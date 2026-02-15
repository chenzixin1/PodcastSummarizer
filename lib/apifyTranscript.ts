const APIFY_API_BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_ID = 'karamelo~youtube-transcripts';
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

interface ApifyRunResponse {
  data?: {
    id?: string;
  };
}

interface ApifyRunStatusResponse {
  data?: {
    status?: string;
    defaultDatasetId?: string;
    statusMessage?: string;
  };
}

interface ApifyApiErrorResponse {
  error?: {
    type?: string;
    message?: string;
  };
}

interface ApifyCaptionWithTimestamp {
  start?: number;
  end?: number;
  duration?: number;
  text?: string;
}

interface ApifyDatasetItem {
  videoId?: string;
  title?: string;
  captions?: ApifyCaptionWithTimestamp[] | string[] | string;
}

interface SrtCue {
  startSec: number;
  endSec: number;
  text: string;
}

export type ApifyTranscriptErrorCode =
  | 'APIFY_NOT_CONFIGURED'
  | 'INVALID_YOUTUBE_URL'
  | 'APIFY_AUTH_FAILED'
  | 'APIFY_QUOTA_EXCEEDED'
  | 'APIFY_INPUT_INVALID'
  | 'APIFY_RUN_FAILED'
  | 'APIFY_TIMEOUT'
  | 'APIFY_NO_TRANSCRIPT'
  | 'APIFY_FETCH_FAILED';

export class ApifyTranscriptError extends Error {
  code: ApifyTranscriptErrorCode;
  status: number;
  details?: string;

  constructor(code: ApifyTranscriptErrorCode, status: number, message: string, details?: string) {
    super(message);
    this.name = 'ApifyTranscriptError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApifyTranscriptResult {
  videoId: string;
  title?: string;
  source: 'apify_text_with_timestamps';
  srtContent: string;
  fullText: string;
  entries: number;
}

function decodeHtmlEntities(input: string): string {
  let output = input;

  for (let i = 0; i < 2; i += 1) {
    const prev = output;
    output = output
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        if (!Number.isFinite(code)) {
          return _;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      })
      .replace(/&#([0-9]+);/g, (_, dec: string) => {
        const code = Number.parseInt(dec, 10);
        if (!Number.isFinite(code)) {
          return _;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      });

    if (output === prev) {
      break;
    }
  }

  return output;
}

function normalizeCaptionText(input: string): string {
  const decoded = decodeHtmlEntities(input);
  return decoded.replace(/\r/g, '').replace(/<[^>]+>/g, '').trim();
}

function toNumber(input: unknown): number | null {
  const value = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(value) ? value : null;
}

function pad(value: number, len: number): string {
  return String(value).padStart(len, '0');
}

