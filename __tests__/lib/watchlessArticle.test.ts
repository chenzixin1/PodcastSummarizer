import sampleFixture from '../../lib/watchless/sampleArticle.json';
import {
  extractDialogueSpeakerLabels,
  formatDialogueTurns,
  normalizeWatchlessArticle,
} from '../../lib/watchless/article';
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
    expect(article?.availableLanguageModes).toEqual(['zh', 'en', 'bilingual', 'hint']);
  });

  it('supports Chinese-only publications without exposing fake English modes', () => {
    const chineseFixture = JSON.parse(JSON.stringify(sampleFixture)) as Record<string, unknown>;
    chineseFixture.transcriptLanguage = 'zh';
    chineseFixture.availableLanguageModes = ['zh'];

    const article = normalizeWatchlessArticle(chineseFixture);
    expect(article?.transcriptLanguage).toBe('zh');
    expect(article?.availableLanguageModes).toEqual(['zh']);
  });

  it('preserves the verbatim body contract for original-word publications', () => {
    const verbatimFixture = JSON.parse(JSON.stringify(sampleFixture)) as Record<string, unknown>;
    verbatimFixture.bodyMode = 'verbatim';
    verbatimFixture.transcriptLanguage = 'other';
    verbatimFixture.availableLanguageModes = ['zh'];

    const article = normalizeWatchlessArticle(verbatimFixture);
    expect(article?.bodyMode).toBe('verbatim');
    expect(article?.transcriptLanguage).toBe('other');
    expect(article?.availableLanguageModes).toEqual(['zh']);
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

  it('puts every recurring speaker turn on its own markdown paragraph', () => {
    const speakerLabels = extractDialogueSpeakerLabels(
      sampleFixture.scenes.map((scene) => scene.articleZh),
    );
    const firstScene = sampleFixture.scenes[0].articleZh;
    const formatted = formatDialogueTurns(firstScene, speakerLabels);
    const speakerTurns = [...formatted.matchAll(/\*\*(Ti Morse|Sam Altman)：\*\*/g)];

    expect(speakerLabels).toEqual(['Sam Altman', 'Ti Morse']);
    expect(speakerTurns.length).toBeGreaterThan(4);
    for (const turn of speakerTurns) {
      expect(turn.index === 0 || formatted.slice(turn.index - 2, turn.index) === '\n\n').toBe(true);
    }
  });

  it('does not split a one-off bold editorial label as a speaker', () => {
    const markdown = '**Ti Morse：** 问题。**Sam Altman：** 回答。\n\n**关键是：** 保持上下文。';
    const speakers = extractDialogueSpeakerLabels([markdown, '**Ti Morse：** 追问。**Sam Altman：** 再回答。']);
    const formatted = formatDialogueTurns(markdown, speakers);

    expect(formatted).toContain('回答。\n\n**关键是：** 保持上下文。');
  });

  it('normalizes legacy bold-name dialogue labels and separates turns', () => {
    const markdown = '**曹卿云**：问题。**林杰屏**：回答。';
    const speakers = extractDialogueSpeakerLabels([
      markdown,
      '**曹卿云**：追问。**林杰屏**：继续回答。',
    ]);

    expect(speakers).toEqual(['曹卿云', '林杰屏']);
    expect(formatDialogueTurns(markdown, speakers)).toBe(
      '**曹卿云：**问题。\n\n**林杰屏：**回答。',
    );
  });
});
