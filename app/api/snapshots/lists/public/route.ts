import { NextRequest, NextResponse } from 'next/server';
import {
  PUBLIC_LIST_SNAPSHOT_CACHE_CONTROL,
  getPublicListSnapshot,
  normalizePage,
  normalizePageSize,
} from '../../../../../lib/staticSnapshots';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawPage = Number.parseInt(String(searchParams.get('page') || ''), 10);
    const rawPageSize = Number.parseInt(String(searchParams.get('pageSize') || ''), 10);
    const page = normalizePage(rawPage);
    const pageSize = normalizePageSize(rawPageSize);

    const snapshot = await getPublicListSnapshot(page, pageSize);
    if (!snapshot) {
      const response = NextResponse.json(
        {
          success: false,
          data: null,
          snapshot: null,
          error: 'Static public list snapshot not found',
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
          page: snapshot.page,
          pageSize: snapshot.pageSize,
        },
      },
    );
    response.headers.set('Cache-Control', PUBLIC_LIST_SNAPSHOT_CACHE_CONTROL);
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
