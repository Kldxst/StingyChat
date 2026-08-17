CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_ip ON chat_logs(ip);

CREATE TABLE IF NOT EXISTS ip_restrictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cidr TEXT NOT NULL UNIQUE,
  block_chat INTEGER NOT NULL DEFAULT 0,
  block_assist INTEGER NOT NULL DEFAULT 0,
  block_web_search INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User-facing tables are also maintained as an idempotent migration.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, cp_sub TEXT NOT NULL UNIQUE, username TEXT NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, onboarding_status TEXT NOT NULL DEFAULT 'required', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 0, settings_json TEXT NOT NULL, favorite_models_json TEXT NOT NULL DEFAULT '[]', personalization_json TEXT, onboarding_ciphertext TEXT, onboarding_iv TEXT, onboarding_status TEXT NOT NULL DEFAULT 'required', updated_at_ms INTEGER NOT NULL);
