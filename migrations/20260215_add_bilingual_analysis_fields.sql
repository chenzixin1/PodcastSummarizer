ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS summary_zh TEXT;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS summary_en TEXT;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS mind_map_json_zh JSONB;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS mind_map_json_en JSONB;
