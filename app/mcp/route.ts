import { after, NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { ApifyTranscriptError, fetchYoutubeSrtViaApify } from '../../lib/apifyTranscript';
import { getAccountCreditOverview } from '../../lib/credits';
import {
  getAnalysisResults,
  getPodcast,
  getUserPodcasts,
  verifyPodcastOwnership,
} from '../../lib/db';
import {
  McpAccessAuthContext,
  McpScope,
  authenticateMcpAccessToken,
  hasMcpScope,
  recordMcpAccessLog,
} from '../../lib/mcpAccess';
import { resolveYoutubePodcastTitle } from '../../lib/podcastTitle';
import { createPodcastFromSrt, PodcastUploadError } from '../../lib/podcastUploadPipeline';
import { triggerWorkerProcessing } from '../../lib/workerTrigger';
import {
  createWatchlessBundleJob,
  cancelWatchlessJob,
  createWatchlessUrlJob,
  failWatchlessJob,
  getOwnedWatchlessJob,
  listWatchlessJobAssets,
  rollbackWatchlessJob,
  uploadWatchlessJobAsset,
  validateWatchlessBundle,
  updateWatchlessJobStatus,
  WATCHLESS_MAX_ASSET_BYTES,
  WATCHLESS_ONLINE_MODEL,
  WATCHLESS_URL_CREDIT_COST,
  WatchlessJobError,
  type WatchlessAssetRole,
} from '../../lib/watchless/jobs';
import { startWatchlessWorkflow, terminateWatchlessWorkflow } from '../../lib/watchless/workflow';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

type PodcastRow = {
  id?: unknown;
  title?: unknown;
  originalFileName?: unknown;
  sourceReference?: unknown;
  sourcePublishedAt?: unknown;
  tags?: unknown;
  isPublic?: unknown;
  isProcessed?: unknown;
  briefSummary?: unknown;
  durationSec?: unknown;
  createdAt?: unknown;
};

type PodcastDetail = PodcastRow & {
  userId?: unknown;
  fileSize?: unknown;
  blobUrl?: unknown;
};

type AnalysisDetail = {
  summary?: unknown;
  summaryZh?: unknown;
  summaryEn?: unknown;
  briefSummary?: unknown;
  translation?: unknown;
  highlights?: unknown;
  mindMapJson?: unknown;
  mindMapJsonZh?: unknown;
  mindMapJsonEn?: unknown;
  fullTextBilingualJson?: unknown;
  summaryBilingualJson?: unknown;
  tokenCount?: unknown;
  wordCount?: unknown;
  characterCount?: unknown;
  processedAt?: unknown;
};

const PROTOCOL_VERSION = '2025-03-26';

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function booleanArg(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function textContent(value: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorToolResult(value: unknown) {
  return {
    isError: true,
    ...textContent(value),
  };
}

function forbiddenToolResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  };
}

function parseBearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null
  );
}

function getRequestId(body: unknown): JsonRpcId | undefined {
  if (Array.isArray(body)) {
    const first = body.find((item) => asObject(item).id !== undefined);
    return asObject(first).id as JsonRpcId | undefined;
  }
  return asObject(body).id as JsonRpcId | undefined;
}

function toolDefinition(
  name: string,
  title: string,
  description: string,
  inputSchema: Record<string, unknown>,
  annotations?: Partial<McpTool['annotations']>,
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      ...annotations,
    },
  };
}

