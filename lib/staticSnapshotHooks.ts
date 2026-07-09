import {
  rebuildPublicListSnapshots,
  refreshStaticSnapshotsForPodcast,
  type SnapshotPublishResult,
} from './staticSnapshots';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function refreshSnapshotsForPodcastMutation(
  podcastId: string,
  label = 'podcast mutation',
): Promise<SnapshotPublishResult> {
  try {
    const result = await refreshStaticSnapshotsForPodcast(podcastId);
    if (!result.success || result.error) {
      console.warn(`[static snapshots] ${label} refresh failed:`, result.error || 'unknown error');
    }
    return result;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`[static snapshots] ${label} refresh crashed:`, message);
    return { success: false, published: false, error: message };
  }
}

export async function refreshPublicListSnapshotsAfterDelete(
  label = 'podcast delete',
): Promise<SnapshotPublishResult> {
  try {
    const result = await rebuildPublicListSnapshots();
    if (!result.success || result.error) {
      console.warn(`[static snapshots] ${label} public list refresh failed:`, result.error || 'unknown error');
    }
    return result;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`[static snapshots] ${label} public list refresh crashed:`, message);
    return { success: false, published: false, error: message };
  }
}
