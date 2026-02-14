import {
  buildAudioFileName,
  downloadBinary,
  extractContentType,
  guessExtension,
} from './download-utils.js';

const transformCache = new Map();

const SIG_FN_PATTERNS = [
  /\.sig\|\|([a-zA-Z0-9$]+)\(/,
  /signature",\s*([a-zA-Z0-9$]+)\(/,
  /\.set\([^,]+,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
  /\bc\s*&&\s*d\.set\([^,]+,\s*([a-zA-Z0-9$]+)\(/,
];

const N_FN_PATTERNS = [
  /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)\(b\)\)/,
  /\.set\("n",\s*([a-zA-Z0-9$]+)\(/,
  /\bn\s*=\s*([a-zA-Z0-9$]+)\(n\)/,
];

function normalizePlayerUrl(playerUrl) {
  const raw = String(playerUrl || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  if (raw.startsWith('/')) {
    return `https://www.youtube.com${raw}`;
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  return `https://www.youtube.com/${raw.replace(/^\/+/, '')}`;
}

function extractBalancedBlock(source, braceStart) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }

  return '';
}

function extractFunctionDefinition(source, fnName) {
  const escaped = fnName.replace(/[$]/g, '\\$&');
  const patterns = [
    new RegExp(`function\\s+${escaped}\\s*\\(([^)]*)\\)\\s*\\{`),
    new RegExp(`${escaped}\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match || match.index < 0) {
      continue;
    }
    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    if (openBrace < 0) {
      continue;
    }

    const body = extractBalancedBlock(source, openBrace);
    if (!body) {
      continue;
    }

    const args = String(match[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      args,
      body,
    };
  }

  return null;
}

function extractObjectBody(source, objectName) {
  const escaped = objectName.replace(/[$]/g, '\\$&');
  const patterns = [
    new RegExp(`var\\s+${escaped}\\s*=\\s*\\{`),
    new RegExp(`${escaped}\\s*=\\s*\\{`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match || match.index < 0) {
      continue;
    }

    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    if (openBrace < 0) {
      continue;
    }

    const body = extractBalancedBlock(source, openBrace);
    if (body) {
      return body;
    }
  }

  return '';
}

function inferMethodKind(methodBody) {
  const body = methodBody.replace(/\s+/g, '');
  if (body.includes('.reverse()')) {
    return 'reverse';
  }
  if (body.includes('.splice(0,')) {
    return 'slice';
  }
  if (body.includes('.slice(')) {
    return 'slice';
  }
  if (body.includes('[0]') && (body.includes('%a.length') || body.includes('%b.length') || body.includes('%c.length'))) {
    return 'swap';
  }
  if (body.includes('varc=') && body.includes('[0]=') && body.includes(']=c')) {
    return 'swap';
  }
  return null;
}

function parseObjectMethods(objectBody) {
  const methodMap = new Map();
  const methodPattern = /([a-zA-Z0-9$]+)\s*:\s*function\(([^)]*)\)\s*\{([^}]*)\}/g;
  let match;

  while ((match = methodPattern.exec(objectBody))) {
    const name = match[1];
    const methodBody = match[3] || '';
    const kind = inferMethodKind(methodBody);
    if (kind) {
      methodMap.set(name, kind);
    }
  }

  return methodMap;
}

function findFirstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '';
}

function buildTransformPlan(source, fnName) {
  if (!fnName) {
    return [];
  }

  const fn = extractFunctionDefinition(source, fnName);
  if (!fn || !fn.body || fn.args.length === 0) {
    return [];
  }

  const targetArg = fn.args[0];
  const objectCallPattern = new RegExp(`([a-zA-Z0-9$]+)\\.([a-zA-Z0-9$]+)\\(${targetArg}(?:,([0-9]+))?\\)`, 'g');

  const objectNames = new Set();
  let callMatch;
  while ((callMatch = objectCallPattern.exec(fn.body))) {
    objectNames.add(callMatch[1]);
  }

  const methodKinds = new Map();
  for (const objectName of objectNames) {
    const objectBody = extractObjectBody(source, objectName);
    const parsedMap = parseObjectMethods(objectBody);
    for (const [methodName, kind] of parsedMap.entries()) {
      methodKinds.set(`${objectName}.${methodName}`, kind);
    }
  }

  const plan = [];
  const tokenPattern = new RegExp(
    `([a-zA-Z0-9$]+)\\.([a-zA-Z0-9$]+)\\(${targetArg}(?:,([0-9]+))?\\)|${targetArg}\\.reverse\\(\\)|${targetArg}\\.splice\\(0,([0-9]+)\\)|${targetArg}\\.slice\\(([0-9]+)\\)`,
    'g',
  );

  let token;
  while ((token = tokenPattern.exec(fn.body))) {
    if (token[1] && token[2]) {
      const key = `${token[1]}.${token[2]}`;
      const kind = methodKinds.get(key);
      if (!kind) {
        continue;
      }
      plan.push({
        type: kind,
        value: Number.parseInt(token[3] || '0', 10) || 0,
      });
      continue;
    }

    if (token[0].includes('.reverse(')) {
      plan.push({ type: 'reverse', value: 0 });
      continue;
    }

    if (token[4]) {
      plan.push({ type: 'slice', value: Number.parseInt(token[4], 10) || 0 });
      continue;
    }

    if (token[5]) {
      plan.push({ type: 'slice', value: Number.parseInt(token[5], 10) || 0 });
    }
  }

  return plan;
}

function applyTransformPlan(input, plan) {
  const chars = String(input || '').split('');
  for (const step of plan) {
    if (step.type === 'reverse') {
      chars.reverse();
      continue;
    }

    if (step.type === 'slice') {
      chars.splice(0, Math.max(0, step.value));
      continue;
    }

    if (step.type === 'swap') {
      if (!chars.length) {
        continue;
      }
      const index = Math.max(0, step.value) % chars.length;
      const first = chars[0];
      chars[0] = chars[index];
      chars[index] = first;
    }
  }

  return chars.join('');
}

async function getPlayerTransforms(playerUrl) {
  const normalizedUrl = normalizePlayerUrl(playerUrl);
  if (!normalizedUrl) {
    throw new Error('Missing player URL for local decipher fallback.');
  }

  if (transformCache.has(normalizedUrl)) {
    return transformCache.get(normalizedUrl);
  }

  const response = await fetch(normalizedUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch player script (${response.status}).`);
  }
  const playerSource = await response.text();

  const signatureFnName = findFirstMatch(playerSource, SIG_FN_PATTERNS);
  const nFnName = findFirstMatch(playerSource, N_FN_PATTERNS);

  const transforms = {
    sig: buildTransformPlan(playerSource, signatureFnName),
    nsig: buildTransformPlan(playerSource, nFnName),
  };

  transformCache.set(normalizedUrl, transforms);
  return transforms;
}

function parseCipherValue(cipherValue) {
  const params = new URLSearchParams(String(cipherValue || ''));
  return {
    url: params.get('url') || '',
    s: params.get('s') || '',
    sp: params.get('sp') || 'sig',
  };
}

function hasDownloadAddress(format) {
  const directUrl = String(format?.url || format?.downloadUrl || '').trim();
  const cipherValue = String(
    format?.signatureCipher ||
      format?.signature_cipher ||
      format?.cipher ||
      format?.signature_cipher_text ||
      '',
  ).trim();
  return Boolean(directUrl || cipherValue);
}

async function buildDownloadUrl(format, playerUrl) {
  const directUrl = String(format?.url || format?.downloadUrl || '').trim();
  const cipherValue = String(
    format?.signatureCipher ||
      format?.signature_cipher ||
      format?.cipher ||
      format?.signature_cipher_text ||
      '',
  ).trim();

  if (!directUrl && !cipherValue) {
    throw new Error('No URL or signatureCipher in selected format.');
  }

  const urlObj = new URL(directUrl || decodeURIComponent(parseCipherValue(cipherValue).url));

  if (cipherValue) {
    const parsedCipher = parseCipherValue(cipherValue);
    if (!parsedCipher.url) {
      throw new Error('Invalid signatureCipher payload.');
    }

    if (parsedCipher.s) {
      const transforms = await getPlayerTransforms(playerUrl);
      if (!transforms.sig.length) {
        throw new Error('Failed to parse signature decipher operations.');
      }
      const signature = applyTransformPlan(parsedCipher.s, transforms.sig);
      urlObj.searchParams.set(parsedCipher.sp || 'sig', signature);
    }
  }

  const n = urlObj.searchParams.get('n');
  if (n) {
    try {
      const transforms = await getPlayerTransforms(playerUrl);
      if (transforms.nsig.length) {
        const transformedN = applyTransformPlan(n, transforms.nsig);
        if (transformedN && transformedN !== n) {
          urlObj.searchParams.set('n', transformedN);
        }
      }
    } catch {
      // Keep original n value when parsing fails.
    }
  }

  return urlObj.toString();
}

function pickAudioFormats(formats) {
  return formats
    .filter((item) => String(item?.mimeType || '').toLowerCase().startsWith('audio/'))
    .filter((item) => hasDownloadAddress(item))
    .sort((a, b) => {
      const mimeA = String(a?.mimeType || '').toLowerCase();
      const mimeB = String(b?.mimeType || '').toLowerCase();
      const scoreA = (mimeA.includes('audio/mp4') ? 200 : 0) + (mimeA.includes('mp4a') ? 100 : 0) + Number(a?.bitrate || 0);
      const scoreB = (mimeB.includes('audio/mp4') ? 200 : 0) + (mimeB.includes('mp4a') ? 100 : 0) + Number(b?.bitrate || 0);
      return scoreB - scoreA;
    });
}

function toNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return num;
}

function toAscii(input) {
  return String(input || '').toLowerCase();
}

function isTranscriptionFriendlyMime(mimeType) {
  const normalized = toAscii(mimeType);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('audio/mp4')) return true;
  if (normalized.startsWith('audio/mpeg')) return true;
  if (normalized.startsWith('audio/wav') || normalized.startsWith('audio/x-wav')) return true;
  if (normalized.startsWith('audio/aac')) return true;
  if (normalized.startsWith('audio/flac')) return true;
  if (normalized.startsWith('audio/ogg')) return false;
  if (normalized.startsWith('audio/webm') || normalized.startsWith('audio/opus')) return false;
  return null;
}

function inferContainerFromMimeType(mimeType) {
  const normalized = toAscii(mimeType);
  if (normalized.startsWith('audio/mp4')) return 'mp4';
  if (normalized.startsWith('audio/mpeg')) return 'mp3';
  if (normalized.startsWith('audio/wav') || normalized.startsWith('audio/x-wav')) return 'wav';
  if (normalized.startsWith('audio/aac')) return 'aac';
  if (normalized.startsWith('audio/flac')) return 'flac';
  return '';
}

function looksLikeTextPayload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    return false;
  }

  const probe = bytes.slice(0, 96);
  let text = '';
  for (const code of probe) {
    if (code === 0) {
      return false;
    }
    if (code >= 32 && code <= 126) {
      text += String.fromCharCode(code);
      continue;
    }
    if (code === 9 || code === 10 || code === 13) {
      text += ' ';
      continue;
    }
    // Non-printable binary byte: likely real media bytes.
    return false;
  }

  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html') ||
    normalized.startsWith('<?xml') ||
    normalized.startsWith('{') ||
    normalized.startsWith('[')
  );
}

function detectAudioContainer(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return 'unknown';
  }

  if (bytes.length >= 12) {
    const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (box === 'ftyp' || box === 'styp' || box === 'sidx' || box === 'moov' || box === 'moof' || box === 'mdat') {
      return 'mp4';
    }
  }

  if (bytes.length >= 4) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (riff === 'RIFF' && bytes.length >= 12) {
      const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (wave === 'WAVE') return 'wav';
    }
    if (riff === 'OggS') return 'ogg';
    if (riff === 'fLaC') return 'flac';
    if (riff === 'ID3') return 'mp3';
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return 'aac';
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }

  return 'unknown';
}

