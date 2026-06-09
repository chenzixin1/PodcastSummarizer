import { NextRequest, NextResponse, after } from 'next/server';
import { requireAdminAccess } from '../../../../../lib/adminGuard';
import { refundFailedJobCredit, recordAdminAuditLog } from '../../../../../lib/credits';
import { cancelProcessingJob, getProcessingJob, retryProcessingJob } from '../../../../../lib/processingJobs';
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';

type JobAction = 'retry' | 'cancel' | 'refund';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || '').trim() as JobAction;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

  if (!['retry', 'cancel', 'refund'].includes(action)) {
    return NextResponse.json({ success: false, error: 'Invalid job action' }, { status: 400 });
  }

  if (action === 'retry') {
    const current = await getProcessingJob(id);
    if (!current.success || !current.data) {
      return NextResponse.json({ success: false, error: 'Processing job not found' }, { status: 404 });
    }

    const result = await retryProcessingJob(id);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Failed to retry job' }, { status: 500 });
    }

    await recordAdminAuditLog({
      adminUserId: admin.email,
      action: 'jobs.retry',
      targetType: 'processing_job',
      targetId: id,
      metadata: { previousStatus: current.data.status },
    }).catch((error) => {
      console.warn('[admin jobs] audit retry skipped:', error);
    });

    after(async () => {
      const triggerResult = await triggerWorkerProcessing('manual_enqueue', id);
      if (!triggerResult.success) {
        console.error('Admin retry worker trigger failed:', triggerResult.error);
      }
    });

    return NextResponse.json({ success: true, data: result.data });
  }

  if (action === 'cancel') {
    const result = await cancelProcessingJob(id, note || 'Cancelled by admin');
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Failed to cancel job' }, { status: 400 });
    }
    await recordAdminAuditLog({
      adminUserId: admin.email,
      action: 'jobs.cancel',
      targetType: 'processing_job',
      targetId: id,
      metadata: { note },
    }).catch((error) => {
      console.warn('[admin jobs] audit cancel skipped:', error);
    });
    return NextResponse.json({ success: true, data: result.data });
  }

  const result = await refundFailedJobCredit({
    podcastId: id,
    createdBy: admin.email,
    note,
  });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to refund job' }, { status: 400 });
  }
  return NextResponse.json({ success: true, data: result.data });
}