function availableTools(context: McpAccessAuthContext): McpTool[] {
  const tools: McpTool[] = [];

  if (hasMcpScope(context, 'podcasts:list')) {
    tools.push(
      toolDefinition(
        'podsum_list_podcasts',
        'List PodSum podcasts',
        'List podcasts owned by the authenticated PodSum account.',
        {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional title/source/tag search text.' },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          },
          additionalProperties: false,
        },
      ),
    );
  }

  if (hasMcpScope(context, 'podcasts:read')) {
    tools.push(
      toolDefinition(
        'podsum_get_podcast',
        'Get PodSum podcast',
        'Read metadata and analysis for one podcast owned by the authenticated account.',
        {
          type: 'object',
          properties: {
            podcastId: { type: 'string' },
          },
          required: ['podcastId'],
          additionalProperties: false,
        },
      ),
    );
  }

  if (hasMcpScope(context, 'exports:markdown')) {
    tools.push(
      toolDefinition(
        'podsum_export_markdown',
        'Export PodSum Markdown',
        'Export a podcast summary as Markdown for Obsidian.',
        {
          type: 'object',
          properties: {
            podcastId: { type: 'string' },
            language: { type: 'string', enum: ['auto', 'zh', 'en'], default: 'auto' },
          },
          required: ['podcastId'],
          additionalProperties: false,
        },
      ),
    );
  }

  if (hasMcpScope(context, 'account:credits:read')) {
    tools.push(
      toolDefinition(
        'podsum_get_credits',
        'Get PodSum credits',
        'Read the current SRT credit balance for the authenticated account.',
        {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      ),
    );
  }

  if (hasMcpScope(context, 'podcasts:upload')) {
    tools.push(
      toolDefinition(
        'podsum_submit_youtube_url',
        'Submit YouTube URL',
        'Submit a YouTube URL to PodSum, generate an SRT transcript, and queue podcast analysis.',
        {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'YouTube URL or video id to ingest.' },
            preferredLanguage: { type: 'string', description: 'Optional transcript language code, such as en or zh.' },
            sourceReference: { type: 'string', description: 'Optional source reference override. Defaults to url.' },
            channelName: { type: 'string', description: 'Optional YouTube channel or creator name to store as a topic tag, such as 最佳拍档 or Lex Fridman.' },
            sourcePublishedAt: { type: 'string', description: 'Optional original YouTube publish date/time, such as 2026-06-08 or an ISO timestamp.' },
            isPublic: { type: 'boolean', default: false },
          },
          required: ['url'],
          additionalProperties: false,
        },
        {
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      ),
    );
  }

  if (hasMcpScope(context, 'watchless:submit')) {
    tools.push(
      toolDefinition(
        'podsum_submit_watchless_url',
        'Submit Watchless URL',
        `Run the full Cloudflare Watchless pipeline for one authorized YouTube URL. Requires and reserves ${WATCHLESS_URL_CREDIT_COST} credits. Uses ${WATCHLESS_ONLINE_MODEL} through OpenRouter.`,
        {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Public YouTube watch, shorts, or youtu.be URL.' },
            preferredLanguage: { type: 'string', default: 'en-US' },
            isPublic: { type: 'boolean', default: false },
            rightsConfirmed: { type: 'boolean', description: 'Must be true. Confirms authorization to process and publish the source.' },
            idempotencyKey: { type: 'string', description: 'Optional retry-safe caller key.' },
          },
          required: ['url', 'rightsConfirmed'],
          additionalProperties: false,
        },
        { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      ),
    );
  }

  if (hasMcpScope(context, 'watchless:publish')) {
    tools.push(
      toolDefinition(
        'podsum_begin_watchless_publish',
        'Begin Watchless publish',
        'Create a no-video-compute upload session for a Watchless article already produced by Codex.',
        {
          type: 'object',
          properties: {
            videoId: { type: 'string' }, title: { type: 'string' }, isPublic: { type: 'boolean', default: false },
            rightsConfirmed: { type: 'boolean' }, idempotencyKey: { type: 'string' },
          },
          required: ['videoId', 'rightsConfirmed'], additionalProperties: false,
        },
        { readOnlyHint: false, idempotentHint: true },
      ),
      toolDefinition(
        'podsum_upload_watchless_asset',
        'Upload Watchless asset',
        'Upload a small base64 article, PDF, transcript, or keyframe into a Watchless publish session. Use the returned HTTP PUT endpoint for larger files.',
        {
          type: 'object', properties: {
            jobId: { type: 'string' }, path: { type: 'string' },
            role: { type: 'string', enum: ['article', 'pdf', 'keyframe', 'transcript', 'html', 'manifest', 'other'] },
            contentType: { type: 'string' }, sha256: { type: 'string' }, base64: { type: 'string', maxLength: 6000000 },
          }, required: ['jobId', 'path', 'role', 'contentType', 'sha256', 'base64'], additionalProperties: false,
        },
        { readOnlyHint: false, idempotentHint: true },
      ),
      toolDefinition(
        'podsum_commit_watchless_publish',
        'Commit Watchless publish',
        'Validate the complete uploaded bundle and publish it as the same podcast record type used elsewhere in PodSum.',
        { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
        { readOnlyHint: false, idempotentHint: true },
      ),
      toolDefinition(
        'podsum_rollback_watchless_publication',
        'Rollback Watchless publication',
        'Remove a staged or published Watchless job owned by this PodSum account.',
        { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
        { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      ),
    );
  }

  if (hasMcpScope(context, 'watchless:submit') || hasMcpScope(context, 'watchless:publish')) {
    tools.push(
      toolDefinition(
        'podsum_get_watchless_publish_status',
        'Get Watchless status',
        'Read progress, assets and errors for an owned Watchless job.',
        { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
      ),
    );
  }

  return tools;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function podcastListPayload(row: PodcastRow) {
  return {
    id: String(row.id || ''),
    title: String(row.title || row.originalFileName || ''),
    originalFileName: String(row.originalFileName || ''),
    sourceReference: row.sourceReference || null,
    sourcePublishedAt: normalizeDate(row.sourcePublishedAt),
    tags: Array.isArray(row.tags) ? row.tags : [],
    isPublic: Boolean(row.isPublic),
    isProcessed: Boolean(row.isProcessed),
    briefSummary: normalizeText(row.briefSummary) || null,
    durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
    createdAt: normalizeDate(row.createdAt),
  };
}

function matchesPodcastQuery(row: PodcastRow, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    row.id,
    row.title,
    row.originalFileName,
    row.sourceReference,
    Array.isArray(row.tags) ? row.tags.join(' ') : '',
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return haystack.includes(query.toLowerCase());
}

async function getOwnedPodcast(podcastId: string, userId: string): Promise<PodcastDetail | null> {
  const podcastResult = await getPodcast(podcastId);
  if (!podcastResult.success) {
    return null;
  }

  const podcast = podcastResult.data as PodcastDetail;
  if (String(podcast.userId || '') === userId) {
    return podcast;
  }

  const ownershipResult = await verifyPodcastOwnership(podcastId, userId);
  return ownershipResult.success ? podcast : null;
}

async function handleListPodcasts(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'podcasts:list')) {
    return forbiddenToolResult('Missing scope: podcasts:list');
  }

  const query = stringArg(args, 'query');
  const limit = numberArg(args, 'limit', 10, 20);
  const result = await getUserPodcasts(context.userId, 1, query ? 50 : limit);
  if (!result.success) {
    throw new Error(result.error || 'Failed to list podcasts');
  }

  const rows = Array.isArray(result.data) ? (result.data as PodcastRow[]) : [];
  return textContent({
    podcasts: rows.filter((row) => matchesPodcastQuery(row, query)).slice(0, limit).map(podcastListPayload),
  });
}

async function handleGetPodcast(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'podcasts:read')) {
    return forbiddenToolResult('Missing scope: podcasts:read');
  }

  const podcastId = stringArg(args, 'podcastId');
  if (!podcastId) {
    throw new Error('podcastId is required');
  }

  const podcast = await getOwnedPodcast(podcastId, context.userId);
  if (!podcast) {
    return forbiddenToolResult('Podcast not found or not owned by this account.');
  }

  let analysis: AnalysisDetail | null = null;
  if (hasMcpScope(context, 'analysis:read')) {
    const analysisResult = await getAnalysisResults(podcastId);
    analysis = analysisResult.success ? (analysisResult.data as AnalysisDetail) : null;
  }

  return textContent({
    podcast: {
      ...podcastListPayload(podcast),
      fileSize: podcast.fileSize || null,
      blobUrl: podcast.blobUrl || null,
    },
    analysis,
  });
}

function markdownSection(title: string, value: unknown): string {
  const text = normalizeText(value);
  return text ? `\n## ${title}\n\n${text}\n` : '';
}

function buildMarkdownExport(podcast: PodcastDetail, analysis: AnalysisDetail | null, language: string): string {
  const title = String(podcast.title || podcast.originalFileName || 'PodSum note');
  const summary =
    language === 'en'
      ? normalizeText(analysis?.summaryEn) || normalizeText(analysis?.summary)
      : language === 'zh'
        ? normalizeText(analysis?.summaryZh) || normalizeText(analysis?.summary)
        : normalizeText(analysis?.summaryZh) || normalizeText(analysis?.summaryEn) || normalizeText(analysis?.summary);

  return [
    `# ${title}`,
    '',
    '```yaml',
    `podsum_id: ${String(podcast.id || '')}`,
    `source: ${String(podcast.sourceReference || '')}`,
    `created: ${normalizeDate(podcast.createdAt) || ''}`,
    `exported: ${new Date().toISOString()}`,
    '```',
    markdownSection('Brief', analysis?.briefSummary),
    markdownSection('Summary', summary),
    markdownSection('Highlights', analysis?.highlights),
    markdownSection('Translation', analysis?.translation),
  ]
    .join('\n')
    .trim();
}

async function handleMarkdownExport(context: McpAccessAuthContext, args: Record<string, unknown>) {
  for (const scope of ['exports:markdown', 'podcasts:read', 'analysis:read'] as McpScope[]) {
    if (!hasMcpScope(context, scope)) {
      return forbiddenToolResult(`Missing scope: ${scope}`);
    }
  }

  const podcastId = stringArg(args, 'podcastId');
  if (!podcastId) {
    throw new Error('podcastId is required');
  }

  const podcast = await getOwnedPodcast(podcastId, context.userId);
  if (!podcast) {
    return forbiddenToolResult('Podcast not found or not owned by this account.');
  }

  const analysisResult = await getAnalysisResults(podcastId);
  const analysis = analysisResult.success ? (analysisResult.data as AnalysisDetail) : null;
  return textContent(buildMarkdownExport(podcast, analysis, stringArg(args, 'language') || 'auto'));
}

async function handleGetCredits(context: McpAccessAuthContext) {
  if (!hasMcpScope(context, 'account:credits:read')) {
    return forbiddenToolResult('Missing scope: account:credits:read');
  }

  const result = await getAccountCreditOverview(context.userId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to read credits');
  }

  return textContent({
    user: result.data?.user,
    recentTransactions: result.data?.transactions || [],
  });
}

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (!safe) {
    return 'transcript.srt';
  }
  return safe.toLowerCase().endsWith('.srt') ? safe : `${safe}.srt`;
}

