import { nanoid } from 'nanoid';
import { sql } from '@vercel/postgres';

export interface QaMessage {
  id: string;
  podcastId: string;
  userId: string | null;
  question: string;
  answer: string;
  suggestedQuestion: boolean;
  createdAt: string;
}

export interface QaMessageResult {
  success: boolean;
  error?: string;
  data?: QaMessage | QaMessage[] | null;
}

interface SaveQaMessageInput {
  podcastId: string;
  userId?: string | null;
  question: string;
  answer: string;
  suggestedQuestion?: boolean;
}

const mapRowToQaMessage = (row: Record<string, unknown>): QaMessage => ({
  id: String(row.id ?? ''),
  podcastId: String(row.podcastId ?? ''),
  userId: (row.userId as string | null) || null,
  question: String(row.question ?? ''),
  answer: String(row.answer ?? ''),
  suggestedQuestion: Boolean(row.suggestedQuestion),
  createdAt: String(row.createdAt ?? ''),
});

export async function ensureQaMessagesTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS qa_messages (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      suggested_question BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_qa_messages_podcast_created_at
    ON qa_messages (podcast_id, created_at DESC)
  `;
}

export async function saveQaMessage(input: SaveQaMessageInput): Promise<QaMessageResult> {
  try {
    await ensureQaMessagesTable();
    const id = nanoid();
    const result = await sql`
      INSERT INTO qa_messages (
        id,
        podcast_id,
        user_id,
        question,
        answer,
        suggested_question
      )
      VALUES (
        ${id},
        ${input.podcastId},
        ${input.userId ?? null},
        ${input.question},
        ${input.answer},
        ${Boolean(input.suggestedQuestion)}
      )
      RETURNING
        id,
        podcast_id as "podcastId",
        user_id as "userId",
        question,
        answer,
        suggested_question as "suggestedQuestion",
        created_at as "createdAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Failed to save QA message' };
    }
    return { success: true, data: mapRowToQaMessage(result.rows[0]) };
  } catch (error) {
    console.error('saveQaMessage failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getQaMessages(podcastId: string, limit = 30): Promise<QaMessageResult> {
  try {
    await ensureQaMessagesTable();
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30;
    const result = await sql`
      SELECT
        id,
        podcast_id as "podcastId",
        user_id as "userId",
        question,
        answer,
        suggested_question as "suggestedQuestion",
        created_at as "createdAt"
      FROM qa_messages
      WHERE podcast_id = ${podcastId}
      ORDER BY created_at ASC
      LIMIT ${safeLimit}
    `;

    return {
      success: true,
      data: result.rows.map(row => mapRowToQaMessage(row)),
    };
  } catch (error) {
    console.error('getQaMessages failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
