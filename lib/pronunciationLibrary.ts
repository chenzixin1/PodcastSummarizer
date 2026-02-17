const PRONUNCIATION_CHUNK_BASE = '/vocab/pronunciation/en-us/chunks';

type PronunciationChunk = Record<string, string>;

const chunkCache = new Map<string, Promise<PronunciationChunk>>();
const lookupCache = new Map<string, string | null>();

function normalizePronunciationWord(word: string): string {
  return String(word || '')
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z'-]+$/g, '')
    .trim();
}

function getBucket(word: string): string {
  const first = word.charAt(0);
  return /^[a-z]$/.test(first) ? first : '_';
}

async function loadChunk(bucket: string): Promise<PronunciationChunk> {
  const cached = chunkCache.get(bucket);
  if (cached) {
    return cached;
  }

  const loading = (async () => {
    const response = await fetch(`${PRONUNCIATION_CHUNK_BASE}/${bucket}.json`);
    if (!response.ok) {
      return {};
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return payload as PronunciationChunk;
  })().catch(() => ({}));

  chunkCache.set(bucket, loading);
  return loading;
}

export async function getPronunciationAudioUrl(word: string): Promise<string | null> {
  const key = normalizePronunciationWord(word);
  if (!key) {
    return null;
  }

  if (lookupCache.has(key)) {
    return lookupCache.get(key) || null;
  }

  const bucket = getBucket(key);
  const chunk = await loadChunk(bucket);
  const url = typeof chunk[key] === 'string' && chunk[key].trim() ? chunk[key].trim() : null;
  lookupCache.set(key, url);
  return url;
}

export function clearPronunciationLibraryCache(): void {
  chunkCache.clear();
  lookupCache.clear();
}

