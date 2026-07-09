/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '../../app/api/admin/podcasts/[id]/route';
import { requireAdminAccess } from '../../lib/adminGuard';
import { deletePodcast, updatePodcastMetadata } from '../../lib/db';
import { recordAdminAuditLog } from '../../lib/credits';
import {
  refreshPublicListSnapshotsAfterDelete,
  refreshSnapshotsForPodcastMutation,
} from '../../lib/staticSnapshotHooks';

jest.mock('../../lib/adminGuard', () => ({
  requireAdminAccess: jest.fn(),
}));

jest.mock('../../lib/db', () => ({
  deletePodcast: jest.fn(),
  updatePodcastMetadata: jest.fn(),
}));

jest.mock('../../lib/credits', () => ({
  recordAdminAuditLog: jest.fn(),
}));

jest.mock('../../lib/staticSnapshotHooks', () => ({
  refreshPublicListSnapshotsAfterDelete: jest.fn(),
  refreshSnapshotsForPodcastMutation: jest.fn(),
}));

const mockRequireAdminAccess = requireAdminAccess as jest.MockedFunction<typeof requireAdminAccess>;
const mockUpdatePodcastMetadata = updatePodcastMetadata as jest.MockedFunction<typeof updatePodcastMetadata>;
const mockDeletePodcast = deletePodcast as jest.MockedFunction<typeof deletePodcast>;
const mockRecordAdminAuditLog = recordAdminAuditLog as jest.MockedFunction<typeof recordAdminAuditLog>;
const mockRefreshSnapshotsForPodcastMutation =
  refreshSnapshotsForPodcastMutation as jest.MockedFunction<typeof refreshSnapshotsForPodcastMutation>;
const mockRefreshPublicListSnapshotsAfterDelete =
  refreshPublicListSnapshotsAfterDelete as jest.MockedFunction<typeof refreshPublicListSnapshotsAfterDelete>;

function buildPatchRequest(body: Record<string, unknown>) {
  return new NextRequest('https://podsum.cc/api/admin/podcasts/pod-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin podcasts route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdminAccess.mockResolvedValue({ ok: true, email: 'admin@example.com' } as never);
    mockUpdatePodcastMetadata.mockResolvedValue({
      success: true,
      data: { id: 'pod-1', isPublic: true },
    } as never);
    mockDeletePodcast.mockResolvedValue({
      success: true,
      data: { id: 'pod-1' },
    } as never);
    mockRecordAdminAuditLog.mockResolvedValue(undefined as never);
    mockRefreshSnapshotsForPodcastMutation.mockResolvedValue({ success: true, published: true });
    mockRefreshPublicListSnapshotsAfterDelete.mockResolvedValue({ success: true, published: true });
  });

  test('PATCH refreshes snapshots after a successful admin metadata update', async () => {
    const response = await PATCH(buildPatchRequest({ isPublic: true }), {
      params: Promise.resolve({ id: 'pod-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockUpdatePodcastMetadata).toHaveBeenCalledWith('pod-1', { isPublic: true });
    expect(mockRefreshSnapshotsForPodcastMutation).toHaveBeenCalledWith('pod-1', 'admin podcast metadata update');
  });

  test('DELETE rebuilds public list snapshots after a successful delete', async () => {
    const response = await DELETE(new NextRequest('https://podsum.cc/api/admin/podcasts/pod-1'), {
      params: Promise.resolve({ id: 'pod-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockDeletePodcast).toHaveBeenCalledWith('pod-1');
    expect(mockRefreshPublicListSnapshotsAfterDelete).toHaveBeenCalledWith('admin podcast delete');
  });
});
