/**
 * @jest-environment node
 */

const mockGetCloudflareContext = jest.fn();

jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mockGetCloudflareContext,
}));

describe('objectStorage', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it('verifies an R2 object is readable before returning a successful upload', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: 'application/x-subrip' },
    });

    mockGetCloudflareContext.mockResolvedValue({
      env: {
        PODSUM_BUCKET: {
          put,
          get,
          delete: jest.fn(),
        },
        NEXTAUTH_URL: 'https://podsum.cc',
      },
    });

    const { uploadObject } = await import('../../lib/objectStorage');
    const result = await uploadObject('podcast 123/test.srt', 'hello', {
      contentType: 'application/x-subrip',
    });

    expect(put).toHaveBeenCalledWith(
      'podcast_123/test.srt',
      'hello',
      expect.objectContaining({
        httpMetadata: { contentType: 'application/x-subrip' },
      }),
    );
    expect(get).toHaveBeenCalledWith('podcast_123/test.srt');
    expect(result).toEqual({
      key: 'podcast_123/test.srt',
      provider: 'r2',
      url: 'https://podsum.cc/api/files/podcast_123/test.srt',
    });
  });

  it('fails the upload when R2 write verification cannot read the object', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockResolvedValue(null);

    mockGetCloudflareContext.mockResolvedValue({
      env: {
        PODSUM_BUCKET: {
          put,
          get,
          delete: jest.fn(),
        },
        NEXTAUTH_URL: 'https://podsum.cc',
      },
    });

    const { uploadObject } = await import('../../lib/objectStorage');

    await expect(uploadObject('missing.srt', 'hello')).rejects.toThrow(
      'Object storage write verification failed for key: missing.srt',
    );
    expect(put).toHaveBeenCalledWith(
      'missing.srt',
      'hello',
      expect.objectContaining({
        httpMetadata: { contentType: undefined },
      }),
    );
    expect(get).toHaveBeenCalledWith('missing.srt');
  });

  it('rejects foreign URLs before making a request or reading a local object', async () => {
    const get = jest.fn();
    mockGetCloudflareContext.mockResolvedValue({ env: { PODSUM_BUCKET: { get }, NEXTAUTH_URL: 'https://podsum.cc' } });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { getObjectText } = await import('../../lib/objectStorage');
    for (const url of ['https://evil.invalid/api/files/private.txt', 'http://127.0.0.1/private', 'https://example.com/data', 'https://user:password@a.public.blob.vercel-storage.com/a']) {
      await expect(getObjectText(url)).rejects.toThrow('Untrusted');
    }
    expect(get).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reads canonical URLs and rejects streamed objects over the 8 MiB budget', async () => {
    const get = jest.fn().mockResolvedValueOnce({ body: new Response('原话 original').body })
      .mockResolvedValueOnce({ body: new Response(new Uint8Array(8 * 1024 * 1024 + 1)).body });
    mockGetCloudflareContext.mockResolvedValue({ env: { PODSUM_BUCKET: { get }, NEXTAUTH_URL: 'https://podsum.cc' } });
    const { getObjectText } = await import('../../lib/objectStorage');
    await expect(getObjectText('https://podsum.cc/api/files/source.txt')).resolves.toBe('原话 original');
    expect(get).toHaveBeenCalledWith('source.txt');
    await expect(getObjectText('too-large.txt')).rejects.toThrow('size limit');
  });
});
