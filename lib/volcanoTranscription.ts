import { randomUUID } from 'crypto';

export interface VolcanoSubmitConfig {
  apiKey: string;
  submitUrl: string;
  queryUrl: string;
  resourceId: string;
  lang: string;
  maxRetries: number;
  retryDelayMs: number;
}

export interface VolcanoUtterance {
  start_time?: number;
  end_time?: number;
  text?: string;
}

export interface VolcanoQueryPayload {
  status?: string;
  message?: string;
  result?: {
    text?: string;
    utterances?: VolcanoUtterance[];
  };
}

interface QueryResult {
  done: boolean;
  data?: VolcanoQueryPayload;
  fatalError?: string;
}

function toNumber(input: string | undefined, fallback: number): number {
  const value = Number.parseInt(input || '', 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function getVolcanoConfig(defaultLang = 'auto'): VolcanoSubmitConfig {
  const apiKey =
    process.env.VOLCANO_ACCESS_KEY ||
    process.env.VOLC_ACCESS_KEY ||
    process.env.BYTEDANCE_ACCESS_KEY ||
    process.env.ACCESS_KEY ||
    '';

  if (!apiKey.trim()) {
    throw new Error('Volcano ASR is not configured. Set VOLCANO_ACCESS_KEY (or VOLC_ACCESS_KEY).');
  }

  return {
    apiKey: apiKey.trim(),
    submitUrl: process.env.VOLCANO_SUBMIT_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',
    queryUrl: process.env.VOLCANO_QUERY_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',
    resourceId: process.env.VOLCANO_RESOURCE_ID || 'volc.bigasr.auc',
    lang: (process.env.VOLCANO_ASR_LANG || defaultLang || 'auto').trim() || 'auto',
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

export function toVolcanoAudioFormat(fileName: string, contentType = ''): string {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('audio/mpeg')) return 'mp3';
  if (normalizedType.includes('audio/wav') || normalizedType.includes('audio/x-wav')) return 'wav';
  if (normalizedType.includes('audio/mp4')) return 'm4a';
  if (normalizedType.includes('audio/aac')) return 'aac';
  if (normalizedType.includes('audio/ogg')) return 'ogg';
  if (normalizedType.includes('audio/flac')) return 'flac';
  if (normalizedType.includes('audio/webm')) return 'webm';

  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mp4', 'opus'].includes(ext)) {
    return ext;
  }

  return 'mp3';
}

export async function submitVolcanoTask(
  audioUrl: string,
  audioFormat: string,
  config: VolcanoSubmitConfig,
  language = 'auto',
): Promise<string> {
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
      lang: language || config.lang || 'auto',
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
    throw new Error(`Volcano submit API failed (${response.status}): ${text || response.statusText}`);
  }

  if (apiStatusCode && apiStatusCode !== '20000000' && !data?.result) {
    throw new Error(
      `Volcano submit rejected request (status code ${apiStatusCode || 'unknown'}): ${apiMessage || text}`,
    );
  }

  return requestId;
}

function extractVolcanoResult(data: VolcanoQueryPayload | null): {
  success: boolean;
  complete: boolean;
  fatalError?: string;
} {
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

export async function queryVolcanoTask(taskId: string, config: VolcanoSubmitConfig): Promise<QueryResult> {
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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

export function srtFromVolcanoResult(data: VolcanoQueryPayload): string {
  const result = data?.result || {};
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];

  if (utterances.length > 0) {
    const cues = utterances
      .map((item) => {
        const text = normalizeText(String(item?.text || ''));
        if (!text) {
          return null;
        }
        const startSec = Number(item?.start_time || 0) / 1000;
        const endSec = Number(item?.end_time || 0) / 1000;
        return {
          startSec,
          durationSec: Math.max(0.2, endSec - startSec),
          text,
        };
      })
      .filter((item): item is { startSec: number; durationSec: number; text: string } => Boolean(item));

    if (cues.length > 0) {
      return buildSrtFromCues(cues);
    }
  }

  const fullText = normalizeText(String(result?.text || ''));
  if (!fullText) {
    throw new Error('Volcano transcription completed but returned empty text.');
  }

  return buildSrtFromCues([
    {
      startSec: 0,
      durationSec: Math.max(2, Math.ceil(fullText.length / 10)),
      text: fullText,
    },
  ]);
}
