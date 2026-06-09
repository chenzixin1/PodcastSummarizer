import { NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../lib/adminGuard';
import { getAdminOverview } from '../../../../lib/adminData';

export async function GET() {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const result = await getAdminOverview();
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load overview' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