function getAppBaseUrl(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return new URL(request.url).origin;
}

async function handleSubmitYoutubeUrl(
  context: McpAccessAuthContext,
  args: Record<string, unknown>,
  request: NextRequest,
) {
  if (!hasMcpScope(context, 'podcasts:upload')) {
    return forbiddenToolResult('Missing scope: podcasts:upload');
  }

  const url = stringArg(args, 'url') || stringArg(args, 'youtubeUrl');
  if (!url) {
    throw new Error('url is required');
  }

  const preferredLanguage = stringArg(args, 'preferredLanguage') || undefined;
  const sourceReference = stringArg(args, 'sourceReference') || url;
  const channelName = stringArg(args, 'channelName').slice(0, 80);
  const sourcePublishedAt = normalizeDate(stringArg(args, 'sourcePublishedAt'));
  const isPublic = booleanArg(args, 'isPublic', false);

  let transcriptResult;
  try {
    transcriptResult = await fetchYoutubeSrtViaApify(url, preferredLanguage);
  } catch (error) {
    if (error instanceof ApifyTranscriptError) {
      return errorToolResult({
        code: error.code,
        status: error.status,
        error: error.message,
        details: error.details || null,
      });
    }
    throw error;
  }

  const id = nanoid();
  const originalFileName = sanitizeFileName(`${transcriptResult.videoId}.srt`);
  const title = resolveYoutubePodcastTitle({
    videoTitle: transcriptResult.title,
    videoId: transcriptResult.videoId,
  });
  const srtBuffer = Buffer.from(transcriptResult.srtContent, 'utf8');
  let result;
  try {
    result = await createPodcastFromSrt({
      id,
      title,
      originalFileName,
      srtContent: srtBuffer,
      sourceReference,
      sourcePublishedAt,
      tags: channelName ? [channelName] : undefined,
      isPublic,
      userId: context.userId,
      contentType: 'application/x-subrip',
    });
  } catch (error) {
    if (error instanceof PodcastUploadError) {
      return errorToolResult({
        code: error.code,
        status: error.status,
        error: error.message,
        details: error.details || null,
      });
    }
    throw error;
  }

  if (result.processingQueued) {
    after(async () => {
      const triggerResult = await triggerWorkerProcessing('upload', id);
      if (!triggerResult.success) {
        console.error('[MCP] Failed to trigger worker:', triggerResult.error);
      }
    });
  } else {
    console.error('[MCP] enqueueProcessingJob failed:', result.queueError);
  }

  return textContent({
    podcast: {
      id,
      title,
      originalFileName,
      fileSize: result.fileSize,
      sourceReference,
      sourcePublishedAt,
      tags: channelName ? [channelName] : [],
      isPublic,
      blobUrl: result.blobUrl,
      dashboardUrl: `${getAppBaseUrl(request)}/dashboard/${id}`,
    },
    remainingCredits: result.remainingCredits,
    processingQueued: result.processingQueued,
    processingJob: result.processingJob,
    queueError: result.queueError,
    youtubeIngest: {
      source: transcriptResult.source,
      videoId: transcriptResult.videoId,
      entries: transcriptResult.entries,
      preferredLanguage: preferredLanguage || null,
    },
  });
}

