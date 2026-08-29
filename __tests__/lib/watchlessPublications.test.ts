import { findWatchlessPublication } from '../../lib/watchless/publications';

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
});
