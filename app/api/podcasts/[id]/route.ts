import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { getPodcast, updatePodcastMetadata, verifyPodcastOwnership } from '../../../../lib/db';

interface PatchBody {
  isPublic?: boolean;
  sourceReference?: string | null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      return NextResponse.json({ success: false, error: 'Podcast not found' }, { status: 404 });
    }

    const ownershipResult = await verifyPodcastOwnership(id, session.user.id);
    if (!ownershipResult.success) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const body = (await request.json()) as PatchBody;
    const hasIsPublicUpdate = typeof body.isPublic === 'boolean';
    const hasSourceReferenceUpdate = Object.prototype.hasOwnProperty.call(body, 'sourceReference');

    if (!hasIsPublicUpdate && !hasSourceReferenceUpdate) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update (isPublic/sourceReference)' },
        { status: 400 }
      );
    }

    if (
      hasSourceReferenceUpdate &&
      body.sourceReference !== null &&
      typeof body.sourceReference !== 'string'
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid sourceReference, expected string or null' },
        { status: 400 }
      );
    }

    const normalizedSourceReference = hasSourceReferenceUpdate
      ? ((body.sourceReference || '').trim().slice(0, 2048) || null)
      : undefined;

    const result = await updatePodcastMetadata(id, {
      isPublic: hasIsPublicUpdate ? body.isPublic : undefined,
      sourceReference: normalizedSourceReference,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
} 
