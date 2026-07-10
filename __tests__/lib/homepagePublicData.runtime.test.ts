/**
 * @jest-environment node
 */

import { getAllPodcasts } from '../../lib/db';
import { getPublicListSnapshot } from '../../lib/staticSnapshots';
import type { PodcastApiRow } from '../../components/home/homeModel';

jest.mock('next/cache', () => ({
  unstable_cache: () => {
    throw new Error('Dummy cache does not cache anything');
  },
}));

jest.mock('../../lib/db', () => ({
  getAllPodcasts: jest.fn(),
}));

jest.mock('../../lib/staticSnapshots', () => ({
  getPublicListSnapshot: jest.fn(),
}));

const mockGetAllPodcasts = getAllPodcasts as jest.MockedFunction<typeof getAllPodcasts>;
const mockGetPublicListSnapshot = getPublicListSnapshot as jest.MockedFunction<typeof getPublicListSnapshot>;

function podcastRow(id: string, isPublic: boolean): PodcastApiRow {
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

test('loads and executes the snapshot-to-D1 public fallback when Next cache is unavailable', async () => {
  const publicRow = podcastRow('d1-public', true);
  mockGetPublicListSnapshot.mockResolvedValue(null);
  mockGetAllPodcasts.mockResolvedValue({
    success: true,
    data: [podcastRow('d1-private', false), publicRow],
  });

  const { getHomepagePublicData } = await import('../../lib/homepagePublicData');
  const result = await getHomepagePublicData();

  expect(result).toEqual({ rows: [publicRow], generatedAt: null });
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE TITLE');
  expect(mockGetPublicListSnapshot).toHaveBeenCalledWith(1, 12);
  expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 12, false);
});
