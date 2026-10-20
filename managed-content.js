import {dbEnabled, query} from './database.js';
import {safeLink} from './qfilm-import.js';
import {movieIdentityTitle} from './movie-presentation.js';
import {isDeepStrictEqual} from 'node:util';
import {d1Enabled} from './d1-client.js';

const defaults = Object.freeze({
  site_name: 'سيما هَب', site_description: '', contact_email: '', maintenance: false,
  maintenance_message: 'الموقع تحت الصيانة', header_notice: '', home_recent_limit: 12,
  sync_enabled: true, sync_interval_hours: 5,
});
let settingsCache, settingsExpires = 0, settingsPending, cacheRevision = 0;
let activeQueries = 0;
const waitingQueries = [];

async function limitedQuery(...args) {
  if (activeQueries < 5) activeQueries++;
  else await new Promise(resolve => waitingQueries.push(resolve));
  try { return await query(...args); }
  finally { const next = waitingQueries.shift(); if (next) next(); else activeQueries--; }
}

const workKind = (item, fallback) => item?.media_type || fallback || (item?.title ? 'movie' : item?.name ? 'tv' : undefined);
const workKey = (item, fallback) => {
  const kind = workKind(item, fallback), id = Number(item?.id);
  return ['movie', 'tv'].includes(kind) && Number.isSafeInteger(id) && id > 0 ? `${kind}:${id}` : null;
};
const own = (object, field) => Object.hasOwn(object || {}, field);
const pageSeo = overrides => ({title: overrides.seo_title, description: overrides.seo_description, noindex: overrides.noindex});

function applyOverrides(item, row) {
  const overrides = row.overrides || {}, result = {...item, ...overrides};
  const type = row.kind, field = type === 'movie' ? 'title' : 'name';
  if (own(overrides, field) || own(overrides, 'name') || own(overrides, 'title')) {
    const name = overrides[field] ?? overrides.name ?? overrides.title;
    result[field] = name;
    result[type === 'movie' ? 'original_title' : 'original_name'] = name;
    if (type === 'movie') {
      result.english_title = name;
      result.display_title = movieIdentityTitle(result);
    } else {
      delete result.display_title;
      delete result.series_display_title;
    }
  } else if (type === 'movie' && item.display_title && ['release_date', 'original_language', 'genre_ids', 'genres'].some(field => own(overrides, field))) {
    result.display_title = movieIdentityTitle(result);
  }
  if (own(overrides, 'genres') && !own(overrides, 'genre_ids')) result.genre_ids = overrides.genres.map(genre => genre.id);
  if (own(overrides, 'genre_ids') && !own(overrides, 'genres') && result.genres) result.genres = result.genres.filter(genre => overrides.genre_ids.includes(genre.id));
  result.public_path = row.slug ? `/${row.slug}/` : item.public_path;
  result._adminSeo = pageSeo(overrides);
  if (own(overrides, 'adult_category')) result.source_adult_category = overrides.adult_category;
  delete result.seo_title;
  delete result.seo_description;
  delete result.noindex;
  delete result.adult_category;
  return result;
}

