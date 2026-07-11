import { getPodcast, type Podcast } from './db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth';

export type InfographicAccessResult =
  | { ok: true; podcast: Podcast; canEdit: boolean }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/** Resolve the same public/private policy used by the analysis endpoint. */
export async function resolveInfographicAccess(id: string): Promise<InfographicAccessResult> {
  if (!id) {
    return { ok: false, status: 400, error: 'Missing ID parameter' };
  }

  const podcastResult = await getPodcast(id);
  if (!podcastResult.success || !podcastResult.data) {
    return { ok: false, status: 404, error: 'Podcast not found' };
  }

  const podcast = podcastResult.data as Podcast;
  const session = await getServerSession(authOptions);
  const canEdit = Boolean(session?.user?.id && session.user.id === podcast.userId);

  if (!podcast.isPublic) {
    if (!session?.user?.id) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }
    if (!canEdit) {
      return { ok: false, status: 403, error: 'Access denied' };
    }
  }

  return { ok: true, podcast, canEdit };
}
