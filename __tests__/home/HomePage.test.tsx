/**
 * @jest-environment node
 */

import HomeWorkspace from '../../components/home/HomeWorkspace';
import type { PodcastApiRow } from '../../components/home/homeModel';
import { getHomepagePublicData } from '../../lib/homepagePublicData';

jest.mock('../../lib/homepagePublicData', () => ({
  getHomepagePublicData: jest.fn(),
}));

import HomePage from '../../app/page';

const mockGetHomepagePublicData = getHomepagePublicData as jest.MockedFunction<typeof getHomepagePublicData>;

const publicRow: PodcastApiRow = {
  id: 'public-1',
  title: 'Public initial card',
  originalFileName: 'public-1.srt',
  briefSummary: 'Public summary',
  fileSize: '2.1 KB',
  blobUrl: 'https://cdn.example.com/public-1.srt',
  sourceReference: 'https://www.youtube.com/watch?v=public-1',
  sourcePublishedAt: '2026-07-09T10:00:00.000Z',
  createdAt: '2026-07-09T11:00:00.000Z',
  processedAt: '2026-07-09T12:00:00.000Z',
  isProcessed: true,
  isPublic: true,
  wordCount: 620,
  durationSec: 240,
  tags: ['AI'],
};

describe('HomePage server boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHomepagePublicData.mockResolvedValue({
      rows: [publicRow],
      generatedAt: '2026-07-10T01:02:03.000Z',
    });
  });

  test('passes parsed search params and public rows to the real workspace', async () => {
    const element = await HomePage({
      searchParams: Promise.resolve({
        view: ['topics', 'explore'],
        tag: ['AI', 'Markets'],
      }),
    });

    expect(element.type).toBe(HomeWorkspace);
    expect(element.props).toEqual({
      initialView: 'topics',
      initialTag: 'AI',
      hasExplicitView: true,
      initialExploreRows: [publicRow],
    });
  });

  test('defaults an implicit homepage view to Explore', async () => {
    const element = await HomePage({ searchParams: Promise.resolve({}) });

    expect(element.props).toMatchObject({
      initialView: 'explore',
      initialTag: '',
      hasExplicitView: false,
    });
  });

  test('starts public loading without waiting for search params to resolve', async () => {
    let resolveSearchParams: ((value: Record<string, string | string[] | undefined>) => void) | undefined;
    const searchParams = new Promise<Record<string, string | string[] | undefined>>((resolve) => {
      resolveSearchParams = resolve;
    });

    const page = HomePage({ searchParams });

    expect(mockGetHomepagePublicData).toHaveBeenCalledTimes(1);
    resolveSearchParams?.({ view: 'explore' });
    await expect(page).resolves.toBeDefined();
  });
});
