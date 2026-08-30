PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS watchless_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('url', 'mcp_bundle')),
  source_url TEXT,
  video_id TEXT,
  title TEXT,
  preferred_language TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'awaiting_upload', 'queued', 'preparing', 'transcribing',
    'segmenting', 'rendering', 'validating', 'publishing', 'completed',
    'failed', 'cancelled', 'rolled_back'
  )),
  stage TEXT,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 100,
  workflow_instance_id TEXT,
  container_instance_name TEXT,
  model TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  rights_confirmed INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credit_status TEXT NOT NULL DEFAULT 'none' CHECK (credit_status IN ('none', 'reserved', 'charged', 'refunded')),
  idempotency_key TEXT,
  output_podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchless_jobs_user_idempotency
  ON watchless_jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_watchless_jobs_user_created
  ON watchless_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchless_jobs_status_updated
  ON watchless_jobs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchless_jobs_video_status
  ON watchless_jobs (video_id, status);

CREATE TRIGGER IF NOT EXISTS watchless_single_active_video_insert
BEFORE INSERT ON watchless_jobs
WHEN NEW.video_id IS NOT NULL
  AND NEW.status IN (
    'created', 'awaiting_upload', 'queued', 'preparing', 'transcribing',
    'segmenting', 'rendering', 'validating', 'publishing'
  )
  AND EXISTS (
    SELECT 1 FROM watchless_jobs
    WHERE video_id = NEW.video_id
      AND status IN (
        'created', 'awaiting_upload', 'queued', 'preparing', 'transcribing',
        'segmenting', 'rendering', 'validating', 'publishing'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'WATCHLESS_VIDEO_ACTIVE');
END;

CREATE TRIGGER IF NOT EXISTS watchless_single_active_video_update
BEFORE UPDATE OF video_id, status ON watchless_jobs
WHEN NEW.video_id IS NOT NULL
  AND NEW.status IN (
    'created', 'awaiting_upload', 'queued', 'preparing', 'transcribing',
    'segmenting', 'rendering', 'validating', 'publishing'
  )
  AND EXISTS (
    SELECT 1 FROM watchless_jobs
    WHERE video_id = NEW.video_id
      AND id != OLD.id
      AND status IN (
        'created', 'awaiting_upload', 'queued', 'preparing', 'transcribing',
        'segmenting', 'rendering', 'validating', 'publishing'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'WATCHLESS_VIDEO_ACTIVE');
END;

CREATE TABLE IF NOT EXISTS watchless_job_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES watchless_jobs(id) ON DELETE CASCADE,
  asset_path TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('article', 'pdf', 'keyframe', 'transcript', 'html', 'manifest', 'other')),
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'published', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, asset_path)
);

CREATE INDEX IF NOT EXISTS idx_watchless_job_assets_job_role
  ON watchless_job_assets (job_id, role, asset_path);

CREATE TRIGGER IF NOT EXISTS watchless_asset_limits_insert
BEFORE INSERT ON watchless_job_assets
WHEN NEW.status != 'deleted' AND (
  (SELECT COUNT(*) FROM watchless_job_assets
    WHERE job_id = NEW.job_id AND status != 'deleted' AND asset_path != NEW.asset_path) + 1 > 100
  OR
  (SELECT COALESCE(SUM(size_bytes), 0) FROM watchless_job_assets
    WHERE job_id = NEW.job_id AND status != 'deleted' AND asset_path != NEW.asset_path) + NEW.size_bytes > 367001600
)
BEGIN
  SELECT RAISE(ABORT, 'WATCHLESS_ASSET_LIMIT');
END;

CREATE TRIGGER IF NOT EXISTS watchless_asset_limits_update
BEFORE UPDATE OF job_id, asset_path, size_bytes, status ON watchless_job_assets
WHEN NEW.status != 'deleted' AND (
  (SELECT COUNT(*) FROM watchless_job_assets
    WHERE job_id = NEW.job_id AND status != 'deleted' AND id != OLD.id) + 1 > 100
  OR
  (SELECT COALESCE(SUM(size_bytes), 0) FROM watchless_job_assets
    WHERE job_id = NEW.job_id AND status != 'deleted' AND id != OLD.id) + NEW.size_bytes > 367001600
)
BEGIN
  SELECT RAISE(ABORT, 'WATCHLESS_ASSET_LIMIT');
END;

ALTER TABLE watchless_publications ADD COLUMN publish_job_id TEXT REFERENCES watchless_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_watchless_publications_publish_job
  ON watchless_publications (publish_job_id);
