import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Exercise the PostgreSQL adapter without connecting to any real database.
const state = {documents: new Map(), content: new Map(), calls: [], intercept: undefined};
const symbol = Symbol.for('cimahub.storage-performance.database');
globalThis[symbol] = {
  async query(sql, params = []) {
    state.calls.push({sql, params});
    if (state.intercept) {
      const result = await state.intercept(sql, params);
      if (result) return result;
    }
    if (sql.startsWith('SELECT body')) {
      const body = state.documents.get(params[0]);
      return {rows: body === undefined ? [] : [{body, updated_at: new Date()}]};
    }
    if (sql.startsWith('SELECT path FROM data_documents')) return {rows: state.documents.has(params[0]) ? [{path: params[0]}] : []};
    if (sql.startsWith('INSERT INTO data_documents')) {
      if (sql.includes('SELECT $2,body,updated_at')) {
        state.documents.set(params[1], state.documents.get(params[0])); return {rowCount: 1};
      }
      const [key, body] = params, previous = state.documents.get(key);
      if (sql.includes('DO NOTHING') && previous !== undefined) return {rowCount: 0};
      state.documents.set(key, sql.includes('data_documents.body ||') && previous !== undefined ? previous + body : body);
      return {rowCount: 1};
    }
    if (sql.startsWith('DELETE FROM data_documents')) {
      state.documents.delete(params[0]); return {rowCount: 1};
    }
    if (sql.startsWith('SELECT * FROM content_items')) return {rows: params[0].map(key => state.content.get(key)).filter(Boolean).map(row => structuredClone(row))};
    if (sql.includes('INSERT INTO content_items')) {
      assert.match(sql, /jsonb_to_recordset/);
      const rows = [];
      for (const item of JSON.parse(params[0])) {
        const previous = state.content.get(item.key), overrides = previous?.overrides || {};
        const row = {...previous, ...item, status: previous?.status || 'published', overrides,
          slug: previous?.slug || item.slug, year: item.year || previous?.year || '',
          name: Object.hasOwn(overrides, 'title') || Object.hasOwn(overrides, 'name') ? previous.name : item.name,
          snapshot: {...previous?.snapshot, ...item.snapshot}};
        state.content.set(item.key, row); rows.push(structuredClone(row));
      }
      return {rows};
    }
    throw new Error(`Unexpected test query: ${sql}`);
  },
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database.js' && /\/(storage|managed-content)\.js$/.test(context.parentURL || '')) return {url: 'cimahub-test:database', shortCircuit: true};
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'cimahub-test:database') return {format: 'module', shortCircuit: true, source: `
      export const dbEnabled = () => true;
      export const query = (...args) => globalThis[Symbol.for('cimahub.storage-performance.database')].query(...args);
      export const transaction = work => work({query});
    `};
    return next(url, context);
  },
});

const storage = await import('../storage.js');
const {rememberAndApply} = await import('../managed-content.js');
const file = name => new URL(`../data/performance-test/${name}.json`, import.meta.url);
const key = name => `data/performance-test/${name}.json`;
const reads = () => state.calls.filter(({sql}) => sql.startsWith('SELECT body')).length;

test('document reads coalesce, preserve encoding and cannot mutate cached bytes', async () => {
  state.calls = [];
  state.documents.set(key('shared'), '{"title":"العنوان"}');
  const values = await Promise.all(Array.from({length: 20}, () => storage.readFile(file('shared'), 'utf8')));
  assert.equal(reads(), 1);
  assert.equal(values[0], '{"title":"العنوان"}');
  assert.ok(values.every(value => value === values[0]));
  const buffer = await storage.readFile(file('shared')); buffer.fill(0);
  assert.equal(await storage.readFile(file('shared'), 'utf8'), values[0]);
  assert.equal(await storage.readFile(file('shared'), 'base64'), Buffer.from(values[0]).toString('base64'));
  assert.equal(reads(), 1);
});

test('document cache expires and refreshes external edits; failures are retried', async t => {
  state.calls = [];
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  state.documents.set(key('expiry'), 'first');
  assert.equal(await storage.readFile(file('expiry'), 'utf8'), 'first');
  state.documents.set(key('expiry'), 'external update');
  now += 2001;
  assert.equal(await storage.readFile(file('expiry'), 'utf8'), 'external update');
  assert.equal(reads(), 2);
  let fail = true;
  state.intercept = async (sql, params) => {
    if (params[0] === key('retry') && fail) { fail = false; throw new Error('temporary database outage'); }
  };
  try {
    await assert.rejects(storage.readFile(file('retry')), /temporary database outage/);
    state.documents.set(key('retry'), 'recovered');
    assert.equal(await storage.readFile(file('retry'), 'utf8'), 'recovered');
  } finally { state.intercept = undefined; }
});

