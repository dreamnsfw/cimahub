import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFile, writeFile, rename, readdir, stat, mkdir} from '../storage.js';
import {dbEnabled, query, transaction, closeDatabase} from '../database.js';
import {rememberAndApply, resolveManaged, managedSources, applyPageOverrides} from '../managed-content.js';

after(closeDatabase);

test('storage leaves test directories and binary files on the filesystem', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'cimahub-storage-'));
  try {
    const first = join(directory, 'first.json'), second = join(directory, 'second.json');
    await writeFile(first, '{"name":"اختبار"}', 'utf8');
    await rename(first, second);
    assert.equal(await readFile(second, 'utf8'), '{"name":"اختبار"}');
    assert.deepEqual(await readdir(directory), ['second.json']);
    assert.equal((await stat(second)).isFile(), true);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('PostgreSQL documents replace JSON storage and preserve atomic renames', {skip: !dbEnabled()}, async () => {
  const folder = `storage-test-${randomUUID()}`;
  const directory = new URL(`../data/${folder}/`, import.meta.url);
  const document = new URL('current.json', directory), temporary = new URL('current.tmp', directory);
  const stale = new URL('disk-only.json', directory);
  const prefix = `data/${folder}/`;
  await mkdir(directory, {recursive: true});
  try {
    await fs.writeFile(stale, '{"stale":true}');
    await assert.rejects(readFile(stale, 'utf8'), {code: 'ENOENT'});
    await assert.rejects(stat(stale), {code: 'ENOENT'});
    assert.deepEqual(await readdir(directory), []);

    await writeFile(document, '{"value":"الأولى"}', 'utf8');
    assert.equal(await readFile(document, 'utf8'), '{"value":"الأولى"}');
    assert.equal(Buffer.isBuffer(await readFile(document)), true);
    await assert.rejects(fs.readFile(document), {code: 'ENOENT'});
    const metadata = await stat(document);
    assert.equal(metadata.size, Buffer.byteLength('{"value":"الأولى"}'));
    assert.equal(metadata.isFile(), true);
    assert.ok(metadata.mtime instanceof Date);

    await writeFile(temporary, '{"value":"الجديدة"}');
    await rename(temporary, document);
    assert.equal(await readFile(document, 'utf8'), '{"value":"الجديدة"}');
    await assert.rejects(readFile(temporary), {code: 'ENOENT'});
    await assert.rejects(rename(temporary, document), {code: 'ENOENT'});
    assert.equal(await readFile(document, 'utf8'), '{"value":"الجديدة"}');
    const entries = await readdir(directory, {withFileTypes: true});
    assert.deepEqual(entries.map(entry => entry.name), ['current.json']);
    assert.equal(entries[0].isFile(), true);

    await assert.rejects(transaction(async client => {
      await client.query('INSERT INTO data_documents(path,body) VALUES($1,$2)', [prefix + 'rollback.json', '{}']);
      throw new Error('rollback example');
    }), /rollback example/);
    await assert.rejects(readFile(new URL('rollback.json', directory)), {code: 'ENOENT'});

    const binary = new URL('asset.bin', directory);
    await writeFile(binary, Buffer.from([0, 1, 255]));
    assert.deepEqual(await fs.readFile(binary), Buffer.from([0, 1, 255]));
  } finally {
    await query('DELETE FROM data_documents WHERE starts_with(path,$1)', [prefix]);
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('manual content changes survive automatic refreshes and sources stay within their episode scope', {skip: !dbEnabled()}, async () => {
  const id = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16), key = `movie:${id}`;
  const slug = `storage-test-${randomUUID()}`, manualSlug = `${slug}-manual`;
  const item = {id, media_type: 'movie', title: 'Automatic name', overview: 'Automatic story', release_date: '2020-01-01', public_path: `/${slug}/`};
  try {
    await rememberAndApply(item, 'movie', {detail: true});
    await query("UPDATE content_items SET updated_at='2020-01-01T00:00:00Z' WHERE key=$1", [key]);
    await rememberAndApply({results: [item, item]}, 'movie');
    assert.equal((await query('SELECT updated_at FROM content_items WHERE key=$1', [key])).rows[0].updated_at.toISOString(), '2020-01-01T00:00:00.000Z');
    await query('UPDATE content_items SET name=$2,slug=$3,overrides=$4::jsonb WHERE key=$1', [key, 'Manual name', manualSlug, JSON.stringify({title: 'Manual name', overview: 'Manual story', seo_title: 'Manual SEO title', noindex: true})]);
    const refreshed = await rememberAndApply({...item, title: 'New automatic name', overview: 'New automatic story'}, 'movie', {detail: true});
    assert.equal(refreshed.title, 'Manual name');
    assert.equal(refreshed.original_title, 'Manual name');
    assert.equal(refreshed.overview, 'Manual story');
    assert.equal(refreshed.public_path, `/${manualSlug}/`);
    assert.equal((await resolveManaged(manualSlug)).id, id);
    const row = (await query('SELECT snapshot,overrides FROM content_items WHERE key=$1', [key])).rows[0];
    assert.equal(row.snapshot.title, 'New automatic name');
    assert.equal(row.overrides.title, 'Manual name');
    const metadata = await applyPageOverrides({title: 'Automatic SEO title', noindex: false}, refreshed);
    assert.equal(metadata.title, 'Manual SEO title');
    assert.equal(metadata.noindex, true);

    const automaticSources = [{quality: 'HD', playback: [{url: 'https://example.com/automatic'}]}];
    assert.deepEqual(await managedSources(item, automaticSources), automaticSources);
    await query('INSERT INTO source_scopes(content_key) VALUES($1)', [key]);
    assert.deepEqual(await managedSources(item, automaticSources), []);
    await query("INSERT INTO content_sources(content_key,season_number,episode_number,kind,url,quality) VALUES($1,0,0,'playback','https://example.com/manual','1080p')", [key]);
    assert.equal((await managedSources(item, automaticSources))[0].playback[0].url, 'https://example.com/manual');
    assert.deepEqual(await managedSources(item, automaticSources, {season: 1, episode: 2}), automaticSources);

    await query("UPDATE content_items SET status='hidden' WHERE key=$1", [key]);
    assert.equal(await resolveManaged(manualSlug), undefined);
    assert.deepEqual((await rememberAndApply({results: [item]}, 'movie')).results, []);
    await assert.rejects(rememberAndApply(item, 'movie', {detail: true}), {status: 404});
  } finally {
    await query('DELETE FROM content_items WHERE key=$1', [key]);
  }
});