function isSupportedContainer(container) {
  const normalized = toAscii(container);
  return normalized === 'mp4' || normalized === 'mp3' || normalized === 'wav' || normalized === 'aac' || normalized === 'flac';
}

function containerToMime(container, fallback = 'audio/mp4') {
  const normalized = toAscii(container);
  if (normalized === 'mp4') return 'audio/mp4';
  if (normalized === 'mp3') return 'audio/mpeg';
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'aac') return 'audio/aac';
  if (normalized === 'flac') return 'audio/flac';
  return fallback;
}

function pickNetworkAudioCandidates(candidates) {
  return candidates
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      url: String(item.url || '').trim(),
      mimeType: String(item.mimeType || '').trim(),
      contentLength: Number(item.contentLength || 0),
      itag: Number(item.itag || 0),
    }))
    .filter((item) => item.url)
    .sort((a, b) => {
      const mimeA = isTranscriptionFriendlyMime(itemMimeSafe(a.mimeType));
      const mimeB = isTranscriptionFriendlyMime(itemMimeSafe(b.mimeType));
      const scoreA = (mimeA === true ? 1000 : mimeA === false ? -1000 : 0) + Number(a.contentLength || 0);
      const scoreB = (mimeB === true ? 1000 : mimeB === false ? -1000 : 0) + Number(b.contentLength || 0);
      return scoreB - scoreA;
    });
}

