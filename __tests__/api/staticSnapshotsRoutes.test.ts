/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getPublicListSnapshotRoute } from '../../app/api/snapshots/lists/public/route';
import { GET as getAnalysisSnapshotRoute } from '../../app/api/snapshots/analysis/[id]/route';
import { getAnalysisSnapshot, getPublicListSnapshot } from '../../lib/staticSnapshots';

jest.mock('../../lib/staticSnapshots', () => ({
  ANALYSIS_SNAPSHOT_CACHE_CONTROL: 'public, max-age=300, stale-while-revalidate=86400',
  PUBLIC_LIST_SNAPSHOT_CACHE_CONTROL: 'public, max-age=60, stale-while-revalidate=300',
  getAnalysisSnapshot: jest.fn(),
  getPublicListSnapshot: jest.fn(),
  normalizePage: jest.fn((value: number) => (Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1)),
  normalizePageSize: jest.fn((value: number) => (
    Number.isFinite(value) ? Math.max(1, Math.min(50, Math.floor(value))) : 12
  )),
}));

const mockGetAnalysisSnapshot = getAnalysisSnapshot as jest.MockedFunction<typeof getAnalysisSnapshot>;
const mockGetPublicListSnapshot = getPublicListSnapshot as jest.MockedFunction<typeof getPublicListSnapshot>;

describe('static snapshot routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/snapshots/lists/public returns cached list snapshots', async () => {
    mockGetPublicListSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      generatedAt: '2026-07-09T00:00:00.000Z',
      page: 2,
      pageSize: 12,
      data: [{ id: 'pod-1', title: 'Published episode' }],
    });

    const response = await getPublicListSnapshotRoute(
      new NextRequest('https://podsum.cc/api/snapshots/lists/public?page=2&pageSize=12'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(mockGetPublicListSnapshot).toHaveBeenCalledWith(2, 12);
    expect(payload).toEqual({
      success: true,
      data: [{ id: 'pod-1', title: 'Published episode' }],
      snapshot: {
        version: 1,
        generatedAt: '2026-07-09T00:00:00.000Z',
        page: 2,
        pageSize: 12,
      },
    });
  });

  test('GET /api/snapshots/lists/public returns no-store soft miss when snapshot is absent', async () => {
    mockGetPublicListSnapshot.mockResolvedValue(null);

    const response = await getPublicListSnapshotRoute(
      new NextRequest('https://podsum.cc/api/snapshots/lists/public?page=1&pageSize=12'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload).toEqual({
      success: false,
      data: null,
      snapshot: null,
      error: 'Static public list snapshot not found',
    });
  });

  test('GET /api/snapshots/analysis/[id] returns cached analysis snapshots', async () => {
    mockGetAnalysisSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      generatedAt: '2026-07-09T00:00:00.000Z',
      data: {
        podcast: { id: 'pod-1', isPublic: true },
        analysis: { summaryZh: '中文总结', highlights: '重点' },
        isProcessed: true,
        processingJob: null,
        canEdit: false,
      },
    });

    const response = await getAnalysisSnapshotRoute(
      new NextRequest('https://podsum.cc/api/snapshots/analysis/pod-1'),
      { params: Promise.resolve({ id: 'pod-1' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=86400');
    expect(mockGetAnalysisSnapshot).toHaveBeenCalledWith('pod-1');
    expect(payload).toEqual({
      success: true,
      data: {
        podcast: { id: 'pod-1', isPublic: true },
        analysis: { summaryZh: '中文总结', highlights: '重点' },
        isProcessed: true,
        processingJob: null,
        canEdit: false,
      },
      snapshot: {
        version: 1,
        generatedAt: '2026-07-09T00:00:00.000Z',
      },
    });
  });

  test('GET /api/snapshots/analysis/[id] returns no-store soft miss when snapshot is absent', async () => {
    mockGetAnalysisSnapshot.mockResolvedValue(null);

    const response = await getAnalysisSnapshotRoute(
      new NextRequest('https://podsum.cc/api/snapshots/analysis/pod-1'),
      { params: Promise.resolve({ id: 'pod-1' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload).toEqual({
      success: false,
      data: null,
      snapshot: null,
      error: 'Static analysis snapshot not found',
    });
  });
});
