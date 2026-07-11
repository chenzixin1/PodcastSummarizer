import { INFOGRAPHIC_MODEL } from './infographicJobs';

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1_000;
const DEFAULT_MAX_DECODED_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg']);
const FONT_STACK = 'Inter, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, Arial, sans-serif';

export interface GeneratedRaster {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
  costUsd: number | null;
}

export interface GenerateInfographicRasterOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxDecodedBytes?: number;
}

export class InfographicGenerationError extends Error {
  readonly code: string;
  readonly transient: boolean;

  constructor(code: string, transient: boolean, message: string) {
    super(message);
    this.name = 'InfographicGenerationError';
    this.code = code;
    this.transient = transient;
  }
}

function errorForHttpStatus(status: number): InfographicGenerationError {
  if (status === 408) {
    return new InfographicGenerationError('upstream_timeout', true, 'Image provider request timed out');
  }
  if (status === 425) {
    return new InfographicGenerationError('upstream_unavailable', true, 'Image provider is temporarily unavailable');
  }
  if (status === 429) {
    return new InfographicGenerationError('upstream_rate_limited', true, 'Image provider rate limit reached');
  }
  if (status >= 500) {
    return new InfographicGenerationError('upstream_unavailable', true, 'Image provider is unavailable');
  }
  if (status === 401 || status === 403) {
    return new InfographicGenerationError('configuration_error', false, 'Image provider authentication failed');
  }
  if (status === 400) {
    return new InfographicGenerationError('invalid_request', false, 'Image provider rejected the request');
  }
  if (status === 422) {
    return new InfographicGenerationError('policy_violation', false, 'Image provider rejected the request');
  }
  if (status >= 400 && status < 500) {
    return new InfographicGenerationError('provider_error', false, 'Image provider rejected the request');
  }
  return new InfographicGenerationError('provider_error', true, 'Image provider request failed');
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new InfographicGenerationError('invalid_response', false, 'Image provider returned invalid image data');
  }

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new InfographicGenerationError('invalid_response', false, 'Image provider returned invalid image data');
  }
}

function decodedBase64Size(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((byte, index) => bytes[index] === byte)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions: { width: number; height: number } | null = null;
  let hasImageData = false;

  while (offset + 12 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) return null;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

    if (offset === 8) {
      if (chunkLength !== 13 || type !== 'IHDR') return null;
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (width <= 0 || height <= 0) return null;
      dimensions = { width, height };
    }

    if (type === 'IDAT' && chunkLength > 0) hasImageData = true;

    if (type === 'IEND') {
      return chunkLength === 0 && chunkEnd === bytes.length && hasImageData ? dimensions : null;
    }
    offset = chunkEnd;
  }
  return null;
}

function hasJpegScanData(bytes: Uint8Array, scanOffset: number): boolean {
  const scanEnd = bytes.length - 2;
  let offset = scanOffset;
  let hasData = false;

  while (offset < scanEnd) {
    if (bytes[offset] !== 0xff) {
      hasData = true;
      offset += 1;
      continue;
    }

    offset += 1;
    while (offset < scanEnd && bytes[offset] === 0xff) offset += 1;
    if (offset >= scanEnd) return false;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00) {
      hasData = true;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    return false;
  }
  return hasData;
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) {
      offset += 1;
      if (offset >= bytes.length) return null;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return null;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width <= 0 || height <= 0) return null;
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      if (segmentLength < 8) return null;
      const componentCount = bytes[offset + 2];
      if (componentCount < 1 || segmentLength !== 6 + (componentCount * 2)) return null;
      return dimensions && hasJpegScanData(bytes, offset + segmentLength) ? dimensions : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function readRasterDimensions(
  bytes: Uint8Array,
  mediaType: 'image/png' | 'image/jpeg',
): { width: number; height: number } {
  const dimensions = mediaType === 'image/png' ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new InfographicGenerationError('invalid_response', false, 'Image provider returned an invalid raster');
  }
  return dimensions;
}

