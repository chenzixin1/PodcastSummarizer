/**
 * @jest-environment node
 */

import { getAllPodcasts } from '../../lib/db';
import { getPublicListSnapshot } from '../../lib/staticSnapshots';
import type { PodcastApiRow } from '../../components/home/homeModel';

jest.mock('../../lib/db', () => ({
  getAllPodcasts: jest.fn(),
}));

jest.mock('../../lib/staticSnapshots', () => ({
  getPublicListSnapshot: jest.fn(),
}));

import { getHomepagePublicData } from '../../lib/homepagePublicData';

const mockGetAllPodcasts = getAllPodcasts as jest.MockedFunction<typeof getAllPodcasts>;
const mockGetPublicListSnapshot = getPublicListSnapshot as jest.MockedFunction<typeof getPublicListSnapshot>;

function podcastRow(id: string, isPublic = true): PodcastApiRow {
  return {
    id,
    title: isPublic ? `Public episode ${id}` : 'SYNTHETIC PRIVATE TITLE',
    originalFileName: `${id}.srt`,
    briefSummary: `Summary for ${id}`,
    fileSize: '4.2 KB',
    blobUrl: `https://cdn.example.com/${id}.srt`,
    sourceReference: `https://www.youtube.com/watch?v=${id}`,
    sourcePublishedAt: '2026-07-09T10:00:00.000Z',
    createdAt: '2026-07-09T11:00:00.000Z',
    processedAt: '2026-07-09T12:00:00.000Z',
    isProcessed: true,
    isPublic,
    wordCount: 1_550,
    durationSec: 600,
    tags: ['AI', 'Engineering'],
  };
}

describe('homepage public data loader', () => {
  beforeEach(() => {
    mockGetAllPodcasts.mockReset();
    mockGetPublicListSnapshot.mockReset();
  });

  test('returns the first 12 public rows from a snapshot hit', async () => {
    const publicRows = Array.from({ length: 13 }, (_, index) => podcastRow(`public-${index + 1}`));
    mockGetPublicListSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      generatedAt: '2026-07-10T01:02:03.000Z',
      page: 1,
      pageSize: 12,
      data: [
        { ...publicRows[0] },
        { ...podcastRow('private-1', false) },
        ...publicRows.slice(1).map((row) => ({ ...row })),
      ],
    });

    const result = await getHomepagePublicData();

    expect(result).toEqual({
      rows: publicRows.slice(0, 12),
      generatedAt: '2026-07-10T01:02:03.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE TITLE');
    expect(mockGetAllPodcasts).not.toHaveBeenCalled();
  });

  test('falls back to the public D1 query on a snapshot miss', async () => {
    const publicRow = podcastRow('d1-public');
    mockGetPublicListSnapshot.mockResolvedValue(null);
    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: [podcastRow('d1-private', false), publicRow],
    });

    const result = await getHomepagePublicData();

    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 12, false);
    expect(result).toEqual({ rows: [publicRow], generatedAt: null });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE TITLE');
  });

  test('falls back to D1 when reading the snapshot throws', async () => {
    const publicRow = podcastRow('fallback-public');
    mockGetPublicListSnapshot.mockRejectedValue(new Error('R2 unavailable'));
    mockGetAllPodcasts.mockResolvedValue({ success: true, data: [publicRow] });

    await expect(getHomepagePublicData()).resolves.toEqual({
      rows: [publicRow],
      generatedAt: null,
    });
  });

  test('normalizes Date values returned by the direct database fallback', async () => {
    const publicRow = podcastRow('dated-public');
    mockGetPublicListSnapshot.mockResolvedValue(null);
    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: [{
        ...publicRow,
        createdAt: new Date(publicRow.createdAt),
        processedAt: new Date(publicRow.processedAt as string),
        sourcePublishedAt: new Date(publicRow.sourcePublishedAt as string),
        userId: 'must-not-enter-public-props',
      }],
    });

    const result = await getHomepagePublicData();

    expect(result).toEqual({ rows: [publicRow], generatedAt: null });
    expect(JSON.stringify(result)).not.toContain('must-not-enter-public-props');
  });

  test('returns empty public rows when snapshot and D1 both fail', async () => {
    mockGetPublicListSnapshot.mockRejectedValue(new Error('R2 unavailable'));
    mockGetAllPodcasts.mockRejectedValue(new Error('D1 unavailable'));

    await expect(getHomepagePublicData()).resolves.toEqual({
      rows: [],
      generatedAt: null,
    });
  });

  test('returns empty public rows for an unsuccessful D1 response', async () => {
    mockGetPublicListSnapshot.mockResolvedValue(null);
    mockGetAllPodcasts.mockResolvedValue({
      success: false,
      error: 'D1 query failed',
    });

    await expect(getHomepagePublicData()).resolves.toEqual({
      rows: [],
      generatedAt: null,
    });
  });
});
