/**
 * @jest-environment node
 */

import {
  analysisSnapshotKey,
  getAnalysisSnapshot,
  getPublicListSnapshot,
  publicListSnapshotKey,
  publishAnalysisSnapshotForPodcast,
  refreshStaticSnapshotsForPodcast,
  rebuildPublicListSnapshots,
} from '../../lib/staticSnapshots';
import { getAllPodcasts, getAnalysisResults, getPodcast } from '../../lib/db';
import { deleteObject, getObjectText, uploadObject } from '../../lib/objectStorage';

jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
  getAnalysisResults: jest.fn(),
  getAllPodcasts: jest.fn(),
}));

jest.mock('../../lib/objectStorage', () => ({
  uploadObject: jest.fn(),
  deleteObject: jest.fn(),
  getObjectText: jest.fn(),
}));

const mockGetPodcast = getPodcast as jest.MockedFunction<typeof getPodcast>;
const mockGetAnalysisResults = getAnalysisResults as jest.MockedFunction<typeof getAnalysisResults>;
const mockGetAllPodcasts = getAllPodcasts as jest.MockedFunction<typeof getAllPodcasts>;
const mockUploadObject = uploadObject as jest.MockedFunction<typeof uploadObject>;
const mockDeleteObject = deleteObject as jest.MockedFunction<typeof deleteObject>;
const mockGetObjectText = getObjectText as jest.MockedFunction<typeof getObjectText>;

