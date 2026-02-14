import { sql } from '@vercel/postgres';
import { randomUUID } from 'crypto';
import { ensureExtensionMonitorTables } from './db';

export type ExtensionMonitorPath = 'path1' | 'path2';
export type ExtensionMonitorTaskStatus =
  | 'received'
  | 'accepted'
  | 'transcribing'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';
export type ExtensionMonitorLevel = 'info' | 'warn' | 'error';

export interface ExtensionMonitorTask {
  id: string;
  path: ExtensionMonitorPath;
  status: ExtensionMonitorTaskStatus;
  stage: string;
  userId: string | null;
  userEmail: string | null;
  clientTaskId: string | null;
  traceId: string | null;
  sourceReference: string | null;
  videoId: string | null;
  title: string | null;
  isPublic: boolean;
  transcriptionJobId: string | null;
  podcastId: string | null;
  providerTaskId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastHttpStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionMonitorEvent {
  id: number;
  taskId: string;
  level: ExtensionMonitorLevel;
  stage: string;
  endpoint: string | null;
  httpStatus: number | null;
  message: string | null;
  requestHeaders: unknown;
  requestBody: unknown;
  responseHeaders: unknown;
  responseBody: unknown;
  errorStack: string | null;
  meta: unknown;
  createdAt: string;
}

export interface ExtensionMonitorTaskListResult {
  tasks: ExtensionMonitorTask[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExtensionMonitorTaskDetailResult {
  task: ExtensionMonitorTask;
  events: ExtensionMonitorEvent[];
}

interface CreateExtensionMonitorTaskInput {
  id?: string;
  path: ExtensionMonitorPath;
  status: ExtensionMonitorTaskStatus;
  stage: string;
  userId?: string | null;
  userEmail?: string | null;
  clientTaskId?: string | null;
  traceId?: string | null;
  sourceReference?: string | null;
  videoId?: string | null;
  title?: string | null;
  isPublic?: boolean;
  transcriptionJobId?: string | null;
  podcastId?: string | null;
  providerTaskId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastHttpStatus?: number | null;
}

interface UpdateExtensionMonitorTaskInput {
  status?: ExtensionMonitorTaskStatus;
  stage?: string;
  userEmail?: string | null;
  clientTaskId?: string | null;
  traceId?: string | null;
  sourceReference?: string | null;
  videoId?: string | null;
  title?: string | null;
  isPublic?: boolean;
  transcriptionJobId?: string | null;
  podcastId?: string | null;
  providerTaskId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastHttpStatus?: number | null;
  clearError?: boolean;
}

interface RecordExtensionMonitorEventInput {
  taskId: string;
  level?: ExtensionMonitorLevel;
  stage: string;
  endpoint?: string | null;
  httpStatus?: number | null;
  message?: string | null;
  requestHeaders?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  errorStack?: string | null;
  meta?: unknown;
}

interface ListExtensionMonitorTasksInput {
  page?: number;
  pageSize?: number;
  path?: ExtensionMonitorPath | '';
  status?: ExtensionMonitorTaskStatus | '';
  q?: string;
  from?: string;
  to?: string;
}

let lastCleanupAt = 0;
const CLEANUP_THROTTLE_MS = 10 * 60 * 1000;
const MAX_TEXT_LEN = 4096;
const MAX_JSON_TEXT_LEN = 200000;

function parseBool(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function parseIntSafe(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function isExtensionMonitorEnabled(): boolean {
  return parseBool(process.env.EXTENSION_MONITOR_ENABLED, false);
}

export function isExtensionMonitorCaptureRawEnabled(): boolean {
  return parseBool(process.env.EXTENSION_MONITOR_CAPTURE_RAW, false);
}

export function extensionMonitorRetentionDays(): number {
  return parseIntSafe(process.env.EXTENSION_MONITOR_RETENTION_DAYS, 3);
}

function limitText(value: string | null | undefined, max = MAX_TEXT_LEN): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, max);
}

function safeJsonStringify(input: unknown): string | null {
  if (input === undefined || input === null) {
    return null;
  }

  try {
    return JSON.stringify(input);
  } catch (error) {
    return JSON.stringify({
      __non_serializable__: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function redactSensitive(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item));
  }

  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower === 'password' || lower === 'pass' || lower === 'pwd') {
      next[key] = '***';
      continue;
    }
    next[key] = redactSensitive(value);
  }
  return next;
}

function toJsonbPayload(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const redacted = redactSensitive(raw);
  const json = safeJsonStringify(redacted);
  if (!json) {
    return null;
  }
  if (json.length > MAX_JSON_TEXT_LEN) {
    return JSON.stringify({
      __truncated__: true,
      bytes: json.length,
      preview: json.slice(0, MAX_JSON_TEXT_LEN),
    });
  }
  return json;
}

function mapTaskRow(row: Record<string, unknown>): ExtensionMonitorTask {
  return {
    id: String(row.id || ''),
    path: (String(row.path || 'path1') === 'path2' ? 'path2' : 'path1') as ExtensionMonitorPath,
    status: String(row.status || 'received') as ExtensionMonitorTaskStatus,
    stage: String(row.stage || ''),
    userId: (row.userId as string | null) || null,
    userEmail: (row.userEmail as string | null) || null,
    clientTaskId: (row.clientTaskId as string | null) || null,
    traceId: (row.traceId as string | null) || null,
    sourceReference: (row.sourceReference as string | null) || null,
    videoId: (row.videoId as string | null) || null,
    title: (row.title as string | null) || null,
    isPublic: Boolean(row.isPublic),
    transcriptionJobId: (row.transcriptionJobId as string | null) || null,
    podcastId: (row.podcastId as string | null) || null,
    providerTaskId: (row.providerTaskId as string | null) || null,
    lastErrorCode: (row.lastErrorCode as string | null) || null,
    lastErrorMessage: (row.lastErrorMessage as string | null) || null,
    lastHttpStatus: row.lastHttpStatus ? Number(row.lastHttpStatus) : null,
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
  };
}

function mapEventRow(row: Record<string, unknown>): ExtensionMonitorEvent {
  return {
    id: Number(row.id || 0),
    taskId: String(row.taskId || ''),
    level: (String(row.level || 'info') as ExtensionMonitorLevel),
    stage: String(row.stage || ''),
    endpoint: (row.endpoint as string | null) || null,
    httpStatus: row.httpStatus ? Number(row.httpStatus) : null,
    message: (row.message as string | null) || null,
    requestHeaders: row.requestHeaders || null,
    requestBody: row.requestBody || null,
    responseHeaders: row.responseHeaders || null,
    responseBody: row.responseBody || null,
    errorStack: (row.errorStack as string | null) || null,
    meta: row.meta || null,
    createdAt: String(row.createdAt || ''),
  };
}

async function ensureEnabledAndReady(): Promise<boolean> {
  if (!isExtensionMonitorEnabled()) {
    return false;
  }
  await ensureExtensionMonitorTables();
  return true;
}

async function maybeCleanupExpiredRows(): Promise<void> {
  if (!(await ensureEnabledAndReady())) {
    return;
  }

  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_THROTTLE_MS) {
    return;
  }
  lastCleanupAt = now;

