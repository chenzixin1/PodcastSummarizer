/**
 * Database Integration Tests
 * 
 * 这些测试使用实际的SQL查询逻辑，但使用mock数据库连接
 * 主要测试SQL查询的正确性和边界情况
 */

// Mock Vercel Postgres with more detailed behavior
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn()
}));

import {
  savePodcast,
  getPodcast,
  getAllPodcasts,
  saveAnalysisResults,
  getAnalysisResults,
  deletePodcast,
  updatePodcastPublicStatus,
  type Podcast,
  type AnalysisResult
} from '../../lib/db';

import { sql } from '@vercel/postgres';

const mockSql = sql as jest.MockedFunction<typeof sql>;

describe('Database Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SQL Query Logic Tests', () => {
    test('savePodcast should use correct UPSERT syntax', async () => {
      const podcast: Podcast = {
        id: 'test-123',
        title: 'Test Podcast',
        originalFileName: 'test.srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test.srt',
        isPublic: true
      };

      mockSql.mockResolvedValue({
        rows: [{ id: 'test-123' }]
      } as any);

      await savePodcast(podcast);

      // 验证调用了正确的参数顺序和数量
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array), // SQL template
        'test-123',        // id
        'Test Podcast',    // title
        'test.srt',        // original_filename
        '1.5 KB',          // file_size
        'https://example.com/test.srt', // blob_url
        true,              // is_public
        'Test Podcast',    // title (for UPDATE)
        'test.srt',        // original_filename (for UPDATE)
        '1.5 KB',          // file_size (for UPDATE)
        'https://example.com/test.srt', // blob_url (for UPDATE)
        true               // is_public (for UPDATE)
      );
    });

    test('getPodcast should use correct column aliases', async () => {
      const mockData = {
        id: 'test-123',
        title: 'Test Podcast',
        originalFileName: 'test.srt', // 注意：这是alias后的字段名
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test.srt',
        isPublic: true,
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockSql.mockResolvedValue({
        rows: [mockData]
      } as any);

      const result = await getPodcast('test-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        'test-123'
      );
    });

    test('getAllPodcasts pagination calculation', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      // 测试分页计算
      await getAllPodcasts(3, 15, false); // page=3, pageSize=15

      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        15,  // LIMIT
        30   // OFFSET = (page - 1) * pageSize = (3 - 1) * 15 = 30
      );
    });

    test('getAllPodcasts should differentiate public/private queries', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      // 测试公开播客查询
      await getAllPodcasts(1, 10, false);
      const publicQuery = mockSql.mock.calls[0][0];

      // 重置mock
      mockSql.mockClear();

      // 测试包含私有播客查询
      await getAllPodcasts(1, 10, true);
      const privateQuery = mockSql.mock.calls[0][0];

      // 验证查询语句不同（public查询应该包含WHERE条件）
      expect(publicQuery.join('')).toContain('is_public = true');
      expect(privateQuery.join('')).not.toContain('is_public = true');
    });

    test('saveAnalysisResults should use correct UPSERT with timestamp', async () => {
      const analysisResult: AnalysisResult = {
        podcastId: 'test-123',
        summary: 'Test summary',
        translation: 'Test translation',
        highlights: 'Test highlights'
      };

      mockSql.mockResolvedValue({
        rows: [{ podcast_id: 'test-123' }]
      } as any);

      await saveAnalysisResults(analysisResult);

      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        'test-123',
        'Test summary',
        'Test translation',
        'Test highlights',
        'Test summary',      // for UPDATE
        'Test translation',  // for UPDATE
        'Test highlights'    // for UPDATE
      );

      // 验证SQL包含CURRENT_TIMESTAMP
      const sqlTemplate = mockSql.mock.calls[0][0];
      expect(sqlTemplate.join('')).toContain('CURRENT_TIMESTAMP');
    });

    test('deletePodcast should delete in correct order', async () => {
      mockSql
        .mockResolvedValueOnce({ rows: [] } as any)              // DELETE analysis_results
        .mockResolvedValueOnce({ rows: [{ id: 'test-123' }] } as any); // DELETE podcasts

      const result = await deletePodcast('test-123');

      expect(result.success).toBe(true);
      expect(mockSql).toHaveBeenCalledTimes(2);

      // 验证调用顺序：先删除analysis_results，再删除podcasts
      const firstCall = mockSql.mock.calls[0][0];
      const secondCall = mockSql.mock.calls[1][0];

      expect(firstCall.join('')).toContain('analysis_results');
      expect(secondCall.join('')).toContain('podcasts');
    });

    test('updatePodcastPublicStatus should update correct field', async () => {
      mockSql.mockResolvedValue({
        rows: [{ id: 'test-123' }]
      } as any);

      await updatePodcastPublicStatus('test-123', false);

      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        false,       // is_public value
        'test-123'   // WHERE id
      );

      // 验证SQL结构
      const sqlTemplate = mockSql.mock.calls[0][0];
      expect(sqlTemplate.join('')).toContain('UPDATE podcasts');
      expect(sqlTemplate.join('')).toContain('is_public =');
      expect(sqlTemplate.join('')).toContain('WHERE id =');
      expect(sqlTemplate.join('')).toContain('RETURNING id');
    });
  });

  describe('Edge Cases and Data Validation', () => {
    test('should handle special characters in podcast data', async () => {
      const podcast: Podcast = {
        id: 'test-special-chars',
        title: "Test's \"Special\" Characters & Symbols",
        originalFileName: 'test file (1).srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test%20file.srt',
        isPublic: false
      };

      mockSql.mockResolvedValue({
        rows: [{ id: 'test-special-chars' }]
      } as any);

      const result = await savePodcast(podcast);

      expect(result.success).toBe(true);
      // 验证特殊字符被正确传递
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        'test-special-chars',
        "Test's \"Special\" Characters & Symbols",
        'test file (1).srt',
        '1.5 KB',
        'https://example.com/test%20file.srt',
        false,
        "Test's \"Special\" Characters & Symbols",
        'test file (1).srt',
        '1.5 KB',
        'https://example.com/test%20file.srt',
        false
      );
    });

    test('should handle long content in analysis results', async () => {
      const longContent = 'A'.repeat(10000); // 10KB 内容
      
      const analysisResult: AnalysisResult = {
        podcastId: 'test-long-content',
        summary: longContent,
        translation: longContent,
        highlights: longContent
      };

      mockSql.mockResolvedValue({
        rows: [{ podcast_id: 'test-long-content' }]
      } as any);

      const result = await saveAnalysisResults(analysisResult);

      expect(result.success).toBe(true);
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        'test-long-content',
        longContent,
        longContent,
        longContent,
        longContent,
        longContent,
        longContent
      );
    });

    test('should handle empty string values', async () => {
      const podcast: Podcast = {
        id: 'test-empty',
        title: '',
        originalFileName: '',
        fileSize: '',
        blobUrl: '',
        isPublic: false
      };

      mockSql.mockResolvedValue({
        rows: [{ id: 'test-empty' }]
      } as any);

      const result = await savePodcast(podcast);

      expect(result.success).toBe(true);
      // 验证空字符串被正确处理
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        'test-empty', '', '', '', '', false,
        '', '', '', '', false
      );
    });

    test('should handle extreme pagination values', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      // 测试极大的页码和页面大小
      await getAllPodcasts(999999, 1000, false);

      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        1000,        // LIMIT
        999998000    // OFFSET = (999999 - 1) * 1000
      );
    });

    test('should handle zero and negative pagination values', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      // 测试零页码
      await getAllPodcasts(0, 10, false);
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        10,   // LIMIT
        -10   // OFFSET = (0 - 1) * 10
      );

      mockSql.mockClear();

      // 测试负页码
      await getAllPodcasts(-1, 5, false);
      expect(mockSql).toHaveBeenCalledWith(
        expect.any(Array),
        5,    // LIMIT
        -10   // OFFSET = (-1 - 1) * 5
      );
    });
  });

  describe('Query Performance Considerations', () => {
    test('getAllPodcasts should use LEFT JOIN for performance', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      await getAllPodcasts(1, 10, true);

      const sqlTemplate = mockSql.mock.calls[0][0];
      const query = sqlTemplate.join('').toLowerCase();

      // 验证使用了LEFT JOIN而不是子查询
      expect(query).toContain('left join');
      expect(query).toContain('analysis_results');
      
      // 验证有ORDER BY用于排序
      expect(query).toContain('order by');
      expect(query).toContain('created_at desc');
    });

    test('should limit result set properly', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      await getAllPodcasts(1, 50, false);

      const sqlTemplate = mockSql.mock.calls[0][0];
      const query = sqlTemplate.join('').toLowerCase();

      // 验证有LIMIT和OFFSET
      expect(query).toContain('limit');
      expect(query).toContain('offset');
    });
  });
}); 