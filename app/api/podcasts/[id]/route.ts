import { NextRequest, NextResponse } from 'next/server';
import { updatePodcastPublicStatus } from '../../../../lib/db';

export async function PATCH(request: NextRequest, context: any) {
  const { id } = context.params;
  try {
    const body = await request.json();
    if (typeof body.isPublic !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Missing or invalid isPublic' }, { status: 400 });
    }
    const result = await updatePodcastPublicStatus(id, body.isPublic);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
} 