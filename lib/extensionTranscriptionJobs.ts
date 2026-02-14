import { sql } from '@vercel/postgres';
import { ensureExtensionTranscriptionJobsTable } from './db';

export type ExtensionTranscriptionJobStatus = 'submitted' | 'transcribing' | 'completed' | 'failed';

export interface ExtensionTranscriptionJob {
  id: string;
  userId: string;
  status: ExtensionTranscriptionJobStatus;
  providerTaskId: string | null;
  podcastId: string | null;
  audioBlobUrl: string | null;
  sourceReference: string | null;
  originalFileName: string | null;
  title: string | null;
  videoId: string | null;
  isPublic: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionTranscriptionJobResult {
  success: boolean;
  error?: string;
  data?: ExtensionTranscriptionJob | null;
}

interface CreateExtensionTranscriptionJobInput {
  id: string;
  userId: string;
  status: ExtensionTranscriptionJobStatus;
  providerTaskId?: string | null;
  podcastId?: string | null;
  audioBlobUrl?: string | null;
  sourceReference?: string | null;
  originalFileName?: string | null;
  title?: string | null;
  videoId?: string | null;
  isPublic?: boolean;
  error?: string | null;
}

const mapRowToJob = (row: Record<string, unknown>): ExtensionTranscriptionJob => ({
  id: String(row.id || ''),
  userId: String(row.userId || ''),
  status: String(row.status || 'submitted') as ExtensionTranscriptionJobStatus,
  providerTaskId: (row.providerTaskId as string | null) || null,
  podcastId: (row.podcastId as string | null) || null,
  audioBlobUrl: (row.audioBlobUrl as string | null) || null,
  sourceReference: (row.sourceReference as string | null) || null,
  originalFileName: (row.originalFileName as string | null) || null,
  title: (row.title as string | null) || null,
  videoId: (row.videoId as string | null) || null,
  isPublic: Boolean(row.isPublic),
  error: (row.error as string | null) || null,
  createdAt: String(row.createdAt || ''),
  updatedAt: String(row.updatedAt || ''),
});

export async function createExtensionTranscriptionJob(
  input: CreateExtensionTranscriptionJobInput,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      INSERT INTO extension_transcription_jobs (
        id,
        user_id,
        status,
        provider_task_id,
        podcast_id,
        audio_blob_url,
        source_reference,
        original_file_name,
        title,
        video_id,
        is_public,
        error
      )
      VALUES (
        ${input.id},
        ${input.userId},
        ${input.status},
        ${input.providerTaskId ?? null},
        ${input.podcastId ?? null},
        ${input.audioBlobUrl ?? null},
        ${input.sourceReference ?? null},
        ${input.originalFileName ?? null},
        ${input.title ?? null},
        ${input.videoId ?? null},
        ${Boolean(input.isPublic)},
        ${input.error ?? null}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        status = EXCLUDED.status,
        provider_task_id = EXCLUDED.provider_task_id,
        podcast_id = EXCLUDED.podcast_id,
        audio_blob_url = EXCLUDED.audio_blob_url,
        source_reference = EXCLUDED.source_reference,
        original_file_name = EXCLUDED.original_file_name,
        title = EXCLUDED.title,
        video_id = EXCLUDED.video_id,
        is_public = EXCLUDED.is_public,
        error = EXCLUDED.error,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Failed to create extension transcription job' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('createExtensionTranscriptionJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getExtensionTranscriptionJobForUser(
  id: string,
  userId: string,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      SELECT
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_transcription_jobs
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Extension transcription job not found' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('getExtensionTranscriptionJobForUser failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateExtensionTranscriptionJobTranscribing(
  id: string,
  userId: string,
  providerTaskId: string,
  audioBlobUrl: string,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      UPDATE extension_transcription_jobs
      SET
        status = 'transcribing',
        provider_task_id = ${providerTaskId},
        audio_blob_url = ${audioBlobUrl},
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Extension transcription job not found' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('updateExtensionTranscriptionJobTranscribing failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateExtensionTranscriptionJobFailed(
  id: string,
  userId: string,
  errorMessage: string,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      UPDATE extension_transcription_jobs
      SET
        status = 'failed',
        error = ${errorMessage.slice(0, 4096)},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Extension transcription job not found' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('updateExtensionTranscriptionJobFailed failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateExtensionTranscriptionJobCompleted(
  id: string,
  userId: string,
  podcastId: string,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      UPDATE extension_transcription_jobs
      SET
        status = 'completed',
        podcast_id = ${podcastId},
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Extension transcription job not found' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('updateExtensionTranscriptionJobCompleted failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function touchExtensionTranscriptionJob(
  id: string,
  userId: string,
): Promise<ExtensionTranscriptionJobResult> {
  try {
    await ensureExtensionTranscriptionJobsTable();
    const result = await sql`
      UPDATE extension_transcription_jobs
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Extension transcription job not found' };
    }

    return { success: true, data: mapRowToJob(result.rows[0]) };
  } catch (error) {
    console.error('touchExtensionTranscriptionJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