  const retentionDays = extensionMonitorRetentionDays();
  await sql`
    DELETE FROM extension_monitor_events
    WHERE created_at < NOW() - (${retentionDays} * INTERVAL '1 day')
  `;
  await sql`
    DELETE FROM extension_monitor_tasks
    WHERE created_at < NOW() - (${retentionDays} * INTERVAL '1 day')
  `;
}

export async function createExtensionMonitorTask(
  input: CreateExtensionMonitorTaskInput,
): Promise<ExtensionMonitorTask | null> {
  if (!(await ensureEnabledAndReady())) {
    return null;
  }

  const id = input.id || randomUUID();
  const result = await sql`
    INSERT INTO extension_monitor_tasks (
      id,
      path,
      status,
      stage,
      user_id,
      user_email,
      client_task_id,
      trace_id,
      source_reference,
      video_id,
      title,
      is_public,
      transcription_job_id,
      podcast_id,
      provider_task_id,
      last_error_code,
      last_error_message,
      last_http_status
    )
    VALUES (
      ${id},
      ${input.path},
      ${input.status},
      ${input.stage},
      ${input.userId ?? null},
      ${limitText(input.userEmail)},
      ${limitText(input.clientTaskId)},
      ${limitText(input.traceId)},
      ${limitText(input.sourceReference, 1024)},
      ${limitText(input.videoId, 128)},
      ${limitText(input.title, 512)},
      ${Boolean(input.isPublic)},
      ${limitText(input.transcriptionJobId)},
      ${limitText(input.podcastId)},
      ${limitText(input.providerTaskId)},
      ${limitText(input.lastErrorCode, 128)},
      ${limitText(input.lastErrorMessage)},
      ${typeof input.lastHttpStatus === 'number' ? input.lastHttpStatus : null}
    )
    ON CONFLICT (id)
    DO UPDATE SET
      status = EXCLUDED.status,
      stage = EXCLUDED.stage,
      user_id = COALESCE(EXCLUDED.user_id, extension_monitor_tasks.user_id),
      user_email = COALESCE(EXCLUDED.user_email, extension_monitor_tasks.user_email),
      client_task_id = COALESCE(EXCLUDED.client_task_id, extension_monitor_tasks.client_task_id),
      trace_id = COALESCE(EXCLUDED.trace_id, extension_monitor_tasks.trace_id),
      source_reference = COALESCE(EXCLUDED.source_reference, extension_monitor_tasks.source_reference),
      video_id = COALESCE(EXCLUDED.video_id, extension_monitor_tasks.video_id),
      title = COALESCE(EXCLUDED.title, extension_monitor_tasks.title),
      is_public = EXCLUDED.is_public,
      transcription_job_id = COALESCE(EXCLUDED.transcription_job_id, extension_monitor_tasks.transcription_job_id),
      podcast_id = COALESCE(EXCLUDED.podcast_id, extension_monitor_tasks.podcast_id),
      provider_task_id = COALESCE(EXCLUDED.provider_task_id, extension_monitor_tasks.provider_task_id),
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      last_http_status = EXCLUDED.last_http_status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;

  await maybeCleanupExpiredRows().catch((error) => {
    console.error('[EXT_MON] cleanup failed:', error);
  });

  if (!result.rows.length) {
    return null;
  }
  return mapTaskRow(result.rows[0]);
}

export async function updateExtensionMonitorTask(
  taskId: string,
  patch: UpdateExtensionMonitorTaskInput,
): Promise<ExtensionMonitorTask | null> {
  if (!taskId || !(await ensureEnabledAndReady())) {
    return null;
  }

  const clearError = Boolean(patch.clearError);
  const result = await sql`
    UPDATE extension_monitor_tasks
    SET
      status = COALESCE(${patch.status ?? null}, status),
      stage = COALESCE(${patch.stage ?? null}, stage),
      user_email = COALESCE(${limitText(patch.userEmail)} , user_email),
      client_task_id = COALESCE(${limitText(patch.clientTaskId)} , client_task_id),
      trace_id = COALESCE(${limitText(patch.traceId)} , trace_id),
      source_reference = COALESCE(${limitText(patch.sourceReference, 1024)} , source_reference),
      video_id = COALESCE(${limitText(patch.videoId, 128)} , video_id),
      title = COALESCE(${limitText(patch.title, 512)} , title),
      is_public = COALESCE(${typeof patch.isPublic === 'boolean' ? patch.isPublic : null}, is_public),
      transcription_job_id = COALESCE(${limitText(patch.transcriptionJobId)} , transcription_job_id),
      podcast_id = COALESCE(${limitText(patch.podcastId)} , podcast_id),
      provider_task_id = COALESCE(${limitText(patch.providerTaskId)} , provider_task_id),
      last_error_code =
        CASE
          WHEN ${clearError} THEN NULL
          ELSE COALESCE(${limitText(patch.lastErrorCode, 128)}, last_error_code)
        END,
      last_error_message =
        CASE
          WHEN ${clearError} THEN NULL
          ELSE COALESCE(${limitText(patch.lastErrorMessage)}, last_error_message)
        END,
      last_http_status =
        CASE
          WHEN ${clearError} THEN NULL
          ELSE COALESCE(${typeof patch.lastHttpStatus === 'number' ? patch.lastHttpStatus : null}, last_http_status)
        END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${taskId}
    RETURNING
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;

  if (!result.rows.length) {
    return null;
  }
  return mapTaskRow(result.rows[0]);
}

export async function recordExtensionMonitorEvent(
  input: RecordExtensionMonitorEventInput,
): Promise<ExtensionMonitorEvent | null> {
  if (!input.taskId || !(await ensureEnabledAndReady())) {
    return null;
  }

  const captureRaw = isExtensionMonitorCaptureRawEnabled();
  const requestHeaders = captureRaw ? toJsonbPayload(input.requestHeaders) : null;
  const requestBody = captureRaw ? toJsonbPayload(input.requestBody) : null;
  const responseHeaders = captureRaw ? toJsonbPayload(input.responseHeaders) : null;
  const responseBody = captureRaw ? toJsonbPayload(input.responseBody) : null;
  const metaPayload = toJsonbPayload(input.meta);

  const result = await sql`
    INSERT INTO extension_monitor_events (
      task_id,
      level,
      stage,
      endpoint,
      http_status,
      message,
      request_headers,
      request_body,
      response_headers,
      response_body,
      error_stack,
      meta
    )
    VALUES (
      ${input.taskId},
      ${input.level || 'info'},
      ${input.stage},
      ${limitText(input.endpoint, 256)},
      ${typeof input.httpStatus === 'number' ? input.httpStatus : null},
      ${limitText(input.message)},
      ${requestHeaders}::jsonb,
      ${requestBody}::jsonb,
      ${responseHeaders}::jsonb,
      ${responseBody}::jsonb,
      ${limitText(input.errorStack, MAX_JSON_TEXT_LEN)},
      ${metaPayload}::jsonb
    )
    RETURNING
      id,
      task_id as "taskId",
      level,
      stage,
      endpoint,
      http_status as "httpStatus",
      message,
      request_headers as "requestHeaders",
      request_body as "requestBody",
      response_headers as "responseHeaders",
      response_body as "responseBody",
      error_stack as "errorStack",
      meta,
      created_at as "createdAt"
  `;

  await maybeCleanupExpiredRows().catch((error) => {
    console.error('[EXT_MON] cleanup failed:', error);
  });

  if (!result.rows.length) {
    return null;
  }
  return mapEventRow(result.rows[0]);
}

export async function findMonitorTaskByTranscriptionJobId(jobId: string): Promise<ExtensionMonitorTask | null> {
  if (!jobId || !(await ensureEnabledAndReady())) {
    return null;
  }
  const result = await sql`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE transcription_job_id = ${jobId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (!result.rows.length) {
    return null;
  }
  return mapTaskRow(result.rows[0]);
}

export async function findMonitorTaskByPodcastId(podcastId: string): Promise<ExtensionMonitorTask | null> {
  if (!podcastId || !(await ensureEnabledAndReady())) {
    return null;
  }
  const result = await sql`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE podcast_id = ${podcastId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (!result.rows.length) {
    return null;
  }
  return mapTaskRow(result.rows[0]);
}

export async function findMonitorTaskByClientIdentity(
  userId: string,
  traceId: string | null | undefined,
  clientTaskId: string | null | undefined,
): Promise<ExtensionMonitorTask | null> {
  if (!userId || !(await ensureEnabledAndReady())) {
    return null;
  }

  const trace = String(traceId || '').trim();
  const client = String(clientTaskId || '').trim();
  if (!trace && !client) {
    return null;
  }

  const result = await sql`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE user_id = ${userId}
      AND (
        (${trace} <> '' AND trace_id = ${trace})
        OR (${client} <> '' AND client_task_id = ${client})
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  if (!result.rows.length) {
    return null;
  }
  return mapTaskRow(result.rows[0]);
}

function normalizePage(input: number | undefined): number {
  const value = Number(input || 1);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

function normalizePageSize(input: number | undefined): number {
  const value = Number(input || 20);
  if (!Number.isFinite(value) || value < 1) {
    return 20;
  }
  return Math.min(Math.floor(value), 100);
}

function normalizeIso(input: string | undefined): string | null {
  const value = String(input || '').trim();
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return null;
  }
  return new Date(ts).toISOString();
}

export async function listExtensionMonitorTasks(
  input: ListExtensionMonitorTasksInput = {},
): Promise<ExtensionMonitorTaskListResult> {
  if (!(await ensureEnabledAndReady())) {
    return {
      tasks: [],
      total: 0,
      page: normalizePage(input.page),
      pageSize: normalizePageSize(input.pageSize),
    };
  }

  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const path = input.path || '';
  const status = input.status || '';
  const query = String(input.q || '').trim();
  const queryLike = query ? `%${query}%` : '';
  const from = normalizeIso(input.from);
  const to = normalizeIso(input.to);

  const [countResult, rowsResult] = await Promise.all([
    sql`
      SELECT COUNT(*)::INT AS total
      FROM extension_monitor_tasks
      WHERE (${path} = '' OR path = ${path})
        AND (${status} = '' OR status = ${status})
        AND (${query} = ''
          OR COALESCE(user_email, '') ILIKE ${queryLike}
          OR COALESCE(video_id, '') ILIKE ${queryLike}
          OR COALESCE(title, '') ILIKE ${queryLike}
          OR COALESCE(client_task_id, '') ILIKE ${queryLike}
          OR COALESCE(trace_id, '') ILIKE ${queryLike}
          OR COALESCE(transcription_job_id, '') ILIKE ${queryLike}
          OR COALESCE(podcast_id, '') ILIKE ${queryLike}
        )
        AND (${from || ''} = '' OR created_at >= ${from || null}::timestamptz)
        AND (${to || ''} = '' OR created_at <= ${to || null}::timestamptz)
    `,
    sql`
      SELECT
        id,
        path,
        status,
        stage,
        user_id as "userId",
        user_email as "userEmail",
        client_task_id as "clientTaskId",
        trace_id as "traceId",
        source_reference as "sourceReference",
        video_id as "videoId",
        title,
        is_public as "isPublic",
        transcription_job_id as "transcriptionJobId",
        podcast_id as "podcastId",
        provider_task_id as "providerTaskId",
        last_error_code as "lastErrorCode",
        last_error_message as "lastErrorMessage",
        last_http_status as "lastHttpStatus",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_monitor_tasks
      WHERE (${path} = '' OR path = ${path})
        AND (${status} = '' OR status = ${status})
        AND (${query} = ''
          OR COALESCE(user_email, '') ILIKE ${queryLike}
          OR COALESCE(video_id, '') ILIKE ${queryLike}
          OR COALESCE(title, '') ILIKE ${queryLike}
          OR COALESCE(client_task_id, '') ILIKE ${queryLike}
          OR COALESCE(trace_id, '') ILIKE ${queryLike}
          OR COALESCE(transcription_job_id, '') ILIKE ${queryLike}
          OR COALESCE(podcast_id, '') ILIKE ${queryLike}
        )
        AND (${from || ''} = '' OR created_at >= ${from || null}::timestamptz)
        AND (${to || ''} = '' OR created_at <= ${to || null}::timestamptz)
      ORDER BY updated_at DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `,
  ]);

  const total = Number((countResult.rows[0] as { total?: number } | undefined)?.total || 0);
  const tasks = rowsResult.rows.map((row) => mapTaskRow(row as Record<string, unknown>));
  return {
    tasks,
    total,
    page,
    pageSize,
  };
}

export async function getExtensionMonitorTaskDetail(
  taskId: string,
): Promise<ExtensionMonitorTaskDetailResult | null> {
  if (!taskId || !(await ensureEnabledAndReady())) {
    return null;
  }

  const [taskResult, eventResult] = await Promise.all([
    sql`
      SELECT
        id,
        path,
        status,
        stage,
        user_id as "userId",
        user_email as "userEmail",
        client_task_id as "clientTaskId",
        trace_id as "traceId",
        source_reference as "sourceReference",
        video_id as "videoId",
        title,
        is_public as "isPublic",
        transcription_job_id as "transcriptionJobId",
        podcast_id as "podcastId",
        provider_task_id as "providerTaskId",
        last_error_code as "lastErrorCode",
        last_error_message as "lastErrorMessage",
        last_http_status as "lastHttpStatus",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_monitor_tasks
      WHERE id = ${taskId}
      LIMIT 1
    `,
    sql`
      SELECT
        id,
        task_id as "taskId",
        level,
        stage,
        endpoint,
        http_status as "httpStatus",
        message,
        request_headers as "requestHeaders",
        request_body as "requestBody",
        response_headers as "responseHeaders",
        response_body as "responseBody",
        error_stack as "errorStack",
        meta,
        created_at as "createdAt"
      FROM extension_monitor_events
      WHERE task_id = ${taskId}
      ORDER BY created_at ASC, id ASC
    `,
  ]);

  if (!taskResult.rows.length) {
    return null;
  }

  return {
    task: mapTaskRow(taskResult.rows[0] as Record<string, unknown>),
    events: eventResult.rows.map((row) => mapEventRow(row as Record<string, unknown>)),
  };
}
