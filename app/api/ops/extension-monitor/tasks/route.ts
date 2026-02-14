import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../lib/auth';
import {
  isExtensionMonitorCaptureRawEnabled,
  isExtensionMonitorEnabled,
  listExtensionMonitorTasks,
} from '../../../../../lib/extensionMonitor';

export const runtime = 'nodejs';

function parsePositiveInt(input: string | null, fallback: number): number {
  const value = Number.parseInt(String(input || ''), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Authentication required.',
        },
        { status: 401 },
      );
    }

    if (!isExtensionMonitorEnabled()) {
      return NextResponse.json(
        {
          success: false,
          code: 'MONITOR_DISABLED',
          error: 'Extension monitor is disabled.',
        },
        { status: 503 },
      );
    }

    const params = request.nextUrl.searchParams;
    const page = parsePositiveInt(params.get('page'), 1);
    const pageSize = Math.min(parsePositiveInt(params.get('pageSize'), 20), 100);
    const path = String(params.get('path') || '').trim() as 'path1' | 'path2' | '';
    const status = String(params.get('status') || '').trim() as
      | 'received'
      | 'accepted'
      | 'transcribing'
      | 'queued'
      | 'processing'
      | 'completed'
      | 'failed'
      | '';
    const q = String(params.get('q') || '').trim();
    const from = String(params.get('from') || '').trim();
    const to = String(params.get('to') || '').trim();

    const list = await listExtensionMonitorTasks({
      page,
      pageSize,
      path,
      status,
      q,
      from,
      to,
    });
    const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));

    return NextResponse.json({
      success: true,
      data: {
        tasks: list.tasks,
        pagination: {
          total: list.total,
          page: list.page,
          pageSize: list.pageSize,
          totalPages,
        },
        monitor: {
          enabled: true,
          captureRaw: isExtensionMonitorCaptureRawEnabled(),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: 'MONITOR_LIST_FAILED',
        error: 'Failed to list extension monitor tasks.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
