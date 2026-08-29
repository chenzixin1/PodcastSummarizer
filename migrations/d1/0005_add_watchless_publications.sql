PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS watchless_publications (
  podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL UNIQUE,
  article_key TEXT NOT NULL,
  scene_count INTEGER NOT NULL,
  duration_label TEXT NOT NULL,
  has_english_transcript INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watchless_publications_status_published
  ON watchless_publications (status, published_at DESC);
