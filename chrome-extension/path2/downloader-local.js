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

async function buildDownloadUrl(format, playerUrl) {
  const directUrl = String(format?.url || '').trim();
  const cipherValue = String(format?.signatureCipher || format?.cipher || '').trim();

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

  const adaptiveFormats = Array.isArray(context.adaptiveFormats) ? context.adaptiveFormats : [];
  const candidates = pickAudioFormats(adaptiveFormats);
  if (!candidates.length) {
    throw new Error('No audio formats available in player response.');
  }

  let lastError = null;
  for (const format of candidates) {
    try {
      const mimeType = extractContentType(format?.mimeType || 'audio/mp4');
      const extension = guessExtension(mimeType, 'm4a');
      const fileName = buildAudioFileName(videoId, title, extension);
      const contentLength = Number(format?.contentLength || 0);
      const url = await buildDownloadUrl(format, context.playerUrl);
      const audioBytes = await downloadBinary(url, {
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        onProgress: options?.onProgress,
      });

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

  throw lastError || new Error('Local fallback failed to download audio.');
}
