import { isD1DatabaseProvider, sql } from './sql';

export const INFOGRAPHIC_MODEL = process.env.OPENROUTER_INFOGRAPHIC_MODEL || 'google/gemini-3-pro-image';
export const INFOGRAPHIC_PROMPT_VERSION = 'podsum-infographic-v1';

export type InfographicJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface InfographicJob {
  podcastId: string;
  status: InfographicJobStatus;
  model: string;
  promptVersion: string;
  artifactUrl: string | null;
  artifactMediaType: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  workerId: string | null;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface InfographicStatusResponse {
  status: InfographicJobStatus | 'unavailable';
  artifactUrl: string | null;
  mediaType: string | null;
  model: string | null;
  promptVersion: string | null;
  updatedAt: string | null;
  canRetry: boolean;
}

export interface InfographicJobResult {
  success: boolean;
  error?: string;
  data?: InfographicJob | null;
}

export interface ClaimInfographicJobOptions {
  leaseSeconds?: number;
}

export interface CompleteInfographicJobPayload {
  artifactUrl: string;
  artifactMediaType: string;
  costUsd: number | null;
}

export interface InfographicFailurePayload {
  transient: boolean;
  errorCode: string;
  message: string;
}

export interface ReconcileInfographicJobsOptions {
  activationTime: string;
  limit?: number;
}

export interface ReconcileInfographicJobsResult {
  success: boolean;
  error?: string;
  data?: { enqueued: number };
}

const DEFAULT_INFOGRAPHIC_LEASE_SECONDS = 10 * 60;
const MAX_RECONCILIATION_LIMIT = 20;
const MAX_ERROR_CODE_LENGTH = 64;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const SAFE_ERROR_CODES = new Set([
  'unknown',
  'generation_failed',
  'upstream_timeout',
  'upstream_unavailable',
  'provider_error',
  'policy_violation',
  'invalid_response',
  'artifact_upload_failed',
  'artifact_verification_failed',
  'missing_analysis',
  'lease_lost',
]);

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRequiredString(value: unknown): string {
  return toNullableString(value) || '';
}

function rowValue(row: Record<string, unknown>, camelCase: string, snakeCase = camelCase): unknown {
  return row[camelCase] ?? row[snakeCase];
}

function mapRowToInfographicJob(row: Record<string, unknown>): InfographicJob {
  return {
    podcastId: toRequiredString(rowValue(row, 'podcastId', 'podcast_id')),
    status: toRequiredString(rowValue(row, 'status') || 'pending') as InfographicJobStatus,
    model: toRequiredString(rowValue(row, 'model')),
    promptVersion: toRequiredString(rowValue(row, 'promptVersion', 'prompt_version')),
    artifactUrl: toNullableString(rowValue(row, 'artifactUrl', 'artifact_url')),
    artifactMediaType: toNullableString(rowValue(row, 'artifactMediaType', 'artifact_media_type')),
    sourceTitle: toRequiredString(rowValue(row, 'sourceTitle', 'source_title')),
    sourceUrl: toNullableString(rowValue(row, 'sourceUrl', 'source_url')),
    attempts: Number(rowValue(row, 'attempts') || 0),
    nextAttemptAt: toNullableString(rowValue(row, 'nextAttemptAt', 'next_attempt_at')),
    leaseExpiresAt: toNullableString(rowValue(row, 'leaseExpiresAt', 'lease_expires_at')),
    workerId: toNullableString(rowValue(row, 'workerId', 'worker_id')),
    costUsd: rowValue(row, 'costUsd', 'cost_usd') === null || rowValue(row, 'costUsd', 'cost_usd') === undefined
      ? null
      : Number(rowValue(row, 'costUsd', 'cost_usd')),
    errorCode: toNullableString(rowValue(row, 'errorCode', 'error_code')),
    errorMessage: toNullableString(rowValue(row, 'errorMessage', 'error_message')),
    createdAt: toRequiredString(rowValue(row, 'createdAt', 'created_at')),
    updatedAt: toRequiredString(rowValue(row, 'updatedAt', 'updated_at')),
    completedAt: toNullableString(rowValue(row, 'completedAt', 'completed_at')),
  };
}

export function mapInfographicJobToResponse(
  job: InfographicJob | null,
  canEdit: boolean,
): InfographicStatusResponse {
  if (!job) {
    return {
      status: 'unavailable',
      artifactUrl: null,
      mediaType: null,
      model: null,
      promptVersion: null,
      updatedAt: null,
      canRetry: false,
    };
  }

  return {
    status: job.status,
    artifactUrl: job.artifactUrl,
    mediaType: job.artifactMediaType,
    model: job.model,
    promptVersion: job.promptVersion,
    updatedAt: job.updatedAt,
    canRetry: canEdit && job.status === 'failed',
  };
}

function normalizeLeaseSeconds(options?: ClaimInfographicJobOptions): number {
  const value = options?.leaseSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_INFOGRAPHIC_LEASE_SECONDS;
}

function normalizeReconciliationLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return MAX_RECONCILIATION_LIMIT;
  }
  return Math.max(1, Math.min(MAX_RECONCILIATION_LIMIT, Math.floor(limit)));
}

