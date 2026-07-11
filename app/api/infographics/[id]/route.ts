import { NextRequest, NextResponse } from 'next/server';
import { resolveInfographicAccess } from '../../../../lib/infographicAccess';
import { getInfographicJob, mapInfographicJobToResponse } from '../../../../lib/infographicJobs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const access = await resolveInfographicAccess(id);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const jobResult = await getInfographicJob(id);
    if (!jobResult.success && jobResult.error !== 'Infographic job not found') {
      return NextResponse.json(
        { success: false, error: jobResult.error || 'Failed to get infographic status' },
        { status: 500 },
      );
    }
    return NextResponse.json({
      success: true,
      data: mapInfographicJobToResponse(jobResult.data || null, access.canEdit),
    });
  } catch (error) {
    console.error('Failed to get infographic status:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
