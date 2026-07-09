PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 10,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size TEXT NOT NULL,
  blob_url TEXT,
  source_reference TEXT,
  source_published_at TEXT,
  tags_json TEXT DEFAULT '[]',
  is_public INTEGER DEFAULT 0,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_results (
  podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  summary TEXT,
  summary_zh TEXT,
  summary_en TEXT,
  brief_summary TEXT,
  translation TEXT,
  highlights TEXT,
  mind_map_json TEXT,
  mind_map_json_zh TEXT,
  mind_map_json_en TEXT,
  full_text_bilingual_json TEXT,
  summary_bilingual_json TEXT,
  bilingual_alignment_version INTEGER DEFAULT 0,
  token_count INTEGER,
  word_count INTEGER,
  character_count INTEGER,
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  current_task TEXT,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  status_message TEXT,
  attempts INTEGER DEFAULT 0,
  worker_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS qa_messages (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  suggested_question INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qa_messages_podcast_created_at
  ON qa_messages (podcast_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qa_context_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  source TEXT NOT NULL,
  start_sec INTEGER,
  end_sec INTEGER,
  content TEXT NOT NULL,
  content_tsv TEXT,
  embedding_json TEXT,
  embedding_model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (podcast_id, source, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_podcast
  ON qa_context_chunks (podcast_id, source, chunk_index);

CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_content
  ON qa_context_chunks (podcast_id, source, chunk_index, id);

CREATE TABLE IF NOT EXISTS extension_transcription_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  provider_task_id TEXT,
  podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
  audio_blob_url TEXT,
  source_reference TEXT,
  original_file_name TEXT,
  title TEXT,
  video_id TEXT,
  is_public INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_user_created
  ON extension_transcription_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_provider_task
  ON extension_transcription_jobs (provider_task_id);

CREATE TABLE IF NOT EXISTS extension_monitor_tasks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  client_task_id TEXT,
  trace_id TEXT,
  source_reference TEXT,
  video_id TEXT,
  title TEXT,
  is_public INTEGER DEFAULT 0,
  transcription_job_id TEXT,
  podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
  provider_task_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_http_status INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extension_monitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES extension_monitor_tasks(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  stage TEXT NOT NULL,
  endpoint TEXT,
  http_status INTEGER,
  message TEXT,
  request_headers TEXT,
  request_body TEXT,
  response_headers TEXT,
  response_body TEXT,
  error_stack TEXT,
  meta TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_created
  ON extension_monitor_tasks (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_status_path_updated
  ON extension_monitor_tasks (status, path, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_user_created
  ON extension_monitor_tasks (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_transcription_job
  ON extension_monitor_tasks (transcription_job_id);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_podcast
  ON extension_monitor_tasks (podcast_id);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_trace
  ON extension_monitor_tasks (trace_id);

CREATE INDEX IF NOT EXISTS idx_extension_monitor_events_task_created
  ON extension_monitor_events (task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  ref_type TEXT,
  ref_id TEXT,
  created_by TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_ref
  ON credit_transactions (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created
  ON admin_audit_logs (created_at DESC);

INSERT INTO credit_transactions (
  id,
  user_id,
  delta,
  balance_after,
  reason,
  source,
  note
)
SELECT
  'migration-balance-' || u.id,
  u.id,
  0,
  u.credits,
  'migration_balance_snapshot',
  'cloudflare_migration',
  'Balance snapshot after Cloudflare migration'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM credit_transactions t
  WHERE t.user_id = u.id
    AND t.reason = 'migration_balance_snapshot'
);

CREATE TABLE IF NOT EXISTS mcp_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_prefix TEXT UNIQUE NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  vault_label TEXT,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  last_ip TEXT,
  last_user_agent TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_user_created
  ON mcp_access_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_prefix
  ON mcp_access_tokens (token_prefix);

CREATE TABLE IF NOT EXISTS mcp_access_logs (
  id TEXT PRIMARY KEY,
  token_id TEXT REFERENCES mcp_access_tokens(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tool TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ok INTEGER DEFAULT 1,
  error_code TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_access_logs_user_created
  ON mcp_access_logs (user_id, created_at DESC);