export async function rememberAndApply(data, fallbackType, {detail = false, persist = true} = {}) {
  if (!dbEnabled()) return data;
  const incoming = new Map();
  function collect(value, fallback) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) collect(item, fallback); return; }
    if (Array.isArray(value.results)) { collect(value.results, fallback); return; }
    const key = workKey(value, fallback);
    if (!key || (!value.title && !value.name)) return;
    const kind = key.split(':')[0], provider_id = Number(value.id);
    const slug = String(value.public_path || '').match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/)?.[1] || null;
    const name = String(value[kind === 'movie' ? 'title' : 'name'] || value.title || value.name);
    const year = String(value.release_date || value.first_air_date || '').slice(0, 4);
    const {_adminSeo, ...snapshot} = value, previous = incoming.get(key);
    incoming.set(key, {key, kind, provider_id, slug: previous?.slug || slug, name,
      year: year || previous?.year || '', snapshot: {...previous?.snapshot, ...snapshot}});
    if (value.recommendations) collect(value.recommendations, kind);
  }
  collect(data, fallbackType);

  // Read current status and overrides once for the whole displayed collection.
  // Unchanged provider snapshots need no UPDATE or updated_at/index churn.
  const rowsByKey = new Map(incoming.size ? (await limitedQuery('SELECT * FROM content_items WHERE key=ANY($1::text[])', [[...incoming.keys()]])).rows.map(row => [row.key, row]) : []);
  const changes = [];
  for (const candidate of incoming.values()) {
    candidate.snapshot = JSON.parse(JSON.stringify(candidate.snapshot));
    const row = rowsByKey.get(candidate.key), manualName = own(row?.overrides, 'title') || own(row?.overrides, 'name');
    if (!row || !isDeepStrictEqual({...row.snapshot, ...candidate.snapshot}, row.snapshot)
      || (!manualName && row.name !== candidate.name)
      || (candidate.year && row.year !== candidate.year) || (!row.slug && candidate.slug)) changes.push(candidate);
  }
  if (persist && changes.length) {
    const {rows} = await limitedQuery(`
      INSERT INTO content_items(key,kind,provider_id,slug,name,year,snapshot)
      SELECT key,kind,provider_id,slug,name,year,snapshot
      FROM jsonb_to_recordset($1::jsonb) AS incoming(key text,kind text,provider_id bigint,slug text,name text,year text,snapshot jsonb)
      ORDER BY key
      ON CONFLICT(key) DO UPDATE SET
        snapshot=content_items.snapshot || EXCLUDED.snapshot,
        name=CASE WHEN content_items.overrides ? 'title' OR content_items.overrides ? 'name' THEN content_items.name ELSE EXCLUDED.name END,
        year=CASE WHEN EXCLUDED.year='' THEN content_items.year ELSE EXCLUDED.year END,
        slug=coalesce(content_items.slug,EXCLUDED.slug),updated_at=now()
      RETURNING *`, [JSON.stringify(changes)]);
    for (const row of rows) rowsByKey.set(row.key, row);
  }
  function visit(value, fallback, isDetail = false) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => visit(item, fallback)).filter(Boolean);
    if (Array.isArray(value.results)) return {...value, results: visit(value.results, fallback)};
    const key = workKey(value, fallback);
    if (!key || (!value.title && !value.name)) return value;
    const kind = key.split(':')[0], row = rowsByKey.get(key);
    if (!row) return value;
    if (row.status !== 'published') {
      if (isDetail) throw Object.assign(new Error('العمل غير موجود'), {status: 404});
      return null;
    }
    let result = applyOverrides({...row.snapshot, ...value}, row);
    if (value.recommendations) result.recommendations = visit(value.recommendations, kind);
    return result;
  }
  return visit(data, fallbackType, detail);
}

export async function resolveManaged(slug) {
  if (!dbEnabled()) return undefined;
  const row = (await query("SELECT provider_id,kind,slug,name,status FROM content_items WHERE slug=$1 AND status='published'", [slug])).rows[0];
  return row ? {id: Number(row.provider_id), type: row.kind, slug: row.slug, name: row.name, status: row.status} : undefined;
}

