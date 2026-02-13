ALTER TABLE podcasts
ADD COLUMN IF NOT EXISTS source_reference TEXT;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS token_count INTEGER;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS word_count INTEGER;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS character_count INTEGER;
