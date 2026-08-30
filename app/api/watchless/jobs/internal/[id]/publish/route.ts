import { NextRequest, NextResponse } from 'next/server';
import { publishWatchlessJob } from '../../../../../../../lib/watchless/jobs';
import { requireInternalWatchless, watchlessErrorResponse } from '../../../../../../../lib/watchless/api';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = requireInternalWatchless(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    return NextResponse.json({ success: true, data: await publishWatchlessJob(id) });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
