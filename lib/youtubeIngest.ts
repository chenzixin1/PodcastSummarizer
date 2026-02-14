import { put } from '@vercel/blob';
import { randomUUID } from 'crypto';

const YOUTUBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([\s\S]*?)<\/text>/g;

type YtdlFormat = {
  url?: string;
  audioBitrate?: number;
  bitrate?: number;
  mimeType?: string;
  container?: string;
};

type YtdlInfo = {
  videoDetails: {
    lengthSeconds?: string;
    title?: string;
  };
  formats: YtdlFormat[];
};

type YtdlLike = {
  getInfo: (url: string, options?: unknown) => Promise<YtdlInfo>;
  filterFormats: (formats: YtdlFormat[], filter: string) => YtdlFormat[];
  downloadFromInfo: (info: YtdlInfo, options?: unknown) => NodeJS.ReadableStream;
  createAgent?: (cookies?: unknown[], opts?: unknown) => unknown;
};

interface VolcanoUtterance {
  start_time?: number;
  end_time?: number;
  text?: string;
}

interface VolcanoResultPayload {
  text?: string;
  utterances?: VolcanoUtterance[];
}

interface VolcanoQueryPayload {
  status?: string;
  message?: string;
  request_id?: string;
  result?: VolcanoResultPayload;
}

interface GladiaSubmitResponse {
  id?: string;
  result_url?: string;
  message?: string;
  error?: string;
}

interface GladiaSubtitle {
  format?: string;
  subtitles?: string;
}

interface GladiaUtterance {
  start?: number;
  end?: number;
  text?: string;
}

interface GladiaTranscriptionPayload {
  subtitles?: GladiaSubtitle[];
  utterances?: GladiaUtterance[];
  full_transcript?: string;
}

interface GladiaResultPayload {
  transcription?: GladiaTranscriptionPayload;
}

interface GladiaPollResponse {
  id?: string;
  status?: string;
  error_code?: number | null;
  error?: string | { message?: string };
  result?: GladiaResultPayload;
}

let cachedYtdl: YtdlLike | null = null;

async function getYtdl(): Promise<YtdlLike> {
  if (cachedYtdl) {
    return cachedYtdl;
  }

  const mod = await import('@distube/ytdl-core');
  const ytdlModule = (mod.default || mod) as unknown as YtdlLike;
  cachedYtdl = ytdlModule;
  return ytdlModule;
}

export type YoutubeTranscriptSource = 'youtube_caption' | 'gladia_asr' | 'volcano_asr';

export interface YoutubeSrtResult {
  srtContent: string;
  source: YoutubeTranscriptSource;
  videoId: string;
  videoTitle?: string;
  selectedLanguage?: string;
  availableLanguages: string[];
  audioBlobUrl?: string;
}

export type YoutubeIngestErrorCode =
  | 'INVALID_YOUTUBE_URL'
  | 'YOUTUBE_LOGIN_REQUIRED'
  | 'YOUTUBE_RATE_LIMITED'
  | 'YOUTUBE_VIDEO_UNAVAILABLE'
  | 'YOUTUBE_CAPTIONS_DISABLED'
  | 'YOUTUBE_CAPTION_EMPTY'
  | 'YOUTUBE_FETCH_FAILED'
  | 'GLADIA_NOT_CONFIGURED'
  | 'GLADIA_SUBMIT_FAILED'
  | 'GLADIA_QUERY_FAILED'
  | 'GLADIA_TRANSCRIBE_TIMEOUT'
  | 'GLADIA_TRANSCRIBE_FAILED'
  | 'VOLCANO_NOT_CONFIGURED'
  | 'VOLCANO_SUBMIT_FAILED'
  | 'VOLCANO_QUERY_FAILED'
  | 'VOLCANO_TRANSCRIBE_TIMEOUT'
  | 'VOLCANO_TRANSCRIBE_FAILED'
  | 'YOUTUBE_AUDIO_DOWNLOAD_FAILED'
  | 'YOUTUBE_AUDIO_TOO_LARGE'
  | 'YOUTUBE_AUDIO_TOO_LONG';

export class YoutubeIngestError extends Error {
  code: YoutubeIngestErrorCode;
  details?: string;

