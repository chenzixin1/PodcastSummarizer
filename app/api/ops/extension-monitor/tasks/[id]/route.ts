import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../../lib/auth';
import {
  getExtensionMonitorTaskDetail,
  isExtensionMonitorCaptureRawEnabled,
  isExtensionMonitorEnabled,
} from '../../../../../../lib/extensionMonitor';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id && !session?.user?.email) {
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

    const { id } = await context.params;
    const taskId = String(id || '').trim();
    if (!taskId) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_TASK_ID',
          error: 'Missing task id.',
        },
        { status: 400 },
      );
    }

    const detail = await getExtensionMonitorTaskDetail(taskId);
    if (!detail) {
      return NextResponse.json(
        {
          success: false,
          code: 'NOT_FOUND',
          error: 'Monitor task not found.',
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        task: detail.task,
        events: detail.events,
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
        code: 'MONITOR_DETAIL_FAILED',
        error: 'Failed to fetch extension monitor task detail.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