function inferMimeTypeFromUrl(url, fallback = 'audio/mp4') {
  try {
    const parsed = new URL(String(url || ''));
    const mimeParam = decodeURIComponent(parsed.searchParams.get('mime') || '');
    if (mimeParam) {
      return mimeParam;
    }
  } catch {
    // Ignore URL parsing failures.
  }
  return fallback;
}

function itemMimeSafe(mimeType) {
  return String(mimeType || '').trim();
}

export async function downloadAudioWithLocalFallback(options) {
  const context = options?.downloadContext || {};
  const videoId = String(context.videoId || options?.videoId || '').trim();
  if (!videoId) {
    throw new Error('Missing videoId for local fallback downloader');
  }

  const title = String(context.title || options?.title || `YouTube ${videoId}`);
  const maxDurationSec = Number(options?.maxDurationSec || 180 * 60);
  const durationSec = toNumber(context.lengthSeconds);
  if (durationSec && durationSec > maxDurationSec) {
    throw new Error(`VIDEO_TOO_LONG: ${durationSec}s exceeds ${maxDurationSec}s.`);
  }

  const networkCandidates = pickNetworkAudioCandidates(context.networkAudioCandidates || []);
  let lastError = null;
  for (const candidate of networkCandidates) {
    try {
      const hintedMimeType = extractContentType(candidate.mimeType || inferMimeTypeFromUrl(candidate.url, 'audio/mp4'));
      const mimeCheck = isTranscriptionFriendlyMime(hintedMimeType);
      if (mimeCheck === false) {
        lastError = new Error(`Unsupported transcription mime type from network candidate: ${hintedMimeType}`);
        continue;
      }

      const contentLength = Number(candidate.contentLength || 0);
      const audioBytes = await downloadBinary(candidate.url, {
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        onProgress: options?.onProgress,
      });
      let container = detectAudioContainer(audioBytes);
      if (container === 'unknown') {
        const hintedContainer = inferContainerFromMimeType(hintedMimeType);
        if (hintedContainer) {
          container = hintedContainer;
        }
      }
      if (!isSupportedContainer(container)) {
        const payloadHint = looksLikeTextPayload(audioBytes) ? ' (received non-audio text payload)' : '';
        lastError = new Error(`Unsupported audio container from network candidate: ${container}${payloadHint}`);
        continue;
      }
      const mimeType = containerToMime(container, hintedMimeType);
      const extension = guessExtension(mimeType, 'm4a');
      const fileName = buildAudioFileName(videoId, title, extension);

      return {
        stack: 'local_decsig',
        audioBytes,
        mimeType,
        extension,
        fileName,
        title,
        durationSec: durationSec || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const adaptiveFormats = Array.isArray(context.adaptiveFormats) ? context.adaptiveFormats : [];
  const allAudioFormats = adaptiveFormats.filter((item) =>
    String(item?.mimeType || '').toLowerCase().startsWith('audio/'),
  );
  const candidates = pickAudioFormats(adaptiveFormats);
  if (!candidates.length) {
    if (lastError) {
      throw lastError;
    }
    if (allAudioFormats.length > 0) {
      throw new Error('No downloadable audio formats available in player response.');
    }
    throw new Error('No audio formats available in player response.');
  }

  for (const format of candidates) {
    try {
      const mimeType = extractContentType(format?.mimeType || 'audio/mp4');
      const mimeCheck = isTranscriptionFriendlyMime(mimeType);
      if (mimeCheck === false) {
        lastError = new Error(`Unsupported transcription mime type from adaptive format: ${mimeType}`);
        continue;
      }
      const extension = guessExtension(mimeType, 'm4a');
      const fileName = buildAudioFileName(videoId, title, extension);
      const contentLength = Number(format?.contentLength || 0);
      const url = await buildDownloadUrl(format, context.playerUrl);
      const audioBytes = await downloadBinary(url, {
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        onProgress: options?.onProgress,
      });
      let container = detectAudioContainer(audioBytes);
      if (container === 'unknown') {
        const hintedContainer = inferContainerFromMimeType(mimeType);
        if (hintedContainer) {
          container = hintedContainer;
        }
      }
      if (!isSupportedContainer(container)) {
        const payloadHint = looksLikeTextPayload(audioBytes) ? ' (received non-audio text payload)' : '';
        lastError = new Error(`Unsupported audio container from adaptive format: ${container}${payloadHint}`);
        continue;
      }
      const finalMimeType = containerToMime(container, mimeType);
      const finalExtension = guessExtension(finalMimeType, extension);
      const finalFileName = buildAudioFileName(videoId, title, finalExtension);

      return {
        stack: 'local_decsig',
        audioBytes,
        mimeType: finalMimeType,
        extension: finalExtension,
        fileName: finalFileName,
        title,
        durationSec: durationSec || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Local fallback failed to download audio.');
}