export async function generateInfographicRaster(
  prompt: string,
  options: GenerateInfographicRasterOptions = {},
): Promise<GeneratedRaster> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) {
    throw new InfographicGenerationError('configuration_error', false, 'OPENROUTER_API_KEY is missing');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
        'X-Title': 'PodSum.cc',
      },
      body: JSON.stringify({
        model: INFOGRAPHIC_MODEL,
        prompt,
        resolution: '2K',
        aspect_ratio: '3:4',
        n: 1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw errorForHttpStatus(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InfographicGenerationError('invalid_response', false, 'Image provider returned invalid JSON');
    }

    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new InfographicGenerationError('invalid_response', false, 'Image provider returned an invalid image payload');
    }
    const image = payload.data[0];
    if (!isRecord(image) || typeof image.b64_json !== 'string' || typeof image.media_type !== 'string') {
      throw new InfographicGenerationError('invalid_response', false, 'Image provider returned an incomplete image payload');
    }
    if (!SUPPORTED_MEDIA_TYPES.has(image.media_type)) {
      throw new InfographicGenerationError('invalid_response', false, 'Image provider returned an unsupported image type');
    }

    if (!Number.isFinite(maxDecodedBytes) || maxDecodedBytes <= 0 || decodedBase64Size(image.b64_json) > maxDecodedBytes) {
      throw new InfographicGenerationError('invalid_response', false, 'Image provider returned an oversized image');
    }
    const bytes = decodeBase64(image.b64_json);

    const mediaType = image.media_type as GeneratedRaster['mediaType'];
    const dimensions = readRasterDimensions(bytes, mediaType);
    const cost = isRecord(payload.usage) ? payload.usage.cost : null;
    return {
      base64: image.b64_json,
      mediaType,
      bytes,
      width: dimensions.width,
      height: dimensions.height,
      costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    };
  } catch (error) {
    if (error instanceof InfographicGenerationError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new InfographicGenerationError('upstream_timeout', true, 'Image provider request timed out');
    }
    throw new InfographicGenerationError('upstream_unavailable', true, 'Image provider request failed');
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const isYoutube = hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';
    if (isYoutube) {
      const videoId = hostname === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1];
      if (!videoId) return null;
      return `https://youtu.be/${encodeURIComponent(videoId)}`;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isCjk(character: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(character);
}

function characterWeight(character: string): number {
  if (isCjk(character)) return 1;
  if (/\s/u.test(character)) return 0.28;
  if (/[A-Za-z0-9]/u.test(character)) return 0.56;
  return 0.5;
}

function tokenWeight(token: string): number {
  return Array.from(token).reduce((total, character) => total + characterWeight(character), 0);
}

function splitOverlongToken(token: string, width: number): string[] {
  const parts: string[] = [];
  let line = '';
  let lineWeight = 0;
  for (const character of Array.from(token)) {
    const weight = characterWeight(character);
    if (line && lineWeight + weight > width) {
      parts.push(line);
      line = '';
      lineWeight = 0;
    }
    line += character;
    lineWeight += weight;
  }
  if (line) parts.push(line);
  return parts;
}

export function wrapInfographicTitle(title: string, width: number): string[] {
  const normalizedWidth = Math.max(1, width);
  const tokens = String(title).match(/[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9][A-Za-z0-9._+/#-]*|\s+|[^\s]/gu) || [];
  const lines: string[] = [];
  let line = '';
  let lineWeight = 0;

  for (const token of tokens) {
    const weight = tokenWeight(token);
    if (line && lineWeight + weight > normalizedWidth) {
      lines.push(line);
      line = '';
      lineWeight = 0;
    }
    if (!line && weight > normalizedWidth) {
      const parts = splitOverlongToken(token, normalizedWidth);
      lines.push(...parts.slice(0, -1));
      line = parts.at(-1) || '';
      lineWeight = tokenWeight(line);
      continue;
    }
    line += token;
    lineWeight += weight;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ComposeInfographicSvgInput {
  raster: GeneratedRaster;
  sourceTitle: string;
  sourceUrl?: string | null;
}

function layoutTitle(title: string, availableWidth: number, initialSize: number, minimumSize: number) {
  let fontSize = initialSize;
  let lines = wrapInfographicTitle(title, availableWidth / fontSize);
  while (lines.length > 3 && fontSize > minimumSize) {
    fontSize = Math.max(minimumSize, fontSize - 1);
    lines = wrapInfographicTitle(title, availableWidth / fontSize);
  }
  return { fontSize, lines };
}

function textElement(x: number, y: number, fontSize: number, lines: string[], className: string): string {
  const lineHeight = Math.ceil(fontSize * 1.35);
  return `<text class="${className}" x="${x}" y="${y}" font-size="${fontSize}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('')}</text>`;
}

export function composeInfographicSvg(input: ComposeInfographicSvgInput): Uint8Array {
  const { raster } = input;
  if (!SUPPORTED_MEDIA_TYPES.has(raster.mediaType)) {
    throw new InfographicGenerationError('invalid_response', false, 'Unsupported raster media type');
  }
  const padding = Math.max(24, Math.ceil(raster.width * 0.025));
  const contentWidth = raster.width + (padding * 2);
  const availableWidth = raster.width;
  const title = String(input.sourceTitle || '');
  const titleLayout = layoutTitle(title, availableWidth, Math.max(14, raster.width * 0.032), 12);
  const titleLineHeight = Math.ceil(titleLayout.fontSize * 1.35);
  const url = normalizeSourceUrl(input.sourceUrl);
  const urlFontSize = Math.max(11, raster.width * 0.018);
  const urlLines = url ? wrapInfographicTitle(url, availableWidth / urlFontSize) : [];
  const urlLineHeight = Math.ceil(urlFontSize * 1.35);
  const titleLinkGap = url ? Math.max(8, Math.ceil(raster.width * 0.014)) : 0;
  const footerTopPadding = padding;
  const footerBottomPadding = padding;
  const footerHeight = footerTopPadding
    + (titleLayout.lines.length * titleLineHeight)
    + (urlLines.length ? titleLinkGap + (urlLines.length * urlLineHeight) : 0)
    + footerBottomPadding;
  const totalHeight = padding + raster.height + footerHeight;
  const titleY = padding + raster.height + footerTopPadding + titleLayout.fontSize;
  const urlY = titleY + ((titleLayout.lines.length - 1) * titleLineHeight) + titleLinkGap + urlFontSize;
  const imageHref = `data:${raster.mediaType};base64,${raster.base64}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${contentWidth}" height="${totalHeight}" viewBox="0 0 ${contentWidth} ${totalHeight}">
<style>.caption{font-family:${FONT_STACK};fill:#173f35}.source{font-family:${FONT_STACK};fill:#5b665f}</style>
<rect width="100%" height="100%" fill="#ffffff"/>
<image x="${padding}" y="${padding}" width="${raster.width}" height="${raster.height}" href="${imageHref}" preserveAspectRatio="xMidYMid meet"/>
${textElement(padding, titleY, titleLayout.fontSize, titleLayout.lines, 'caption')}
${urlLines.length ? textElement(padding, urlY, urlFontSize, urlLines, 'source') : ''}
</svg>`;
  return new TextEncoder().encode(svg);
}