export async function managedWorks() {
  if (!dbEnabled()) return [];
  const {rows} = await query(d1Enabled()?`SELECT key,kind,provider_id,slug,name,year,status,overrides,
    snapshot->>'indexable' AS stored_indexable,snapshot->>'poster_path' AS stored_poster,
    snapshot->>'title' AS stored_title,snapshot->>'description' AS stored_description,
    snapshot->>'overview' AS stored_overview,snapshot->>'adult' AS stored_adult
    FROM content_items ORDER BY key`:'SELECT * FROM content_items ORDER BY key');
  if(d1Enabled())for(const row of rows)row.snapshot={indexable:row.stored_indexable===null?undefined:Boolean(row.stored_indexable),poster_path:row.stored_poster,title:row.stored_title,description:row.stored_description,overview:row.stored_overview,adult:Boolean(row.stored_adult)};
  return rows.map(row => {
    const snapshot = row.snapshot || {}, overrides = row.overrides || {};
    const name = overrides[row.kind === 'movie' ? 'title' : 'name'] || row.name;
    return {...snapshot, id: Number(row.provider_id), type: row.kind, slug: row.slug, name,
      year: String(overrides.release_date || overrides.first_air_date || row.year || '').slice(0, 4),
      status: row.status, indexable: row.status === 'published' && !snapshot.adult && (typeof overrides.noindex==='boolean'?!overrides.noindex:snapshot.indexable!==false),
      poster: overrides.poster_path ?? snapshot.poster_path ?? snapshot.poster,
      title: overrides.seo_title || snapshot.title,
      description: overrides.seo_description || snapshot.description || snapshot.overview};
  });
}

export async function managedSources(item, existing, {season = 0, episode = 0} = {}) {
  const key = workKey(item);
  if (!dbEnabled() || !key) return existing;
  const {rows} = await query(`SELECT scope.managed,source.* FROM source_scopes scope
    LEFT JOIN content_sources source ON source.content_key=scope.content_key
      AND coalesce(source.season_number,0)=scope.season_number
      AND coalesce(source.episode_number,0)=scope.episode_number AND source.active
    WHERE scope.content_key=$1 AND scope.season_number=$2 AND scope.episode_number=$3
    ORDER BY source.sort_order,source.id`, [key, season, episode]);
  if (!rows.length || !rows[0].managed) return existing;
  const groups = new Map();
  for (const row of rows) {
    if (!row.id) continue;
    const url = safeLink(row.url);
    if (!url) continue;
    const quality = row.quality || '';
    if (!groups.has(quality)) groups.set(quality, {quality, playback: [], downloads: []});
    groups.get(quality)[row.kind === 'download' ? 'downloads' : 'playback'].push({url, label: row.label || '', quality});
  }
  return [...groups.values()];
}

export function invalidateManagedCaches() {
  cacheRevision++;
  settingsCache = undefined;
  settingsPending = undefined;
  settingsExpires = 0;
}

export async function currentSettings() {
  if (!dbEnabled()) return {...defaults};
  if (settingsCache && Date.now() < settingsExpires) return {...settingsCache};
  if (!settingsPending) {
    const revision = cacheRevision;
    const pending = query('SELECT key,value FROM site_settings').then(({rows}) => {
      const settings = {...defaults};
      for (const {key, value} of rows) {
        if (!own(defaults, key) || typeof value !== typeof defaults[key]) continue;
        if (key === 'home_recent_limit' && (!Number.isInteger(value) || value < 1 || value > 48)) continue;
        if (key === 'sync_interval_hours' && (!Number.isInteger(value) || value < 1 || value > 168)) continue;
        settings[key] = value;
      }
      if (revision === cacheRevision) { settingsCache = settings; settingsExpires = Date.now() + 2000; }
      return settings;
    }).finally(() => { if (settingsPending === pending) settingsPending = undefined; });
    settingsPending = pending;
  }
  return {...await settingsPending};
}

export async function applyPageOverrides(metadata, item) {
  let overrides = item?._adminSeo;
  if (!overrides && dbEnabled()) {
    const key = workKey(item);
    if (key) {
      const row = (await query('SELECT overrides FROM content_items WHERE key=$1', [key])).rows[0];
      if (row) overrides = pageSeo(row.overrides || {});
    }
  }
  if (!overrides) return metadata;
  const result = {...metadata};
  if (typeof overrides.title === 'string' && overrides.title.trim()) result.title = overrides.title.trim();
  if (typeof overrides.description === 'string' && overrides.description.trim()) result.description = overrides.description.trim();
  if (typeof overrides.noindex === 'boolean') result.noindex = overrides.noindex;
  return result;
}
