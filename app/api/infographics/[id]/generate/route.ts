import { NextRequest, NextResponse, after } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../lib/auth';
import { getAnalysisResults } from '../../../../../lib/db';
import { resolveInfographicAccess } from '../../../../../lib/infographicAccess';
import { enqueueInfographicJob, mapInfographicJobToResponse } from '../../../../../lib/infographicJobs';
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';

type InfographicWorkerTrigger = (reason: 'infographic_command', podcastId: string) => Promise<unknown>;
const triggerInfographicWorker = triggerWorkerProcessing as unknown as InfographicWorkerTrigger;

function hasCompletedAnalysis(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const analysis = value as Record<string, unknown>;
  return Boolean(
    (typeof analysis.summaryZh === 'string' && analysis.summaryZh.trim())
    || (typeof analysis.summary === 'string' && analysis.summary.trim()),
  );
}

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

    const analysisResult = await getAnalysisResults(id);
    if (!analysisResult.success || !hasCompletedAnalysis(analysisResult.data)) {
      return NextResponse.json(
        { success: false, error: 'Analysis must be completed before generating an infographic' },
        { status: 409 },
      );
    }

    const enqueueResult = await enqueueInfographicJob(id);
    if (!enqueueResult.success || !enqueueResult.data) {
      return NextResponse.json(
        { success: false, error: 'Failed to enqueue infographic' },
        { status: 500 },
      );
    }

    after(() => triggerInfographicWorker('infographic_command', id));
    return NextResponse.json({
      success: true,
      data: mapInfographicJobToResponse(enqueueResult.data, access.canEdit),
    });
  } catch (error) {
    console.error('Failed to generate infographic:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to enqueue infographic' },
      { status: 500 },
    );
  }
}
