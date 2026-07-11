CREATE TABLE IF NOT EXISTS infographic_jobs (
  podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  artifact_url TEXT,
  artifact_media_type TEXT,
  source_title TEXT NOT NULL,
  source_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at DATETIME,
  lease_expires_at DATETIME,
  worker_id TEXT,
  cost_usd REAL,
  error_code TEXT,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_infographic_jobs_due
ON infographic_jobs(status, next_attempt_at, updated_at);
