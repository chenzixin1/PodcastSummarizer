import { getObjectText } from '../objectStorage';
import { sql } from '../sql';
import { normalizeWatchlessArticle, type WatchlessArticle } from './article';

export interface StoredWatchlessPublication {
  podcastId: string;
  videoId: string;
  articleKey: string;
  sceneCount: number;
  durationLabel: string;
  hasEnglishTranscript: boolean;
}

export async function getStoredWatchlessPublication(
  podcastId: string,
): Promise<StoredWatchlessPublication | null> {
  let result;
  try {
    result = await sql<{
      podcastId: string;
      videoId: string;
      articleKey: string;
      sceneCount: number;
      durationLabel: string;
      hasEnglishTranscript: boolean;
    }>`
      SELECT
        podcast_id as "podcastId",
        video_id as "videoId",
        article_key as "articleKey",
        scene_count as "sceneCount",
        duration_label as "durationLabel",
        has_english_transcript as "hasEnglishTranscript"
      FROM watchless_publications
      WHERE podcast_id = ${podcastId}
        AND status = 'published'
      LIMIT 1
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|does not exist/i.test(message)) return null;
    throw error;
  }

  const row = result.rows[0];
  if (!row) return null;
  return {
    podcastId: String(row.podcastId),
    videoId: String(row.videoId),
    articleKey: String(row.articleKey),
    sceneCount: Number(row.sceneCount),
    durationLabel: String(row.durationLabel),
    hasEnglishTranscript: Boolean(row.hasEnglishTranscript),
  };
}

export async function loadStoredWatchlessArticle(
  publication: StoredWatchlessPublication,
): Promise<WatchlessArticle> {
  const raw = await getObjectText(publication.articleKey);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Stored Watchless article is not valid JSON.');
  }
  const article = normalizeWatchlessArticle(value);
  if (!article || article.id !== publication.podcastId || article.videoId !== publication.videoId) {
    throw new Error('Stored Watchless article failed validation.');
  }
  return article;
}
