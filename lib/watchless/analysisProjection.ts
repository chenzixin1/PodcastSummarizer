import type { WatchlessArticle } from './article';
import type { FullTextBilingualPayload } from '../bilingualAlignment';

/** Map article text to PodSum's legacy field names without summarizing it.
 * `translation` is the English Full Text; `highlights` is the Chinese Full Text.
 * Alignment is by scene, not an unverified sentence-level match.
 */
export function projectWatchlessFullText(article: WatchlessArticle) {
  const pairs = article.scenes.map((scene, index) => ({
    order: index,
    en: scene.transcriptEn,
    zh: scene.articleZh,
    enTimestamp: scene.timeLabel,
    zhTimestamp: scene.timeLabel,
    matchMethod: 'section_index' as const,
    confidence: 1,
  }));
  const fullTextBilingualJson: FullTextBilingualPayload = {
    version: 1,
    pairs,
    stats: { total: pairs.length, matched: pairs.length, llmMatched: 0, unmatched: 0,
      methods: { section_index: pairs.length } },
    generatedAt: new Date().toISOString(),
  };
  const result = {
    translation: pairs.map(pair => pair.en).join('\n\n'),
    highlights: pairs.map(pair => pair.zh).join('\n\n'),
    fullTextBilingualJson,
  };
  // Leave room for summary and other columns under D1's per-row size limit.
  // A large source must fail explicitly, never silently lose its final scenes.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1_500_000) {
    throw new Error('WATCHLESS_ANALYSIS_TOO_LARGE: full text exceeds the analysis row budget');
  }
  return result;
}
