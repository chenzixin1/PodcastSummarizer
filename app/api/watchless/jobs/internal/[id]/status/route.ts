import { NextRequest, NextResponse } from 'next/server';
import { updateWatchlessJobStatus, type WatchlessJobStatus } from '../../../../../../../lib/watchless/jobs';
import { requireInternalWatchless, watchlessErrorResponse } from '../../../../../../../lib/watchless/api';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = requireInternalWatchless(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const status = String(body.status || 'preparing') as WatchlessJobStatus;
    if (!['preparing', 'transcribing', 'segmenting', 'rendering', 'validating'].includes(status)) {
      return NextResponse.json({ success: false, code: 'INVALID_RUNTIME_STATUS', error: 'Runtime status is not allowed.' }, { status: 422 });
    }
    const data = await updateWatchlessJobStatus({
      jobId: id,
      status,
      stage: typeof body.stage === 'string' ? body.stage : undefined,
      progressCurrent: Number(body.progressCurrent || 0),
      progressTotal: Number(body.progressTotal || 100),
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