test('missing documents briefly coalesce while local writes and atomic renames invalidate immediately', async () => {
  state.calls = [];
  for (let i = 0; i < 2; i++) await assert.rejects(storage.readFile(file('missing')), {code: 'ENOENT'});
  assert.equal(reads(), 1);
  await storage.writeFile(file('missing'), 'created');
  assert.equal(await storage.readFile(file('missing'), 'utf8'), 'created');
  await storage.writeFile(file('missing'), '+appended', {flag: 'a'});
  assert.equal(await storage.readFile(file('missing'), 'utf8'), 'created+appended');
  await storage.writeFile(file('temporary'), 'replacement');
  assert.equal(await storage.readFile(file('temporary'), 'utf8'), 'replacement');
  await storage.rename(file('temporary'), file('missing'));
  const move = state.calls.find(({sql}) => sql.includes('SELECT $2,body,updated_at'));
  assert.deepEqual(move.params, [key('temporary'), key('missing')], 'renames transfer paths rather than the JSON body');
  assert.equal(await storage.readFile(file('missing'), 'utf8'), 'replacement');
  await assert.rejects(storage.readFile(file('temporary')), {code: 'ENOENT'});
});

test('a read started before a write cannot put the old document back in cache', async () => {
  let resolveRead, started;
  const ready = new Promise(resolve => { started = resolve; });
  state.intercept = (sql, params) => {
    if (sql.startsWith('SELECT body') && params[0] === key('race') && !resolveRead) {
      started(); return new Promise(resolve => { resolveRead = resolve; });
    }
  };
  try {
    const stale = storage.readFile(file('race'), 'utf8'); await ready;
    await storage.writeFile(file('race'), 'new');
    assert.equal(await storage.readFile(file('race'), 'utf8'), 'new');
    resolveRead({rows: [{body: 'old'}]});
    assert.equal(await stale, 'old');
    assert.equal(await storage.readFile(file('race'), 'utf8'), 'new');
  } finally { state.intercept = undefined; }
});

test('document count and retained byte budgets prevent unbounded caching', async () => {
  const huge = 'x'.repeat(17 * 1024 * 1024);
  state.documents.set(key('large'), huge); state.calls = [];
  await storage.readFile(file('large'), 'utf8'); await storage.readFile(file('large'), 'utf8');
  assert.equal(reads(), 2, 'documents exceeding the retained byte budget are not stored');
  state.documents.delete(key('large'));
  for (let i = 0; i < 129; i++) {
    state.documents.set(key(`bounded-${i}`), String(i));
    await storage.readFile(file(`bounded-${i}`), 'utf8');
  }
  const before = reads();
  assert.equal(await storage.readFile(file('bounded-0'), 'utf8'), '0');
  assert.equal(reads(), before + 1, 'old entries are evicted at the count limit');
});

const work = id => ({id, media_type: 'movie', title: `Movie ${id}`, public_path: `/movie-${id}/`, release_date: '2020-01-01'});
test('a displayed collection uses a batch read and only changed snapshots are written', async () => {
  const items = Array.from({length: 24}, (_, i) => work(i + 100));
  state.calls = [];
  assert.equal((await rememberAndApply({results: items}, 'movie')).results.length, 24);
  assert.equal(state.calls.length, 2);
  state.calls = [];
  assert.equal((await rememberAndApply({results: items}, 'movie')).results.length, 24);
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0].sql, /^SELECT/);
  const changed = items.map((item, index) => index === 0 ? {...item, overview: 'Updated story'} : item);
  state.calls = [];
  await rememberAndApply({results: changed}, 'movie');
  assert.equal(state.calls.length, 2);
  assert.equal(JSON.parse(state.calls[1].params[0]).length, 1);
  assert.equal(state.content.get('movie:100').snapshot.overview, 'Updated story');
  await rememberAndApply({results: items}, 'movie');
  assert.equal(state.content.get('movie:100').snapshot.overview, 'Updated story', 'brief list entries preserve detail fields');
});

test('fresh admin overrides, slugs and visibility apply even when the provider snapshot is unchanged', async () => {
  const item = work(500);
  await rememberAndApply(item, 'movie');
  Object.assign(state.content.get('movie:500'), {name: 'Manual name', slug: 'manual-slug', overrides: {title: 'Manual name', overview: 'Manual story', noindex: true}});
  state.calls = [];
  const result = await rememberAndApply(item, 'movie', {detail: true});
  assert.equal(result.title, 'Manual name'); assert.equal(result.overview, 'Manual story');
  assert.equal(result.public_path, '/manual-slug/'); assert.equal(result._adminSeo.noindex, true);
  assert.equal(state.calls.length, 1);
  state.content.get('movie:500').status = 'hidden';
  assert.deepEqual((await rememberAndApply({results: [item]}, 'movie')).results, []);
  await assert.rejects(rememberAndApply(item, 'movie', {detail: true}), {status: 404});
});

test('duplicate recommendations merge into a single write and retain their rendered positions', async () => {
  state.calls = [];
  const result = await rememberAndApply({results: [{...work(600), recommendations: {results: [{...work(600), overview: 'Recommended detail'}, work(601)]}}, work(601)]}, 'movie');
  assert.equal(state.calls.length, 2);
  assert.equal(JSON.parse(state.calls[1].params[0]).length, 2);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].recommendations.results.length, 2);
  assert.equal(state.content.get('movie:600').snapshot.overview, 'Recommended detail');
});
