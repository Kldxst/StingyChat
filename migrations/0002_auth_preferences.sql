CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cp_sub TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'required',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL,
  favorite_models_json TEXT NOT NULL DEFAULT '[]',
  personalization_json TEXT,
  onboarding_ciphertext TEXT,
  onboarding_iv TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'required',
  updated_at_ms INTEGER NOT NULL
);
