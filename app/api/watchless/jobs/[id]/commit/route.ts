import { NextRequest, NextResponse } from 'next/server';
import { getOwnedWatchlessJob, updateWatchlessJobStatus, validateWatchlessBundle } from '../../../../../../lib/watchless/jobs';
import { requireWatchlessUser, watchlessErrorResponse } from '../../../../../../lib/watchless/api';
import { startWatchlessWorkflow } from '../../../../../../lib/watchless/workflow';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWatchlessUser(request, 'watchless:publish');
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const job = await getOwnedWatchlessJob(id, auth.userId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 });
    if (job.status === 'completed' || (job.status === 'queued' && job.workflowInstanceId)) {
      return NextResponse.json({ success: true, data: job }, { status: 202 });
    }
    if (job.status !== 'awaiting_upload') {
      return NextResponse.json({ success: false, code: 'JOB_NOT_COMMITTABLE', error: `Job is ${job.status}.` }, { status: 409 });
    }
    await validateWatchlessBundle(id);
    await updateWatchlessJobStatus({ jobId: id, status: 'queued', stage: 'queued', progressCurrent: 5, progressTotal: 100 });
    let workflowInstanceId: string;
    try {
      workflowInstanceId = await startWatchlessWorkflow(id, 'publish');
    } catch (error) {
      await updateWatchlessJobStatus({
        jobId: id,
        status: 'awaiting_upload',
        stage: 'awaiting_upload',
        progressCurrent: 0,
        progressTotal: 100,
        errorCode: 'WORKFLOW_START_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return NextResponse.json({ success: true, data: { jobId: id, workflowInstanceId } }, { status: 202 });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
