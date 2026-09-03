import { NextRequest, NextResponse } from 'next/server';
import { failWatchlessJob, retryWatchlessUrlJob } from '../../../../../../lib/watchless/jobs';
import { requireWatchlessUser, watchlessErrorResponse } from '../../../../../../lib/watchless/api';
import { startWatchlessWorkflow } from '../../../../../../lib/watchless/workflow';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWatchlessUser(request, 'watchless:submit');
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const job = await retryWatchlessUrlJob(id, auth.userId);
    try {
      const workflowInstanceId = await startWatchlessWorkflow(job.id, 'url', { uniqueAttempt: true });
      return NextResponse.json({ success: true, data: { ...job, workflowInstanceId } }, { status: 202 });
    } catch (error) {
      await failWatchlessJob(job.id, 'WORKFLOW_RETRY_START_FAILED', error instanceof Error ? error.message : String(error));
      throw error;
    }
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
