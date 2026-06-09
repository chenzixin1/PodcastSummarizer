import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../lib/adminGuard';
import { listAdminPodcasts } from '../../../../lib/adminData';

function parseInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const params = request.nextUrl.searchParams;
  const result = await listAdminPodcasts({
    query: params.get('q'),
    status: params.get('status'),
    visibility: params.get('visibility'),
    limit: parseInteger(params.get('limit'), 80),
    offset: parseInteger(params.get('offset'), 0),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load podcasts' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
