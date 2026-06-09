import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../../lib/adminGuard';
import { deletePodcast, updatePodcastMetadata } from '../../../../../lib/db';
import { recordAdminAuditLog } from '../../../../../lib/credits';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const updates: { isPublic?: boolean; sourceReference?: string | null } = {};

  if (typeof body?.isPublic === 'boolean') {
    updates.isPublic = body.isPublic;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sourceReference')) {
    updates.sourceReference =
      typeof body.sourceReference === 'string'
        ? body.sourceReference.trim().slice(0, 2048) || null
        : null;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
  }

  const result = await updatePodcastMetadata(id, updates);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to update podcast' }, { status: 500 });
  }

  await recordAdminAuditLog({
    adminUserId: admin.email,
    action: 'podcasts.update',
    targetType: 'podcast',
    targetId: id,
    metadata: updates,
  }).catch((error) => {
    console.warn('[admin podcasts] audit update skipped:', error);
  });

  return NextResponse.json({ success: true, data: result.data });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminAccess();
  if (!admin.ok) {
    return admin.response;
  }

  const { id } = await context.params;
  const result = await deletePodcast(id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to delete podcast' }, { status: 404 });
  }

  await recordAdminAuditLog({
    adminUserId: admin.email,
    action: 'podcasts.delete',
    targetType: 'podcast',
    targetId: id,
  }).catch((error) => {
    console.warn('[admin podcasts] audit delete skipped:', error);
  });

  return NextResponse.json({ success: true, data: result.data });
}
