-- Explicit child cleanup also covers databases that already applied 0010.
-- It runs in the podcast deletion transaction, before foreign-key validation.
CREATE TRIGGER watchless_analysis_delete BEFORE DELETE ON podcasts
BEGIN
  DELETE FROM watchless_analysis_attempts WHERE run_id IN (
    SELECT id FROM watchless_analysis_runs WHERE podcast_id=OLD.id
  );
  DELETE FROM watchless_analysis_parts WHERE run_id IN (
    SELECT id FROM watchless_analysis_runs WHERE podcast_id=OLD.id
  );
  DELETE FROM watchless_analysis_runs WHERE podcast_id=OLD.id;
END;
