CREATE TABLE IF NOT EXISTS qa_request_limits (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count >= 1)
);
CREATE INDEX IF NOT EXISTS idx_qa_messages_user_podcast_created
  ON qa_messages(user_id, podcast_id, created_at);
