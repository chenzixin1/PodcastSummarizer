/**
 * @jest-environment node
 */

import {
  composeInfographicSvg,
  generateInfographicRaster,
  InfographicGenerationError,
  normalizeSourceUrl,
  readRasterDimensions,
  wrapInfographicTitle,
} from '../../lib/infographicImage';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function makePng(width = 400, height = 600): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function makeJpeg(width = 200, height = 100): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function responseWithImage(bytes = makePng(), mediaType = 'image/png'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ b64_json: toBase64(bytes), media_type: mediaType }],
      usage: { cost: 0.13552 },
    }),
  } as Response;
}

describe('infographic image client', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.OPENROUTER_API_KEY = originalKey;
  });

  test('uses the pinned OpenRouter Images request shape', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(responseWithImage());

    const result = await generateInfographicRaster('grounded prompt');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      model: 'google/gemini-3-pro-image',
      prompt: 'grounded prompt',
      resolution: '2K',
      aspect_ratio: '3:4',
      n: 1,
    });
    expect(result).toMatchObject({
      mediaType: 'image/png', width: 400, height: 600, costUsd: 0.13552,
    });
  });

  test.each([
    ['timeout', Object.assign(new Error('aborted'), { name: 'AbortError' }), 'upstream_timeout', true],
    ['429', { ok: false, status: 429, statusText: 'Too Many Requests' } as Response, 'upstream_rate_limited', true],
    ['5xx', { ok: false, status: 503, statusText: 'Unavailable' } as Response, 'upstream_unavailable', true],
    ['content policy 4xx', { ok: false, status: 400, statusText: 'Content policy' } as Response, 'policy_violation', false],
  ])('classifies %s safely', async (_name, outcome, code, transient) => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });

    await expect(generateInfographicRaster('private prompt')).rejects.toMatchObject({ code, transient });
  });

  test.each([
    ['malformed JSON', { ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response, {}, 'invalid_response'],
    ['missing base64', { ok: true, status: 200, json: async () => ({ data: [{ media_type: 'image/png' }] }) } as Response, {}, 'invalid_response'],
    ['unsupported media type', responseWithImage(makePng(), 'image/webp'), {}, 'invalid_response'],
    ['oversized decoded payload', responseWithImage(makePng()), { maxDecodedBytes: 2 }, 'invalid_response'],
  ])('rejects %s without leaking provider payloads', async (_name, response, options, code) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response);

    await expect(generateInfographicRaster('private prompt', options)).rejects.toMatchObject({ code, transient: false });
  });

  test('does not expose base64 payloads in errors', async () => {
    const payload = 'a'.repeat(100);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [{ b64_json: payload, media_type: 'image/png' }] }),
    } as Response);

    await expect(generateInfographicRaster('private prompt', { maxDecodedBytes: 1 })).rejects.toThrow(InfographicGenerationError);
    try {
      await generateInfographicRaster('private prompt', { maxDecodedBytes: 1 });
    } catch (error) {
      expect((error as Error).message).not.toContain(payload);
    }
  });
});

describe('infographic raster and Polaroid SVG', () => {
  test('reads PNG and JPEG raster dimensions', () => {
    expect(readRasterDimensions(makePng(400, 600), 'image/png')).toEqual({ width: 400, height: 600 });
    expect(readRasterDimensions(makeJpeg(200, 100), 'image/jpeg')).toEqual({ width: 200, height: 100 });
  });

  test('normalizes YouTube sources and removes timestamps', () => {
    expect(normalizeSourceUrl('https://www.youtube.com/watch?v=abc123&t=42s&utm_source=test')).toBe('https://youtu.be/abc123');
    expect(normalizeSourceUrl('https://youtu.be/abc123?si=tracking')).toBe('https://youtu.be/abc123');
    expect(normalizeSourceUrl('not a url')).toBeNull();
  });

  test('wraps mixed Chinese and English without losing text', () => {
    const title = '理解 Reinforcement Learning 如何改变下一代训练范式';
    const lines = wrapInfographicTitle(title, 12);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(title);
  });

  test('escapes XML, omits an absent SRT URL, and embeds the raster', () => {
    const svg = new TextDecoder().decode(composeInfographicSvg({
      raster: {
        base64: toBase64(makePng()), mediaType: 'image/png', bytes: makePng(), width: 400, height: 600, costUsd: null,
      },
      sourceTitle: 'A <title> & "quote"',
      sourceUrl: null,
    }));

    expect(svg).toContain('A &lt;title&gt; &amp; &quot;quote&quot;');
    expect(svg).not.toContain('https://');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).toContain('<text');
    expect(svg).toContain('<tspan');
  });

  test('grows the footer for a 100-character title without truncation', () => {
    const shortSvg = new TextDecoder().decode(composeInfographicSvg({
      raster: { base64: toBase64(makePng()), mediaType: 'image/png', bytes: makePng(), width: 400, height: 600, costUsd: null },
      sourceTitle: 'Short title', sourceUrl: 'https://youtu.be/abc123',
    }));
    const title = 'a'.repeat(100);
    const longSvg = new TextDecoder().decode(composeInfographicSvg({
      raster: { base64: toBase64(makePng()), mediaType: 'image/png', bytes: makePng(), width: 400, height: 600, costUsd: null },
      sourceTitle: title, sourceUrl: 'https://youtu.be/abc123',
    }));

    const heightOf = (svg: string) => Number(svg.match(/height="(\d+(?:\.\d+)?)"/)?.[1]);
    expect(heightOf(longSvg)).toBeGreaterThan(heightOf(shortSvg));
    expect(longSvg.replace(/<[^>]+>/g, '').replace(/\s/g, '')).toContain(title);
  });
});
