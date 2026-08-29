import sampleFixture from '../../lib/watchless/sampleArticle.json';
import { normalizeWatchlessArticle } from '../../lib/watchless/article';
import { sampleWatchlessPreview } from '../../lib/watchless/samplePreview';

describe('normalizeWatchlessArticle', () => {
  it('accepts the complete bundled article and preserves all scenes', () => {
    const article = normalizeWatchlessArticle(sampleFixture);

    expect(article).not.toBeNull();
    expect(article?.videoId).toBe('Vv3CEAS_w34');
    expect(article?.scenes).toHaveLength(20);
    expect(article?.scenes[0].keyframe).toMatch(/^\/watchless\//);
    expect(sampleWatchlessPreview.id).toBe(article?.id);
    expect(sampleWatchlessPreview.sceneCount).toBe(article?.scenes.length);
    expect(sampleWatchlessPreview.firstScene.keyframe).toBe(article?.scenes[0].keyframe);
  });

  it('rejects partial articles instead of rendering broken long-form content', () => {
    expect(normalizeWatchlessArticle({ title: 'Incomplete article', scenes: [] })).toBeNull();
  });

  it('rejects an article when any scene has an invalid time range', () => {
    const invalidFixture = JSON.parse(JSON.stringify(sampleFixture)) as typeof sampleFixture;
    invalidFixture.scenes[0].endSec = invalidFixture.scenes[0].startSec;

    expect(normalizeWatchlessArticle(invalidFixture)).toBeNull();
  });

  it('rejects duplicate scene identities and unsafe asset URLs', () => {
    const duplicateFixture = JSON.parse(JSON.stringify(sampleFixture)) as typeof sampleFixture;
    duplicateFixture.scenes[1].id = duplicateFixture.scenes[0].id;
    expect(normalizeWatchlessArticle(duplicateFixture)).toBeNull();

    const unsafeFixture = JSON.parse(JSON.stringify(sampleFixture)) as typeof sampleFixture;
    unsafeFixture.scenes[0].keyframe = 'javascript:alert(1)';
    expect(normalizeWatchlessArticle(unsafeFixture)).toBeNull();
  });
});