  constructor(code: YoutubeIngestErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'YoutubeIngestError';
    this.code = code;
    this.details = details;
  }
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

interface CaptionTrackListRenderer {
  captionTracks?: CaptionTrack[];
}

interface YoutubePageInspectResult {
  videoTitle?: string;
  captionTracks: CaptionTrack[];
  availableLanguages: string[];
  loginRequired: boolean;
  rateLimited: boolean;
  videoUnavailable: boolean;
  debugPlayability?: string;
}

interface VolcanoSubmitConfig {
  apiKey: string;
  submitUrl: string;
  queryUrl: string;
  resourceId: string;
  lang: string;
  maxRetries: number;
  retryDelayMs: number;
}

interface GladiaConfig {
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_PREFERRED_CAPTION_LANGS = ['zh-Hans', 'zh-CN', 'zh', 'zh-Hant', 'zh-TW', 'en', 'en-US'];

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePreferredCaptionLangs(): string[] {
  const envValue = (process.env.YOUTUBE_PREFERRED_CAPTION_LANGS || '').trim();
  if (!envValue) {
    return DEFAULT_PREFERRED_CAPTION_LANGS;
  }
  const langs = envValue
    .split(',')
    .map((lang) => lang.trim())
    .filter(Boolean);
  return langs.length > 0 ? langs : DEFAULT_PREFERRED_CAPTION_LANGS;
}

function normalizeLangCode(code: string): string {
  return code.trim().toLowerCase().replace('_', '-');
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
    // Fallback to regex below.
  }

