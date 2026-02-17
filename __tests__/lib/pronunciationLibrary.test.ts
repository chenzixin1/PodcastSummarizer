import { clearPronunciationLibraryCache, getPronunciationAudioUrl } from '../../lib/pronunciationLibrary';

describe('pronunciationLibrary', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    clearPronunciationLibraryCache();
    (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;
  });

  test('loads chunk and caches lookup', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        terrestrial: 'https://blob.example/terrestrial.mp3',
      }),
    });

    const first = await getPronunciationAudioUrl('Terrestrial');
    const second = await getPronunciationAudioUrl('terrestrial');

    expect(first).toBe('https://blob.example/terrestrial.mp3');
    expect(second).toBe('https://blob.example/terrestrial.mp3');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('returns null when chunk misses word', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const url = await getPronunciationAudioUrl('nonexistentword');
    expect(url).toBeNull();
  });

  test('returns null for invalid input', async () => {
    const url = await getPronunciationAudioUrl('@@@');
    expect(url).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
