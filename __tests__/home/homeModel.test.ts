import {
  filterSummaryItems,
  formatCoverDate,
  formatSummaryDate,
  mapPodcastRow,
  parseHomeView,
  readSearchParam,
  sortSummaryItems,
  type PodcastApiRow,
  type SummaryItem,
} from '../../components/home/homeModel';

const publicRow: PodcastApiRow = {
  id: 'public-1',
  title: 'Public episode',
  originalFileName: 'public-episode.srt',
  briefSummary: '# 中文总结\nA public summary.',
  fileSize: '2.5 KB',
  blobUrl: 'https://cdn.example.com/public-episode.srt',
  sourceReference: 'https://www.youtube.com/watch?v=public-1',
  sourcePublishedAt: '2026-07-09T12:00:00.000Z',
  createdAt: '2026-07-09T13:00:00.000Z',
  processedAt: '2026-07-09T14:00:00.000Z',
  isProcessed: true,
  isPublic: true,
  wordCount: 930,
  durationSec: 360,
  tags: ['AI', 'Markets'],
};

function summary(overrides: Partial<SummaryItem>): SummaryItem {
  return {
    id: 'summary-1',
    title: 'Summary',
    briefSummary: null,
    fileSize: null,
    sourceReference: null,
    sourcePublishedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    isProcessed: true,
    isPublic: true,
    wordCount: null,
    durationSec: null,
    tags: [],
    scope: 'explore',
    ...overrides,
  };
}

describe('homepage model', () => {
  test('parses supported homepage views from scalar and array query values', () => {
    expect(parseHomeView('topics')).toBe('topics');
    expect(parseHomeView(['starred'])).toBe('starred');
  });

  test('falls back to Explore for unsupported homepage views', () => {
    expect(parseHomeView('private')).toBe('explore');
  });

  test('reads the first scalar search parameter value', () => {
    expect(readSearchParam('topics')).toBe('topics');
    expect(readSearchParam(['starred', 'explore'])).toBe('starred');
    expect(readSearchParam(undefined)).toBeUndefined();
  });

  test('maps a public API row into the requested Explore scope', () => {
    const item = mapPodcastRow(publicRow, 'explore');

    expect(item).toMatchObject({
      id: 'public-1',
      title: 'Public episode',
      briefSummary: 'A public summary.',
      isPublic: true,
      tags: ['AI', 'Markets'],
      scope: 'explore',
    });
  });

  test('filters topic rows by selected tag and text query', () => {
    const rows = [
      summary({ id: 'match', title: 'Alpha markets', tags: ['AI'] }),
      summary({ id: 'wrong-tag', title: 'Alpha markets', tags: ['Cloud'] }),
      summary({ id: 'wrong-query', title: 'Beta systems', tags: ['AI'] }),
    ];

    expect(filterSummaryItems(rows, {
      view: 'topics',
      selectedTag: 'AI',
      query: 'alpha',
    }).map((item) => item.id)).toEqual(['match']);
  });

  test('sorts rows by display date without mutating source order', () => {
    const older = summary({ id: 'older', createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = summary({
      id: 'newer',
      createdAt: '2026-06-01T00:00:00.000Z',
      sourcePublishedAt: '2026-07-08T00:00:00.000Z',
    });
    const rows = [older, newer];

    expect(sortSummaryItems(rows, 'date', 'desc').map((item) => item.id)).toEqual(['newer', 'older']);
    expect(rows.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  test('formats cover dates from the UTC calendar day at a local-time boundary', () => {
    expect(formatCoverDate('2026-07-09T23:30:00.000Z')).toBe('JUL 9');
  });

  test('formats visible summary dates from the UTC calendar day at a local-time boundary', () => {
    expect(formatSummaryDate('2026-07-09T23:30:00.000Z')).toBe('Jul 9, 2026');
  });
});
