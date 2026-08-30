import { NextRequest, NextResponse } from 'next/server';
import { getWatchlessJob } from '../../../../../../lib/watchless/jobs';
import { requireInternalWatchless, watchlessErrorResponse } from '../../../../../../lib/watchless/api';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = requireInternalWatchless(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const job = await getWatchlessJob(id);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ success: true, data: job });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
