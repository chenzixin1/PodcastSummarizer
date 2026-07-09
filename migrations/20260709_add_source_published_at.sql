ALTER TABLE podcasts
ADD COLUMN IF NOT EXISTS source_published_at TEXT;
