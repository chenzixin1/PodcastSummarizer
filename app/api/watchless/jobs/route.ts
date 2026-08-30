import { NextRequest, NextResponse } from 'next/server';
import { createWatchlessUrlJob, listOwnedWatchlessJobs } from '../../../../lib/watchless/jobs';
import { requireWatchlessUser, watchlessErrorResponse } from '../../../../lib/watchless/api';
import { startWatchlessWorkflow } from '../../../../lib/watchless/workflow';

export async function GET(request: NextRequest) {
  const auth = await requireWatchlessUser(request, 'watchless:submit');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ success: true, data: await listOwnedWatchlessJobs(auth.userId, 30) });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWatchlessUser(request, 'watchless:submit');
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json() as Record<string, unknown>;
    const job = await createWatchlessUrlJob({
      userId: auth.userId,
      sourceUrl: String(body.url || ''),
      preferredLanguage: typeof body.preferredLanguage === 'string' ? body.preferredLanguage : undefined,
      isPublic: body.isPublic === true,
      rightsConfirmed: body.rightsConfirmed === true,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    });
    if (job.workflowInstanceId) {
      return NextResponse.json({ success: true, data: job }, { status: 202 });
    }
    try {
      const workflowInstanceId = await startWatchlessWorkflow(job.id, 'url');
      return NextResponse.json({ success: true, data: { ...job, workflowInstanceId } }, { status: 202 });
    } catch (error) {
      const { failWatchlessJob } = await import('../../../../lib/watchless/jobs');
      await failWatchlessJob(job.id, 'WORKFLOW_START_FAILED', error instanceof Error ? error.message : String(error));
      throw error;
    }
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