function toSrtTimestamp(secondsInput: number): string {
  const safeSeconds = Number.isFinite(secondsInput) && secondsInput >= 0 ? secondsInput : 0;
  const totalMs = Math.round(safeSeconds * 1000);

  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function buildSrtFromCues(cues: SrtCue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${toSrtTimestamp(cue.startSec)} --> ${toSrtTimestamp(cue.endSec)}\n${cue.text}`)
    .join('\n\n')
    .trim();
}

function parseXmlWithTimestamps(xml: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)">([\s\S]*?)<\/text>/g;
  const matches = [...xml.matchAll(regex)];

  for (const match of matches) {
    const start = toNumber(match[1]);
    const duration = toNumber(match[2]);
    const text = normalizeCaptionText(match[3] || '');
    if (!text || start === null) {
      continue;
    }
    const safeDuration = duration !== null && duration > 0 ? duration : 2;
    cues.push({
      startSec: start,
      endSec: start + safeDuration,
      text,
    });
  }

  return cues;
}

function normalizeCaptionsToCues(captions: ApifyDatasetItem['captions']): SrtCue[] {
  if (Array.isArray(captions)) {
    const objectEntries = captions.filter(
      (item): item is ApifyCaptionWithTimestamp => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );

    if (objectEntries.length > 0) {
      const cues: SrtCue[] = [];
      for (let index = 0; index < objectEntries.length; index += 1) {
        const current = objectEntries[index];
        const next = objectEntries[index + 1];

        const text = normalizeCaptionText(String(current.text || ''));
        if (!text) {
          continue;
        }

        const start = toNumber(current.start) ?? 0;
        const explicitEnd = toNumber(current.end);
        const duration = toNumber(current.duration);
        const nextStart = next ? toNumber(next.start) : null;

        let end = explicitEnd ?? (duration !== null ? start + duration : null) ?? (nextStart ?? start + 2);
        if (!(Number.isFinite(end) && end > start)) {
          end = start + 2;
        }

        cues.push({
          startSec: start,
          endSec: end,
          text,
        });
      }
      return cues;
    }

    const lines = captions
      .map((item) => normalizeCaptionText(String(item || '')))
      .filter(Boolean);

    return lines.map((text, index) => {
      const startSec = index * 2.2;
      return {
        startSec,
        endSec: startSec + 2,
        text,
      };
    });
  }

  if (typeof captions === 'string' && captions.trim()) {
    if (captions.includes('<text start=')) {
      return parseXmlWithTimestamps(captions);
    }

    const text = normalizeCaptionText(captions);
    if (!text) {
      return [];
    }
    return [
      {
        startSec: 0,
        endSec: Math.max(2, Math.ceil(text.length / 12)),
        text,
      },
    ];
  }

  return [];
}

function parseVideoId(input: string): string {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      const maybeId = url.pathname.split('/').filter(Boolean)[0];
      if (maybeId && /^[A-Za-z0-9_-]{11}$/.test(maybeId)) {
        return maybeId;
      }
    }

    if (hostname.includes('youtube.com') || hostname.includes('youtube-nocookie.com')) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      const markerIndex = pathParts.findIndex((part) => ['shorts', 'embed', 'live', 'v'].includes(part));
      if (markerIndex >= 0 && pathParts[markerIndex + 1] && /^[A-Za-z0-9_-]{11}$/.test(pathParts[markerIndex + 1])) {
        return pathParts[markerIndex + 1];
      }
    }
  } catch {
    // Fallback regex below.
  }

  const fallbackMatch = trimmed.match(/(?:v=|be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);
  if (fallbackMatch?.[1]) {
    return fallbackMatch[1];
  }

  throw new ApifyTranscriptError('INVALID_YOUTUBE_URL', 400, 'Invalid YouTube URL. Unable to extract video ID.');
}

function toWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function apifyActorId(): string {
  return (process.env.APIFY_YOUTUBE_TRANSCRIPT_ACTOR_ID || '').trim() || DEFAULT_ACTOR_ID;
}

function apifyToken(): string {
  const token = (process.env.APIFY_API_TOKEN || '').trim();
  if (!token) {
    throw new ApifyTranscriptError(
      'APIFY_NOT_CONFIGURED',
      503,
      'APIFY_API_TOKEN is missing on server. Please configure it in Vercel environment variables.',
    );
  }
  return token;
}

function parseApifyApiError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const err = (payload as ApifyApiErrorResponse).error;
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return message || null;
}

async function startApifyRun(videoUrl: string, token: string, preferredLanguage?: string): Promise<string> {
  const actorId = apifyActorId();
  const input: Record<string, unknown> = {
    urls: [videoUrl],
    outputFormat: 'textWithTimestamps',
  };
  if (preferredLanguage?.trim()) {
    input.preferredLanguage = preferredLanguage.trim();
  }

  const response = await fetch(`${APIFY_API_BASE}/acts/${encodeURIComponent(actorId)}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  });

  if (!response.ok) {
    let detail: string | null = null;
    try {
      detail = parseApifyApiError(await response.json());
    } catch {
      detail = null;
    }

    if (response.status === 401) {
      throw new ApifyTranscriptError('APIFY_AUTH_FAILED', 401, 'APIFY token is invalid.', detail || undefined);
    }
    if (response.status === 402) {
      throw new ApifyTranscriptError(
        'APIFY_QUOTA_EXCEEDED',
        402,
        'APIFY quota exceeded. Please check billing/credits.',
        detail || undefined,
      );
    }
    if (response.status === 400) {
      throw new ApifyTranscriptError(
        'APIFY_INPUT_INVALID',
        400,
        'APIFY request input is invalid.',
        detail || undefined,
      );
    }
    throw new ApifyTranscriptError(
      'APIFY_FETCH_FAILED',
      502,
      'Failed to start APIFY actor run.',
      detail || `http_${response.status}`,
    );
  }

  const payload = (await response.json()) as ApifyRunResponse;
  const runId = payload?.data?.id;
  if (!runId) {
    throw new ApifyTranscriptError('APIFY_FETCH_FAILED', 502, 'APIFY run response missing run ID.');
  }
  return runId;
}

