import { ensureCreditLedgerTables } from './credits';
import { sql } from './sql';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  credits: number;
  createdAt: string;
  podcastCount: number;
  publicPodcastCount: number;
  lastPodcastAt: string | null;
}

export interface AdminJobRow {
  podcastId: string;
  podcastTitle: string;
  userEmail: string | null;
  status: string;
  currentTask: string | null;
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

export interface AdminPodcastRow {
  id: string;
  title: string;
  originalFileName: string;
  fileSize: string;
  sourceReference: string | null;
  tags: unknown;
  isPublic: boolean;
  userId: string | null;
  userEmail: string | null;
  isProcessed: boolean;
  jobStatus: string | null;
  wordCount: number | null;
  createdAt: string;
  processedAt: string | null;
}

function normalizeLimit(value: number | undefined, fallback = 50, max = 200): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(Number(value))));
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value);
  return normalized ? normalized : null;
}

function mapAdminUserRow(row: Record<string, unknown>): AdminUserRow {
  return {
    id: String(row.id || ''),
    email: String(row.email || ''),
    name: String(row.name || ''),
    credits: asNumber(row.credits),
    createdAt: String(row.createdAt || ''),
    podcastCount: asNumber(row.podcastCount),
    publicPodcastCount: asNumber(row.publicPodcastCount),
    lastPodcastAt: asStringOrNull(row.lastPodcastAt),
  };
}

function mapAdminJobRow(row: Record<string, unknown>): AdminJobRow {
  return {
    podcastId: String(row.podcastId || ''),
    podcastTitle: String(row.podcastTitle || ''),
    userEmail: asStringOrNull(row.userEmail),
    status: String(row.status || ''),
    currentTask: asStringOrNull(row.currentTask),
    progressCurrent: asNumber(row.progressCurrent),
    progressTotal: asNumber(row.progressTotal),
    statusMessage: asStringOrNull(row.statusMessage),
    attempts: asNumber(row.attempts),
    workerId: asStringOrNull(row.workerId),
    lastError: asStringOrNull(row.lastError),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    startedAt: asStringOrNull(row.startedAt),
    finishedAt: asStringOrNull(row.finishedAt),
  };
}

function mapAdminPodcastRow(row: Record<string, unknown>): AdminPodcastRow {
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    originalFileName: String(row.originalFileName || ''),
    fileSize: String(row.fileSize || ''),
    sourceReference: asStringOrNull(row.sourceReference),
    tags: row.tags,
    isPublic: Boolean(row.isPublic),
    userId: asStringOrNull(row.userId),
    userEmail: asStringOrNull(row.userEmail),
    isProcessed: Boolean(row.isProcessed),
    jobStatus: asStringOrNull(row.jobStatus),
    wordCount: row.wordCount === null || row.wordCount === undefined ? null : asNumber(row.wordCount),
    createdAt: String(row.createdAt || ''),
    processedAt: asStringOrNull(row.processedAt),
  };
}

