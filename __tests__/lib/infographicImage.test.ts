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
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0x08, 0x02, 0x00, 0x00, 0x00], 24);
  new DataView(bytes.buffer).setUint32(33, 1);
  bytes.set([0x49, 0x44, 0x41, 0x54, 0x00], 37);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  return bytes;
}

function makePngHeaderOnly(): Uint8Array {
  const bytes = makePng();
  return new Uint8Array([...bytes.slice(0, 33), ...bytes.slice(46)]);
}

function makeJpeg(width = 200, height = 100): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd9,
  ]);
}

function makeJpegHeaderOnly(): Uint8Array {
  return new Uint8Array([...makeJpeg().slice(0, 21), 0xff, 0xd9]);
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
    ['408', { ok: false, status: 408, statusText: 'Request Timeout' } as Response, 'upstream_timeout', true],
    ['425', { ok: false, status: 425, statusText: 'Too Early' } as Response, 'upstream_unavailable', true],
    ['429', { ok: false, status: 429, statusText: 'Too Many Requests' } as Response, 'upstream_rate_limited', true],
    ['5xx', { ok: false, status: 503, statusText: 'Unavailable' } as Response, 'upstream_unavailable', true],
    ['401', { ok: false, status: 401, statusText: 'Unauthorized' } as Response, 'configuration_error', false],
    ['403', { ok: false, status: 403, statusText: 'Forbidden' } as Response, 'configuration_error', false],
    ['400', { ok: false, status: 400, statusText: 'Bad Request' } as Response, 'invalid_request', false],
    ['422', { ok: false, status: 422, statusText: 'Unprocessable Entity' } as Response, 'policy_violation', false],
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

  test.each([null, 'not an object', 42, [], { data: {} }])('rejects a non-object or non-array success payload', async payload => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => payload,
    } as Response);

    await expect(generateInfographicRaster('grounded prompt')).rejects.toMatchObject({
      code: 'invalid_response', transient: false,
    });
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
  test('reads structurally complete PNG and JPEG data streams', () => {
    expect(readRasterDimensions(makePng(400, 600), 'image/png')).toEqual({ width: 400, height: 600 });
    expect(readRasterDimensions(makeJpeg(200, 100), 'image/jpeg')).toEqual({ width: 200, height: 100 });
  });

  test.each([
    ['truncated PNG', makePng().slice(0, 28), 'image/png'],
    ['PNG header without IDAT', makePngHeaderOnly(), 'image/png'],
    ['PNG without terminal IEND', makePng().slice(0, -12), 'image/png'],
    ['PNG with forged IHDR type', (() => { const bytes = makePng(); bytes.set([0x66, 0x61, 0x6b, 0x65], 12); return bytes; })(), 'image/png'],
    ['JPEG header without SOS scan data', makeJpegHeaderOnly(), 'image/jpeg'],
    ['JPEG with malformed SOS declaration', (() => { const bytes = makeJpeg(); bytes.set([0x00, 0x02], 23); return bytes; })(), 'image/jpeg'],
    ['JPEG without terminal EOI', makeJpeg().slice(0, -2), 'image/jpeg'],
    ['JPEG with zero SOF width', makeJpeg(0, 100), 'image/jpeg'],
  ] as const)('rejects %s', (_name, bytes, mediaType) => {
    expect(() => readRasterDimensions(bytes, mediaType)).toThrow(InfographicGenerationError);
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