async function handleSubmitWatchlessUrl(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'watchless:submit')) return forbiddenToolResult('Missing scope: watchless:submit');
  try {
    const job = await createWatchlessUrlJob({
      userId: context.userId,
      sourceUrl: stringArg(args, 'url'),
      rightsConfirmed: booleanArg(args, 'rightsConfirmed'),
      preferredLanguage: stringArg(args, 'preferredLanguage') || undefined,
      isPublic: booleanArg(args, 'isPublic'),
      idempotencyKey: stringArg(args, 'idempotencyKey') || undefined,
    });
    if (job.workflowInstanceId) return textContent({ job, status: 'already_started' });
    let workflowInstanceId: string;
    try {
      workflowInstanceId = await startWatchlessWorkflow(job.id, 'url');
    } catch (error) {
      await failWatchlessJob(job.id, 'WORKFLOW_START_FAILED', error instanceof Error ? error.message : String(error));
      throw error;
    }
    return textContent({
      job: { ...job, workflowInstanceId },
      creditPolicy: { required: WATCHLESS_URL_CREDIT_COST, state: 'reserved', refunds: 'platform failure or pre-completion rollback' },
      runtime: { model: WATCHLESS_ONLINE_MODEL, provider: 'OpenRouter', execution: 'Cloudflare Workflow + Container' },
    });
  } catch (error) {
    if (error instanceof WatchlessJobError) return errorToolResult({ code: error.code, status: error.status, error: error.message });
    throw error;
  }
}

