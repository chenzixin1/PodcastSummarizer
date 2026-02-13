import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import { enqueueProcessingJob } from '../../../../lib/processingJobs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const id = body?.id as string | undefined;
    const force = Boolean(body?.force);

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing podcast id' }, { status: 400 });
    }

    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      return NextResponse.json({ success: false, error: 'Podcast not found' }, { status: 404 });
    }

    const ownershipResult = await verifyPodcastOwnership(id, session.user.id);
    if (!ownershipResult.success) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    if (!force) {
      const analysisResult = await getAnalysisResults(id);
      if (analysisResult.success) {
        return NextResponse.json({
          success: true,
          data: {
            skipped: true,
            reason: 'already_processed',
            message: 'Analysis already exists'
          }
        });
      }
    }

    const enqueueResult = await enqueueProcessingJob(id);
    if (!enqueueResult.success) {
      return NextResponse.json({ success: false, error: enqueueResult.error || 'Failed to enqueue job' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        job: enqueueResult.data
      }
    });
  } catch (error) {
    console.error('Failed to enqueue process job:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
