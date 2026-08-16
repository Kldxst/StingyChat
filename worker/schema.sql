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
