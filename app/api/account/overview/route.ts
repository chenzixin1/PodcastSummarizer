import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { getAccountCreditOverview } from '../../../../lib/credits';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const result = await getAccountCreditOverview(session.user.id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load account' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
