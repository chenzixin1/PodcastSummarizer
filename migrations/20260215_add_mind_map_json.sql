ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS mind_map_json JSONB;
