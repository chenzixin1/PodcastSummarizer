import { NextRequest, NextResponse, after } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../lib/auth';
import { resolveInfographicAccess } from '../../../../../lib/infographicAccess';
import { mapInfographicJobToResponse, retryInfographicJob } from '../../../../../lib/infographicJobs';
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';

type InfographicWorkerTrigger = (reason: 'infographic_command', podcastId: string) => Promise<unknown>;
const triggerInfographicWorker = triggerWorkerProcessing as unknown as InfographicWorkerTrigger;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }
    const access = await resolveInfographicAccess(id);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    if (!access.canEdit) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const retryResult = await retryInfographicJob(id);
    if (!retryResult.success || !retryResult.data) {
      return NextResponse.json(
        { success: false, error: 'Infographic cannot be retried' },
        { status: 409 },
      );
    }

    after(() => triggerInfographicWorker('infographic_command', id));
    return NextResponse.json({
      success: true,
      data: mapInfographicJobToResponse(retryResult.data, access.canEdit),
    });
  } catch (error) {
    console.error('Failed to retry infographic:', error);
    return NextResponse.json(
      { success: false, error: 'Infographic cannot be retried' },
      { status: 500 },
    );
  }
}