async function handleBeginWatchlessPublish(context: McpAccessAuthContext, args: Record<string, unknown>, request: NextRequest) {
  if (!hasMcpScope(context, 'watchless:publish')) return forbiddenToolResult('Missing scope: watchless:publish');
  try {
    const job = await createWatchlessBundleJob({
      userId: context.userId,
      videoId: stringArg(args, 'videoId'),
      title: stringArg(args, 'title') || undefined,
      rightsConfirmed: booleanArg(args, 'rightsConfirmed'),
      isPublic: booleanArg(args, 'isPublic'),
      idempotencyKey: stringArg(args, 'idempotencyKey') || undefined,
    });
    return textContent({
      job,
      creditCost: 0,
      upload: {
        method: 'PUT',
        endpointTemplate: `${getAppBaseUrl(request)}/api/watchless/jobs/${job.id}/assets?path={path}&role={role}`,
        headers: { Authorization: 'Bearer <same MCP token>', 'Content-Type': '<asset content type>', 'X-Content-SHA256': '<lowercase sha256>' },
        maxAssetBytes: WATCHLESS_MAX_ASSET_BYTES,
      },
    });
  } catch (error) {
    if (error instanceof WatchlessJobError) return errorToolResult({ code: error.code, status: error.status, error: error.message });
    throw error;
  }
}

async function handleUploadWatchlessAsset(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'watchless:publish')) return forbiddenToolResult('Missing scope: watchless:publish');
  const encoded = stringArg(args, 'base64');
  if (!encoded || encoded.length > 6_000_000) return errorToolResult({ code: 'INLINE_ASSET_TOO_LARGE', error: 'Use the HTTP PUT endpoint returned by begin for larger assets.' });
  try {
    const asset = await uploadWatchlessJobAsset({
      jobId: stringArg(args, 'jobId'), userId: context.userId, assetPath: stringArg(args, 'path'),
      role: stringArg(args, 'role') as WatchlessAssetRole, contentType: stringArg(args, 'contentType'),
      expectedSha256: stringArg(args, 'sha256'), bytes: new Uint8Array(Buffer.from(encoded, 'base64')),
    });
    return textContent({ asset });
  } catch (error) {
    if (error instanceof WatchlessJobError) return errorToolResult({ code: error.code, status: error.status, error: error.message });
    throw error;
  }
}

