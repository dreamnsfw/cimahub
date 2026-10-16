import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const sourceEnv = parseEnv(await readFile('.env', 'utf8'));
const targetEnv = parseEnv(await readFile('.env.neon', 'utf8'));
const sourceUrl = new URL(sourceEnv.DATABASE_URL);
const targetUrl = new URL(targetEnv.DATABASE_URL);
if (sourceUrl.hostname !== '127.0.0.1' || !targetUrl.hostname.endsWith('.neon.tech')) {
  throw new Error('Expected a local source database and a Neon destination.');
}

const source = new pg.Client({connectionString: sourceUrl.href, connectionTimeoutMillis: 10000});
const target = new pg.Client({connectionString: targetUrl.href, connectionTimeoutMillis: 10000});
const directory = path.resolve('.runtime/neon-migration');
await mkdir(directory, {recursive: true});
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const backup = path.join(directory, `${stamp}.dump`);
const workers = [];

function run(binary, args, url) {
  const connection = new URL(url);
  const password = decodeURIComponent(connection.password);
  connection.password = '';
  return new Promise((resolve, reject) => {
    const child = spawn(path.resolve('.runtime/postgres/bin', binary), [...args, '--dbname', connection.href], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {...process.env, PGPASSWORD: password},
    });
    let diagnostic = '';
    child.stderr.on('data', chunk => {diagnostic += chunk;});
    child.on('error', () => reject(new Error(`${binary} could not start.`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else {
        const sanitized = diagnostic.replaceAll(password, '[redacted]').replaceAll(url, '[redacted]');
        reject(new Error(`${binary} failed (${code}): ${sanitized}`));
      }
    });
  });
}

async function manifest(client) {
  const {rows} = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tables = [];
  for (const {tablename} of rows) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const {rows: values} = await client.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(hash, '' ORDER BY hash), '')) AS checksum FROM (SELECT md5(row_to_json(t)::text) AS hash FROM public.${quoted} t) rows`);
    tables.push({table: tablename, ...values[0]});
  }
  return tables;
}

try {
  await source.connect();
  await target.connect();
  const {rows: occupied} = await target.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'");
  if (occupied[0].count !== 0) throw new Error('Destination is not empty; refusing to overwrite it.');
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await source.query("SET LOCAL TIME ZONE 'UTC'");
  await target.query("SET TIME ZONE 'UTC'");
  const {rows: snapshot} = await source.query('SELECT pg_export_snapshot() AS id');
  const expected = await manifest(source);
  console.log(JSON.stringify({stage: 'snapshot', tables: expected.length, content: expected.find(t => t.table === 'content_items')?.count}));
  await run('pg_dump.exe', ['--format=custom', '--schema-only', '--no-owner', '--no-privileges', '--snapshot', snapshot[0].id, '--file', backup], sourceUrl.href);
  const batches = [];
  let totalBytes = 0;
  for (const {table} of expected) {
    const qualified = 'public."' + table.replaceAll('"', '""') + '"';
    const {rows} = await source.query(`SELECT row_to_json(t)::text AS payload FROM ${qualified} t`);
    let values = [], bytes = 0;
    const flush = () => {
      if (values.length) batches.push({qualified, payload: '[' + values.join(',') + ']'});
      values = []; bytes = 0;
    };
    for (const {payload} of rows) {
      const size = Buffer.byteLength(payload, 'utf8');
      if (values.length && (bytes + size > 128 * 1024 || values.length >= 150)) flush();
      values.push(payload); bytes += size + 1; totalBytes += size;
    }
    flush();
  }
  const {rows: sequences} = await source.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  const sequenceStates = [];
  for (const {sequencename} of sequences) {
    const qualified = 'public."' + sequencename.replaceAll('"', '""') + '"';
    const {rows} = await source.query(`SELECT last_value::text, is_called FROM ${qualified}`);
    sequenceStates.push({qualified, ...rows[0]});
  }
  await source.query('COMMIT');
  await run('pg_restore.exe', ['--section=pre-data', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', backup], targetUrl.href);
  console.log(JSON.stringify({stage: 'uploading_batches', batches: batches.length, bytes: totalBytes}));
  let next = 0, completed = 0;
  const count = Math.min(6, batches.length);
  for (let i = 0; i < count; i++) {
    const worker = new pg.Client({connectionString: targetUrl.href, connectionTimeoutMillis: 10000});
    workers.push(worker);
    await worker.connect();
    await worker.query("SET TIME ZONE 'UTC'");
  }
  const results = await Promise.allSettled(workers.map(async worker => {
    while (next < batches.length) {
      const batch = batches[next++];
      await worker.query(`INSERT INTO ${batch.qualified} SELECT * FROM json_populate_recordset(NULL::${batch.qualified}, $1::json)`, [batch.payload]);
      completed++;
      if (completed % 25 === 0 || completed === batches.length) console.log(JSON.stringify({stage: 'upload_progress', completed, total: batches.length}));
    }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  for (const state of sequenceStates) await target.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)', [state.qualified, state.last_value, state.is_called]);
  await run('pg_restore.exe', ['--section=post-data', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', backup], targetUrl.href);
  const actual = await manifest(target);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Destination verification differs from the exported snapshot.');
  await writeFile(path.join(directory, `${stamp}.manifest.json`), JSON.stringify({verifiedAt: new Date().toISOString(), backup, tables: actual}, null, 2));
  console.log(JSON.stringify({stage: 'verified', tables: actual.map(({table, count}) => ({table, count}))}));
} catch (error) {
  await source.query('ROLLBACK').catch(() => {});
  const safe = String(error.message).replaceAll(sourceUrl.href, '[redacted]').replaceAll(targetUrl.href, '[redacted]');
  console.error(safe);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.end(), target.end(), ...workers.map(worker => worker.end())]);
}
