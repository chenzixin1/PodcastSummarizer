import { NextRequest, NextResponse } from 'next/server';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../lib/extensionAuth';
import {
  createExtensionMonitorTask,
  findMonitorTaskByClientIdentity,
  isExtensionMonitorCaptureRawEnabled,
  isExtensionMonitorEnabled,
  recordExtensionMonitorEvent,
  updateExtensionMonitorTask,
} from '../../../../lib/extensionMonitor';

export const runtime = 'nodejs';

type ClientPath = 'path1' | 'path2';
type ClientLevel = 'info' | 'warn' | 'error';

interface MonitorEventBody {
  path?: string;
  status?: string;
  stage?: string;
  level?: string;
  message?: string;
  endpoint?: string;
  httpStatus?: number;
  clientTaskId?: string;
  traceId?: string;
  sourceReference?: string;
  videoId?: string;
  title?: string;
  isPublic?: boolean | string | number;
  transcriptionJobId?: string;
  podcastId?: string;
  providerTaskId?: string;
  errorCode?: string;
  errorMessage?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  meta?: unknown;
}

const KNOWN_PATHS = new Set(['path1', 'path2']);
const KNOWN_LEVELS = new Set(['info', 'warn', 'error']);
const KNOWN_MONITOR_STATUSES = new Set([
  'received',
  'accepted',
  'transcribing',
  'queued',
  'processing',
  'completed',
  'failed',
]);
const KNOWN_EXTENSION_STATUSES = new Set([
  'queued',
  'running',
  'awaiting_path2_confirm',
  'uploaded',
  'transcribing',
  'processing',
  'completed',
  'failed',
]);

function toText(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return null;
}

function normalizePath(input: unknown): ClientPath {
  const value = String(input || '').trim().toLowerCase();
  return (KNOWN_PATHS.has(value) ? value : 'path1') as ClientPath;
}

function normalizeLevel(input: unknown): ClientLevel {
  const value = String(input || '').trim().toLowerCase();
  return (KNOWN_LEVELS.has(value) ? value : 'info') as ClientLevel;
}

function inferPathByStage(stage: string): ClientPath {
  const normalized = stage.toLowerCase();
  return normalized.includes('path2') ? 'path2' : 'path1';
}

function mapClientStatus(input: unknown, stage: string, level: ClientLevel): 'received' | 'accepted' | 'transcribing' | 'queued' | 'processing' | 'completed' | 'failed' {
  const raw = String(input || '').trim();
  if (KNOWN_MONITOR_STATUSES.has(raw)) {
    return raw as 'received' | 'accepted' | 'transcribing' | 'queued' | 'processing' | 'completed' | 'failed';
  }

  if (KNOWN_EXTENSION_STATUSES.has(raw)) {
    switch (raw) {
      case 'queued':
        return 'received';
      case 'running':
      case 'uploaded':
        return 'accepted';
      case 'awaiting_path2_confirm':
      case 'failed':
        return 'failed';
      case 'transcribing':
        return 'transcribing';
      case 'processing':
        return 'processing';
      case 'completed':
        return 'completed';
      default:
        break;
    }
  }

  const normalizedStage = String(stage || '').toLowerCase();
  if (level === 'error' || normalizedStage.includes('fail')) {
    return 'failed';
  }
  if (normalizedStage.includes('transcrib')) {
    return 'transcribing';
  }
  if (normalizedStage.includes('process')) {
    return 'processing';
  }
  if (normalizedStage.includes('received') || normalizedStage.includes('created')) {
    return 'received';
  }
  return 'accepted';
}

export async function POST(request: NextRequest) {
  const endpoint = '/api/extension/monitor-event';

  try {
    const token = parseBearerToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Missing Bearer token.',
        },
        { status: 401 },
      );
    }

    const user = verifyExtensionAccessToken(token);

    if (!isExtensionMonitorEnabled()) {
      return NextResponse.json({
        success: true,
        data: {
          monitorEnabled: false,
          captureRaw: false,
          ignored: true,
        },
      });
    }

    const body = (await request.json().catch(() => ({}))) as MonitorEventBody;
    const stage = String(body?.stage || '').trim() || 'client_event';
    const level = normalizeLevel(body?.level);
    const inferredPath = inferPathByStage(stage);
    const path = body?.path ? normalizePath(body.path) : inferredPath;
    const status = mapClientStatus(body?.status, stage, level);
    const clientTaskId = toText(body?.clientTaskId);
    const traceId = toText(body?.traceId);
    const sourceReference = toText(body?.sourceReference);
    const videoId = toText(body?.videoId);
    const title = toText(body?.title);
    const isPublic = toBoolean(body?.isPublic);
    const transcriptionJobId = toText(body?.transcriptionJobId);
    const podcastId = toText(body?.podcastId);
    const providerTaskId = toText(body?.providerTaskId);
    const errorCode = toText(body?.errorCode);
    const errorMessage = toText(body?.errorMessage);
    const message = toText(body?.message);
    const eventEndpoint = toText(body?.endpoint) || endpoint;
    const httpStatus = Number.isFinite(Number(body?.httpStatus)) ? Number(body.httpStatus) : null;

    let monitorTask = await findMonitorTaskByClientIdentity(user.id, traceId, clientTaskId);
    if (!monitorTask) {
      monitorTask = await createExtensionMonitorTask({
        path,
        status,
        stage,
        userId: user.id,
        userEmail: user.email,
        clientTaskId,
        traceId,
        sourceReference,
        videoId,
        title,
        isPublic: isPublic ?? false,
        transcriptionJobId,
        podcastId,
        providerTaskId,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage || message,
        lastHttpStatus: httpStatus,
      });
    } else {
      monitorTask = await updateExtensionMonitorTask(monitorTask.id, {
        status,
        stage,
        userEmail: user.email,
        clientTaskId,
        traceId,
        sourceReference,
        videoId,
        title,
        isPublic: isPublic ?? undefined,
        transcriptionJobId,
        podcastId,
        providerTaskId,
        lastErrorCode: errorCode || undefined,
        lastErrorMessage: (errorMessage || message) ?? undefined,
        lastHttpStatus: httpStatus,
        clearError: !errorCode && !errorMessage && level !== 'error',
      });
    }

    if (monitorTask?.id) {
      await recordExtensionMonitorEvent({
        taskId: monitorTask.id,
        level,
        stage,
        endpoint: eventEndpoint,
        httpStatus,
        message: message || errorMessage,
        requestHeaders: Object.fromEntries(request.headers.entries()),
        requestBody: body?.requestBody ?? body,
        responseBody: body?.responseBody,
        meta: body?.meta,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        monitorTaskId: monitorTask?.id || null,
        monitorEnabled: true,
        captureRaw: isExtensionMonitorCaptureRawEnabled(),
      },
    });
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: 'MONITOR_EVENT_FAILED',
        error: 'Failed to ingest extension monitor event.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
