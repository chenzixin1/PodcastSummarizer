import { projectWatchlessFullText } from '../../lib/watchless/analysisProjection';
import { normalizeFullTextBilingualPayload } from '../../lib/bilingualAlignment';
import type { WatchlessArticle } from '../../lib/watchless/article';

const article = {
  scenes: Array.from({ length: 10 }, (_, index) => ({
    articleZh: `说话人：第 ${index + 1} 场。${'完整正文。'.repeat(600)}`,
    transcriptEn: `Speaker: Original scene ${index + 1}. ${'I do not know yet. '.repeat(250)}`,
    timeLabel: `${index}:00–${index + 1}:00`,
  })),
} as WatchlessArticle;

test('maps the full English and Chinese text into the dashboard field contract', () => {
  const result = projectWatchlessFullText(article);
  expect(result.translation).toBe(article.scenes.map(s => s.transcriptEn).join('\n\n'));
  expect(result.highlights).toBe(article.scenes.map(s => s.articleZh).join('\n\n'));
  expect(result.highlights.length).toBeGreaterThan(22000);
  expect(result.highlights).toContain('第 10 场');
  expect(result.fullTextBilingualJson.pairs).toHaveLength(10);
  expect(normalizeFullTextBilingualPayload(result.fullTextBilingualJson)?.pairs).toHaveLength(10);
});

test('never modifies original article text', () => {
  const original = JSON.stringify(article);
  projectWatchlessFullText(article);
  expect(JSON.stringify(article)).toBe(original);
});

test('rejects oversized analysis rather than silently truncating it', () => {
  expect(() => projectWatchlessFullText({ ...article, scenes: article.scenes.map(s => ({ ...s, articleZh: '文'.repeat(100000) })) }))
    .toThrow('WATCHLESS_ANALYSIS_TOO_LARGE');
});
