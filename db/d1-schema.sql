PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
 id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'administrator',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_lower ON admin_users(lower(email));
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
 csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS content_items (
 key TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('movie','tv')),
 provider_id INTEGER, slug TEXT UNIQUE, name TEXT NOT NULL, year TEXT,
 status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft','hidden')),
 overrides TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides)),
 snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS content_items_kind_status ON content_items(kind,status);
CREATE INDEX IF NOT EXISTS content_items_updated ON content_items(updated_at DESC);
CREATE TABLE IF NOT EXISTS site_settings (
 key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS content_sources (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 content_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
 season_number INTEGER CHECK(season_number>=0), episode_number INTEGER CHECK(episode_number>=0),
 kind TEXT NOT NULL CHECK(kind IN ('playback','download')), label TEXT NOT NULL DEFAULT '',
 url TEXT NOT NULL, quality TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS content_sources_scope ON content_sources(content_key,season_number,episode_number,kind,sort_order);
CREATE TABLE IF NOT EXISTS source_scopes (
 content_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
 season_number INTEGER NOT NULL DEFAULT 0 CHECK(season_number>=0),
 episode_number INTEGER NOT NULL DEFAULT 0 CHECK(episode_number>=0),
 managed INTEGER NOT NULL DEFAULT 1 CHECK(managed IN (0,1)),
 PRIMARY KEY(content_key,season_number,episode_number)
);
CREATE TABLE IF NOT EXISTS taxonomy (
 key TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS job_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, status TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS job_runs_recent ON job_runs(created_at DESC);
CREATE TABLE IF NOT EXISTS runtime_state (
 key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS content_parts (
 content_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
 season_number INTEGER NOT NULL CHECK(season_number BETWEEN 1 AND 1000),
 episode_number INTEGER NOT NULL DEFAULT 0 CHECK(episode_number BETWEEN 0 AND 10000),
 data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(content_key,season_number,episode_number)
);

-- Store SEO records individually: page requests must not read or rewrite the
-- entire catalog, and large legacy documents cannot fit in a single D1 row.
CREATE TABLE IF NOT EXISTS seo_records (
 namespace TEXT NOT NULL CHECK(namespace IN ('works','images','pages','collections')),
 key TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)),
 PRIMARY KEY(namespace,key)
);
CREATE TABLE IF NOT EXISTS data_documents (
 path TEXT PRIMARY KEY NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0),
 revision TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS data_document_chunks (
 path TEXT NOT NULL REFERENCES data_documents(path) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal>=0), body TEXT NOT NULL,
 PRIMARY KEY(path,ordinal)
);
