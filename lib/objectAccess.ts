import { sql } from './sql';
import { getStoredWatchlessPublication, loadStoredWatchlessArticle } from './watchless/repository';

/** Resolve only persisted, published references. Never grant access by a guessed ID prefix. */
export async function resolveObjectOwner(key: string): Promise<{ userId: string | null; isPublic: boolean } | null> {
  if (!/^[A-Za-z0-9._/-]{1,900}$/.test(key) || key.split('/').some(p => !p || p === '.' || p === '..') ||
      /^(watchless-staging|watchless-runs)\//.test(key)) return null;
  const path = `/api/files/${key}`;
  const url = `${(process.env.NEXTAUTH_URL || 'https://podsum.cc').replace(/\/$/, '')}${path}`;
  const direct = await sql<{ userId: string | null; isPublic: boolean | number }>`
    SELECT p.user_id as "userId", p.is_public as "isPublic" FROM podcasts p
    WHERE p.blob_url IN (${path}, ${url}, ${key})
       OR EXISTS (SELECT 1 FROM infographic_jobs i WHERE i.podcast_id = p.id
         AND i.status = 'completed' AND i.artifact_url IN (${path}, ${url})) LIMIT 1
  `;
  const owner = direct.rows[0];
  if (owner) return { userId: owner.userId, isPublic: owner.isPublic === true || owner.isPublic === 1 };
  const match = /^watchless\/([A-Za-z0-9_-]{11})\//.exec(key);
  if (!match) return null;
  const result = await sql<{ id: string; userId: string | null; isPublic: boolean | number }>`
    SELECT p.id, p.user_id as "userId", p.is_public as "isPublic" FROM podcasts p
    JOIN watchless_publications w ON w.podcast_id = p.id
    WHERE w.video_id = ${match[1]} AND w.status = 'published' LIMIT 1
  `;
  const row = result.rows[0];
  if (!row) return null;
  const publication = await getStoredWatchlessPublication(row.id);
  if (!publication) return null;
  if (key !== publication.articleKey) {
    const article = await loadStoredWatchlessArticle(publication);
    const refs = [article.pdfUrl, ...article.scenes.map(scene => scene.keyframe)];
    if (!refs.some(ref => ref === path || ref === url)) return null;
  }
  return { userId: row.userId, isPublic: row.isPublic === true || row.isPublic === 1 };
}
