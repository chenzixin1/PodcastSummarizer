import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getD1DatabaseBinding, sql } from '../sql';
import { deleteObject, getObject, getObjectText, uploadObject } from '../objectStorage';
import { normalizeWatchlessArticle, type WatchlessArticle } from './article';

export const WATCHLESS_URL_CREDIT_COST = 1000;
export const WATCHLESS_ONLINE_MODEL = 'openai/gpt-5.6-luna';
export const WATCHLESS_MAX_ACTIVE_JOBS_PER_USER = 1;
export const WATCHLESS_MAX_URL_JOBS_PER_USER_PER_DAY = 3;
export const WATCHLESS_MAX_ACTIVE_BUNDLE_JOBS_PER_USER = 3;
export const WATCHLESS_MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const WATCHLESS_MAX_TOTAL_ASSET_BYTES = 350 * 1024 * 1024;
export const WATCHLESS_MAX_ASSETS = 100;

export const WATCHLESS_JOB_STATUSES = [
  'created',
  'awaiting_upload',
  'queued',
  'preparing',
  'transcribing',
  'segmenting',
  'rendering',
  'validating',
  'publishing',
  'completed',
  'failed',
  'cancelled',
  'rolled_back',
] as const;

export type WatchlessJobStatus = (typeof WATCHLESS_JOB_STATUSES)[number];
export type WatchlessJobSourceKind = 'url' | 'mcp_bundle';
export type WatchlessAssetRole = 'article' | 'pdf' | 'keyframe' | 'transcript' | 'html' | 'manifest' | 'other';

const ACTIVE_STATUSES: WatchlessJobStatus[] = [
  'created',
  'awaiting_upload',
  'queued',
  'preparing',
  'transcribing',
  'segmenting',
  'rendering',
  'validating',
  'publishing',
];
const CANCELLABLE_STATUSES: WatchlessJobStatus[] = [
  'created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering',
];
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const ALLOWED_ASSET_ROLES = new Set<WatchlessAssetRole>([
  'article', 'pdf', 'keyframe', 'transcript', 'html', 'manifest', 'other',
]);
const ASSET_CONTENT_TYPES: Record<WatchlessAssetRole, ReadonlySet<string>> = {
  article: new Set(['application/json']),
  pdf: new Set(['application/pdf']),
  keyframe: new Set(['image/jpeg', 'image/png']),
  transcript: new Set(['text/plain', 'application/x-subrip']),
  html: new Set(['text/html']),
  manifest: new Set(['application/json']),
  other: new Set(['application/octet-stream']),
};

type D1Result<T = Record<string, unknown>> = { results?: T[]; meta?: { changes?: number } };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
};
type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: <T = Record<string, unknown>>(statements: D1Statement[]) => Promise<Array<D1Result<T>>>;
};

