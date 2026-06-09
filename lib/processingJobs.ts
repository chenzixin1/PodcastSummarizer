import { isD1DatabaseProvider, sql } from './sql';

export type ProcessingJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ProcessingTask = 'summary' | 'translation' | 'highlights' | null;

export interface ProcessingJob {
  podcastId: string;
  status: ProcessingJobStatus;
  currentTask: ProcessingTask;
  progressCurrent: number;
  progressTotal: number;
  statusMessage: string | null;
  attempts: number;
  workerId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProcessingJobResult {
  success: boolean;
  error?: string;
  data?: ProcessingJob | null;
}

export interface ProcessingQueueHealth {
  counts: Record<string, number>;
  queuedOldestAt: string | null;
  staleProcessingCount: number;
  activeWorkers: number;
  checkedAt: string;
}

const mapRowToProcessingJob = (row: Record<string, unknown>): ProcessingJob => ({
  podcastId: String(row.podcastId ?? ''),
  status: String(row.status ?? 'queued') as ProcessingJobStatus,
  currentTask: (row.currentTask ?? null) as ProcessingTask,
  progressCurrent: Number(row.progressCurrent || 0),
  progressTotal: Number(row.progressTotal || 0),
  statusMessage: (row.statusMessage as string | null) || null,
  attempts: Number(row.attempts || 0),
  workerId: (row.workerId as string | null) || null,
  lastError: (row.lastError as string | null) || null,
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
  startedAt: (row.startedAt as string | null) || null,
  finishedAt: (row.finishedAt as string | null) || null,
});

export async function ensureProcessingJobsTable(): Promise<void> {
  if (isD1DatabaseProvider()) {
    return;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS processing_jobs (
      podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      current_task TEXT,
      progress_current INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      status_message TEXT,
      attempts INTEGER DEFAULT 0,
      worker_id TEXT,
      last_error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    )
  `;
}

export async function enqueueProcessingJob(podcastId: string): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      INSERT INTO processing_jobs (
        podcast_id, status, current_task, progress_current, progress_total, status_message, attempts, worker_id, last_error, started_at, finished_at
      )
      VALUES (
        ${podcastId},
        'queued',
        NULL,
        0,
        0,
        'Queued for background processing',
        0,
        NULL,
        NULL,
        NULL,
        NULL
      )
      ON CONFLICT (podcast_id)
      DO UPDATE SET
        status = 'queued',
        current_task = NULL,
        progress_current = 0,
        progress_total = 0,
        status_message = 'Queued for background processing',
        worker_id = NULL,
        last_error = NULL,
        started_at = NULL,
        finished_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Failed to enqueue processing job' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('enqueueProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function retryProcessingJob(podcastId: string): Promise<ProcessingJobResult> {
  const result = await enqueueProcessingJob(podcastId);
  if (!result.success || !result.data) {
    return result;
  }
  return {
    success: true,
    data: {
      ...result.data,
      statusMessage: 'Queued for manual retry',
    },
  };
}

export async function getProcessingJob(podcastId: string): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
      FROM processing_jobs
      WHERE podcast_id = ${podcastId}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Processing job not found' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('getProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function claimNextProcessingJob(workerId: string): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    if (isD1DatabaseProvider()) {
      const result = await sql`
        UPDATE processing_jobs
        SET
          status = 'processing',
          worker_id = ${workerId},
          attempts = attempts + 1,
          current_task = COALESCE(current_task, 'summary'),
          status_message = 'Worker picked up the job',
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE podcast_id = (
          SELECT podcast_id
          FROM processing_jobs
          WHERE status = 'queued'
             OR (status = 'processing' AND updated_at < datetime('now', '-2 minutes'))
          ORDER BY
            CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
            updated_at ASC
          LIMIT 1
        )
        RETURNING
          podcast_id as "podcastId",
          status,
          current_task as "currentTask",
          progress_current as "progressCurrent",
          progress_total as "progressTotal",
          status_message as "statusMessage",
          attempts,
          worker_id as "workerId",
          last_error as "lastError",
          created_at as "createdAt",
          updated_at as "updatedAt",
          started_at as "startedAt",
          finished_at as "finishedAt"
      `;

      if (result.rows.length === 0) {
        return { success: true, data: null };
      }

      return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
    }

    const result = await sql`
      WITH next_job AS (
        SELECT podcast_id
        FROM processing_jobs
        WHERE status = 'queued'
           OR (status = 'processing' AND updated_at < NOW() - INTERVAL '2 minutes')
        ORDER BY
          CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
          updated_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE processing_jobs j
      SET
        status = 'processing',
        worker_id = ${workerId},
        attempts = j.attempts + 1,
        current_task = COALESCE(j.current_task, 'summary'),
        status_message = 'Worker picked up the job',
        started_at = COALESCE(j.started_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      FROM next_job
      WHERE j.podcast_id = next_job.podcast_id
      RETURNING
        j.podcast_id as "podcastId",
        j.status,
        j.current_task as "currentTask",
        j.progress_current as "progressCurrent",
        j.progress_total as "progressTotal",
        j.status_message as "statusMessage",
        j.attempts,
        j.worker_id as "workerId",
        j.last_error as "lastError",
        j.created_at as "createdAt",
        j.updated_at as "updatedAt",
        j.started_at as "startedAt",
        j.finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: true, data: null };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('claimNextProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateProcessingJobProgress(
  podcastId: string,
  payload: {
    currentTask?: ProcessingTask;
    progressCurrent?: number;
    progressTotal?: number;
    statusMessage?: string | null;
  }
): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      UPDATE processing_jobs
      SET
        current_task = COALESCE(${payload.currentTask ?? null}, current_task),
        progress_current = COALESCE(${payload.progressCurrent ?? null}, progress_current),
        progress_total = COALESCE(${payload.progressTotal ?? null}, progress_total),
        status_message = COALESCE(${payload.statusMessage ?? null}, status_message),
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status != 'cancelled'
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Processing job not found' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('updateProcessingJobProgress failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function completeProcessingJob(podcastId: string): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      UPDATE processing_jobs
      SET
        status = 'completed',
        status_message = 'Processing completed',
        current_task = NULL,
        progress_current = progress_total,
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status != 'cancelled'
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Processing job not found' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('completeProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function failProcessingJob(podcastId: string, message: string): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      UPDATE processing_jobs
      SET
        status = 'failed',
        status_message = 'Processing failed',
        last_error = ${message},
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status != 'cancelled'
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Processing job not found' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('failProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function cancelProcessingJob(
  podcastId: string,
  message = 'Cancelled by admin',
): Promise<ProcessingJobResult> {
  try {
    await ensureProcessingJobsTable();
    const result = await sql`
      UPDATE processing_jobs
      SET
        status = 'cancelled',
        status_message = ${message},
        current_task = NULL,
        worker_id = NULL,
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status IN ('queued', 'processing', 'failed')
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Processing job not found or cannot be cancelled' };
    }

    return { success: true, data: mapRowToProcessingJob(result.rows[0]) };
  } catch (error) {
    console.error('cancelProcessingJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getProcessingQueueHealth(): Promise<{
  success: boolean;
  error?: string;
  data?: ProcessingQueueHealth;
}> {
  try {
    await ensureProcessingJobsTable();
    const [countsResult, oldestResult, staleResult, workersResult] = await Promise.all([
      sql`
        SELECT status, COUNT(*) as count
        FROM processing_jobs
        GROUP BY status
      `,
      sql`
        SELECT MIN(created_at) as "queuedOldestAt"
        FROM processing_jobs
        WHERE status = 'queued'
      `,
      sql`
        SELECT COUNT(*) as count
        FROM processing_jobs
        WHERE status = 'processing'
          AND updated_at < NOW() - INTERVAL '2 minutes'
      `,
      sql`
        SELECT COUNT(DISTINCT worker_id) as count
        FROM processing_jobs
        WHERE status = 'processing'
          AND worker_id IS NOT NULL
          AND updated_at >= NOW() - INTERVAL '2 minutes'
      `,
    ]);

    const counts: Record<string, number> = {};
    for (const row of countsResult.rows) {
      counts[String(row.status || 'unknown')] = Number(row.count || 0);
    }

    return {
      success: true,
      data: {
        counts,
        queuedOldestAt: (oldestResult.rows[0]?.queuedOldestAt as string | null) || null,
        staleProcessingCount: Number(staleResult.rows[0]?.count || 0),
        activeWorkers: Number(workersResult.rows[0]?.count || 0),
        checkedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('getProcessingQueueHealth failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
