import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../../lib/auth';
import { getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import {
  getStoredWatchlessPublication,
  loadStoredWatchlessArticle,
} from '../../../../lib/watchless/repository';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing podcast ID.' }, { status: 400 });
    }

    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      return NextResponse.json({ success: false, error: 'Podcast not found.' }, { status: 404 });
    }

    const podcast = podcastResult.data as { isPublic?: boolean; userId?: string | null };
    if (!podcast.isPublic) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
      }
      const ownership = await verifyPodcastOwnership(id, session.user.id);
      if (!ownership.success) {
        return NextResponse.json({ success: false, error: 'Access denied.' }, { status: 403 });
      }
    }

    const publication = await getStoredWatchlessPublication(id);
    if (!publication) {
      return NextResponse.json({ success: false, error: 'Watchless publication not found.' }, { status: 404 });
    }

    const baseData = {
      podcastId: publication.podcastId,
      videoId: publication.videoId,
      articleMeta: {
        sceneCount: publication.sceneCount,
        durationLabel: publication.durationLabel,
        hasEnglishTranscript: publication.hasEnglishTranscript,
      },
    };
    const cacheControl = 'private, no-store';
    const successResponse = (data: Record<string, unknown>) => {
      const response = NextResponse.json({ success: true, data });
      response.headers.set('Cache-Control', cacheControl);
      return response;
    };

    if (request.nextUrl.searchParams.get('meta') === '1') {
      return successResponse(baseData);
    }

    const article = await loadStoredWatchlessArticle(publication);
    return successResponse({ ...baseData, article });
  } catch (error) {
    console.error('[watchless publication] load failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error.' },
      { status: 500 },
    );
  }
}
