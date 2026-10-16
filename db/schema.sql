CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'administrator',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_lower ON admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS content_items (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('movie', 'tv')),
  provider_id bigint,
  slug text UNIQUE,
  name text NOT NULL,
  year text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft', 'hidden')),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_items_kind_status ON content_items(kind, status);
CREATE INDEX IF NOT EXISTS content_items_updated ON content_items(updated_at DESC);

CREATE TABLE IF NOT EXISTS site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_sources (
  id bigserial PRIMARY KEY,
  content_key text NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
  season_number integer CHECK (season_number >= 0),
  episode_number integer CHECK (episode_number >= 0),
  kind text NOT NULL CHECK (kind IN ('playback', 'download')),
  label text NOT NULL DEFAULT '',
  url text NOT NULL,
  quality text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_sources_scope ON content_sources(content_key, season_number, episode_number, kind, sort_order);

CREATE TABLE IF NOT EXISTS source_scopes (
  content_key text NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
  season_number integer NOT NULL DEFAULT 0 CHECK (season_number >= 0),
  episode_number integer NOT NULL DEFAULT 0 CHECK (episode_number >= 0),
  managed boolean NOT NULL DEFAULT true,
  PRIMARY KEY (content_key, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS taxonomy (
  key text PRIMARY KEY,
  kind text NOT NULL,
  label text NOT NULL,
  path text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id bigserial PRIMARY KEY,
  job text NOT NULL,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_runs_recent ON job_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS data_documents (
  path text PRIMARY KEY,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS runtime_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_parts (
  content_key text NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number BETWEEN 1 AND 1000),
  episode_number integer NOT NULL DEFAULT 0 CHECK (episode_number BETWEEN 0 AND 10000),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_key, season_number, episode_number)
);