async function handleCommitWatchlessPublish(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'watchless:publish')) return forbiddenToolResult('Missing scope: watchless:publish');
  const jobId = stringArg(args, 'jobId');
  const owned = await getOwnedWatchlessJob(jobId, context.userId);
  if (!owned) return forbiddenToolResult('Watchless job not found or not owned by this account.');
  if (owned.status === 'completed' || (owned.status === 'queued' && owned.workflowInstanceId)) {
    return textContent({ job: owned, status: 'already_committed' });
  }
  if (owned.status !== 'awaiting_upload') return errorToolResult({ code: 'JOB_NOT_COMMITTABLE', error: `Job is ${owned.status}.` });
  try {
    const validation = await validateWatchlessBundle(jobId);
    await updateWatchlessJobStatus({ jobId, status: 'queued', stage: 'queued', progressCurrent: 5, progressTotal: 100 });
    let workflowInstanceId: string;
    try {
      workflowInstanceId = await startWatchlessWorkflow(jobId, 'publish');
    } catch (error) {
      await updateWatchlessJobStatus({
        jobId,
        status: 'awaiting_upload',
        stage: 'awaiting_upload',
        progressCurrent: 0,
        progressTotal: 100,
        errorCode: 'WORKFLOW_START_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return textContent({ jobId, workflowInstanceId, scenes: validation.article.scenes.length, status: 'queued' });
  } catch (error) {
    if (error instanceof WatchlessJobError) return errorToolResult({ code: error.code, status: error.status, error: error.message });
    throw error;
  }
}

async function handleGetWatchlessStatus(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'watchless:publish') && !hasMcpScope(context, 'watchless:submit')) {
    return forbiddenToolResult('Missing scope: watchless:publish or watchless:submit');
  }
  const jobId = stringArg(args, 'jobId');
  const job = await getOwnedWatchlessJob(jobId, context.userId);
  if (!job) return forbiddenToolResult('Watchless job not found or not owned by this account.');
  return textContent({ job, assets: await listWatchlessJobAssets(jobId) });
}

async function handleRollbackWatchless(context: McpAccessAuthContext, args: Record<string, unknown>) {
  if (!hasMcpScope(context, 'watchless:publish')) return forbiddenToolResult('Missing scope: watchless:publish');
  try {
    const jobId = stringArg(args, 'jobId');
    const job = await getOwnedWatchlessJob(jobId, context.userId);
    if (!job) return forbiddenToolResult('Watchless job not found or not owned by this account.');
    if (['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering', 'validating', 'publishing'].includes(job.status)) {
      const cancelled = await cancelWatchlessJob(jobId, context.userId);
      if (['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering'].includes(job.status) && job.workflowInstanceId) {
        await terminateWatchlessWorkflow(job.workflowInstanceId).catch((error) => {
          console.error('[MCP] Watchless Workflow termination failed after cancellation:', error);
        });
      }
      return textContent({ job: cancelled });
    }
    return textContent({ job: await rollbackWatchlessJob(jobId, context.userId) });
  } catch (error) {
    if (error instanceof WatchlessJobError) return errorToolResult({ code: error.code, status: error.status, error: error.message });
    throw error;
  }
}

function isToolError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'isError' in result);
}

function textPayload(result: unknown): string {
  const content = (result as { content?: Array<{ text?: unknown }> } | null)?.content;
  const text = Array.isArray(content) ? content[0]?.text : null;
  return typeof text === 'string' ? text : '';
}

function toolResultCode(result: unknown): string | null {
  if (!isToolError(result)) {
    return null;
  }
  const text = textPayload(result);
  try {
    const payload = JSON.parse(text) as { code?: unknown };
    return typeof payload.code === 'string' ? payload.code : 'tool_error';
  } catch {
    return 'tool_forbidden';
  }
}

function toolResourceId(name: string, args: Record<string, unknown>, result: unknown): string | null {
  if (name === 'podsum_submit_youtube_url' || name === 'podsum_submit_watchless_url' || name === 'podsum_begin_watchless_publish') {
    if (!isToolError(result)) {
      try {
        const payload = JSON.parse(textPayload(result)) as { podcast?: { id?: unknown }; job?: { id?: unknown } };
        if (typeof payload.podcast?.id === 'string' && payload.podcast.id) {
          return payload.podcast.id;
        }
        if (typeof payload.job?.id === 'string' && payload.job.id) return payload.job.id;
      } catch {
        // Fall back to the submitted URL below.
      }
    }
    return stringArg(args, 'url') || stringArg(args, 'youtubeUrl') || stringArg(args, 'videoId') || null;
  }
  return stringArg(args, 'podcastId') || stringArg(args, 'jobId') || null;
}

