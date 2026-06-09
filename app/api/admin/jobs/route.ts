import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../lib/adminGuard';
import { listAdminJobs } from '../../../../lib/adminData';
import { getProcessingQueueHealth } from '../../../../lib/processingJobs';

function parseInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const params = request.nextUrl.searchParams;
  const [jobsResult, healthResult] = await Promise.all([
    listAdminJobs({
      status: params.get('status'),
      query: params.get('q'),
      limit: parseInteger(params.get('limit'), 80),
      offset: parseInteger(params.get('offset'), 0),
    }),
    getProcessingQueueHealth(),
  ]);

  if (!jobsResult.success) {
    return NextResponse.json({ success: false, error: jobsResult.error || 'Failed to load jobs' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      jobs: jobsResult.data || [],
      health: healthResult.data || null,
    },
  });
}
