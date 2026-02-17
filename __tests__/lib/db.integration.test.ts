/**
 * Database Integration Tests
 */

jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(),
}));

import {
  savePodcast,
  getPodcast,
  getAllPodcasts,
  saveAnalysisResults,
  deletePodcast,
  updatePodcastPublicStatus,
  type Podcast,
  type AnalysisResult,
} from '../../lib/db';
import { sql } from '@vercel/postgres';

const mockSql = sql as jest.MockedFunction<typeof sql>;
type SqlCall = Parameters<typeof sql>;

function findSqlCall(fragment: string): SqlCall {
  const matched = mockSql.mock.calls.find((call) => {
    const template = call[0];
    return Array.isArray(template) && template.join('').includes(fragment);
  });
  expect(matched).toBeDefined();
  return matched as SqlCall;
}

describe('Database Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SQL Query Logic Tests', () => {
    test('savePodcast should use UPSERT with expected values', async () => {
      const podcast: Podcast = {
        id: 'test-123',
        title: 'Test Podcast',
        originalFileName: 'test.srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test.srt',
        isPublic: true,
      };

      mockSql.mockResolvedValue({ rows: [{ id: 'test-123' }] } as never);
      await savePodcast(podcast);

      const insertCall = findSqlCall('INSERT INTO podcasts');
      expect(insertCall[1]).toBe('test-123');
      expect(insertCall[2]).toBe('Test Podcast');
      expect(insertCall[3]).toBe('test.srt');
      expect(insertCall[4]).toBe('1.5 KB');
      expect(insertCall[5]).toBe('https://example.com/test.srt');
      expect(insertCall[6]).toBeNull();
      expect(insertCall[7]).toBe(true);
    });

    test('getPodcast should use correct column aliases', async () => {
      const mockData = {
        id: 'test-123',
        title: 'Test Podcast',
        originalFileName: 'test.srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test.srt',
        isPublic: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockSql.mockResolvedValue({ rows: [mockData] } as never);
      const result = await getPodcast('test-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);

      const queryCall = findSqlCall('FROM podcasts');
      expect(queryCall[1]).toBe('test-123');
    });

    test('getAllPodcasts pagination calculation', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);
      await getAllPodcasts(3, 15, false);

      const listCall = findSqlCall('ORDER BY p.created_at DESC');
      expect(listCall[1]).toBe(15);
      expect(listCall[2]).toBe(30);
    });

    test('getAllPodcasts should differentiate public/private queries', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);

      await getAllPodcasts(1, 10, false);
      const publicQuery = findSqlCall('WHERE p.is_public = true')[0].join('');
      expect(publicQuery).toContain('WHERE p.is_public = true');

      mockSql.mockClear();
      mockSql.mockResolvedValue({ rows: [] } as never);

      await getAllPodcasts(1, 10, true);
      const privateQuery = findSqlCall('FROM podcasts p')[0].join('');
      expect(privateQuery).not.toContain('WHERE p.is_public = true');
    });

    test('saveAnalysisResults should upsert and touch timestamp', async () => {
      const analysisResult: AnalysisResult = {
        podcastId: 'test-123',
        summary: 'Test summary',
        translation: 'Test translation',
        highlights: 'Test highlights',
      };

      mockSql.mockResolvedValue({ rows: [{ podcast_id: 'test-123' }] } as never);
      await saveAnalysisResults(analysisResult);

      const upsertCall = findSqlCall('INSERT INTO analysis_results');
      expect(upsertCall[1]).toBe('test-123');
      expect(upsertCall[2]).toBe('Test summary');
      expect(upsertCall[3]).toBe('Test summary');
      expect(upsertCall[6]).toBe('Test translation');
      expect(upsertCall[7]).toBe('Test highlights');
      expect(upsertCall[13]).toBe(0);

      const queryTemplate = upsertCall[0].join('');
      expect(queryTemplate).toContain('CURRENT_TIMESTAMP');
    });

    test('deletePodcast should delete in correct order', async () => {
      mockSql
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ id: 'test-123' }] } as never);

      const result = await deletePodcast('test-123');

      expect(result.success).toBe(true);
      expect(mockSql).toHaveBeenCalledTimes(2);
      expect(mockSql.mock.calls[0][0].join('')).toContain('analysis_results');
      expect(mockSql.mock.calls[1][0].join('')).toContain('podcasts');
    });

    test('updatePodcastPublicStatus should update correct field', async () => {
      mockSql.mockResolvedValue({ rows: [{ id: 'test-123' }] } as never);
      await updatePodcastPublicStatus('test-123', false);

      const updateCall = findSqlCall('UPDATE podcasts');
      expect(updateCall[1]).toBe(false);
      expect(updateCall[2]).toBe('test-123');
      expect(updateCall[0].join('')).toContain('is_public =');
    });
  });

  describe('Edge Cases and Data Validation', () => {
    test('should handle special characters in podcast data', async () => {
      const podcast: Podcast = {
        id: 'test-special-chars',
        title: `Test's "Special" Characters & Symbols`,
        originalFileName: 'test file (1).srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test%20file.srt',
        isPublic: false,
      };

      mockSql.mockResolvedValue({ rows: [{ id: 'test-special-chars' }] } as never);
      const result = await savePodcast(podcast);

      expect(result.success).toBe(true);
      const insertCall = findSqlCall('INSERT INTO podcasts');
      expect(insertCall[1]).toBe('test-special-chars');
      expect(insertCall[2]).toBe(`Test's "Special" Characters & Symbols`);
      expect(insertCall[3]).toBe('test file (1).srt');
      expect(insertCall[5]).toBe('https://example.com/test%20file.srt');
      expect(insertCall[7]).toBe(false);
    });

    test('should handle long content in analysis results', async () => {
      const longContent = 'A'.repeat(10_000);
      const analysisResult: AnalysisResult = {
        podcastId: 'test-long-content',
        summary: longContent,
        translation: longContent,
        highlights: longContent,
      };

      mockSql.mockResolvedValue({ rows: [{ podcast_id: 'test-long-content' }] } as never);
      const result = await saveAnalysisResults(analysisResult);

      expect(result.success).toBe(true);
      const upsertCall = findSqlCall('INSERT INTO analysis_results');
      expect(upsertCall[1]).toBe('test-long-content');
      expect(upsertCall[2]).toBe(longContent);
      expect(upsertCall[3]).toBe(longContent);
      expect(upsertCall[6]).toBe(longContent);
      expect(upsertCall[7]).toBe(longContent);
    });

    test('should handle empty string values', async () => {
      const podcast: Podcast = {
        id: 'test-empty',
        title: '',
        originalFileName: '',
        fileSize: '',
        blobUrl: '',
        isPublic: false,
      };

      mockSql.mockResolvedValue({ rows: [{ id: 'test-empty' }] } as never);
      const result = await savePodcast(podcast);

      expect(result.success).toBe(true);
      const insertCall = findSqlCall('INSERT INTO podcasts');
      expect(insertCall[1]).toBe('test-empty');
      expect(insertCall[2]).toBe('');
      expect(insertCall[3]).toBe('');
      expect(insertCall[4]).toBe('');
      expect(insertCall[5]).toBe('');
      expect(insertCall[6]).toBeNull();
      expect(insertCall[7]).toBe(false);
    });

    test('should handle extreme pagination values', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);
      await getAllPodcasts(999999, 1000, false);

      const listCall = findSqlCall('ORDER BY p.created_at DESC');
      expect(listCall[1]).toBe(1000);
      expect(listCall[2]).toBe(999998000);
    });

    test('should handle zero and negative pagination values', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);

      await getAllPodcasts(0, 10, false);
      let listCall = findSqlCall('ORDER BY p.created_at DESC');
      expect(listCall[1]).toBe(10);
      expect(listCall[2]).toBe(-10);

      mockSql.mockClear();
      mockSql.mockResolvedValue({ rows: [] } as never);

      await getAllPodcasts(-1, 5, false);
      listCall = findSqlCall('ORDER BY p.created_at DESC');
      expect(listCall[1]).toBe(5);
      expect(listCall[2]).toBe(-10);
    });
  });

  describe('Query Performance Considerations', () => {
    test('getAllPodcasts should use LEFT JOIN for performance', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);
      await getAllPodcasts(1, 10, true);

      const query = findSqlCall('FROM podcasts p')[0].join('').toLowerCase();
      expect(query).toContain('left join');
      expect(query).toContain('analysis_results');
      expect(query).toContain('order by');
      expect(query).toContain('created_at desc');
    });

    test('should limit result set properly', async () => {
      mockSql.mockResolvedValue({ rows: [] } as never);
      await getAllPodcasts(1, 50, false);

      const query = findSqlCall('FROM podcasts p')[0].join('').toLowerCase();
      expect(query).toContain('limit');
      expect(query).toContain('offset');
    });
  });
});
