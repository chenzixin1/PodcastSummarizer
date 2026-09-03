import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '../../../../../../../lib/objectStorage';
import { getOwnedWatchlessJob, listWatchlessJobAssets } from '../../../../../../../lib/watchless/jobs';
import { requireWatchlessUser, watchlessErrorResponse } from '../../../../../../../lib/watchless/api';

function downloadName(assetPath: string): string {
  const name = assetPath.split('/').filter(Boolean).pop() || 'watchless-artifact';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160) || 'watchless-artifact';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const auth = await requireWatchlessUser(request, ['watchless:submit', 'watchless:publish']);
  if (!('userId' in auth)) return auth;
  try {
    const { id, assetId } = await params;
    const job = await getOwnedWatchlessJob(id, auth.userId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 });
    const asset = (await listWatchlessJobAssets(id)).find((item) => item.id === assetId);
    if (!asset) return NextResponse.json({ success: false, error: 'Artifact not found.' }, { status: 404 });
    const stored = await getObject(asset.objectKey);
    if (!stored.ok || !stored.body) {
      return NextResponse.json({ success: false, error: 'Artifact bytes are no longer available.' }, { status: 404 });
    }
    const headers = new Headers(stored.headers);
    headers.set('Content-Type', asset.contentType);
    headers.set('Content-Length', String(asset.sizeBytes));
    headers.set('Content-Disposition', `attachment; filename="${downloadName(asset.assetPath)}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(stored.body, { headers });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
