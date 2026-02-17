ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS full_text_bilingual_json JSONB;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS summary_bilingual_json JSONB;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS bilingual_alignment_version INTEGER DEFAULT 0;
