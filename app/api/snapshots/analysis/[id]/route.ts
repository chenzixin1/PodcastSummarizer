import { NextRequest, NextResponse } from 'next/server';
import {
  getAnalysisSnapshot,
} from '../../../../../lib/staticSnapshots';
import { getPodcast } from '../../../../../lib/db';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    if (!id) {
      const response = NextResponse.json(
        {
          success: false,
          error: 'Missing ID parameter',
        },
        { status: 400 },
      );
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    const current = await getPodcast(id);
    if (!current.success || !(current.data as { isPublic?: boolean })?.isPublic) {
      return NextResponse.json({ success: false, data: null }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const snapshot = await getAnalysisSnapshot(id);
    if (!snapshot) {
      const response = NextResponse.json(
        {
          success: false,
          data: null,
          snapshot: null,
          error: 'Static analysis snapshot not found',
        },
      );
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    const response = NextResponse.json(
      {
        success: true,
        data: snapshot.data,
        snapshot: {
          version: snapshot.snapshotVersion,
          generatedAt: snapshot.generatedAt,
        },
      },
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
