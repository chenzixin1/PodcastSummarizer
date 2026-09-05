/** @jest-environment node */
import { mapSceneKeyframes, validateOriginalSource } from '../../lib/watchless/bundleIntegrity';
import { sampleWatchlessArticle } from '../../lib/watchless/sample';

describe('Watchless source and frame integrity', () => {
  const article = { ...sampleWatchlessArticle, transcriptEnKind: 'original' as const,
    scenes: sampleWatchlessArticle.scenes.slice(0, 2).map((scene, i) => ({ ...scene,
      transcriptEn: `Speaker: exact statement ${i}.`, sourceTranscript: `Speaker: exact statement ${i}.`,
      keyframe: `/api/files/watchless/${sampleWatchlessArticle.videoId}/keyframes/scene_${i === 0 ? 2 : 10}.jpg` })) };
  test('binds by reference, not lexical order or extra covers', () => {
    const frames = [{ assetPath: 'cover.jpg' }, { assetPath: 'keyframes/scene_10.jpg' }, { assetPath: 'keyframes/scene_2.jpg' }];
    expect(mapSceneKeyframes(article, frames)).toEqual([frames[2], frames[1]]);
  });
  test('rejects missing and reused frames', () => {
    expect(() => mapSceneKeyframes(article, [])).toThrow('KEYFRAME_REFERENCE_INVALID');
    expect(() => mapSceneKeyframes({ ...article, scenes: [article.scenes[0], article.scenes[0]] }, [{ assetPath: 'keyframes/scene_2.jpg' }])).toThrow();
  });
  test('preserves the exact source with a stable hash', () => {
    const source = article.scenes.map(scene => scene.sourceTranscript).join('\n\n');
    expect(validateOriginalSource(article, source).text).toBe(source);
    expect(validateOriginalSource(article, source).sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateOriginalSource(article, `${source} extra`)).toThrow('TRANSCRIPT_ARTICLE_MISMATCH');
  });
  test('rejects rewritten original words even if languages are valid', () => {
    expect(() => validateOriginalSource({ ...article, scenes: [{ ...article.scenes[0], transcriptEn: 'Speaker: rewritten.' }] })).toThrow('ORIGINAL_TEXT_MISMATCH');
  });
});
