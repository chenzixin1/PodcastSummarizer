-- Request workflow_id is immutable provenance, not the current recovery owner.
-- Settlement queries CAS the current run owner separately, including after restart.
DROP TRIGGER watchless_analysis_attempt_owner;
CREATE TRIGGER watchless_analysis_attempt_owner BEFORE UPDATE ON watchless_analysis_attempts
WHEN NOT EXISTS(SELECT 1 FROM watchless_analysis_runs r JOIN processing_jobs j ON j.podcast_id=r.podcast_id
  JOIN watchless_publications w ON w.podcast_id=r.podcast_id WHERE r.id=NEW.run_id
  AND r.status IN ('initializing','running','waiting') AND j.status='processing'
  AND j.worker_id=r.workflow_id AND w.status='published' AND w.article_key=r.article_key)
BEGIN
  SELECT RAISE(ABORT,'ANALYSIS_SUPERSEDED');
END;
