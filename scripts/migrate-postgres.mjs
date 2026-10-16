import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, relative, resolve, sep} from 'node:path';
import {dbEnabled, initializeDatabase, transaction, closeDatabase} from '../database.js';
import {safeLink} from '../qfilm-import.js';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));

async function jsonFiles(directory) {
  let entries;
  try { entries = await readdir(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
  }
  return files;
}

function sourceRows(documents) {
  const parsed = new Map(documents.map(document => [document.path, JSON.parse(document.body)]));
  const matched = {
    ...(parsed.get('data/qfilm-import.json')?.entries || {}),
    ...(parsed.get('data/qfilm-new-import.json')?.entries || {}),
  };
  const sources = new Map(), orders = new Map();
  function add(record, contentKey, season = 0, episode = 0) {
    if (!/^(movie|tv):[1-9]\d*$/.test(contentKey)) return;
    for (const [field, kind] of [['playback', 'playback'], ['downloads', 'download']]) {
      for (const link of record?.[field] || []) {
        const url = safeLink(link.url);
        if (!url) continue;
        const identifier = JSON.stringify([contentKey, season, episode, kind, url]);
        const quality = String(link.quality || record.quality || '').slice(0, 100);
        const previous = sources.get(identifier);
        if (previous) { if (!previous.quality && quality) previous.quality = quality; continue; }
        const scope = `${contentKey}/${season}/${episode}/${kind}`, order = orders.get(scope) || 0;
        orders.set(scope, order + 1);
        sources.set(identifier, {content_key: contentKey, season_number: season, episode_number: episode, kind,
          url, label: String(link.label || new URL(url).hostname).slice(0, 200), quality, sort_order: order});
      }
    }
  }
  for (const record of Object.values(matched)) if (record.status === 'matched') add(record, `movie:${record.tmdbId}`);
  for (const [path, data] of parsed) {
    const movieId = path.match(/^data\/auto-movie-links\/([1-9]\d*)\.json$/)?.[1];
    if (movieId) for (const record of Array.isArray(data) ? data : []) {
      if (record.status === 'matched' && (!record.tmdbId || Number(record.tmdbId) === Number(movieId))) add(record, `movie:${movieId}`);
    }
    const seriesId = path.match(/^data\/series-links\/([1-9]\d*)\.json$/)?.[1];
    if (seriesId && (!data.tmdbId || Number(data.tmdbId) === Number(seriesId))) {
      for (const [episodeKey, record] of Object.entries(data.episodes || {})) {
        const match = episodeKey.match(/^([1-9]\d*)-([1-9]\d*)$/);
        if (!match) continue;
        const season = Number(match[1]), episode = Number(match[2]);
        if (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode) || (record.season && Number(record.season) !== season) || (record.episode && Number(record.episode) !== episode)) continue;
        add(record, `tv:${seriesId}`, season, episode);
      }
    }
  }
  return [...sources.values()];
}

function mergeLegacyDocument(legacy, current) {
  if (legacy && current && typeof legacy === 'object' && typeof current === 'object' && !Array.isArray(legacy) && !Array.isArray(current)) {
    return Object.fromEntries([...new Set([...Object.keys(legacy), ...Object.keys(current)])].map(key => [key,
      Object.hasOwn(current, key) ? mergeLegacyDocument(legacy[key], current[key]) : legacy[key]]));
  }
  return current;
}

