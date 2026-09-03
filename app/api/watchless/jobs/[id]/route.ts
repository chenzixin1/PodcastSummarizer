import { NextRequest, NextResponse } from 'next/server';
import {
  cancelWatchlessJob,
  getOwnedWatchlessJob,
  listWatchlessJobAssets,
  listWatchlessJobEvents,
  rollbackWatchlessJob,
} from '../../../../../lib/watchless/jobs';
import { requireWatchlessUser, watchlessErrorResponse } from '../../../../../lib/watchless/api';
import { terminateWatchlessWorkflow } from '../../../../../lib/watchless/workflow';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWatchlessUser(request, ['watchless:submit', 'watchless:publish']);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const job = await getOwnedWatchlessJob(id, auth.userId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 });
    const [assets, events] = await Promise.all([
      listWatchlessJobAssets(id),
      listWatchlessJobEvents(id),
    ]);
    const safeAssets = assets.map((asset) => ({
      id: asset.id,
      jobId: asset.jobId,
      assetPath: asset.assetPath,
      role: asset.role,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      status: asset.status,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      downloadUrl: `/api/watchless/jobs/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.id)}`,
    }));
    return NextResponse.json({ success: true, data: { ...job, assets: safeAssets, events } });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWatchlessUser(request, ['watchless:submit', 'watchless:publish']);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const job = await getOwnedWatchlessJob(id, auth.userId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 });
    if (['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering', 'validating', 'publishing'].includes(job.status)) {
      const cancelled = await cancelWatchlessJob(id, auth.userId);
      if (['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering'].includes(job.status) && job.workflowInstanceId) {
        await terminateWatchlessWorkflow(job.workflowInstanceId).catch((error) => {
          console.error('[Watchless] Workflow termination failed after cancellation:', error);
        });
      }
      return NextResponse.json({ success: true, data: cancelled });
    }
    return NextResponse.json({ success: true, data: await rollbackWatchlessJob(id, auth.userId) });
  } catch (error) {
    return watchlessErrorResponse(error);
  }
}
