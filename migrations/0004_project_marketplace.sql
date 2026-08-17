CREATE TABLE IF NOT EXISTS project_metadata (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'read',
  status TEXT NOT NULL DEFAULT 'active',
  model TEXT,
  content_fingerprint TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_metadata_user_updated ON project_metadata(user_id, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS marketplace_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  authority TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_security_advisories (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  affected_versions TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_plugin_state (
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  device_install_required INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, plugin_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

