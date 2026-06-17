CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  user_message_count INTEGER NOT NULL DEFAULT 0,
  assistant_message_count INTEGER NOT NULL DEFAULT 0,
  last_intent TEXT,
  last_outcome TEXT,
  pending_action TEXT,
  customer_email_hash TEXT,
  order_number_hash TEXT,
  zoho_ticket_id TEXT,
  quality_status TEXT NOT NULL DEFAULT 'unreviewed',
  quality_score INTEGER,
  quality_notes TEXT,
  reviewed_at INTEGER,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS conversations_last_seen_idx ON conversations(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS conversations_quality_status_idx ON conversations(quality_status);
CREATE INDEX IF NOT EXISTS conversations_last_intent_idx ON conversations(last_intent);
CREATE INDEX IF NOT EXISTS conversations_last_outcome_idx ON conversations(last_outcome);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  content_redacted TEXT NOT NULL,
  intent TEXT,
  outcome TEXT,
  pending_action TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
  ON conversation_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  user_content TEXT NOT NULL,
  user_content_redacted TEXT NOT NULL,
  assistant_content TEXT,
  assistant_content_redacted TEXT,
  intent TEXT NOT NULL,
  outcome TEXT NOT NULL,
  pending_action TEXT,
  issue_type TEXT,
  issue_summary TEXT,
  order_number_hash TEXT,
  customer_email_hash TEXT,
  zoho_ticket_id TEXT,
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'unreviewed',
  quality_score INTEGER,
  quality_notes TEXT,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_turns_conversation_created_idx
  ON conversation_turns(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_turns_created_idx ON conversation_turns(created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_intent_outcome_idx ON conversation_turns(intent, outcome);
CREATE INDEX IF NOT EXISTS conversation_turns_quality_status_idx ON conversation_turns(quality_status);

CREATE TABLE IF NOT EXISTS analytics_tool_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_tool_events_conversation_created_idx
  ON analytics_tool_events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS analytics_tool_events_name_idx ON analytics_tool_events(name);
