/**
 * @jest-environment node
 */

import {
  refreshPublicListSnapshotsAfterDelete,
  refreshSnapshotsForPodcastMutation,
} from '../../lib/staticSnapshotHooks';
import {
  rebuildPublicListSnapshots,
  refreshStaticSnapshotsForPodcast,
} from '../../lib/staticSnapshots';

jest.mock('../../lib/staticSnapshots', () => ({
  rebuildPublicListSnapshots: jest.fn(),
  refreshStaticSnapshotsForPodcast: jest.fn(),
}));

const mockRebuildPublicListSnapshots =
  rebuildPublicListSnapshots as jest.MockedFunction<typeof rebuildPublicListSnapshots>;
const mockRefreshStaticSnapshotsForPodcast =
  refreshStaticSnapshotsForPodcast as jest.MockedFunction<typeof refreshStaticSnapshotsForPodcast>;

describe('staticSnapshotHooks', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshStaticSnapshotsForPodcast.mockResolvedValue({ success: true, published: true });
    mockRebuildPublicListSnapshots.mockResolvedValue({ success: true, published: true });
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  test('refreshes snapshots for a podcast mutation', async () => {
    const result = await refreshSnapshotsForPodcastMutation('pod-1', 'test mutation');

    expect(result).toEqual({ success: true, published: true });
    expect(mockRefreshStaticSnapshotsForPodcast).toHaveBeenCalledWith('pod-1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('warns when podcast snapshot refresh returns a degraded result', async () => {
    mockRefreshStaticSnapshotsForPodcast.mockResolvedValue({
      success: true,
      published: true,
      error: 'public list snapshot refresh failed: list down',
    });

    const result = await refreshSnapshotsForPodcastMutation('pod-1', 'test mutation');

    expect(result).toEqual({
      success: true,
      published: true,
      error: 'public list snapshot refresh failed: list down',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[static snapshots] test mutation refresh failed:',
      'public list snapshot refresh failed: list down',
    );
  });

  test('does not throw when podcast snapshot refresh fails', async () => {
    mockRefreshStaticSnapshotsForPodcast.mockResolvedValue({
      success: false,
      published: false,
      error: 'R2 unavailable',
    });

    const result = await refreshSnapshotsForPodcastMutation('pod-1', 'test mutation');

    expect(result).toEqual({
      success: false,
      published: false,
      error: 'R2 unavailable',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[static snapshots] test mutation refresh failed:',
      'R2 unavailable',
    );
  });

  test('does not throw when podcast snapshot refresh rejects', async () => {
    mockRefreshStaticSnapshotsForPodcast.mockRejectedValue(new Error('network down'));

    const result = await refreshSnapshotsForPodcastMutation('pod-1', 'test mutation');

    expect(result).toEqual({
      success: false,
      published: false,
      error: 'network down',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[static snapshots] test mutation refresh crashed:',
      'network down',
    );
  });

  test('rebuilds public list snapshots after delete', async () => {
    const result = await refreshPublicListSnapshotsAfterDelete('delete mutation');

    expect(result).toEqual({ success: true, published: true });
    expect(mockRebuildPublicListSnapshots).toHaveBeenCalledWith();
  });
});