export async function getAdminOverview(): Promise<{
  success: boolean;
  error?: string;
  data?: {
    totals: {
      users: number;
      podcasts: number;
      publicPodcasts: number;
      processedPodcasts: number;
      totalCredits: number;
    };
    jobs: Record<string, number>;
    recentFailedJobs: AdminJobRow[];
  };
}> {
  try {
    await ensureCreditLedgerTables();
    const [users, podcasts, publicPodcasts, processedPodcasts, totalCredits, jobRows, failedJobs] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM users`,
      sql`SELECT COUNT(*) as count FROM podcasts`,
      sql`SELECT COUNT(*) as count FROM podcasts WHERE is_public = true`,
      sql`SELECT COUNT(*) as count FROM analysis_results`,
      sql`SELECT COALESCE(SUM(credits), 0) as total FROM users`,
      sql`
        SELECT status, COUNT(*) as count
        FROM processing_jobs
        GROUP BY status
      `,
      sql`
        SELECT
          j.podcast_id as "podcastId",
          COALESCE(p.title, p.original_filename, j.podcast_id) as "podcastTitle",
          u.email as "userEmail",
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
        FROM processing_jobs j
        LEFT JOIN podcasts p ON p.id = j.podcast_id
        LEFT JOIN users u ON u.id = p.user_id
        WHERE j.status = 'failed'
        ORDER BY j.updated_at DESC
        LIMIT 8
      `,
    ]);

    const jobs: Record<string, number> = {};
    for (const row of jobRows.rows) {
      jobs[String(row.status || 'unknown')] = asNumber(row.count);
    }

    return {
      success: true,
      data: {
        totals: {
          users: asNumber(users.rows[0]?.count),
          podcasts: asNumber(podcasts.rows[0]?.count),
          publicPodcasts: asNumber(publicPodcasts.rows[0]?.count),
          processedPodcasts: asNumber(processedPodcasts.rows[0]?.count),
          totalCredits: asNumber(totalCredits.rows[0]?.total),
        },
        jobs,
        recentFailedJobs: failedJobs.rows.map((row) => mapAdminJobRow(row)),
      },
    };
  } catch (error) {
    console.error('getAdminOverview failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listAdminUsers(options: {
  query?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ success: boolean; error?: string; data?: AdminUserRow[] }> {
  try {
    await ensureCreditLedgerTables();
    const query = (options.query || '').trim().toLowerCase();
    const pattern = `%${query}%`;
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);

    const result = await sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.credits,
        u.created_at as "createdAt",
        COUNT(p.id) as "podcastCount",
        COALESCE(SUM(CASE WHEN p.is_public = true THEN 1 ELSE 0 END), 0) as "publicPodcastCount",
        MAX(p.created_at) as "lastPodcastAt"
      FROM users u
      LEFT JOIN podcasts p ON p.user_id = u.id
      WHERE (
        ${query} = ''
        OR LOWER(u.email) LIKE ${pattern}
        OR LOWER(u.name) LIKE ${pattern}
      )
      GROUP BY u.id, u.email, u.name, u.credits, u.created_at
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return { success: true, data: result.rows.map((row) => mapAdminUserRow(row)) };
  } catch (error) {
    console.error('listAdminUsers failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listAdminJobs(options: {
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ success: boolean; error?: string; data?: AdminJobRow[] }> {
  try {
    await ensureCreditLedgerTables();
    const status = (options.status || '').trim();
    const query = (options.query || '').trim().toLowerCase();
    const pattern = `%${query}%`;
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);

    const result = await sql`
      SELECT
        j.podcast_id as "podcastId",
        COALESCE(p.title, p.original_filename, j.podcast_id) as "podcastTitle",
        u.email as "userEmail",
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
      FROM processing_jobs j
      LEFT JOIN podcasts p ON p.id = j.podcast_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE (${status} = '' OR j.status = ${status})
        AND (
          ${query} = ''
          OR LOWER(COALESCE(p.title, '')) LIKE ${pattern}
          OR LOWER(COALESCE(p.original_filename, '')) LIKE ${pattern}
          OR LOWER(COALESCE(u.email, '')) LIKE ${pattern}
          OR LOWER(j.podcast_id) LIKE ${pattern}
        )
      ORDER BY j.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return { success: true, data: result.rows.map((row) => mapAdminJobRow(row)) };
  } catch (error) {
    console.error('listAdminJobs failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listAdminPodcasts(options: {
  query?: string | null;
  status?: string | null;
  visibility?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ success: boolean; error?: string; data?: AdminPodcastRow[] }> {
  try {
    await ensureCreditLedgerTables();
    const query = (options.query || '').trim().toLowerCase();
    const pattern = `%${query}%`;
    const status = (options.status || '').trim();
    const visibility = (options.visibility || '').trim();
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);

    const result = await sql`
      SELECT
        p.id,
        p.title,
        p.original_filename as "originalFileName",
        p.file_size as "fileSize",
        p.source_reference as "sourceReference",
        p.tags_json as "tags",
        p.is_public as "isPublic",
        p.user_id as "userId",
        u.email as "userEmail",
        CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
        j.status as "jobStatus",
        ar.word_count as "wordCount",
        p.created_at as "createdAt",
        ar.processed_at as "processedAt"
      FROM podcasts p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN analysis_results ar ON ar.podcast_id = p.id
      LEFT JOIN processing_jobs j ON j.podcast_id = p.id
      WHERE (
          ${query} = ''
          OR LOWER(COALESCE(p.title, '')) LIKE ${pattern}
          OR LOWER(COALESCE(p.original_filename, '')) LIKE ${pattern}
          OR LOWER(COALESCE(p.source_reference, '')) LIKE ${pattern}
          OR LOWER(COALESCE(u.email, '')) LIKE ${pattern}
          OR LOWER(p.id) LIKE ${pattern}
        )
        AND (${status} = '' OR COALESCE(j.status, 'missing') = ${status})
        AND (
          ${visibility} = ''
          OR (${visibility} = 'public' AND p.is_public = true)
          OR (${visibility} = 'private' AND p.is_public = false)
        )
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return { success: true, data: result.rows.map((row) => mapAdminPodcastRow(row)) };
  } catch (error) {
    console.error('listAdminPodcasts failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