function normalizeD1DateTime(value: string): string | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function sanitizeErrorCode(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_ERROR_CODE_LENGTH);

  return SAFE_ERROR_CODES.has(normalized) ? normalized : 'provider_error';
}

function sanitizeErrorMessage(value: string): string {
  const sanitized = String(value || '')
    .trim()
    .replace(/(authorization|x-api-key|api[_-]?key|access[_-]?token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '$1: [REDACTED]')
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:provider|request|response)\s*(?:body|payload)\s*[:=]\s*(?:\{[\s\S]*?\}|\[[\s\S]*?\]|[^\n]+)/gi, '[REDACTED_PROVIDER_BODY]')
    .replace(/\b(?:sk|rk|pk|api)[_-][a-z0-9._-]{16,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/\b[a-z0-9+/_-]{48,}={0,2}\b/gi, '[REDACTED_BASE64]');

  return (sanitized || 'Infographic generation failed').slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export async function ensureInfographicJobsTable(): Promise<void> {
  if (isD1DatabaseProvider()) {
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS infographic_jobs (
      podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      artifact_url TEXT,
      artifact_media_type TEXT,
      source_title TEXT NOT NULL,
      source_url TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP,
      lease_expires_at TIMESTAMP,
      worker_id TEXT,
      cost_usd REAL,
      error_code TEXT,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `;
}

export async function enqueueInfographicJob(podcastId: string): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    await sql`
      INSERT INTO infographic_jobs (
        podcast_id,
        status,
        model,
        prompt_version,
        source_title,
        source_url
      )
      SELECT
        p.id,
        'pending',
        ${INFOGRAPHIC_MODEL},
        ${INFOGRAPHIC_PROMPT_VERSION},
        p.title,
        p.source_reference
      FROM podcasts p
      JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE p.id = ${podcastId}
      ON CONFLICT (podcast_id) DO NOTHING
    `;

    return getInfographicJob(podcastId);
  } catch (error) {
    console.error('enqueueInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getInfographicJob(podcastId: string): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const result = await sql`
      SELECT *
      FROM infographic_jobs
      WHERE podcast_id = ${podcastId}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return { success: false, data: null, error: 'Infographic job not found' };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('getInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function claimNextInfographicJob(
  workerId: string,
  options?: ClaimInfographicJobOptions,
): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const leaseSeconds = normalizeLeaseSeconds(options);
    const result = isD1DatabaseProvider()
      ? await sql`
          UPDATE infographic_jobs
          SET
            status = 'processing',
            worker_id = ${workerId},
            attempts = attempts + 1,
            next_attempt_at = NULL,
            lease_expires_at = datetime('now', '+' || ${leaseSeconds} || ' seconds'),
            updated_at = CURRENT_TIMESTAMP
          WHERE podcast_id = (
            SELECT podcast_id
            FROM infographic_jobs
            WHERE (
              status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
            ) OR (
              status = 'processing'
              AND (lease_expires_at IS NULL OR lease_expires_at < CURRENT_TIMESTAMP)
            )
            ORDER BY
              CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
              COALESCE(next_attempt_at, lease_expires_at, updated_at) ASC
            LIMIT 1
          )
          RETURNING *
        `
      : await sql`
          WITH next_job AS (
            SELECT podcast_id
            FROM infographic_jobs
            WHERE (
              status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
            ) OR (
              status = 'processing'
              AND (lease_expires_at IS NULL OR lease_expires_at < CURRENT_TIMESTAMP)
            )
            ORDER BY
              CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
              COALESCE(next_attempt_at, lease_expires_at, updated_at) ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE infographic_jobs j
          SET
            status = 'processing',
            worker_id = ${workerId},
            attempts = j.attempts + 1,
            next_attempt_at = NULL,
            lease_expires_at = CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'),
            updated_at = CURRENT_TIMESTAMP
          FROM next_job
          WHERE j.podcast_id = next_job.podcast_id
          RETURNING j.*
        `;

    if (result.rows.length === 0) {
      return { success: true, data: null };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('claimNextInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function heartbeatInfographicJob(
  podcastId: string,
  workerId: string,
  options?: ClaimInfographicJobOptions,
): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const leaseSeconds = normalizeLeaseSeconds(options);
    const result = isD1DatabaseProvider()
      ? await sql`
          UPDATE infographic_jobs
          SET
            lease_expires_at = datetime('now', '+' || ${leaseSeconds} || ' seconds'),
            updated_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${podcastId}
            AND status = 'processing'
            AND worker_id = ${workerId}
          RETURNING *
        `
      : await sql`
          UPDATE infographic_jobs
          SET
            lease_expires_at = CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'),
            updated_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${podcastId}
            AND status = 'processing'
            AND worker_id = ${workerId}
          RETURNING *
        `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Infographic job not found or lease is no longer owned' };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('heartbeatInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function completeInfographicJob(
  podcastId: string,
  workerId: string,
  payload: CompleteInfographicJobPayload,
): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const result = await sql`
      UPDATE infographic_jobs
      SET
        status = 'completed',
        artifact_url = ${payload.artifactUrl},
        artifact_media_type = ${payload.artifactMediaType},
        cost_usd = ${payload.costUsd},
        next_attempt_at = NULL,
        lease_expires_at = NULL,
        error_code = NULL,
        error_message = NULL,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status = 'processing'
        AND worker_id = ${workerId}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Infographic job not found or lease is no longer owned' };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('completeInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordInfographicFailure(
  podcastId: string,
  workerId: string,
  payload: InfographicFailurePayload,
): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const errorCode = sanitizeErrorCode(payload.errorCode);
    const errorMessage = sanitizeErrorMessage(payload.message);
    const result = isD1DatabaseProvider()
      ? await sql`
          UPDATE infographic_jobs
          SET
            status = CASE
              WHEN ${payload.transient} AND attempts < 3 THEN 'pending'
              ELSE 'failed'
            END,
            next_attempt_at = CASE
              WHEN ${payload.transient} AND attempts < 3 AND attempts = 1 THEN datetime('now', '+1 minute')
              WHEN ${payload.transient} AND attempts < 3 AND attempts = 2 THEN datetime('now', '+5 minutes')
              ELSE NULL
            END,
            lease_expires_at = NULL,
            worker_id = NULL,
            error_code = ${errorCode},
            error_message = ${errorMessage},
            completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${podcastId}
            AND status = 'processing'
            AND worker_id = ${workerId}
          RETURNING *
        `
      : await sql`
          UPDATE infographic_jobs
          SET
            status = CASE
              WHEN ${payload.transient} AND attempts < 3 THEN 'pending'
              ELSE 'failed'
            END,
            next_attempt_at = CASE
              WHEN ${payload.transient} AND attempts < 3 AND attempts = 1 THEN CURRENT_TIMESTAMP + INTERVAL '1 minute'
              WHEN ${payload.transient} AND attempts < 3 AND attempts = 2 THEN CURRENT_TIMESTAMP + INTERVAL '5 minutes'
              ELSE NULL
            END,
            lease_expires_at = NULL,
            worker_id = NULL,
            error_code = ${errorCode},
            error_message = ${errorMessage},
            completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${podcastId}
            AND status = 'processing'
            AND worker_id = ${workerId}
          RETURNING *
        `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Infographic job not found or lease is no longer owned' };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('recordInfographicFailure failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function retryInfographicJob(podcastId: string): Promise<InfographicJobResult> {
  try {
    await ensureInfographicJobsTable();
    const result = await sql`
      UPDATE infographic_jobs
      SET
        status = 'pending',
        attempts = 0,
        next_attempt_at = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        error_code = NULL,
        error_message = NULL,
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${podcastId}
        AND status = 'failed'
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'Infographic job not found or cannot be retried' };
    }

    return { success: true, data: mapRowToInfographicJob(result.rows[0]) };
  } catch (error) {
    console.error('retryInfographicJob failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function reconcileInfographicJobs(
  options: ReconcileInfographicJobsOptions,
): Promise<ReconcileInfographicJobsResult> {
  if (!options.activationTime) {
    return { success: true, data: { enqueued: 0 } };
  }

  try {
    await ensureInfographicJobsTable();
    const limit = normalizeReconciliationLimit(options.limit);
    const activationTime = isD1DatabaseProvider()
      ? normalizeD1DateTime(options.activationTime)
      : options.activationTime;
    if (!activationTime) {
      return { success: false, error: 'Invalid infographic activation timestamp' };
    }
    const result = await sql`
      INSERT INTO infographic_jobs (
        podcast_id,
        status,
        model,
        prompt_version,
        source_title,
        source_url
      )
      SELECT
        p.id,
        'pending',
        ${INFOGRAPHIC_MODEL},
        ${INFOGRAPHIC_PROMPT_VERSION},
        p.title,
        p.source_reference
      FROM podcasts p
      JOIN analysis_results ar ON ar.podcast_id = p.id
      LEFT JOIN infographic_jobs existing ON existing.podcast_id = p.id
      WHERE existing.podcast_id IS NULL
        AND ar.processed_at >= ${activationTime}
      ORDER BY ar.processed_at ASC
      LIMIT ${limit}
      ON CONFLICT (podcast_id) DO NOTHING
    `;

    return { success: true, data: { enqueued: Number(result.rowCount || 0) } };
  } catch (error) {
    console.error('reconcileInfographicJobs failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