export async function migratePostgres() {
  if (!dbEnabled()) throw new Error('Set DATABASE_URL before migrating data to PostgreSQL.');
  await initializeDatabase();
  const files = await jsonFiles(dataDirectory), documents = [];
  let catalog;
  for (const path of files) {
    const body = await readFile(path, 'utf8');
    JSON.parse(body); // Refuse a partial migration if an existing document is corrupt.
    documents.push({path: relative(workspace, path).split(sep).join('/'), body});
    if (path === join(dataDirectory, 'seo-catalog.json')) catalog = JSON.parse(body);
  }
  const works = Object.entries(catalog?.works || {}).flatMap(([key, record]) => {
    const kind = record.type || key.split(':')[0];
    if (!['movie', 'tv'].includes(kind) || !record.slug) return [];
    const providerId = Number(record.id || key.split(':')[1]);
    return [{key, kind, provider_id: Number.isSafeInteger(providerId) && providerId > 0 ? providerId : null, slug: record.slug, name: record.name || record.title || key, year: String(record.year || ''), snapshot: record}];
  });
  return transaction(async connection => {
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('cimahub-data-migration-v1'))");
    let importedDocuments = 0, importedContent = 0, importedSources = 0, mergedDocuments = 0;
    for (let offset = 0; offset < documents.length; offset += 200) {
      const result = await connection.query('INSERT INTO data_documents(path,body) SELECT path,body FROM jsonb_to_recordset($1::jsonb) AS document(path text,body text) ON CONFLICT DO NOTHING', [JSON.stringify(documents.slice(offset, offset + 200))]);
      importedDocuments += result.rowCount;
    }
    // A server started before its first migration can have created partial documents.
    // Fill missing legacy object keys once; newer database values always take precedence.
    const restored = (await connection.query("SELECT value FROM runtime_state WHERE key='legacy-json-migration-v1'")).rows.length > 0;
    if (!restored) {
      const legacyByPath = new Map(documents.map(document => [document.path, JSON.parse(document.body)]));
      const existing = (await connection.query('SELECT path,body FROM data_documents WHERE path=ANY($1::text[]) FOR UPDATE', [[...legacyByPath.keys()]])).rows;
      for (const document of existing) {
        const current = JSON.parse(document.body), merged = mergeLegacyDocument(legacyByPath.get(document.path), current);
        if (JSON.stringify(current) !== JSON.stringify(merged)) {
          await connection.query('UPDATE data_documents SET body=$2,updated_at=clock_timestamp() WHERE path=$1', [document.path, JSON.stringify(merged)]);
          mergedDocuments++;
        }
      }
    }
    for (let offset = 0; offset < works.length; offset += 200) {
      const result = await connection.query('INSERT INTO content_items(key,kind,provider_id,slug,name,year,snapshot) SELECT key,kind,provider_id,slug,name,year,snapshot FROM jsonb_to_recordset($1::jsonb) AS item(key text,kind text,provider_id bigint,slug text,name text,year text,snapshot jsonb) ON CONFLICT DO NOTHING', [JSON.stringify(works.slice(offset, offset + 200))]);
      importedContent += result.rowCount;
    }
    // Read the database documents here so rerunning migration respects newer automatic imports.
    const sourceDocuments = (await connection.query("SELECT path,body FROM data_documents WHERE path=ANY($1::text[]) OR starts_with(path,'data/auto-movie-links/') OR starts_with(path,'data/series-links/')", [['data/qfilm-import.json', 'data/qfilm-new-import.json']])).rows;
    const sources = sourceRows(sourceDocuments);
    for (let offset = 0; offset < sources.length; offset += 200) {
      const result = await connection.query(`INSERT INTO content_sources(content_key,season_number,episode_number,kind,label,url,quality,sort_order)
        SELECT source.content_key,source.season_number,source.episode_number,source.kind,source.label,source.url,source.quality,source.sort_order
        FROM jsonb_to_recordset($1::jsonb) AS source(content_key text,season_number integer,episode_number integer,kind text,label text,url text,quality text,sort_order integer)
        JOIN content_items item ON item.key=source.content_key
        WHERE NOT EXISTS (SELECT 1 FROM content_sources existing WHERE existing.content_key=source.content_key
          AND coalesce(existing.season_number,0)=source.season_number AND coalesce(existing.episode_number,0)=source.episode_number
          AND existing.kind=source.kind AND existing.url=source.url)
        AND NOT EXISTS (SELECT 1 FROM source_scopes scope WHERE scope.content_key=source.content_key
          AND scope.season_number=source.season_number AND scope.episode_number=source.episode_number AND scope.managed)`, [JSON.stringify(sources.slice(offset, offset + 200))]);
      importedSources += result.rowCount;
    }
    await connection.query("INSERT INTO runtime_state(key,value) VALUES('legacy-json-migration-v1',$1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify({completedAt: new Date().toISOString(), files: documents.length, works: works.length})]);
    return {documentsFound: documents.length, documentsImported: importedDocuments, documentsMerged: mergedDocuments, contentFound: works.length, contentImported: importedContent, sourcesFound: sources.length, sourcesImported: importedSources};
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await migratePostgres(), null, 2)); }
  catch (error) { console.error('PostgreSQL migration failed:', error.code || error.message); process.exitCode = 1; }
  finally { await closeDatabase(); }
}
