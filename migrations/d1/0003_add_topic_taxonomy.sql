CREATE TABLE IF NOT EXISTS topic_definitions (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  facet TEXT NOT NULL CHECK (facet IN ('topic', 'person', 'organization_product')),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'candidate', 'blocked')),
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topic_definitions_facet_status
  ON topic_definitions (facet, status);

CREATE TABLE IF NOT EXISTS podcast_topics (
  podcast_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  relevance_score REAL NOT NULL,
  evidence TEXT NOT NULL,
  extraction_source TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (podcast_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_podcast_topics_podcast
  ON podcast_topics (podcast_id);

CREATE INDEX IF NOT EXISTS idx_podcast_topics_topic
  ON podcast_topics (topic_id);

CREATE TABLE IF NOT EXISTS topic_candidates (
  id TEXT PRIMARY KEY,
  proposed_name TEXT NOT NULL,
  proposed_facet TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  podcast_ids_json TEXT NOT NULL DEFAULT '[]',
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  average_confidence REAL NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topic_candidates_review
  ON topic_candidates (review_status, occurrence_count DESC);
