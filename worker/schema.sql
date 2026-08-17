CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_text TEXT NOT NULL,
  user_id TEXT,
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
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, cp_sub TEXT NOT NULL UNIQUE, username TEXT NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, onboarding_status TEXT NOT NULL DEFAULT 'required', role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', storage_quota_bytes INTEGER NOT NULL DEFAULT 104857600, storage_usage_bytes INTEGER NOT NULL DEFAULT 0, suspended_at_ms INTEGER, suspended_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 0, settings_json TEXT NOT NULL, favorite_models_json TEXT NOT NULL DEFAULT '[]', personalization_json TEXT, onboarding_ciphertext TEXT, onboarding_iv TEXT, onboarding_status TEXT NOT NULL DEFAULT 'required', updated_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_permission_overrides (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(user_id,permission));
CREATE TABLE IF NOT EXISTS admin_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', ip TEXT, created_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_usage_daily (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, usage_date TEXT NOT NULL, chat_requests INTEGER NOT NULL DEFAULT 0, assist_requests INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,usage_date));
CREATE TABLE IF NOT EXISTS cloud_conversations (id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '', provider_profile_id TEXT NOT NULL, memory_json TEXT NOT NULL DEFAULT '{}', title_generated INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS cloud_messages (id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,conversation_id) REFERENCES cloud_conversations(user_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS conversation_payload_chunks (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL, payload_id TEXT NOT NULL, kind TEXT NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, size_bytes INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(user_id,payload_id,chunk_index), FOREIGN KEY(user_id,conversation_id) REFERENCES cloud_conversations(user_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS conversation_tombstones (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL, deleted_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, PRIMARY KEY(user_id,conversation_id));
