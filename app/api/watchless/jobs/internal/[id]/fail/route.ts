import { NextRequest, NextResponse } from 'next/server';
import { failWatchlessJob } from '../../../../../../../lib/watchless/jobs';
import { requireInternalWatchless, watchlessErrorResponse } from '../../../../../../../lib/watchless/api';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = requireInternalWatchless(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : 'WATCHLESS_RUNTIME_FAILED';
    const message = typeof body.message === 'string' ? body.message : 'Watchless runtime failed.';
    return NextResponse.json({ success: true, data: await failWatchlessJob(id, code, message) });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
