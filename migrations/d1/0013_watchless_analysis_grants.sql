-- Explicit operator authorization is bound to one existing article version,
-- one part and one exact next attempt. No public endpoint creates grants.
CREATE TABLE watchless_analysis_grants (
  run_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 1),
  reason TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,part_id,attempt),
  FOREIGN KEY(run_id,part_id) REFERENCES watchless_analysis_parts(run_id,part_id)
);
CREATE TRIGGER watchless_analysis_grant_immutable BEFORE UPDATE ON watchless_analysis_grants
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_GRANT_IMMUTABLE');
END;

-- Rebuild only the request ledger to remove its unconditional <=3 CHECK.
-- The reserve trigger below enforces <=3 unless the exact request is approved.
DROP TRIGGER watchless_analysis_delete;
DROP TRIGGER watchless_analysis_attempt_owner;
DROP TRIGGER watchless_analysis_reserve;
CREATE TABLE watchless_analysis_attempts_next (
  run_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt >= 1 AND (imported=0 OR attempt<=3)),
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
INSERT INTO watchless_analysis_attempts_next SELECT * FROM watchless_analysis_attempts;
DROP TABLE watchless_analysis_attempts;
ALTER TABLE watchless_analysis_attempts_next RENAME TO watchless_analysis_attempts;
CREATE INDEX watchless_analysis_active_attempts ON watchless_analysis_attempts(status,deadline);
CREATE TRIGGER watchless_analysis_attempt_owner BEFORE UPDATE ON watchless_analysis_attempts
WHEN NOT EXISTS(SELECT 1 FROM watchless_analysis_runs r JOIN processing_jobs j ON j.podcast_id=r.podcast_id
  JOIN watchless_publications w ON w.podcast_id=r.podcast_id WHERE r.id=NEW.run_id
  AND r.status IN ('initializing','running','waiting') AND j.status='processing'
  AND j.worker_id=r.workflow_id AND w.status='published' AND w.article_key=r.article_key)
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_SUPERSEDED');
END;
CREATE TRIGGER watchless_analysis_delete BEFORE DELETE ON podcasts
BEGIN
  DELETE FROM watchless_analysis_grants WHERE run_id IN (SELECT id FROM watchless_analysis_runs WHERE podcast_id=OLD.id);
  DELETE FROM watchless_analysis_attempts WHERE run_id IN (SELECT id FROM watchless_analysis_runs WHERE podcast_id=OLD.id);
  DELETE FROM watchless_analysis_parts WHERE run_id IN (SELECT id FROM watchless_analysis_runs WHERE podcast_id=OLD.id);
  DELETE FROM watchless_analysis_runs WHERE podcast_id=OLD.id;
END;
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
  SELECT CASE WHEN (
    NEW.attempt>3 OR
    (NEW.attempt>1 AND (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND attempt>1)>=10) OR
    (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND part_id=NEW.part_id AND error_kind='format')>=2
  ) AND NOT EXISTS(SELECT 1 FROM watchless_analysis_grants g WHERE g.run_id=NEW.run_id AND g.part_id=NEW.part_id
    AND g.attempt=NEW.attempt AND g.approved_at<=NEW.started_at AND g.expires_at>NEW.started_at)
    THEN RAISE(ABORT,'ANALYSIS_BUDGET_EXHAUSTED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM watchless_analysis_attempts WHERE run_id=NEW.run_id AND part_id=NEW.part_id AND status IN ('started','unknown') AND deadline>NEW.started_at)
    THEN RAISE(ABORT,'ANALYSIS_ATTEMPT_ACTIVE') END;
  SELECT CASE WHEN (
    (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE status IN ('started','unknown') AND deadline>NEW.started_at) +
    (SELECT COUNT(*) FROM processing_jobs j JOIN watchless_publications w ON w.podcast_id=j.podcast_id
      WHERE j.executor='legacy' AND j.status='processing' AND j.updated_at>=datetime('now','-5 minutes'))
  ) >= 3 THEN RAISE(ABORT,'ANALYSIS_CONCURRENCY_LIMIT') END;
END;