function toolResourceType(name: string): string | null {
  if (name.startsWith('podsum_') && name.includes('watchless')) return 'watchless_job';
  if (name === 'podsum_submit_youtube_url') return 'podcast';
  return null;
}
async function handleToolCall(
  context: McpAccessAuthContext,
  params: Record<string, unknown>,
  request: NextRequest,
) {
  const name = stringArg(params, 'name');
  const args = asObject(params.arguments);
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent');

  try {
    let result;
    if (name === 'podsum_list_podcasts') {
      result = await handleListPodcasts(context, args);
    } else if (name === 'podsum_get_podcast') {
      result = await handleGetPodcast(context, args);
    } else if (name === 'podsum_export_markdown') {
      result = await handleMarkdownExport(context, args);
    } else if (name === 'podsum_get_credits') {
      result = await handleGetCredits(context);
    } else if (name === 'podsum_submit_youtube_url') {
      result = await handleSubmitYoutubeUrl(context, args, request);
    } else if (name === 'podsum_submit_watchless_url') {
      result = await handleSubmitWatchlessUrl(context, args);
    } else if (name === 'podsum_begin_watchless_publish') {
      result = await handleBeginWatchlessPublish(context, args, request);
    } else if (name === 'podsum_upload_watchless_asset') {
      result = await handleUploadWatchlessAsset(context, args);
    } else if (name === 'podsum_commit_watchless_publish') {
      result = await handleCommitWatchlessPublish(context, args);
    } else if (name === 'podsum_get_watchless_publish_status') {
      result = await handleGetWatchlessStatus(context, args);
    } else if (name === 'podsum_rollback_watchless_publication') {
      result = await handleRollbackWatchless(context, args);
    } else {
      throw new Error(`Unknown tool: ${name || '(missing)'}`);
    }

    await recordMcpAccessLog({
      context,
      tool: name || 'unknown',
      resourceType: toolResourceType(name),
      resourceId: toolResourceId(name, args, result),
      ok: !isToolError(result),
      errorCode: toolResultCode(result),
      ip,
      userAgent,
    });
    return result;
  } catch (error) {
    await recordMcpAccessLog({
      context,
      tool: name || 'unknown',
      resourceType: toolResourceType(name),
      resourceId: stringArg(args, 'podcastId') || stringArg(args, 'url') || stringArg(args, 'youtubeUrl') || null,
      ok: false,
      errorCode: error instanceof Error ? error.message : 'tool_error',
      ip,
      userAgent,
    });
    throw error;
  }
}

async function handleMessage(context: McpAccessAuthContext, message: JsonRpcRequest, request: NextRequest) {
  const id = message.id;
  const method = message.method;
  const params = asObject(message.params);

  if (!method || message.jsonrpc !== '2.0') {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request');
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: 'PodSum.cc',
        version: '0.1.0',
      },
    });
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, {
      tools: availableTools(context),
    });
  }

  if (method === 'tools/call') {
    return jsonRpcResult(id, await handleToolCall(context, params, request));
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const authResult = await authenticateMcpAccessToken({
    token: parseBearerToken(request),
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  if (!authResult.success || !authResult.data) {
    return NextResponse.json(
      jsonRpcError(getRequestId(body), -32001, authResult.error || 'Authentication required', {
        code: authResult.errorCode || 'unauthorized',
      }),
      { status: 401 },
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const item of messages) {
    try {
      const response = await handleMessage(authResult.data, asObject(item) as JsonRpcRequest, request);
      if (response) {
        responses.push(response);
      }
    } catch (error) {
      responses.push(
        jsonRpcError(
          asObject(item).id as JsonRpcId | undefined,
          -32603,
          error instanceof Error ? error.message : 'Internal error',
        ),
      );
    }
  }

  if (responses.length === 0) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json(Array.isArray(body) ? responses : responses[0], {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET() {
  return NextResponse.json(
    {
      name: 'PodSum.cc MCP',
      transport: 'streamable-http',
      endpoint: '/mcp',
      authentication: 'Authorization: Bearer <token>',
    },
    {
      status: 405,
      headers: {
        Allow: 'POST',
        'Cache-Control': 'no-store',
      },
    },
  );
}