export interface WatchlessJob {
  id: string;
  userId: string;
  sourceKind: WatchlessJobSourceKind;
  sourceUrl: string | null;
  videoId: string | null;
  title: string | null;
  preferredLanguage: string | null;
  status: WatchlessJobStatus;
  stage: string | null;
  progressCurrent: number;
  progressTotal: number;
  workflowInstanceId: string | null;
  model: string | null;
  isPublic: boolean;
  rightsConfirmed: boolean;
  creditsReserved: number;
  creditStatus: 'none' | 'reserved' | 'charged' | 'refunded';
  outputPodcastId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface WatchlessJobEvent {
  id: number;
  jobId: string;
  status: WatchlessJobStatus;
  stage: string;
  progressCurrent: number;
  progressTotal: number;
  message: string | null;
  createdAt: string;
}

export interface WatchlessJobAsset {
  id: string;
  jobId: string;
  assetPath: string;
  role: WatchlessAssetRole;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: 'uploaded' | 'published' | 'deleted';
}

export class WatchlessJobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function d1(): D1Database {
  const binding = getD1DatabaseBinding() as unknown as D1Database | null;
  if (!binding) throw new WatchlessJobError('D1_UNAVAILABLE', 'Watchless jobs require the D1 production runtime.', 503);
  return binding;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function mapJob(row: Record<string, unknown>): WatchlessJob {
  return {
    id: String(row.id || ''),
    userId: String(row.userId || row.user_id || ''),
    sourceKind: String(row.sourceKind || row.source_kind || 'url') as WatchlessJobSourceKind,
    sourceUrl: asString(row.sourceUrl || row.source_url) || null,
    videoId: asString(row.videoId || row.video_id) || null,
    title: asString(row.title) || null,
    preferredLanguage: asString(row.preferredLanguage || row.preferred_language) || null,
    status: String(row.status || 'created') as WatchlessJobStatus,
    stage: asString(row.stage) || null,
    progressCurrent: Number(row.progressCurrent ?? row.progress_current ?? 0),
    progressTotal: Number(row.progressTotal ?? row.progress_total ?? 100),
    workflowInstanceId: asString(row.workflowInstanceId || row.workflow_instance_id) || null,
    model: asString(row.model) || null,
    isPublic: asBoolean(row.isPublic ?? row.is_public),
    rightsConfirmed: asBoolean(row.rightsConfirmed ?? row.rights_confirmed),
    creditsReserved: Number(row.creditsReserved ?? row.credits_reserved ?? 0),
    creditStatus: String(row.creditStatus || row.credit_status || 'none') as WatchlessJob['creditStatus'],
    outputPodcastId: asString(row.outputPodcastId || row.output_podcast_id) || null,
    errorCode: asString(row.errorCode || row.error_code) || null,
    errorMessage: asString(row.errorMessage || row.error_message) || null,
    createdAt: String(row.createdAt || row.created_at || ''),
    startedAt: asString(row.startedAt || row.started_at) || null,
    updatedAt: String(row.updatedAt || row.updated_at || ''),
    completedAt: asString(row.completedAt || row.completed_at) || null,
  };
}

function mapJobEvent(row: Record<string, unknown>): WatchlessJobEvent {
  return {
    id: Number(row.id || 0),
    jobId: String(row.jobId || row.job_id || ''),
    status: String(row.status || 'created') as WatchlessJobStatus,
    stage: asString(row.stage) || String(row.status || 'created'),
    progressCurrent: Number(row.progressCurrent ?? row.progress_current ?? 0),
    progressTotal: Number(row.progressTotal ?? row.progress_total ?? 100),
    message: asString(row.message) || null,
    createdAt: String(row.createdAt || row.created_at || ''),
  };
}

function mapAsset(row: Record<string, unknown>): WatchlessJobAsset {
  return {
    id: String(row.id || ''),
    jobId: String(row.jobId || row.job_id || ''),
    assetPath: String(row.assetPath || row.asset_path || ''),
    role: String(row.role || 'other') as WatchlessAssetRole,
    objectKey: String(row.objectKey || row.object_key || ''),
    contentType: String(row.contentType || row.content_type || 'application/octet-stream'),
    sizeBytes: Number(row.sizeBytes ?? row.size_bytes ?? 0),
    sha256: String(row.sha256 || ''),
    status: String(row.status || 'uploaded') as WatchlessJobAsset['status'],
  };
}

export function extractYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (YOUTUBE_VIDEO_ID_PATTERN.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') {
      const queryId = url.searchParams.get('v') || '';
      if (YOUTUBE_VIDEO_ID_PATTERN.test(queryId)) return queryId;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live'].includes(parts[0]) && YOUTUBE_VIDEO_ID_PATTERN.test(parts[1])) return parts[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function canonicalYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function podcastIdForVideo(videoId: string): string {
  if (videoId === 'Vv3CEAS_w34') return 'watchless-vv3ceas-w34';
  return `watchless-${videoId.toLowerCase()}`;
}

function normalizeLanguage(input: unknown): string {
  const value = asString(input).slice(0, 16);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value) ? value : 'en-US';
}

function normalizeAssetPath(input: string): string {
  const value = input.trim().replace(/^\/+/, '');
  if (!ASSET_PATH_PATTERN.test(value) || value.includes('..') || value.includes('//')) {
    throw new WatchlessJobError('INVALID_ASSET_PATH', 'Asset path must be a safe relative path.');
  }
  return value;
}

function normalizeAssetContentType(role: WatchlessAssetRole, input: string): string {
  const mediaType = input.split(';', 1)[0].trim().toLowerCase();
  if (!ASSET_CONTENT_TYPES[role].has(mediaType)) {
    throw new WatchlessJobError('INVALID_ASSET_CONTENT_TYPE', `Unsupported content type for ${role}.`, 415);
  }
  if (mediaType === 'text/plain' || mediaType === 'text/html' || mediaType === 'application/json') {
    return `${mediaType}; charset=utf-8`;
  }
  return mediaType;
}

function modelForOnlineWatchless(): string {
  const configured = (process.env.WATCHLESS_MODEL || WATCHLESS_ONLINE_MODEL).trim();
  if (configured !== WATCHLESS_ONLINE_MODEL) {
    throw new WatchlessJobError('MODEL_NOT_ALLOWED', `WATCHLESS_MODEL must be ${WATCHLESS_ONLINE_MODEL}.`, 503);
  }
  return configured;
}

export async function getWatchlessJob(jobId: string): Promise<WatchlessJob | null> {
  const result = await sql`
    SELECT * FROM watchless_jobs WHERE id = ${jobId} LIMIT 1
  `;
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function getOwnedWatchlessJob(jobId: string, userId: string): Promise<WatchlessJob | null> {
  const result = await sql`
    SELECT * FROM watchless_jobs WHERE id = ${jobId} AND user_id = ${userId} LIMIT 1
  `;
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function updateWatchlessJobWorkflow(jobId: string, workflowInstanceId: string): Promise<void> {
  await sql`
    UPDATE watchless_jobs
    SET workflow_instance_id = ${workflowInstanceId}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${jobId}
  `;
}

export async function listOwnedWatchlessJobs(userId: string, limit = 20): Promise<WatchlessJob[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const result = await sql`
    SELECT * FROM watchless_jobs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return result.rows.map(mapJob);
}

export async function listWatchlessJobAssets(jobId: string): Promise<WatchlessJobAsset[]> {
  const result = await sql`
    SELECT * FROM watchless_job_assets
    WHERE job_id = ${jobId} AND status != 'deleted'
    ORDER BY role, asset_path
  `;
  return result.rows.map(mapAsset);
}

export async function listWatchlessJobEvents(jobId: string): Promise<WatchlessJobEvent[]> {
  try {
    const result = await sql`
      SELECT * FROM watchless_job_events
      WHERE job_id = ${jobId}
      ORDER BY created_at ASC, id ASC
      LIMIT 200
    `;
    return result.rows.map(mapJobEvent);
  } catch (error) {
    console.error('[Watchless] Could not load job events:', error);
    return [];
  }
}

async function recordWatchlessJobEvent(job: WatchlessJob, message?: string | null): Promise<void> {
  try {
    await sql`
      INSERT INTO watchless_job_events (
        job_id, status, stage, progress_current, progress_total, message
      ) VALUES (
        ${job.id}, ${job.status}, ${job.stage || job.status},
        ${job.progressCurrent}, ${job.progressTotal}, ${asString(message).slice(0, 500) || null}
      )
    `;
  } catch (error) {
    // Diagnostics must never be able to break the conversion itself.
    console.error('[Watchless] Could not record job event:', error);
  }
}

export async function createWatchlessUrlJob(input: {
  userId: string;
  sourceUrl: string;
  rightsConfirmed: boolean;
  preferredLanguage?: string;
  isPublic?: boolean;
  idempotencyKey?: string;
}): Promise<WatchlessJob> {
  if (!input.rightsConfirmed) {
    throw new WatchlessJobError('RIGHTS_CONFIRMATION_REQUIRED', 'You must confirm that you are authorized to process this video.', 403);
  }
  const videoId = extractYoutubeVideoId(input.sourceUrl);
  if (!videoId) throw new WatchlessJobError('INVALID_YOUTUBE_URL', 'Only supported YouTube URLs or video IDs are accepted.');
  const publication = await sql`
    SELECT podcast_id FROM watchless_publications WHERE video_id = ${videoId} LIMIT 1
  `;
  if (publication.rows[0]) {
    throw new WatchlessJobError(
      'VIDEO_ALREADY_PUBLISHED',
      'This video already has a PodSum Watchless publication. Versioned replacement is not enabled.',
      409,
    );
  }
  const existing = await sql`
    SELECT * FROM watchless_jobs
    WHERE user_id = ${input.userId}
      AND video_id = ${videoId}
      AND status IN ('created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering', 'validating', 'publishing')
    ORDER BY created_at DESC LIMIT 1
  `;
  if (existing.rows[0]) return mapJob(existing.rows[0]);

  const id = `wl_${nanoid(18)}`;
  const model = modelForOnlineWatchless();
  const sourceUrl = canonicalYoutubeUrl(videoId);
  const idempotencyKey = asString(input.idempotencyKey).slice(0, 120) || null;
  const db = d1();
  const statements = [
    db.prepare(`
      UPDATE users
      SET credits = credits - ?
      WHERE id = ?
        AND credits >= ?
        AND (
          SELECT COUNT(*) FROM watchless_jobs
          WHERE user_id = ?
            AND status IN ('created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering', 'validating', 'publishing')
        ) < ?
        AND (
          SELECT COUNT(*) FROM watchless_jobs
          WHERE user_id = ? AND source_kind = 'url'
            AND created_at >= datetime('now', '-24 hours')
        ) < ?
      RETURNING id, credits
    `).bind(
      WATCHLESS_URL_CREDIT_COST,
      input.userId,
      WATCHLESS_URL_CREDIT_COST,
      input.userId,
      WATCHLESS_MAX_ACTIVE_JOBS_PER_USER,
      input.userId,
      WATCHLESS_MAX_URL_JOBS_PER_USER_PER_DAY,
    ),
    db.prepare(`
      INSERT INTO watchless_jobs (
        id, user_id, source_kind, source_url, video_id, preferred_language,
        status, stage, workflow_instance_id, container_instance_name, model,
        is_public, rights_confirmed, credits_reserved, credit_status, idempotency_key
      )
      SELECT ?, ?, 'url', ?, ?, ?, 'queued', 'queued', ?, ?, ?, ?, 1, ?, 'reserved', ?
      WHERE changes() = 1
      RETURNING *
    `).bind(
      id,
      input.userId,
      sourceUrl,
      videoId,
      normalizeLanguage(input.preferredLanguage),
      null,
      `watchless-${id}`,
      model,
      input.isPublic ? 1 : 0,
      WATCHLESS_URL_CREDIT_COST,
      idempotencyKey,
    ),
    db.prepare(`
      INSERT INTO credit_transactions (
        id, user_id, delta, balance_after, reason, source, ref_type, ref_id, note
      )
      SELECT ?, ?, ?, credits, 'watchless_credit_reservation', 'watchless_url', 'watchless_job', ?, ?
      FROM users
      WHERE id = ? AND EXISTS (SELECT 1 FROM watchless_jobs WHERE id = ?)
    `).bind(
      nanoid(),
      input.userId,
      -WATCHLESS_URL_CREDIT_COST,
      id,
      `Reserved ${WATCHLESS_URL_CREDIT_COST} credits for online Watchless conversion`,
      input.userId,
      id,
    ),
    db.prepare('SELECT id, credits FROM users WHERE id = ? LIMIT 1').bind(input.userId),
  ];
  try {
    const results = await db.batch(statements);
    const inserted = results[1]?.results?.[0];
    if (inserted) {
      const job = mapJob(inserted);
      await recordWatchlessJobEvent(job, 'URL conversion accepted.');
      return job;
    }
    const userExists = Boolean(results[3]?.results?.[0]);
    if (!userExists) throw new WatchlessJobError('USER_NOT_FOUND', 'User not found.', 404);
    throw new WatchlessJobError(
      'WATCHLESS_LIMIT_OR_CREDITS',
      `At least ${WATCHLESS_URL_CREDIT_COST} available credits, no other active Watchless job, and fewer than ${WATCHLESS_MAX_URL_JOBS_PER_USER_PER_DAY} URL jobs in the last 24 hours are required.`,
      402,
    );
  } catch (error) {
    if (error instanceof WatchlessJobError) throw error;
    if (/unique constraint/i.test(String(error)) && idempotencyKey) {
      const duplicate = await sql`
        SELECT * FROM watchless_jobs WHERE user_id = ${input.userId} AND idempotency_key = ${idempotencyKey} LIMIT 1
      `;
      if (duplicate.rows[0]) return mapJob(duplicate.rows[0]);
    }
    if (/WATCHLESS_VIDEO_ACTIVE/i.test(String(error))) {
      throw new WatchlessJobError('VIDEO_JOB_ACTIVE', 'Another Watchless job for this video is already active.', 409);
    }
    throw error;
  }
}

export async function createWatchlessBundleJob(input: {
  userId: string;
  videoId: string;
  rightsConfirmed: boolean;
  title?: string;
  isPublic?: boolean;
  idempotencyKey?: string;
}): Promise<WatchlessJob> {
  if (!input.rightsConfirmed) {
    throw new WatchlessJobError('RIGHTS_CONFIRMATION_REQUIRED', 'You must confirm that you are authorized to publish these assets.', 403);
  }
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(input.videoId)) throw new WatchlessJobError('INVALID_VIDEO_ID', 'Invalid YouTube video ID.');
  const activeForVideo = await sql`
    SELECT * FROM watchless_jobs
    WHERE user_id = ${input.userId} AND video_id = ${input.videoId}
      AND source_kind = 'mcp_bundle' AND status IN ('awaiting_upload', 'validating', 'publishing')
    ORDER BY created_at DESC LIMIT 1
  `;
  if (activeForVideo.rows[0]) return mapJob(activeForVideo.rows[0]);
  const idempotencyKey = asString(input.idempotencyKey).slice(0, 120) || null;
  if (idempotencyKey) {
    const existing = await sql`
      SELECT * FROM watchless_jobs WHERE user_id = ${input.userId} AND idempotency_key = ${idempotencyKey} LIMIT 1
    `;
    if (existing.rows[0]) return mapJob(existing.rows[0]);
  }
  const publication = await sql`
    SELECT podcast_id FROM watchless_publications WHERE video_id = ${input.videoId} LIMIT 1
  `;
  if (publication.rows[0]) {
    throw new WatchlessJobError(
      'VIDEO_ALREADY_PUBLISHED',
      'This video already has a PodSum Watchless publication. Versioned replacement is not enabled.',
      409,
    );
  }
  const id = `wl_${nanoid(18)}`;
  let result;
  try {
    result = await sql`
      INSERT INTO watchless_jobs (
        id, user_id, source_kind, source_url, video_id, title, status, stage,
        workflow_instance_id, model, is_public, rights_confirmed, idempotency_key
      ) SELECT
        ${id}, ${input.userId}, 'mcp_bundle', ${canonicalYoutubeUrl(input.videoId)}, ${input.videoId},
        ${asString(input.title).slice(0, 500) || null}, 'awaiting_upload', 'awaiting_upload',
        NULL, NULL, ${input.isPublic ? 1 : 0}, 1, ${idempotencyKey}
      WHERE (
        SELECT COUNT(*) FROM watchless_jobs
        WHERE user_id = ${input.userId} AND source_kind = 'mcp_bundle'
          AND status IN ('awaiting_upload', 'validating', 'publishing')
      ) < ${WATCHLESS_MAX_ACTIVE_BUNDLE_JOBS_PER_USER}
      RETURNING *
    `;
  } catch (error) {
    if (/WATCHLESS_VIDEO_ACTIVE/i.test(String(error))) {
      throw new WatchlessJobError('VIDEO_JOB_ACTIVE', 'Another Watchless job for this video is already active.', 409);
    }
    throw error;
  }
  if (!result.rows[0]) {
    throw new WatchlessJobError(
      'MCP_BUNDLE_JOB_LIMIT',
      `At most ${WATCHLESS_MAX_ACTIVE_BUNDLE_JOBS_PER_USER} active Watchless upload jobs are allowed per user.`,
      429,
    );
  }
  const job = mapJob(result.rows[0]);
  await recordWatchlessJobEvent(job, 'Waiting for the Watchless bundle upload.');
  return job;
}

export async function uploadWatchlessJobAsset(input: {
  jobId: string;
  userId: string;
  assetPath: string;
  role: WatchlessAssetRole;
  contentType: string;
  bytes: ArrayBuffer | Uint8Array;
  expectedSha256?: string;
}): Promise<WatchlessJobAsset> {
  const job = await getOwnedWatchlessJob(input.jobId, input.userId);
  if (!job) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  if (job.sourceKind !== 'mcp_bundle' || job.status !== 'awaiting_upload') {
    throw new WatchlessJobError('JOB_NOT_UPLOADABLE', 'This job is not accepting MCP assets.', 409);
  }
  if (!ALLOWED_ASSET_ROLES.has(input.role)) throw new WatchlessJobError('INVALID_ASSET_ROLE', 'Invalid Watchless asset role.');
  const assetPath = normalizeAssetPath(input.assetPath);
  const contentType = normalizeAssetContentType(input.role, input.contentType || 'application/octet-stream');
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > WATCHLESS_MAX_ASSET_BYTES) {
    throw new WatchlessJobError('ASSET_SIZE_LIMIT', `Each asset must be between 1 byte and ${WATCHLESS_MAX_ASSET_BYTES} bytes.`, 413);
  }
  const existingAsset = await sql<{ id: string; sizeBytes: number }>`
    SELECT id, size_bytes as "sizeBytes" FROM watchless_job_assets
    WHERE job_id = ${input.jobId} AND asset_path = ${assetPath} AND status != 'deleted' LIMIT 1
  `;
  const usage = await sql<{ count: number; totalBytes: number }>`
    SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as "totalBytes"
    FROM watchless_job_assets WHERE job_id = ${input.jobId} AND status != 'deleted'
  `;
  const currentCount = Number(usage.rows[0]?.count || 0);
  const currentBytes = Number(usage.rows[0]?.totalBytes || 0);
  const replacedBytes = Number(existingAsset.rows[0]?.sizeBytes || 0);
  if (!existingAsset.rows[0] && currentCount >= WATCHLESS_MAX_ASSETS) throw new WatchlessJobError('ASSET_COUNT_LIMIT', 'Too many Watchless assets.', 413);
  if (currentBytes - replacedBytes + bytes.byteLength > WATCHLESS_MAX_TOTAL_ASSET_BYTES) {
    throw new WatchlessJobError('TOTAL_ASSET_SIZE_LIMIT', 'Watchless upload exceeds the total asset size limit.', 413);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expectedSha256 = asString(input.expectedSha256).toLowerCase();
  if (!SHA256_PATTERN.test(expectedSha256) || expectedSha256 !== sha256) {
    throw new WatchlessJobError('ASSET_CHECKSUM_MISMATCH', 'Asset SHA-256 does not match the uploaded bytes.', 422);
  }
  const objectKey = `watchless-staging/${job.id}/${assetPath}`;
  await uploadObject(objectKey, bytes, { contentType });
  const id = `wla_${nanoid(16)}`;
  try {
    const result = await sql`
      INSERT INTO watchless_job_assets (
        id, job_id, asset_path, role, object_key, content_type, size_bytes, sha256, status, updated_at
      ) VALUES (
        ${id}, ${job.id}, ${assetPath}, ${input.role}, ${objectKey},
        ${contentType}, ${bytes.byteLength}, ${sha256}, 'uploaded', CURRENT_TIMESTAMP
      )
      ON CONFLICT(job_id, asset_path) DO UPDATE SET
        role = excluded.role,
        object_key = excluded.object_key,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        status = 'uploaded',
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return mapAsset(result.rows[0]);
  } catch (error) {
    if (!existingAsset.rows[0]) await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function recordInternalWatchlessAsset(input: {
  jobId: string;
  assetPath: string;
  role: WatchlessAssetRole;
  contentType: string;
  bytes: ArrayBuffer | Uint8Array;
  expectedSha256?: string;
}): Promise<WatchlessJobAsset> {
  const job = await getWatchlessJob(input.jobId);
  if (!job) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  if (job.sourceKind !== 'url' || ![
    'queued', 'preparing', 'transcribing', 'segmenting', 'rendering', 'validating',
  ].includes(job.status)) {
    throw new WatchlessJobError('JOB_NOT_UPLOADABLE', 'This job is not accepting runtime assets.', 409);
  }
  const assetPath = normalizeAssetPath(input.assetPath);
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  if (!ALLOWED_ASSET_ROLES.has(input.role) || bytes.byteLength < 1 || bytes.byteLength > WATCHLESS_MAX_ASSET_BYTES) {
    throw new WatchlessJobError('INVALID_ASSET', 'Runtime asset failed validation.', 413);
  }
  const contentType = normalizeAssetContentType(input.role, input.contentType || 'application/octet-stream');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = asString(input.expectedSha256).toLowerCase();
  if (!SHA256_PATTERN.test(expected) || expected !== sha256) throw new WatchlessJobError('ASSET_CHECKSUM_MISMATCH', 'Asset SHA-256 mismatch.', 422);
  const existingAsset = await sql<{ id: string; sizeBytes: number }>`
    SELECT id, size_bytes as "sizeBytes" FROM watchless_job_assets
    WHERE job_id = ${input.jobId} AND asset_path = ${assetPath} AND status != 'deleted' LIMIT 1
  `;
  const usage = await sql<{ count: number; totalBytes: number }>`
    SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as "totalBytes"
    FROM watchless_job_assets WHERE job_id = ${input.jobId} AND status != 'deleted'
  `;
  const currentCount = Number(usage.rows[0]?.count || 0);
  const currentBytes = Number(usage.rows[0]?.totalBytes || 0);
  const replacedBytes = Number(existingAsset.rows[0]?.sizeBytes || 0);
  if (!existingAsset.rows[0] && currentCount >= WATCHLESS_MAX_ASSETS) throw new WatchlessJobError('ASSET_COUNT_LIMIT', 'Too many Watchless assets.', 413);
  if (currentBytes - replacedBytes + bytes.byteLength > WATCHLESS_MAX_TOTAL_ASSET_BYTES) {
    throw new WatchlessJobError('TOTAL_ASSET_SIZE_LIMIT', 'Watchless upload exceeds the total asset size limit.', 413);
  }
  const objectKey = `watchless-staging/${job.id}/${assetPath}`;
  await uploadObject(objectKey, bytes, { contentType });
  const id = `wla_${nanoid(16)}`;
  try {
    const result = await sql`
      INSERT INTO watchless_job_assets (
        id, job_id, asset_path, role, object_key, content_type, size_bytes, sha256, status, updated_at
      ) VALUES (
        ${id}, ${job.id}, ${assetPath}, ${input.role}, ${objectKey}, ${contentType},
        ${bytes.byteLength}, ${sha256}, 'uploaded', CURRENT_TIMESTAMP
      )
      ON CONFLICT(job_id, asset_path) DO UPDATE SET
        role = excluded.role, object_key = excluded.object_key, content_type = excluded.content_type,
        size_bytes = excluded.size_bytes, sha256 = excluded.sha256, status = 'uploaded', updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return mapAsset(result.rows[0]);
  } catch (error) {
    if (!existingAsset.rows[0]) await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function updateWatchlessJobStatus(input: {
  jobId: string;
  status: WatchlessJobStatus;
  stage?: string;
  progressCurrent?: number;
  progressTotal?: number;
  title?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  message?: string | null;
}): Promise<WatchlessJob> {
  if (!WATCHLESS_JOB_STATUSES.includes(input.status)) throw new WatchlessJobError('INVALID_STATUS', 'Invalid Watchless job status.');
  const progressCurrent = Math.max(0, Math.min(1000, Math.floor(input.progressCurrent ?? 0)));
  const progressTotal = Math.max(1, Math.min(1000, Math.floor(input.progressTotal ?? 100)));
  const result = await sql`
    UPDATE watchless_jobs SET
      status = ${input.status},
      stage = ${asString(input.stage).slice(0, 80) || input.status},
      progress_current = ${progressCurrent},
      progress_total = ${progressTotal},
      title = COALESCE(${asString(input.title).slice(0, 500) || null}, title),
      error_code = ${asString(input.errorCode).slice(0, 120) || null},
      error_message = ${asString(input.errorMessage).slice(0, 2000) || null},
      started_at = CASE WHEN started_at IS NULL AND ${input.status} NOT IN ('created', 'awaiting_upload', 'queued') THEN CURRENT_TIMESTAMP ELSE started_at END,
      completed_at = CASE WHEN ${input.status} IN ('completed', 'failed', 'cancelled', 'rolled_back') THEN CURRENT_TIMESTAMP ELSE completed_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${input.jobId}
      AND (status NOT IN ('completed', 'failed', 'cancelled', 'rolled_back') OR status = ${input.status})
    RETURNING *
  `;
  if (!result.rows[0]) {
    const current = await getWatchlessJob(input.jobId);
    if (current) throw new WatchlessJobError('INVALID_STATE_TRANSITION', `Cannot change terminal job ${current.status} to ${input.status}.`, 409);
    throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  }
  const job = mapJob(result.rows[0]);
  await recordWatchlessJobEvent(job, input.message);
  return job;
}

export async function refundWatchlessJobCredits(jobId: string, reason: string): Promise<boolean> {
  const db = d1();
  const transactionId = nanoid();
  const results = await db.batch([
    db.prepare(`
      UPDATE watchless_jobs
      SET credit_status = 'refunded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND credit_status = 'reserved' AND credits_reserved > 0
      RETURNING user_id, credits_reserved
    `).bind(jobId),
    db.prepare(`
      UPDATE users
      SET credits = credits + (SELECT credits_reserved FROM watchless_jobs WHERE id = ?)
      WHERE id = (SELECT user_id FROM watchless_jobs WHERE id = ?) AND changes() = 1
      RETURNING id, credits
    `).bind(jobId, jobId),
    db.prepare(`
      INSERT INTO credit_transactions (
        id, user_id, delta, balance_after, reason, source, ref_type, ref_id, note
      )
      SELECT ?, j.user_id, j.credits_reserved, u.credits, 'watchless_job_refund', 'watchless_workflow', 'watchless_job', j.id, ?
      FROM watchless_jobs j JOIN users u ON u.id = j.user_id
      WHERE j.id = ? AND j.credit_status = 'refunded' AND changes() = 1
    `).bind(transactionId, reason.slice(0, 500), jobId),
  ]);
  return Boolean(results[0]?.results?.[0]);
}

function wordCount(value: string): number {
  const latin = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length || 0;
  return latin + cjk;
}

function highConfidenceTags(article: WatchlessArticle): string[] {
  const text = `${article.title} ${article.titleZh} ${article.summaryZh}`.toLowerCase();
  const tags: string[] = [];
  if (/\bai\b|人工智能|模型|agent/.test(text)) tags.push('Artificial Intelligence');
  if (/startup|创业|创始人/.test(text)) tags.push('Startups');
  if (/semiconductor|gpu|hbm|芯片|半导体/.test(text)) tags.push('Semiconductors');
  if (/invest|market|股票|资本|财报/.test(text)) tags.push('Investing');
  return tags.slice(0, 4);
}

function requiredAsset(assets: WatchlessJobAsset[], role: WatchlessAssetRole): WatchlessJobAsset {
  const asset = assets.find((item) => item.role === role);
  if (!asset) throw new WatchlessJobError('MISSING_ASSET', `Missing required ${role} asset.`, 422);
  return asset;
}

export function validateWatchlessTimeline(article: WatchlessArticle, toleranceSeconds = 1): void {
  const scenes = article.scenes;
  if (Math.abs(scenes[0].startSec) > toleranceSeconds) {
    throw new WatchlessJobError('TIMELINE_INCOMPLETE', 'The first scene must start at the beginning of the video.', 422);
  }
  for (let index = 1; index < scenes.length; index += 1) {
    const previous = scenes[index - 1];
    const current = scenes[index];
    if (Math.abs(previous.endSec - current.startSec) > toleranceSeconds) {
      throw new WatchlessJobError('TIMELINE_INCOMPLETE', `Scenes ${index} and ${index + 1} have a gap or overlap.`, 422);
    }
  }
  if (Math.abs(scenes[scenes.length - 1].endSec - article.durationSec) > toleranceSeconds) {
    throw new WatchlessJobError('TIMELINE_INCOMPLETE', 'The final scene must cover the end of the video.', 422);
  }
}

export async function validateWatchlessBundle(jobId: string): Promise<{
  job: WatchlessJob;
  assets: WatchlessJobAsset[];
  article: WatchlessArticle;
}> {
  const job = await getWatchlessJob(jobId);
  if (!job) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  const assets = await listWatchlessJobAssets(jobId);
  if (assets.length > WATCHLESS_MAX_ASSETS) throw new WatchlessJobError('ASSET_COUNT_LIMIT', 'Too many Watchless assets.', 422);
  const articleAsset = requiredAsset(assets, 'article');
  requiredAsset(assets, 'pdf');
  const keyframes = assets.filter((item) => item.role === 'keyframe').sort((a, b) => a.assetPath.localeCompare(b.assetPath));
  let raw: unknown;
  try {
    raw = JSON.parse(await getObjectText(articleAsset.objectKey));
  } catch {
    throw new WatchlessJobError('INVALID_ARTICLE_JSON', 'article.json is missing or invalid.', 422);
  }
  const rawRecord = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  if (!job.videoId) throw new WatchlessJobError('VIDEO_ID_MISSING', 'Watchless job has no video ID.', 422);
  rawRecord.id = podcastIdForVideo(job.videoId);
  rawRecord.videoId = job.videoId;
  const article = normalizeWatchlessArticle(rawRecord);
  if (!article) throw new WatchlessJobError('ARTICLE_VALIDATION_FAILED', 'article.json failed the PodSum Watchless schema.', 422);
  validateWatchlessTimeline(article);
  if (keyframes.length < article.scenes.length) {
    throw new WatchlessJobError('KEYFRAMES_INCOMPLETE', `Expected at least ${article.scenes.length} keyframes, found ${keyframes.length}.`, 422);
  }
  return { job, assets, article };
}

async function copyAsset(asset: WatchlessJobAsset, finalKey: string): Promise<void> {
  const response = await getObject(asset.objectKey);
  if (!response.ok) throw new WatchlessJobError('ASSET_NOT_FOUND', `Uploaded asset is missing: ${asset.assetPath}`, 422);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.sizeBytes) throw new WatchlessJobError('ASSET_SIZE_MISMATCH', `Uploaded asset size changed: ${asset.assetPath}`, 422);
  const sha256 = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  if (sha256 !== asset.sha256) throw new WatchlessJobError('ASSET_CHECKSUM_MISMATCH', `Uploaded asset checksum changed: ${asset.assetPath}`, 422);
  await uploadObject(finalKey, bytes, { contentType: asset.contentType });
}

async function cleanupWatchlessStagingAssets(jobId: string, knownAssets?: WatchlessJobAsset[]): Promise<void> {
  const assets = knownAssets || await listWatchlessJobAssets(jobId);
  const stagingKeys = Array.from(new Set(
    assets.map((asset) => asset.objectKey).filter((key) => key.startsWith('watchless-staging/')),
  ));
  await Promise.all(stagingKeys.map((key) => deleteObject(key).catch(() => undefined)));
  await sql`
    UPDATE watchless_job_assets
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE job_id = ${jobId} AND object_key LIKE ${'watchless-staging/%'}
  `;
}

export async function publishWatchlessJob(jobId: string): Promise<WatchlessJob> {
  const current = await getWatchlessJob(jobId);
  if (current?.status === 'completed') return current;
  await updateWatchlessJobStatus({ jobId, status: 'validating', stage: 'validating', progressCurrent: 80, progressTotal: 100 });
  const { job, assets, article } = await validateWatchlessBundle(jobId);
  const videoId = article.videoId;
  const podcastId = podcastIdForVideo(videoId);
  const existing = await sql<{ podcastId: string; userId: string; publishJobId: string | null }>`
    SELECT wp.podcast_id as "podcastId", p.user_id as "userId", wp.publish_job_id as "publishJobId"
    FROM watchless_publications wp JOIN podcasts p ON p.id = wp.podcast_id
    WHERE wp.video_id = ${videoId} LIMIT 1
  `;
  if (existing.rows[0] && existing.rows[0].publishJobId !== jobId) {
    throw new WatchlessJobError('VIDEO_ALREADY_PUBLISHED', 'This video already has a PodSum Watchless publication. Refusing to overwrite it without version history.', 409);
  }
  const podcastCollision = await sql<{ userId: string; publishJobId: string | null }>`
    SELECT p.user_id as "userId", wp.publish_job_id as "publishJobId"
    FROM podcasts p LEFT JOIN watchless_publications wp ON wp.podcast_id = p.id
    WHERE p.id = ${podcastId} LIMIT 1
  `;
  if (podcastCollision.rows[0] && podcastCollision.rows[0].publishJobId !== jobId) {
    throw new WatchlessJobError('PODCAST_ID_COLLISION', 'The canonical PodSum podcast id is already in use.', 409);
  }
  await updateWatchlessJobStatus({ jobId, status: 'publishing', stage: 'publishing', progressCurrent: 88, progressTotal: 100 });
  const finalPrefix = `watchless/${videoId}`;
  const pdfAsset = requiredAsset(assets, 'pdf');
  const articleAsset = requiredAsset(assets, 'article');
  const transcriptAsset = assets.find((item) => item.role === 'transcript');
  const keyframes = assets.filter((item) => item.role === 'keyframe').sort((a, b) => a.assetPath.localeCompare(b.assetPath));
  const finalKeys: Array<{ asset: WatchlessJobAsset; key: string }> = [];
  finalKeys.push({ asset: pdfAsset, key: `${finalPrefix}/article.pdf` });
  if (transcriptAsset) finalKeys.push({ asset: transcriptAsset, key: `${finalPrefix}/transcript.txt` });
  for (let index = 0; index < article.scenes.length; index += 1) {
    const extension = keyframes[index].assetPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    finalKeys.push({ asset: keyframes[index], key: `${finalPrefix}/keyframes/scene_${String(index + 1).padStart(3, '0')}.${extension}` });
  }
  const articleKey = `${finalPrefix}/article.json`;
  try {
    for (const entry of finalKeys) await copyAsset(entry.asset, entry.key);

    const finalArticleInput: WatchlessArticle = {
    ...article,
    id: podcastId,
    pdfUrl: `/api/files/${finalPrefix}/article.pdf`,
    scenes: article.scenes.map((scene, index) => ({
      ...scene,
      keyframe: `/api/files/${finalKeys.filter((entry) => entry.asset.role === 'keyframe')[index].key}`,
    })),
    };
    const finalArticle = normalizeWatchlessArticle(finalArticleInput);
    if (!finalArticle) throw new WatchlessJobError('FINAL_ARTICLE_VALIDATION_FAILED', 'Final article URL rewrite failed validation.', 500);
    await uploadObject(articleKey, `${JSON.stringify(finalArticle, null, 2)}\n`, { contentType: 'application/json; charset=utf-8' });

    const fullText = finalArticle.scenes.map((scene) => scene.articleZh).join('\n\n');
    const tags = JSON.stringify(highConfidenceTags(finalArticle));
    const transcriptKey = transcriptAsset ? `${finalPrefix}/transcript.txt` : articleKey;
    const database = d1();
    const publicationStatements: D1Statement[] = [
    database.prepare(`
      INSERT INTO podcasts (
        id, title, original_filename, file_size, blob_url, source_reference,
        duration_sec, is_public, user_id, tags_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, blob_url = excluded.blob_url, source_reference = excluded.source_reference,
        duration_sec = excluded.duration_sec, is_public = excluded.is_public, tags_json = excluded.tags_json
    `).bind(
      podcastId, finalArticle.title, `${videoId}.txt`, `${fullText.length} bytes`,
      `/api/files/${transcriptKey}`, finalArticle.sourceUrl, Math.round(finalArticle.durationSec),
      job.isPublic ? 1 : 0, job.userId, tags,
    ),
    database.prepare(`
      INSERT INTO analysis_results (
        podcast_id, summary, summary_zh, summary_en, brief_summary, translation, highlights,
        token_count, word_count, character_count, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(podcast_id) DO UPDATE SET
        summary = excluded.summary, summary_zh = excluded.summary_zh, summary_en = excluded.summary_en,
        brief_summary = excluded.brief_summary, translation = excluded.translation, highlights = excluded.highlights,
        word_count = excluded.word_count, character_count = excluded.character_count, processed_at = CURRENT_TIMESTAMP
    `).bind(
      podcastId, finalArticle.summaryZh, finalArticle.summaryZh, finalArticle.summaryEn,
      finalArticle.summaryZh.slice(0, 420), fullText.slice(0, 22000),
      finalArticle.scenes.slice(0, 8).map((scene) => `- ${scene.titleZh}`).join('\n'),
      wordCount(fullText), fullText.length,
    ),
    database.prepare(`
      INSERT INTO watchless_publications (
        podcast_id, video_id, article_key, scene_count, duration_label,
        has_english_transcript, status, publish_job_id, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(podcast_id) DO UPDATE SET
        video_id = excluded.video_id, article_key = excluded.article_key, scene_count = excluded.scene_count,
        duration_label = excluded.duration_label, has_english_transcript = excluded.has_english_transcript,
        status = 'published', publish_job_id = excluded.publish_job_id,
        published_at = excluded.published_at, updated_at = CURRENT_TIMESTAMP
    `).bind(
      podcastId, videoId, articleKey, finalArticle.scenes.length, finalArticle.durationLabel,
      finalArticle.availableLanguageModes?.includes('en') ? 1 : 0, jobId,
    ),
      ...finalKeys.map((entry) => database.prepare(`
      UPDATE watchless_job_assets SET object_key = ?, status = 'published', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(entry.key, entry.asset.id)),
      database.prepare(`
        UPDATE watchless_job_assets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(articleAsset.id),
      database.prepare(`
      UPDATE watchless_jobs SET
        status = 'completed', stage = 'completed', progress_current = 100, progress_total = 100,
        output_podcast_id = ?, credit_status = CASE WHEN credit_status = 'reserved' THEN 'charged' ELSE credit_status END,
        error_code = NULL, error_message = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(podcastId, jobId),
    ];
    await database.batch(publicationStatements);
    const completedForEvent = await getWatchlessJob(jobId);
    if (completedForEvent) await recordWatchlessJobEvent(completedForEvent, 'PodSum publication completed.');
    await cleanupWatchlessStagingAssets(jobId, assets);
    const completed = await getWatchlessJob(jobId);
    if (!completed) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job disappeared after publication.', 500);
    return completed;
  } catch (error) {
    const current = await getWatchlessJob(jobId).catch(() => null);
    if (current?.status === 'completed') return current;
    await Promise.all([
      ...finalKeys.map((entry) => deleteObject(entry.key).catch(() => undefined)),
      deleteObject(articleKey).catch(() => undefined),
    ]);
    throw error;
  }
}

export async function failWatchlessJob(jobId: string, code: string, message: string): Promise<WatchlessJob> {
  const current = await getWatchlessJob(jobId);
  if (!current) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  if (['completed', 'cancelled', 'rolled_back'].includes(current.status)) return current;
  const job = await updateWatchlessJobStatus({
    jobId,
    status: 'failed',
    stage: current.stage || current.status,
    progressCurrent: current.progressCurrent,
    progressTotal: current.progressTotal,
    errorCode: code,
    errorMessage: message,
    message: `Failed during ${current.stage || current.status}.`,
  });
  if (job.creditStatus === 'reserved') await refundWatchlessJobCredits(jobId, `${code}: ${message}`);
  await cleanupWatchlessStagingAssets(jobId);
  return (await getWatchlessJob(jobId)) || job;
}

export async function rollbackWatchlessJob(jobId: string, userId: string): Promise<WatchlessJob> {
  const job = await getOwnedWatchlessJob(jobId, userId);
  if (!job) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  if (ACTIVE_STATUSES.includes(job.status) && job.status !== 'awaiting_upload') {
    throw new WatchlessJobError('JOB_ACTIVE', 'Terminate the running Workflow before rollback.', 409);
  }
  const assets = await listWatchlessJobAssets(jobId);
  if (job.outputPodcastId) {
    const publication = await sql<{ articleKey: string }>`
      SELECT article_key as "articleKey" FROM watchless_publications
      WHERE podcast_id = ${job.outputPodcastId} LIMIT 1
    `;
    if (publication.rows[0]?.articleKey) await deleteObject(publication.rows[0].articleKey).catch(() => undefined);
    await sql`DELETE FROM podcasts WHERE id = ${job.outputPodcastId} AND user_id = ${userId}`;
  }
  for (const asset of assets) await deleteObject(asset.objectKey).catch(() => undefined);
  if (job.creditStatus === 'reserved') await refundWatchlessJobCredits(jobId, 'Watchless job rolled back before completion');
  await sql`
    UPDATE watchless_jobs SET status = 'rolled_back', stage = 'rolled_back', completed_at = CURRENT_TIMESTAMP,
      output_podcast_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${jobId}
  `;
  const rolledBack = await getWatchlessJob(jobId);
  if (!rolledBack) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  await recordWatchlessJobEvent(rolledBack, 'Publication removed.');
  return rolledBack;
}

export async function cancelWatchlessJob(jobId: string, userId: string): Promise<WatchlessJob> {
  const job = await getOwnedWatchlessJob(jobId, userId);
  if (!job) throw new WatchlessJobError('JOB_NOT_FOUND', 'Watchless job not found.', 404);
  if (!ACTIVE_STATUSES.includes(job.status)) return job;
  if (!CANCELLABLE_STATUSES.includes(job.status)) {
    throw new WatchlessJobError('JOB_COMMITTING', 'The publication commit has started and can no longer be cancelled safely.', 409);
  }
  const cancelled = await updateWatchlessJobStatus({
    jobId,
    status: 'cancelled',
    stage: 'cancelled',
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
  });
  if (cancelled.creditStatus === 'reserved') await refundWatchlessJobCredits(jobId, 'Watchless job cancelled before completion');
  await cleanupWatchlessStagingAssets(jobId);
  return (await getWatchlessJob(jobId)) || cancelled;
}
