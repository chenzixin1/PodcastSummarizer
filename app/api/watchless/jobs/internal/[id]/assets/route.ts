import { NextRequest, NextResponse } from 'next/server';
import { recordInternalWatchlessAsset, WATCHLESS_MAX_ASSET_BYTES, type WatchlessAssetRole } from '../../../../../../../lib/watchless/jobs';
import { requireInternalWatchless, watchlessErrorResponse } from '../../../../../../../lib/watchless/api';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = requireInternalWatchless(request);
  if (forbidden) return forbidden;
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > WATCHLESS_MAX_ASSET_BYTES) {
      return NextResponse.json({ success: false, code: 'ASSET_SIZE_LIMIT', error: 'Asset exceeds the 50 MiB limit.' }, { status: 413 });
    }
    const { id } = await params;
    const search = request.nextUrl.searchParams;
    const asset = await recordInternalWatchlessAsset({
      jobId: id,
      assetPath: search.get('path') || '',
      role: (search.get('role') || 'other') as WatchlessAssetRole,
      contentType: request.headers.get('content-type') || 'application/octet-stream',
      expectedSha256: request.headers.get('x-content-sha256') || '',
      bytes: new Uint8Array(await request.arrayBuffer()),
    });
    return NextResponse.json({ success: true, data: asset }, { status: 201 });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
