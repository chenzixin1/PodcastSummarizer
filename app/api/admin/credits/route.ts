import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../lib/adminGuard';
import { adjustUserCredits, listCreditTransactions } from '../../../../lib/credits';

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
  const result = await listCreditTransactions({
    userId: params.get('userId'),
    query: params.get('q'),
    limit: parseInteger(params.get('limit'), 80),
    offset: parseInteger(params.get('offset'), 0),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load credits' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body?.userId || '').trim();
  const delta = Number(body?.delta);
  const reason = String(body?.reason || 'admin_adjustment').trim().slice(0, 80) || 'admin_adjustment';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
  }
  if (!Number.isFinite(delta) || Math.trunc(delta) === 0) {
    return NextResponse.json({ success: false, error: 'delta must be a non-zero number' }, { status: 400 });
  }

  const result = await adjustUserCredits({
    userId,
    delta: Math.trunc(delta),
    reason,
    source: 'admin_credits',
    createdBy: admin.email,
    note,
  });

  if (!result.success) {
    const status = result.errorCode === 'USER_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ success: false, error: result.error || 'Failed to adjust credits' }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