async function waitForApifyRun(runId: string, token: string): Promise<string> {
  const timeoutMs = Number.parseInt(process.env.APIFY_TRANSCRIPT_TIMEOUT_MS || '', 10) || DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = Number.parseInt(process.env.APIFY_TRANSCRIPT_POLL_MS || '', 10) || DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${APIFY_API_BASE}/actor-runs/${encodeURIComponent(runId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new ApifyTranscriptError(
        'APIFY_FETCH_FAILED',
        502,
        'Failed to query APIFY run status.',
        `http_${response.status}`,
      );
    }

    const payload = (await response.json()) as ApifyRunStatusResponse;
    const status = String(payload?.data?.status || '');

    if (status === 'SUCCEEDED') {
      const datasetId = String(payload?.data?.defaultDatasetId || '');
      if (!datasetId) {
        throw new ApifyTranscriptError('APIFY_RUN_FAILED', 502, 'APIFY completed but dataset ID is missing.');
      }
      return datasetId;
    }

    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new ApifyTranscriptError(
        'APIFY_RUN_FAILED',
        502,
        `APIFY actor run failed with status: ${status}.`,
        payload?.data?.statusMessage || undefined,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new ApifyTranscriptError('APIFY_TIMEOUT', 504, 'Timed out while waiting for APIFY transcript result.');
}

async function fetchApifyDatasetItem(datasetId: string, token: string): Promise<ApifyDatasetItem> {
  const response = await fetch(`${APIFY_API_BASE}/datasets/${encodeURIComponent(datasetId)}/items`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ApifyTranscriptError(
      'APIFY_FETCH_FAILED',
      502,
      'Failed to fetch APIFY dataset items.',
      `http_${response.status}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const items = Array.isArray(payload) ? (payload as ApifyDatasetItem[]) : [];
  if (items.length === 0) {
    throw new ApifyTranscriptError('APIFY_NO_TRANSCRIPT', 404, 'No transcript was returned for this video.');
  }
  return items[0] || {};
}

export async function fetchYoutubeSrtViaApify(
  youtubeUrlOrId: string,
  preferredLanguage?: string,
): Promise<ApifyTranscriptResult> {
  const videoId = parseVideoId(youtubeUrlOrId);
  const watchUrl = toWatchUrl(videoId);
  const token = apifyToken();

  const runId = await startApifyRun(watchUrl, token, preferredLanguage);
  const datasetId = await waitForApifyRun(runId, token);
  const item = await fetchApifyDatasetItem(datasetId, token);

  const cues = normalizeCaptionsToCues(item.captions);
  if (cues.length === 0) {
    throw new ApifyTranscriptError('APIFY_NO_TRANSCRIPT', 404, 'Transcript payload is empty for this video.');
  }

  const srtContent = buildSrtFromCues(cues);
  if (!srtContent) {
    throw new ApifyTranscriptError('APIFY_NO_TRANSCRIPT', 404, 'Transcript conversion produced empty SRT content.');
  }

  const normalizedTitle = typeof item.title === 'string' ? decodeHtmlEntities(item.title).trim() : '';
  const fullText = cues.map((cue) => cue.text).join(' ').trim();
  return {
    videoId,
    title: normalizedTitle || undefined,
    source: 'apify_text_with_timestamps',
    srtContent,
    fullText,
    entries: cues.length,
  };
}
