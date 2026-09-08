import { createHash } from 'node:crypto';
import type { WatchlessArticle } from './article';

type Frame = { assetPath: string };
export function mapSceneKeyframes<T extends Frame>(article: WatchlessArticle, assets: T[]): T[] {
  const prefix = `/api/files/watchless/${article.videoId}/`;
  const used = new Set<string>();
  return article.scenes.map(scene => {
    const path = scene.keyframe.startsWith('https://') ? new URL(scene.keyframe).pathname : scene.keyframe;
    const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\//, '');
    const matches = assets.filter(asset => asset.assetPath === relative);
    if (matches.length !== 1 || used.has(relative)) throw new Error(`KEYFRAME_REFERENCE_INVALID: ${scene.id}`);
    used.add(relative);
    return matches[0];
  });
}

export function canonicalWatchlessSource(article: WatchlessArticle): string {
  return article.scenes.map(scene => {
    const source = scene.sourceTranscript || (article.transcriptEnKind !== 'translation' ? scene.transcriptEn :
      article.articleZhKind === 'original' ? scene.articleZh : '');
    if (!source.trim()) throw new Error(`ORIGINAL_SOURCE_MISSING: ${scene.id}`);
    return source;
  }).join('\n\n');
}

// Formatting can change, words cannot. Speaker labels remain part of the source.
function normalizedWords(text: string): string {
  return text.replace(/^\d+\s*$/gm, '').replace(/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->.*$/gm, '')
    .replace(/[*_#]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

export function validateOriginalSource(article: WatchlessArticle, transcript?: string): { text: string; sha256: string } {
  const text = canonicalWatchlessSource(article);
  if (article.transcriptEnKind === 'original') {
    for (const scene of article.scenes) {
      if (scene.sourceTranscript && normalizedWords(scene.sourceTranscript) !== normalizedWords(scene.transcriptEn)) {
        throw new Error(`ORIGINAL_TEXT_MISMATCH: ${scene.id}`);
      }
    }
  }
  if (transcript && normalizedWords(text) !== normalizedWords(transcript)) throw new Error('TRANSCRIPT_ARTICLE_MISMATCH');
  return { text, sha256: createHash('sha256').update(text).digest('hex') };
}
