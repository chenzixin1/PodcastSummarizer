import { extractLocalTopics } from '../topicExtractor';
import type { WatchlessArticle } from './article';

export function extractWatchlessTopics(article: WatchlessArticle, summary?: { summaryZh: string; summaryEn: string }) {
  return extractLocalTopics({ title: `${article.title} ${article.titleZh || ''}`,
    briefSummary: article.summaryZh, summaryZh: summary?.summaryZh || article.summaryZh,
    summaryEn: summary?.summaryEn || article.summaryEn,
    content: article.scenes.map(scene => [scene.titleZh, scene.transcriptEn, scene.articleZh].filter(Boolean).join('\n')).join('\n'),
  });
}
