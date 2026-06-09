import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../../../lib/adminGuard';
import { adjustUserCredits } from '../../../../../../lib/credits';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const delta = Number(body?.delta);
  const reason = String(body?.reason || 'admin_adjustment').trim().slice(0, 80) || 'admin_adjustment';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

  if (!Number.isFinite(delta) || Math.trunc(delta) === 0) {
    return NextResponse.json({ success: false, error: 'delta must be a non-zero number' }, { status: 400 });
  }

  const result = await adjustUserCredits({
    userId: id,
    delta: Math.trunc(delta),
    reason,
    source: 'admin_users',
    createdBy: admin.email,
    note,
  });

  if (!result.success) {
    const status = result.errorCode === 'USER_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ success: false, error: result.error || 'Failed to adjust credits' }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
