import { isD1DatabaseProvider, sql } from './sql';
export const QA_REQUESTS_PER_HOUR = 30;

/** Count attempts before paid inference, including failed requests. Atomic in D1/Postgres. */
export async function consumeQaRequestQuota(userId: string): Promise<boolean> {
  if (!userId?.trim()) return false;
  if (!isD1DatabaseProvider()) await sql`CREATE TABLE IF NOT EXISTS qa_request_limits (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    window_start BIGINT NOT NULL, request_count INTEGER NOT NULL
  )`;
  const window = Math.floor(Date.now()/3600000);
  const result = await sql`INSERT INTO qa_request_limits (user_id, window_start, request_count)
    VALUES (${userId}, ${window}, 1)
    ON CONFLICT (user_id) DO UPDATE SET window_start = excluded.window_start,
      request_count = CASE WHEN qa_request_limits.window_start <> excluded.window_start THEN 1 ELSE qa_request_limits.request_count + 1 END
    WHERE qa_request_limits.window_start <> excluded.window_start OR qa_request_limits.request_count < ${QA_REQUESTS_PER_HOUR}
    RETURNING request_count`;
  return result.rows.length === 1;
}
