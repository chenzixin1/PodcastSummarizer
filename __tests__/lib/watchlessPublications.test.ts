import {
  fetchWatchlessPublication,
  findWatchlessPublication,
} from '../../lib/watchless/publications';
import sampleFixture from '../../lib/watchless/sampleArticle.json';

describe('Watchless publication registry', () => {
  test('links the bundled article to the standard podcast record', async () => {
    const publication = findWatchlessPublication('watchless-vv3ceas-w34');

    expect(publication).not.toBeNull();
    expect(publication?.videoId).toBe('Vv3CEAS_w34');
    await expect(publication?.loadArticle()).resolves.toMatchObject({
      id: 'watchless-vv3ceas-w34',
      videoId: 'Vv3CEAS_w34',
      scenes: expect.arrayContaining([
        expect.objectContaining({ id: 'scene-01' }),
        expect.objectContaining({ id: 'scene-20' }),
      ]),
    });
  });

  test('also resolves by YouTube video id without affecting unrelated podcasts', () => {
    expect(findWatchlessPublication('legacy-record', 'Vv3CEAS_w34')?.podcastId)
      .toBe('watchless-vv3ceas-w34');
    expect(findWatchlessPublication('ordinary-podcast', 'unrelated-video')).toBeNull();
  });

  test('loads data-driven publication metadata and article content from the API', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('?meta=1')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            podcastId: 'watchless-remote-video',
            videoId: 'remoteVideo1',
            articleMeta: {
              sceneCount: 20,
              durationLabel: '1 小时 09 分',
              hasEnglishTranscript: true,
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true,
        data: { article: sampleFixture },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    global.fetch = fetchMock;

    const publication = await fetchWatchlessPublication('watchless-remote-video');
    expect(publication?.articleMeta).toEqual({
      sceneCount: 20,
      durationLabel: '1 小时 09 分',
      hasEnglishTranscript: true,
    });
    await expect(publication?.loadArticle()).resolves.toMatchObject({
      videoId: 'Vv3CEAS_w34',
      scenes: expect.any(Array),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/watchless/watchless-remote-video?meta=1');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/watchless/watchless-remote-video');
    global.fetch = originalFetch;
  });

  test('returns null when a podcast has no Watchless publication', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValueOnce(new Response('{}', { status: 404 }));
    global.fetch = fetchMock;
    await expect(fetchWatchlessPublication('ordinary-podcast')).resolves.toBeNull();
    global.fetch = originalFetch;
  });
});
