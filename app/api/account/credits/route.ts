import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { listCreditTransactions } from '../../../../lib/credits';

function parseInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const result = await listCreditTransactions({
    userId: session.user.id,
    limit: parseInteger(params.get('limit'), 80),
    offset: parseInteger(params.get('offset'), 0),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load credits' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
