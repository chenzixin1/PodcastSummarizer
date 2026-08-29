import type { WatchlessArticle } from './article';
import { sampleWatchlessPreview } from './samplePreview';

export interface WatchlessPublication {
  podcastId: string;
  videoId: string;
  articleMeta: {
    sceneCount: number;
    durationLabel: string;
    hasEnglishTranscript?: boolean;
  };
  loadArticle: () => Promise<WatchlessArticle>;
}

interface WatchlessPublicationApiPayload {
  success?: boolean;
  data?: {
    podcastId?: string;
    videoId?: string;
    articleMeta?: {
      sceneCount?: number;
      durationLabel?: string;
      hasEnglishTranscript?: boolean;
    };
    article?: unknown;
  };
  error?: string;
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

async function readPublicationResponse(response: Response): Promise<WatchlessPublicationApiPayload> {
  const payload = await response.json().catch(() => null) as WatchlessPublicationApiPayload | null;
  if (!payload) {
    throw new Error(`Watchless publication API returned an invalid response (${response.status}).`);
  }
  return payload;
}

export async function fetchWatchlessPublication(
  podcastId: string,
): Promise<WatchlessPublication | null> {
  const encodedId = encodeURIComponent(podcastId);
  const response = await fetch(`/api/watchless/${encodedId}?meta=1`);
  if (response.status === 404) {
    return null;
  }
  const payload = await readPublicationResponse(response);
  const data = payload.data;
  const sceneCount = Number(data?.articleMeta?.sceneCount);
  const durationLabel = String(data?.articleMeta?.durationLabel || '').trim();
  const videoId = String(data?.videoId || '').trim();
  const responseOk = typeof response.ok === 'boolean'
    ? response.ok
    : response.status >= 200 && response.status < 300;
  if (!responseOk || !payload.success || !data?.podcastId || !videoId || !durationLabel || !Number.isInteger(sceneCount) || sceneCount < 1) {
    throw new Error(payload.error || `Watchless publication metadata is incomplete (${response.status}): ${JSON.stringify({
      ok: response.ok,
      success: payload.success,
      podcastId: data?.podcastId,
      videoId,
      durationLabel,
      sceneCount,
    })}`);
  }

  return {
    podcastId: data.podcastId,
    videoId,
    articleMeta: {
      sceneCount,
      durationLabel,
      hasEnglishTranscript: data.articleMeta?.hasEnglishTranscript !== false,
    },
    loadArticle: async () => {
      const articleResponse = await fetch(`/api/watchless/${encodedId}`);
      const articlePayload = await readPublicationResponse(articleResponse);
      const articleResponseOk = typeof articleResponse.ok === 'boolean'
        ? articleResponse.ok
        : articleResponse.status >= 200 && articleResponse.status < 300;
      if (!articleResponseOk || !articlePayload.success || !articlePayload.data?.article) {
        throw new Error(articlePayload.error || `Watchless article could not be loaded (${articleResponse.status}).`);
      }
      const { normalizeWatchlessArticle } = await import('./article');
      const article = normalizeWatchlessArticle(articlePayload.data.article);
      if (!article) {
        throw new Error('Watchless article data failed validation.');
      }
      return article;
    },
  };
}