  const fallbackMatch = trimmed.match(/(?:v=|be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);
  if (fallbackMatch?.[1]) {
    return fallbackMatch[1];
  }

  throw new YoutubeIngestError('INVALID_YOUTUBE_URL', 'Invalid YouTube URL. Unable to extract video ID.');
}

function parsePlayabilitySnippet(html: string): string | undefined {
  const match = html.match(/"playabilityStatus":\{[^}]+\}/);
  return match?.[0];
}

async function inspectYoutubePage(videoId: string): Promise<YoutubePageInspectResult> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(watchUrl, {
    headers: {
      'User-Agent': YOUTUBE_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new YoutubeIngestError(
      'YOUTUBE_FETCH_FAILED',
      `Failed to fetch YouTube page (${response.status}).`,
      response.statusText,
    );
  }

  const html = await response.text();
  const debugPlayability = parsePlayabilitySnippet(html);

  const rateLimited = html.includes('g-recaptcha') || html.includes('www.google.com/sorry') || html.includes('Too many requests');
  const loginRequired = html.includes('"status":"LOGIN_REQUIRED"');
  const videoUnavailable =
    html.includes('"status":"ERROR"') || html.includes('"status":"UNPLAYABLE"') || html.includes('Video unavailable');

  let captionTracks: CaptionTrack[] = [];
  const captionParts = html.split('"captions":');
  if (captionParts.length > 1) {
    try {
      const captionRenderer = JSON.parse(captionParts[1].split(',"videoDetails"')[0].replace('\n', ''))
        ?.playerCaptionsTracklistRenderer as CaptionTrackListRenderer | undefined;
      if (Array.isArray(captionRenderer?.captionTracks)) {
        captionTracks = captionRenderer.captionTracks;
      }
    } catch {
      // Keep empty and classify below.
    }
  }

  let videoTitle: string | undefined;
  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (titleMatch?.[1]) {
    videoTitle = decodeHtmlEntities(titleMatch[1]).trim();
  }

  const availableLanguages = Array.from(new Set(captionTracks.map((track) => track.languageCode).filter(Boolean)));

  return {
    videoTitle,
    captionTracks,
    availableLanguages,
    loginRequired,
    rateLimited,
    videoUnavailable,
    debugPlayability,
  };
}

function rankTrack(track: CaptionTrack, preferredLanguages: string[]): number {
  const trackLang = normalizeLangCode(track.languageCode || '');
  const isAuto = track.kind === 'asr' ? 1 : 0;

  let bestRank = 9999;
  preferredLanguages.forEach((preferred, index) => {
    const preferredNorm = normalizeLangCode(preferred);
    const preferredBase = preferredNorm.split('-')[0];
    const trackBase = trackLang.split('-')[0];

    if (trackLang === preferredNorm) {
      bestRank = Math.min(bestRank, index * 100);
      return;
    }

    if (trackBase && preferredBase && trackBase === preferredBase) {
      bestRank = Math.min(bestRank, index * 100 + 20);
      return;
    }
  });

  if (bestRank === 9999) {
    bestRank = 5000;
  }

  return bestRank + isAuto;
}

function prioritizeCaptionTracks(captionTracks: CaptionTrack[], preferredLanguages: string[]): CaptionTrack[] {
  const seen = new Set<string>();
  const sorted = [...captionTracks]
    .filter((track) => Boolean(track.baseUrl && track.languageCode))
    .sort((a, b) => rankTrack(a, preferredLanguages) - rankTrack(b, preferredLanguages));

  const result: CaptionTrack[] = [];
  for (const track of sorted) {
    const key = `${track.languageCode}|${track.kind || 'manual'}|${track.baseUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(track);
  }

  return result;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([\da-fA-F]+);/g, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildSrtFromCues(cues: Array<{ startSec: number; durationSec: number; text: string }>): string {
  return cues
    .map((cue, index) => {
      const start = formatSrtTime(cue.startSec);
      const end = formatSrtTime(cue.startSec + Math.max(0.2, cue.durationSec));
      return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
    })
    .join('\n\n');
}

async function fetchCaptionTrackAsSrt(track: CaptionTrack): Promise<string> {
  const response = await fetch(track.baseUrl, {
    headers: {
      'User-Agent': YOUTUBE_USER_AGENT,
      'Accept-Language': `${track.languageCode},en;q=0.8`,
    },
  });

  if (!response.ok) {
    throw new YoutubeIngestError(
      'YOUTUBE_FETCH_FAILED',
      `Failed to fetch caption track (${response.status}).`,
      `${track.languageCode} ${track.kind || 'manual'}`,
    );
  }

  const body = await response.text();
  if (!body.trim()) {
    return '';
  }

  const matches = [...body.matchAll(RE_XML_TRANSCRIPT)];
  const cues = matches
    .map((match) => {
      const startSec = Number.parseFloat(match[1]);
      const durationSec = Number.parseFloat(match[2]);
      const rawText = decodeHtmlEntities(match[3]);
      const text = rawText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return { startSec, durationSec, text };
    })
    .filter((cue) => Number.isFinite(cue.startSec) && Number.isFinite(cue.durationSec) && cue.text.length > 0);

  if (cues.length === 0) {
    return '';
  }

  return buildSrtFromCues(cues);
}

async function fetchYoutubeCaptionSrt(
  youtubeUrl: string,
  videoId: string,
): Promise<Omit<YoutubeSrtResult, 'source' | 'audioBlobUrl'>> {
  const preferredLanguages = parsePreferredCaptionLangs();
  const inspection = await inspectYoutubePage(videoId);

  if (inspection.captionTracks.length === 0) {
    if (inspection.rateLimited) {
      throw new YoutubeIngestError(
        'YOUTUBE_RATE_LIMITED',
        'YouTube temporarily blocked subtitle requests from the server (captcha/rate-limit).',
        inspection.debugPlayability,
      );
    }
    if (inspection.loginRequired) {
      throw new YoutubeIngestError(
        'YOUTUBE_LOGIN_REQUIRED',
        'YouTube requires login verification for this video before subtitles can be fetched.',
        inspection.debugPlayability,
      );
    }
    if (inspection.videoUnavailable) {
      throw new YoutubeIngestError(
        'YOUTUBE_VIDEO_UNAVAILABLE',
        'The YouTube video is unavailable or cannot be played in the current region/context.',
        inspection.debugPlayability,
      );
    }
    throw new YoutubeIngestError(
      'YOUTUBE_CAPTIONS_DISABLED',
      'No subtitle tracks are available for this video on YouTube.',
      inspection.debugPlayability,
    );
  }

  const tracks = prioritizeCaptionTracks(inspection.captionTracks, preferredLanguages);

  for (const track of tracks) {
    try {
      const srtContent = await fetchCaptionTrackAsSrt(track);
      if (srtContent.trim()) {
        return {
          srtContent,
          videoId,
          videoTitle: inspection.videoTitle,
          selectedLanguage: `${track.languageCode}${track.kind === 'asr' ? ' (auto)' : ''}`,
          availableLanguages: inspection.availableLanguages,
        };
      }
    } catch (error) {
      if (error instanceof YoutubeIngestError && error.code === 'YOUTUBE_FETCH_FAILED') {
        continue;
      }
      throw error;
    }
  }

  throw new YoutubeIngestError(
    'YOUTUBE_CAPTION_EMPTY',
    'Subtitle tracks exist but returned empty content for all candidate languages.',
    `available=${inspection.availableLanguages.join(',')} url=${youtubeUrl}`,
  );
}

function detectAudioExtension(mimeType?: string, container?: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('audio/mp4')) return 'm4a';
  if (mime.includes('audio/webm')) return 'webm';
  if (mime.includes('audio/mpeg')) return 'mp3';
  if (mime.includes('audio/ogg')) return 'ogg';
  if (mime.includes('audio/wav')) return 'wav';
  if (mime.includes('audio/flac')) return 'flac';

  const normalizedContainer = (container || '').toLowerCase();
  if (normalizedContainer === 'mp4') return 'm4a';
  if (normalizedContainer) return normalizedContainer;
  return 'mp3';
}

function toVolcanoAudioFormat(extension: string): string {
  const ext = extension.toLowerCase();
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'webm', 'aac'].includes(ext)) {
    return ext;
  }
  return 'wav';
}

async function streamToBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;
    if (total > maxBytes) {
      throw new YoutubeIngestError(
        'YOUTUBE_AUDIO_TOO_LARGE',
        `Downloaded audio exceeds the configured limit (${maxBytes} bytes).`,
      );
    }
    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks);
}

function parseYtdlCookies(): unknown[] {
  const cookiesJson = (process.env.YOUTUBE_COOKIES_JSON || '').trim();
  if (cookiesJson) {
    try {
      const parsed = JSON.parse(cookiesJson) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid cookie json and fallback to plain cookie string parsing.
    }
  }

  const cookieHeader = (process.env.YOUTUBE_COOKIES || '').trim();
  if (!cookieHeader) {
    return [];
  }

  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) {
        return null;
      }
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (!name || !value) {
        return null;
      }
      return {
        name,
        value,
        domain: '.youtube.com',
        path: '/',
      };
    })
    .filter(Boolean);
}

function buildYtdlCommonOptions(ytdl: YtdlLike): Record<string, unknown> {
  const options: Record<string, unknown> = {
    requestOptions: {
      headers: {
        'User-Agent': YOUTUBE_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
  };

  const rawClients = (process.env.YOUTUBE_YTDL_PLAYER_CLIENTS || '').trim();
  if (rawClients) {
    const clients = rawClients
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (clients.length > 0) {
      options.playerClients = clients;
    }
  }

  const cookies = parseYtdlCookies();
  if (cookies.length > 0 && typeof ytdl.createAgent === 'function') {
    try {
      options.agent = ytdl.createAgent(cookies);
    } catch (error) {
      console.warn('[YOUTUBE_INGEST] Failed to create ytdl agent from cookies:', error);
    }
  }

  return options;
}

function classifyYtdlError(error: unknown): YoutubeIngestError {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();

  if (
    normalized.includes('sign in to confirm') ||
    normalized.includes('login required') ||
    normalized.includes('video is login required') ||
    normalized.includes('this video may be inappropriate')
  ) {
    return new YoutubeIngestError(
      'YOUTUBE_LOGIN_REQUIRED',
      'YouTube requires login verification before audio can be downloaded for ASR.',
      detail,
    );
  }

  if (normalized.includes('too many requests') || normalized.includes('status code: 429')) {
    return new YoutubeIngestError(
      'YOUTUBE_RATE_LIMITED',
      'YouTube temporarily rate-limited audio download requests for this video.',
      detail,
    );
  }

  if (normalized.includes('video unavailable') || normalized.includes('private video') || normalized.includes('members-only')) {
    return new YoutubeIngestError(
      'YOUTUBE_VIDEO_UNAVAILABLE',
      'The YouTube video is unavailable or restricted for server-side download.',
      detail,
    );
  }

  return new YoutubeIngestError('YOUTUBE_AUDIO_DOWNLOAD_FAILED', 'Failed to download YouTube audio for ASR fallback.', detail);
}

async function downloadYoutubeAudio(youtubeUrl: string): Promise<{
  audioBuffer: Buffer;
  extension: string;
  contentType: string;
  videoTitle?: string;
}> {
  try {
    const ytdl = await getYtdl();
    const commonOptions = buildYtdlCommonOptions(ytdl);
    const infoAttempts: Array<{ label: string; options: Record<string, unknown> }> = [
      {
        label: 'default',
        options: commonOptions,
      },
      {
        label: 'web_embedded',
        options: {
          ...commonOptions,
          playerClients: ['WEB_EMBEDDED', 'WEB'],
        },
      },
      {
        label: 'android_tv',
        options: {
          ...commonOptions,
          playerClients: ['ANDROID', 'TV', 'WEB'],
        },
      },
    ];

    let info: YtdlInfo | null = null;
    let infoError: unknown = null;
    for (const attempt of infoAttempts) {
      try {
        info = await ytdl.getInfo(youtubeUrl, attempt.options);
        break;
      } catch (error) {
        infoError = error;
        console.warn(`[YOUTUBE_INGEST] ytdl.getInfo failed (${attempt.label}):`, error);
      }
    }

    if (!info) {
      throw infoError instanceof Error ? infoError : new Error(String(infoError || 'Failed to get YouTube info'));
    }

    const durationSeconds = Number.parseInt(info.videoDetails.lengthSeconds || '0', 10);
    const maxDurationSeconds = toNumber(process.env.YOUTUBE_MAX_AUDIO_DURATION_SECONDS, 3 * 60 * 60);
    if (durationSeconds > maxDurationSeconds) {
      throw new YoutubeIngestError(
        'YOUTUBE_AUDIO_TOO_LONG',
        `Video is too long (${durationSeconds}s), max allowed is ${maxDurationSeconds}s for ASR fallback.`,
      );
    }

    const audioFormats = ytdl
      .filterFormats(info.formats, 'audioonly')
      .filter((format) => Boolean(format.url && (format.audioBitrate || format.bitrate)));

    if (audioFormats.length === 0) {
      throw new YoutubeIngestError('YOUTUBE_AUDIO_DOWNLOAD_FAILED', 'No downloadable audio-only format found.');
    }

    const formatRank = (format: YtdlFormat): number => {
      const ext = detectAudioExtension(format.mimeType, format.container);
      const prefScore = ['m4a', 'mp4', 'mp3', 'ogg', 'webm', 'wav', 'flac'].indexOf(ext);
      const score = prefScore >= 0 ? prefScore : 99;
      return score;
    };

    const candidateFormats = [...audioFormats].sort((a, b) => {
      const rankDiff = formatRank(a) - formatRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      const bitrateA = a.audioBitrate || a.bitrate || 0;
      const bitrateB = b.audioBitrate || b.bitrate || 0;
      return bitrateB - bitrateA;
    });

    const maxAudioBytes = toNumber(process.env.YOUTUBE_MAX_AUDIO_BYTES, 150 * 1024 * 1024);
    const maxFormatAttempts = Math.max(1, toNumber(process.env.YOUTUBE_MAX_FORMAT_ATTEMPTS, 4));
    let lastDownloadError: unknown = null;
    for (const selectedFormat of candidateFormats.slice(0, maxFormatAttempts)) {
      try {
        const audioStream = ytdl.downloadFromInfo(info, {
          ...commonOptions,
          format: selectedFormat,
          highWaterMark: 1 << 25,
        });

        const audioBuffer = await streamToBuffer(audioStream, maxAudioBytes);
        const contentType = (selectedFormat.mimeType || '').split(';')[0] || 'audio/mpeg';
        const extension = detectAudioExtension(selectedFormat.mimeType, selectedFormat.container);

        return {
          audioBuffer,
          extension,
          contentType,
          videoTitle: info.videoDetails.title,
        };
      } catch (error) {
        lastDownloadError = error;
        console.warn('[YOUTUBE_INGEST] ytdl audio format attempt failed:', error);
      }
    }

    throw lastDownloadError instanceof Error ? lastDownloadError : new Error('All ytdl audio format attempts failed.');
  } catch (error) {
    if (error instanceof YoutubeIngestError) {
      throw error;
    }
    throw classifyYtdlError(error);
  }
}

function getGladiaConfig(): GladiaConfig {
  const apiKey = (process.env.GLADIA_API_KEY || process.env.GLADIA_KEY || '').trim();
  if (!apiKey) {
    throw new YoutubeIngestError('GLADIA_NOT_CONFIGURED', 'Gladia ASR is not configured. Set GLADIA_API_KEY.');
  }

  const baseUrlRaw = (process.env.GLADIA_BASE_URL || 'https://api.gladia.io').trim();
  const baseUrl = baseUrlRaw.replace(/\/+$/, '');

  return {
    apiKey,
    baseUrl,
    maxRetries: toNumber(process.env.GLADIA_MAX_RETRIES, 120),
    retryDelayMs: toNumber(process.env.GLADIA_RETRY_DELAY_MS, 5000),
  };
}

function isGladiaFallbackEnabled(): boolean {
  const raw = (process.env.GLADIA_FALLBACK_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function formatGladiaError(error: GladiaPollResponse['error'], fallback: string): string {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message || fallback;
}

function srtFromGladiaResult(data: GladiaPollResponse): string {
  const transcription = data.result?.transcription;
  const subtitles = Array.isArray(transcription?.subtitles) ? transcription?.subtitles : [];
  const srtSubtitle = subtitles.find((item) => (item.format || '').toLowerCase() === 'srt' && item.subtitles?.trim());
  if (srtSubtitle?.subtitles?.trim()) {
    return srtSubtitle.subtitles.trim();
  }

  const utterances = Array.isArray(transcription?.utterances) ? transcription?.utterances : [];
  if (utterances.length > 0) {
    const cues = utterances
      .map((utt) => {
        const startSec = Number(utt.start || 0);
        const endSec = Number(utt.end || startSec + 0.2);
        const durationSec = Math.max(0.2, endSec - startSec);
        const text = normalizeTranscribedText(String(utt.text || ''));
        return { startSec, durationSec, text };
      })
      .filter((cue) => cue.text.length > 0);
    if (cues.length > 0) {
      return buildSrtFromCues(cues);
    }
  }

  const fullText = normalizeTranscribedText(String(transcription?.full_transcript || ''));
  if (fullText) {
    return buildSrtFromCues([
      {
        startSec: 0,
        durationSec: Math.max(2, Math.ceil(fullText.length / 10)),
        text: fullText,
      },
    ]);
  }

  throw new YoutubeIngestError('GLADIA_TRANSCRIBE_FAILED', 'Gladia completed but returned empty subtitle/transcript payload.');
}

function getVolcanoConfig(): VolcanoSubmitConfig {
  const apiKey =
    process.env.VOLCANO_ACCESS_KEY ||
    process.env.VOLC_ACCESS_KEY ||
    process.env.BYTEDANCE_ACCESS_KEY ||
    process.env.ACCESS_KEY ||
    '';

  if (!apiKey.trim()) {
    throw new YoutubeIngestError(
      'VOLCANO_NOT_CONFIGURED',
      'Volcano ASR is not configured. Set VOLCANO_ACCESS_KEY (or VOLC_ACCESS_KEY).',
    );
  }

  return {
    apiKey: apiKey.trim(),
    submitUrl: process.env.VOLCANO_SUBMIT_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',
    queryUrl: process.env.VOLCANO_QUERY_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',
    resourceId: process.env.VOLCANO_RESOURCE_ID || 'volc.bigasr.auc',
    lang: process.env.VOLCANO_ASR_LANG || 'zh',
    maxRetries: toNumber(process.env.VOLCANO_MAX_RETRIES, 60),
    retryDelayMs: toNumber(process.env.VOLCANO_RETRY_DELAY_MS, 5000),
  };
}

async function parseJsonBody<T>(response: Response): Promise<{ text: string; data: T | null }> {
  const text = await response.text();
  if (!text) {
    return { text, data: null };
  }
  try {
    return { text, data: JSON.parse(text) as T };
  } catch {
    return { text, data: null };
  }
}

async function submitVolcanoTask(audioUrl: string, audioFormat: string, config: VolcanoSubmitConfig): Promise<string> {
  const requestId = randomUUID();

  const payload = {
    user: { uid: requestId },
    audio: {
      format: audioFormat,
      url: audioUrl,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_speaker_info: true,
      enable_channel_split: false,
      enable_ddc: false,
      show_utterances: true,
      vad_segment: true,
      lang: config.lang,
      sensitive_words_filter: '',
    },
  };

  const response = await fetch(config.submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'X-Api-Resource-Id': config.resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(payload),
  });

  const { text, data } = await parseJsonBody<VolcanoQueryPayload>(response);
  const apiStatusCode = response.headers.get('x-api-status-code') || '';
  const apiMessage = response.headers.get('x-api-message') || '';

  if (!response.ok) {
    throw new YoutubeIngestError(
      'VOLCANO_SUBMIT_FAILED',
      `Volcano submit API failed (${response.status}).`,
      text || response.statusText,
    );
  }

  if (apiStatusCode && apiStatusCode !== '20000000' && !data?.request_id) {
    throw new YoutubeIngestError(
      'VOLCANO_SUBMIT_FAILED',
      `Volcano submit rejected request (status code ${apiStatusCode || 'unknown'}).`,
      apiMessage || text,
    );
  }

  return requestId;
}

function extractVolcanoResult(data: VolcanoQueryPayload | null): { success: boolean; complete: boolean; fatalError?: string } {
  const result = data?.result || {};
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];

  if (text || utterances.length > 0) {
    return { success: true, complete: true };
  }

  const status = typeof data?.status === 'string' ? data.status.toUpperCase() : '';
  if (status === 'FAILED') {
    return { success: false, complete: true, fatalError: data?.message || 'Volcano task failed.' };
  }

  return { success: false, complete: false };
}

async function queryVolcanoTask(taskId: string, config: VolcanoSubmitConfig): Promise<{ done: boolean; data?: VolcanoQueryPayload; fatalError?: string }> {
  const response = await fetch(config.queryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'X-Api-Resource-Id': config.resourceId,
      'X-Api-Request-Id': taskId,
    },
    body: JSON.stringify({}),
  });

  if (response.status === 429 || response.status === 503) {
    return { done: false };
  }

  const { text, data } = await parseJsonBody<VolcanoQueryPayload>(response);
  const apiStatusCode = response.headers.get('x-api-status-code') || '';
  const apiMessage = response.headers.get('x-api-message') || '';

  if (!response.ok) {
    return {
      done: true,
      fatalError: `Volcano query API failed (${response.status}): ${text || response.statusText}`,
    };
  }

  if (apiStatusCode.startsWith('45')) {
    return {
      done: true,
      fatalError: `Volcano query returned client error ${apiStatusCode}: ${apiMessage || text}`,
    };
  }

  if (apiStatusCode.startsWith('55')) {
    return { done: false };
  }

  const parsed = extractVolcanoResult(data);
  if (parsed.complete && parsed.success) {
    return { done: true, data: data || undefined };
  }

  if (parsed.complete && !parsed.success) {
    return { done: true, fatalError: parsed.fatalError || 'Volcano task failed.' };
  }

  if (['20000001', '20000002', ''].includes(apiStatusCode) || apiStatusCode === '20000000') {
    return { done: false };
  }

  return {
    done: true,
    fatalError: `Volcano query returned unexpected status ${apiStatusCode}: ${apiMessage || text}`,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTranscribedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function srtFromVolcanoResult(data: VolcanoQueryPayload): string {
  const result = data?.result || {};
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];

  if (utterances.length > 0) {
    const cues = utterances
      .map((utt: VolcanoUtterance) => {
        const startSec = Number(utt?.start_time || 0) / 1000;
        const endSec = Number(utt?.end_time || 0) / 1000;
        const durationSec = Math.max(0.2, endSec - startSec);
        const text = normalizeTranscribedText(String(utt?.text || ''));
        return { startSec, durationSec, text };
      })
      .filter((cue: { text: string }) => cue.text.length > 0);

    if (cues.length > 0) {
      return buildSrtFromCues(cues);
    }
  }

  const fullText = normalizeTranscribedText(String(result?.text || ''));
  if (!fullText) {
    throw new YoutubeIngestError('VOLCANO_TRANSCRIBE_FAILED', 'Volcano transcription completed but returned empty text.');
  }

  const sentenceParts = fullText
    .split(/(?<=[。！？!?\.])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const pieces = sentenceParts.length > 0 ? sentenceParts : [fullText];
  const totalChars = pieces.reduce((sum, item) => sum + item.length, 0) || 1;
  let cursor = 0;

  const cues = pieces.map((piece) => {
    const ratio = piece.length / totalChars;
    const durationSec = Math.max(1.8, ratio * Math.max(15, fullText.length / 6));
    const cue = {
      startSec: cursor,
      durationSec,
      text: piece,
    };
    cursor += durationSec;
    return cue;
  });

  return buildSrtFromCues(cues);
}

async function transcribeWithGladiaFromYoutube(youtubeUrl: string, videoId: string): Promise<Omit<YoutubeSrtResult, 'source' | 'selectedLanguage' | 'availableLanguages'>> {
  const gladiaConfig = getGladiaConfig();
  const submitPayload = {
    audio_url: youtubeUrl,
    subtitles: true,
    subtitles_config: {
      formats: ['srt'],
    },
  };

  const submitResponse = await fetch(`${gladiaConfig.baseUrl}/v2/pre-recorded`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gladia-key': gladiaConfig.apiKey,
    },
    body: JSON.stringify(submitPayload),
  });

  const { text: submitText, data: submitData } = await parseJsonBody<GladiaSubmitResponse>(submitResponse);
  if (!submitResponse.ok || !submitData?.id) {
    throw new YoutubeIngestError(
      'GLADIA_SUBMIT_FAILED',
      `Gladia submit API failed (${submitResponse.status}).`,
      submitText || submitData?.error || submitData?.message || submitResponse.statusText,
    );
  }

  const queryUrl = submitData.result_url || `${gladiaConfig.baseUrl}/v2/pre-recorded/${submitData.id}`;
  for (let attempt = 1; attempt <= gladiaConfig.maxRetries; attempt += 1) {
    const queryResponse = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'x-gladia-key': gladiaConfig.apiKey,
      },
    });

    const { text: queryText, data: queryData } = await parseJsonBody<GladiaPollResponse>(queryResponse);
    if (!queryResponse.ok) {
      throw new YoutubeIngestError(
        'GLADIA_QUERY_FAILED',
        `Gladia query API failed (${queryResponse.status}).`,
        queryText || queryResponse.statusText,
      );
    }

    const status = (queryData?.status || '').toLowerCase();
    if (status === 'done') {
      const srtContent = srtFromGladiaResult(queryData || {});
      return {
        srtContent,
        videoId,
      };
    }

    if (status === 'error' || queryData?.error_code) {
      throw new YoutubeIngestError(
        'GLADIA_TRANSCRIBE_FAILED',
        'Gladia transcription failed.',
        `${formatGladiaError(queryData?.error, 'Unknown Gladia error')}${queryText ? ` | raw=${queryText}` : ''}`,
      );
    }

    if (attempt < gladiaConfig.maxRetries) {
      await wait(gladiaConfig.retryDelayMs);
    }
  }

  throw new YoutubeIngestError(
    'GLADIA_TRANSCRIBE_TIMEOUT',
    `Gladia transcription did not finish within ${gladiaConfig.maxRetries} retries.`,
  );
}

async function transcribeWithVolcanoFromYoutube(youtubeUrl: string, videoId: string): Promise<Omit<YoutubeSrtResult, 'source' | 'selectedLanguage' | 'availableLanguages'>> {
  const volcConfig = getVolcanoConfig();
  const audio = await downloadYoutubeAudio(youtubeUrl);

  const audioFileName = `${videoId}-${Date.now()}.${audio.extension}`;
  const audioBlob = await put(audioFileName, audio.audioBuffer, {
    access: 'public',
    contentType: audio.contentType,
  });

  const audioFormat = toVolcanoAudioFormat(audio.extension);
  const taskId = await submitVolcanoTask(audioBlob.url, audioFormat, volcConfig);

  for (let attempt = 1; attempt <= volcConfig.maxRetries; attempt += 1) {
    const queryResult = await queryVolcanoTask(taskId, volcConfig);

    if (queryResult.done && queryResult.data) {
      const srtContent = srtFromVolcanoResult(queryResult.data);
      return {
        srtContent,
        videoId,
        videoTitle: audio.videoTitle,
        audioBlobUrl: audioBlob.url,
      };
    }

    if (queryResult.done && queryResult.fatalError) {
      throw new YoutubeIngestError('VOLCANO_TRANSCRIBE_FAILED', 'Volcano transcription failed.', queryResult.fatalError);
    }

    if (attempt < volcConfig.maxRetries) {
      await wait(volcConfig.retryDelayMs);
    }
  }

  throw new YoutubeIngestError(
    'VOLCANO_TRANSCRIBE_TIMEOUT',
    `Volcano transcription did not finish within ${volcConfig.maxRetries} retries.`,
  );
}

export async function generateSrtFromYoutubeUrl(youtubeUrl: string): Promise<YoutubeSrtResult> {
  const videoId = parseVideoId(youtubeUrl);

  try {
    const captionResult = await fetchYoutubeCaptionSrt(youtubeUrl, videoId);
    return {
      ...captionResult,
      source: 'youtube_caption',
    };
  } catch (captionError) {
    if (!(captionError instanceof YoutubeIngestError)) {
      throw captionError;
    }

    let gladiaError: YoutubeIngestError | null = null;
    if (isGladiaFallbackEnabled()) {
      try {
        const gladiaResult = await transcribeWithGladiaFromYoutube(youtubeUrl, videoId);
        return {
          ...gladiaResult,
          source: 'gladia_asr',
          availableLanguages: [],
          selectedLanguage: undefined,
        };
      } catch (error) {
        if (error instanceof YoutubeIngestError) {
          if (error.code !== 'GLADIA_NOT_CONFIGURED') {
            gladiaError = error;
          }
        } else {
          throw error;
        }
      }
    }

    try {
      const asrResult = await transcribeWithVolcanoFromYoutube(youtubeUrl, videoId);

      return {
        ...asrResult,
        source: 'volcano_asr',
        availableLanguages: [],
        selectedLanguage: undefined,
      };
    } catch (asrError) {
      if (
        asrError instanceof YoutubeIngestError &&
        asrError.code === 'VOLCANO_NOT_CONFIGURED'
      ) {
        const fallbackDetails = [
          `ASR fallback unavailable: ${asrError.message}`,
          gladiaError ? `gladia_fallback: ${gladiaError.code} ${gladiaError.message}${gladiaError.details ? ` (${gladiaError.details})` : ''}` : null,
          captionError.details ? `caption_details: ${captionError.details}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        throw new YoutubeIngestError(
          captionError.code,
          captionError.message,
          fallbackDetails,
        );
      }
      if (asrError instanceof YoutubeIngestError && gladiaError) {
        asrError.details = `${asrError.details ? `${asrError.details} | ` : ''}gladia_fallback: ${gladiaError.code} ${gladiaError.message}${gladiaError.details ? ` (${gladiaError.details})` : ''}`;
      }
      throw asrError;
    }
  }
}
