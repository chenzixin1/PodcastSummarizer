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
});
