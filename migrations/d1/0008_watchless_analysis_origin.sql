ALTER TABLE analysis_results ADD COLUMN analysis_kind TEXT NOT NULL DEFAULT 'full';
ALTER TABLE analysis_results ADD COLUMN analysis_model TEXT;
ALTER TABLE analysis_results ADD COLUMN analysis_source_sha256 TEXT;
UPDATE analysis_results SET analysis_kind = 'overview'
WHERE podcast_id IN (SELECT podcast_id FROM watchless_publications);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_daily ON credit_transactions(user_id, reason, created_at);
