import type { WatchlessArticle } from './article';
import { sampleWatchlessPreview } from './samplePreview';

export interface WatchlessPublication {
  podcastId: string;
  videoId: string;
  articleMeta: {
    sceneCount: number;
    durationLabel: string;
  };
  loadArticle: () => Promise<WatchlessArticle>;
}

const samAltmanPublication: WatchlessPublication = {
  podcastId: sampleWatchlessPreview.id,
  videoId: sampleWatchlessPreview.videoId,
  articleMeta: sampleWatchlessPreview,
  loadArticle: async () => {
    const { sampleWatchlessArticle } = await import('./sample');
    return sampleWatchlessArticle;
  },
};

const PUBLICATIONS = [samAltmanPublication] as const;

export function findWatchlessPublication(
  podcastId: string,
  videoId?: string | null,
): WatchlessPublication | null {
  return PUBLICATIONS.find((publication) => (
    publication.podcastId === podcastId || publication.videoId === videoId
  )) || null;
}
