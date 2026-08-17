ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER NOT NULL DEFAULT 104857600;
ALTER TABLE users ADD COLUMN storage_usage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_at_ms INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;
ALTER TABLE chat_logs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE admin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_admin_audit_created ON admin_audit_events(created_at_ms DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit_events(target_user_id, created_at_ms DESC);

CREATE TABLE user_usage_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  chat_requests INTEGER NOT NULL DEFAULT 0,
  assist_requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE cloud_conversations (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_profile_id TEXT NOT NULL,
  memory_json TEXT NOT NULL DEFAULT '{}',
  title_generated INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_cloud_conversations_changed ON cloud_conversations(user_id, updated_at_ms DESC);

CREATE TABLE cloud_messages (
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, conversation_id) REFERENCES cloud_conversations(user_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_cloud_messages_conversation ON cloud_messages(user_id, conversation_id, created_at_ms);

CREATE TABLE conversation_payload_chunks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  payload_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('attachment_text', 'artifact')),
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, payload_id, chunk_index),
  FOREIGN KEY (user_id, conversation_id) REFERENCES cloud_conversations(user_id, id) ON DELETE CASCADE
);

CREATE TABLE conversation_tombstones (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  deleted_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX idx_conversation_tombstones_expiry ON conversation_tombstones(expires_at_ms);
