ALTER TABLE processing_jobs ADD COLUMN executor TEXT NOT NULL DEFAULT 'legacy';

-- Old retry endpoints must not reset progress or route migrated jobs back to the queue.
CREATE TRIGGER watchless_analysis_no_legacy_requeue BEFORE UPDATE ON processing_jobs
WHEN OLD.executor='watchless-workflow' AND NEW.status='queued' AND OLD.status!='queued'
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TABLE watchless_analysis_runs (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id),
  article_key TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'initializing',
  workflow_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  current_part TEXT,
  pause_reason TEXT,
  next_retry_at INTEGER,
  supplied_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(podcast_id, article_key, source_hash, model, prompt_version)
);
CREATE UNIQUE INDEX watchless_analysis_one_active ON watchless_analysis_runs(podcast_id)
  WHERE status IN ('initializing','running','waiting');
CREATE TRIGGER watchless_analysis_terminal BEFORE UPDATE OF status ON watchless_analysis_runs
WHEN OLD.status IN ('cancelled','completed') AND NEW.status!=OLD.status
BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER watchless_analysis_cancel AFTER UPDATE OF status ON processing_jobs
WHEN NEW.status='cancelled' AND NEW.executor='watchless-workflow'
BEGIN
  UPDATE watchless_analysis_runs SET status='cancelled',pause_reason='CANCELLED'
    WHERE podcast_id=NEW.podcast_id AND status IN ('initializing','running','waiting','paused');
END;
CREATE TRIGGER watchless_analysis_no_legacy_overlap BEFORE INSERT ON watchless_analysis_runs
WHEN EXISTS(SELECT 1 FROM processing_jobs WHERE podcast_id=NEW.podcast_id AND executor='legacy'
  AND status='processing' AND updated_at>=datetime('now','-5 minutes'))
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_LEGACY_ACTIVE');
END;
CREATE TABLE watchless_analysis_parts (
  run_id TEXT NOT NULL REFERENCES watchless_analysis_runs(id),
  part_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  cache_key TEXT NOT NULL,
  result_key TEXT,
  payload TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY(run_id,part_id)
);
CREATE TABLE watchless_analysis_attempts (
  run_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3),
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  finished_at INTEGER,
  error_kind TEXT,
  retry_at INTEGER,
  result_key TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(run_id,part_id,attempt),
  FOREIGN KEY(run_id,part_id) REFERENCES watchless_analysis_parts(run_id,part_id)
);
CREATE INDEX watchless_analysis_active_attempts ON watchless_analysis_attempts(status,deadline);

CREATE TRIGGER watchless_analysis_part_owner BEFORE UPDATE ON watchless_analysis_parts
WHEN NOT EXISTS(SELECT 1 FROM watchless_analysis_runs r JOIN processing_jobs j ON j.podcast_id=r.podcast_id
  JOIN watchless_publications w ON w.podcast_id=r.podcast_id WHERE r.id=NEW.run_id
  AND r.status IN ('initializing','running','waiting') AND j.status='processing'
  AND j.worker_id=r.workflow_id AND w.status='published' AND w.article_key=r.article_key)
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_SUPERSEDED');
END;

CREATE TRIGGER watchless_analysis_attempt_owner BEFORE UPDATE ON watchless_analysis_attempts
WHEN NOT EXISTS(SELECT 1 FROM watchless_analysis_runs r JOIN processing_jobs j ON j.podcast_id=r.podcast_id
  JOIN watchless_publications w ON w.podcast_id=r.podcast_id WHERE r.id=NEW.run_id
  AND r.status IN ('initializing','running','waiting') AND j.status='processing'
  AND j.worker_id=r.workflow_id AND r.workflow_id=NEW.workflow_id
  AND w.status='published' AND w.article_key=r.article_key)
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_SUPERSEDED');
END;

-- Serialized D1 writes are the budget/concurrency authority, not in-memory counters.
CREATE TRIGGER watchless_analysis_reserve BEFORE INSERT ON watchless_analysis_attempts
WHEN NEW.imported = 0
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM watchless_analysis_runs r JOIN watchless_publications w ON w.podcast_id=r.podcast_id
      JOIN processing_jobs j ON j.podcast_id=r.podcast_id
    WHERE r.id=NEW.run_id AND r.workflow_id=NEW.workflow_id AND r.status IN ('running','waiting')
      AND w.article_key=r.article_key AND w.status='published'
      AND j.executor='watchless-workflow' AND j.status='processing' AND j.worker_id=NEW.workflow_id
  ) THEN RAISE(ABORT,'ANALYSIS_SUPERSEDED') END;
  SELECT CASE WHEN NEW.attempt != 1 + (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND part_id=NEW.part_id)
    THEN RAISE(ABORT,'ANALYSIS_ATTEMPT_CONFLICT') END;
  SELECT CASE WHEN NEW.attempt > 1 AND (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND attempt>1) >= 10
    THEN RAISE(ABORT,'ANALYSIS_BUDGET_EXHAUSTED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND part_id=NEW.part_id AND status IN ('started','unknown') AND deadline>NEW.started_at)
    THEN RAISE(ABORT,'ANALYSIS_ATTEMPT_ACTIVE') END;
  SELECT CASE WHEN (
    (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE status IN ('started','unknown') AND deadline>NEW.started_at) +
    (SELECT COUNT(*) FROM processing_jobs j JOIN watchless_publications w ON w.podcast_id=j.podcast_id
      WHERE j.executor='legacy' AND j.status='processing' AND j.updated_at>=datetime('now','-5 minutes'))
  ) >= 3 THEN RAISE(ABORT,'ANALYSIS_CONCURRENCY_LIMIT') END;
END;
