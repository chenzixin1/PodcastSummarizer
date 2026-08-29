import sampleFixture from './sampleArticle.json';
import { normalizeWatchlessArticle } from './article';

const normalizedSampleArticle = normalizeWatchlessArticle(sampleFixture);

if (!normalizedSampleArticle) {
  throw new Error('Invalid bundled Watchless sample article.');
}

export const sampleWatchlessArticle = normalizedSampleArticle;