describe('staticSnapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadObject.mockResolvedValue({
      key: 'snapshots/analysis/pod-1.json',
      url: 'https://podsum.cc/api/files/snapshots/analysis/pod-1.json',
      provider: 'r2',
    });
    mockDeleteObject.mockResolvedValue(undefined);
  });

  test('writes completed public podcast analysis snapshots', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-1',
        title: 'Published episode',
        originalFileName: 'episode.srt',
        fileSize: '1 KB',
        isPublic: true,
        sourceReference: 'https://example.com/watch',
      },
    });
    mockGetAnalysisResults.mockResolvedValue({
      success: true,
      data: {
        podcastId: 'pod-1',
        summaryZh: '中文总结',
        summaryEn: 'English summary',
        highlights: '重点内容',
        translation: 'Translated full text',
        processedAt: '2026-06-09T00:00:00.000Z',
      },
    });

    const result = await publishAnalysisSnapshotForPodcast('pod-1');

    expect(result).toEqual({ success: true, published: true });
    expect(mockUploadObject).toHaveBeenCalledWith(
      analysisSnapshotKey('pod-1'),
      expect.any(String),
      { contentType: 'application/json; charset=utf-8' },
    );
    const payload = JSON.parse(mockUploadObject.mock.calls[0][1] as string);
    expect(payload.data).toMatchObject({
      isProcessed: true,
      processingJob: null,
      canEdit: false,
      podcast: {
        id: 'pod-1',
        isPublic: true,
      },
      analysis: {
        summaryZh: '中文总结',
        highlights: '重点内容',
      },
    });
  });

  test('deletes analysis snapshots instead of publishing private podcasts', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-private',
        isPublic: false,
      },
    });

    const result = await publishAnalysisSnapshotForPodcast('pod-private');

    expect(result).toEqual({ success: true, published: false });
    expect(mockDeleteObject).toHaveBeenCalledWith(analysisSnapshotKey('pod-private'));
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  test('preserves existing analysis snapshots when podcast refresh fails transiently', async () => {
    mockGetPodcast.mockResolvedValue({
      success: false,
      error: 'db down',
    });

    const result = await publishAnalysisSnapshotForPodcast('pod-1');

    expect(result).toEqual({
      success: true,
      published: false,
      error: 'db down',
    });
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  test('preserves existing analysis snapshots when analysis refresh fails transiently', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-1',
        isPublic: true,
      },
    });
    mockGetAnalysisResults.mockResolvedValue({
      success: false,
      error: 'db down',
    });

    const result = await publishAnalysisSnapshotForPodcast('pod-1');

    expect(result).toEqual({
      success: true,
      published: false,
      error: 'db down',
    });
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  test('deletes analysis snapshots when public podcast analysis is incomplete after a successful read', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-1',
        isPublic: true,
      },
    });
    mockGetAnalysisResults.mockResolvedValue({
      success: true,
      data: {
        podcastId: 'pod-1',
        summaryZh: 'Only summary',
        highlights: '',
      },
    });

    const result = await publishAnalysisSnapshotForPodcast('pod-1');

    expect(result).toEqual({ success: true, published: false });
    expect(mockDeleteObject).toHaveBeenCalledWith(analysisSnapshotKey('pod-1'));
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  test('reads only usable public analysis snapshots', async () => {
    mockGetObjectText.mockResolvedValue(JSON.stringify({
      snapshotVersion: 1,
      generatedAt: '2026-06-09T00:00:00.000Z',
      data: {
        podcast: {
          id: 'pod-1',
          isPublic: true,
        },
        analysis: {
          summaryZh: '中文总结',
          highlights: '重点内容',
        },
        isProcessed: true,
        processingJob: null,
        canEdit: false,
      },
    }));

    const snapshot = await getAnalysisSnapshot('pod-1');

    expect(snapshot?.data.podcast.id).toBe('pod-1');
  });

  test('rejects stale public analysis snapshots', async () => {
    mockGetObjectText.mockResolvedValue(JSON.stringify({
      snapshotVersion: 0,
      generatedAt: '2026-06-09T00:00:00.000Z',
      data: {
        podcast: {
          id: 'pod-1',
          isPublic: true,
        },
        analysis: {
          summaryZh: '中文总结',
          highlights: '重点内容',
        },
        isProcessed: true,
        processingJob: null,
        canEdit: false,
      },
    }));

    await expect(getAnalysisSnapshot('pod-1')).resolves.toBeNull();
  });

  test('writes public list snapshots with current list fields', async () => {
    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'pod-1',
          title: 'Updated title',
          tags: ['AI', 'Markets'],
          briefSummary: 'Fresh brief',
          sourcePublishedAt: '2026-06-09T08:00:00.000Z',
          isProcessed: true,
        },
      ],
    });

    const result = await rebuildPublicListSnapshots({ pageSize: 12, pages: 1 });

    expect(result).toEqual({ success: true, published: true });
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 12, false);
    expect(mockUploadObject).toHaveBeenCalledWith(
      publicListSnapshotKey(1, 12),
      expect.any(String),
      { contentType: 'application/json; charset=utf-8' },
    );
    const payload = JSON.parse(mockUploadObject.mock.calls[0][1] as string);
    expect(payload).toMatchObject({
      page: 1,
      pageSize: 12,
      data: [
        {
          id: 'pod-1',
          title: 'Updated title',
          tags: ['AI', 'Markets'],
          briefSummary: 'Fresh brief',
          sourcePublishedAt: '2026-06-09T08:00:00.000Z',
          isProcessed: true,
        },
      ],
    });
  });

  test('fails closed when public list payload is malformed', async () => {
    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: { items: [] } as never,
    });

    const result = await rebuildPublicListSnapshots({ pageSize: 12, pages: 1 });

    expect(result).toEqual({
      success: false,
      published: false,
      error: 'Malformed public podcasts payload for page 1',
    });
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  test('reads only public list snapshots that match normalized paging', async () => {
    mockGetObjectText.mockResolvedValue(JSON.stringify({
      snapshotVersion: 2,
      generatedAt: '2026-06-09T00:00:00.000Z',
      page: 1,
      pageSize: 50,
      data: [{ id: 'pod-1', title: 'Published episode' }],
    }));

    const snapshot = await getPublicListSnapshot(0, 999);

    expect(snapshot).toMatchObject({
      page: 1,
      pageSize: 50,
      data: [{ id: 'pod-1', title: 'Published episode' }],
    });
  });

  test('keeps snapshot refresh best-effort when one cache refresh fails', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-1',
        isPublic: true,
      },
    });
    mockGetAnalysisResults.mockResolvedValue({
      success: true,
      data: {
        podcastId: 'pod-1',
        summaryZh: '中文总结',
        highlights: '重点内容',
      },
    });
    mockGetAllPodcasts.mockResolvedValue({
      success: false,
      error: 'list refresh broke',
    });

    const result = await refreshStaticSnapshotsForPodcast('pod-1');

    expect(result).toEqual({
      success: true,
      published: true,
      error: 'public list snapshot refresh failed: list refresh broke',
    });
    expect(mockUploadObject).toHaveBeenCalledTimes(1);
    expect(mockUploadObject).toHaveBeenCalledWith(
      analysisSnapshotKey('pod-1'),
      expect.any(String),
      { contentType: 'application/json; charset=utf-8' },
    );
  });
});
