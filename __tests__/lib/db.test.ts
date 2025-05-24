/**
 * Database Operations Tests
 * 
 * 测试所有数据库操作函数：
 * 1. 数据库初始化
 * 2. 播客CRUD操作
 * 3. 分析结果CRUD操作
 * 4. 分页查询
 * 5. 错误处理
 */

// Mock Vercel Postgres
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn()
}));

import {
  initDatabase,
  savePodcast,
  saveAnalysisResults,
  getPodcast,
  getAnalysisResults,
  getAllPodcasts,
  getUserPodcasts,
  deletePodcast,
  updatePodcastPublicStatus,
  type Podcast,
  type AnalysisResult,
  type DbResult
} from '../../lib/db';

import { sql } from '@vercel/postgres';

const mockSql = sql as jest.MockedFunction<typeof sql>;

describe('Database Operations Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // 默认的 SQL mock 行为
    mockSql.mockImplementation(() => {
      return Promise.resolve({ rows: [] } as any);
    });
  });

  describe('initDatabase', () => {
    test('should successfully initialize database tables', async () => {
      const result = await initDatabase();
      
      expect(result.success).toBe(true);
      expect(mockSql).toHaveBeenCalledTimes(2); // 两个CREATE TABLE语句
    });

    test('should handle database initialization error', async () => {
      mockSql.mockRejectedValue(new Error('Connection failed'));
      
      const result = await initDatabase();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('savePodcast', () => {
    const mockPodcast: Podcast = {
      id: 'test-id-123',
      title: 'Test Podcast',
      originalFileName: 'test.srt',
      fileSize: '1.5 KB',
      blobUrl: 'https://example.com/test.srt',
      isPublic: false
    };

    test('should successfully save podcast', async () => {
      mockSql.mockResolvedValue({
        rows: [{ id: 'test-id-123' }]
      } as any);

      const result = await savePodcast(mockPodcast);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'test-id-123' });
    });

    test('should handle save podcast error', async () => {
      mockSql.mockRejectedValue(new Error('Database constraint violation'));

      const result = await savePodcast(mockPodcast);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database constraint violation');
    });
  });

  describe('saveAnalysisResults', () => {
    const mockAnalysisResult: AnalysisResult = {
      podcastId: 'test-id-123',
      summary: 'Test summary',
      translation: 'Test translation',
      highlights: 'Test highlights'
    };

    test('should successfully save analysis results', async () => {
      mockSql.mockResolvedValue({
        rows: [{ podcast_id: 'test-id-123' }]
      } as any);

      const result = await saveAnalysisResults(mockAnalysisResult);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ podcast_id: 'test-id-123' });
    });

    test('should handle save analysis results error', async () => {
      mockSql.mockRejectedValue(new Error('Foreign key constraint failed'));

      const result = await saveAnalysisResults(mockAnalysisResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Foreign key constraint failed');
    });
  });

  describe('getPodcast', () => {
    test('should successfully get podcast by id', async () => {
      const mockPodcastData = {
        id: 'test-id-123',
        title: 'Test Podcast',
        originalFileName: 'test.srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test.srt',
        isPublic: false,
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockSql.mockResolvedValue({
        rows: [mockPodcastData]
      } as any);

      const result = await getPodcast('test-id-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockPodcastData);
    });

    test('should return error when podcast not found', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      const result = await getPodcast('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Podcast not found');
    });

    test('should handle database error', async () => {
      mockSql.mockRejectedValue(new Error('Database connection lost'));

      const result = await getPodcast('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
    });
  });

  describe('getAnalysisResults', () => {
    test('should successfully get analysis results', async () => {
      const mockAnalysisData = {
        podcastId: 'test-id-123',
        summary: 'Test summary',
        translation: 'Test translation',
        highlights: 'Test highlights',
        processedAt: '2024-01-01T00:00:00Z'
      };

      mockSql.mockResolvedValue({
        rows: [mockAnalysisData]
      } as any);

      const result = await getAnalysisResults('test-id-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockAnalysisData);
    });

    test('should return error when analysis results not found', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      const result = await getAnalysisResults('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Analysis results not found');
    });
  });

  describe('getAllPodcasts', () => {
    const mockPodcastsList = [
      {
        id: 'podcast-1',
        title: 'Podcast 1',
        originalFileName: 'test1.srt',
        fileSize: '1.5 KB',
        blobUrl: 'https://example.com/test1.srt',
        isPublic: true,
        createdAt: '2024-01-01T00:00:00Z',
        isProcessed: true
      },
      {
        id: 'podcast-2',
        title: 'Podcast 2',
        originalFileName: 'test2.srt',
        fileSize: '2.0 KB',
        blobUrl: 'https://example.com/test2.srt',
        isPublic: false,
        createdAt: '2024-01-02T00:00:00Z',
        isProcessed: false
      }
    ];

    test('should get all public podcasts by default', async () => {
      mockSql.mockResolvedValue({
        rows: mockPodcastsList.filter(p => p.isPublic)
      } as any);

      const result = await getAllPodcasts();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].isPublic).toBe(true);
    });

    test('should include private podcasts when requested', async () => {
      mockSql.mockResolvedValue({
        rows: mockPodcastsList
      } as any);

      const result = await getAllPodcasts(1, 10, true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    test('should handle pagination correctly', async () => {
      mockSql.mockResolvedValue({
        rows: mockPodcastsList
      } as any);

      const result = await getAllPodcasts(2, 5, false);

      expect(result.success).toBe(true);
    });

    test('should handle database error', async () => {
      mockSql.mockRejectedValue(new Error('Query timeout'));

      const result = await getAllPodcasts();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query timeout');
    });
  });

  describe('getUserPodcasts', () => {
    test('should delegate to getAllPodcasts with includePrivate=true', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      const result = await getUserPodcasts('user-123', 2, 5);

      expect(result.success).toBe(true);
    });
  });

  describe('deletePodcast', () => {
    test('should successfully delete podcast and its analysis results', async () => {
      // Mock 两次调用：先删除analysis_results，再删除podcast
      mockSql
        .mockResolvedValueOnce({ rows: [] } as any) // DELETE analysis_results
        .mockResolvedValueOnce({ rows: [{ id: 'test-id-123' }] } as any); // DELETE podcast

      const result = await deletePodcast('test-id-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'test-id-123' });
      expect(mockSql).toHaveBeenCalledTimes(2);
    });

    test('should return error when podcast not found for deletion', async () => {
      mockSql
        .mockResolvedValueOnce({ rows: [] } as any) // DELETE analysis_results
        .mockResolvedValueOnce({ rows: [] } as any); // DELETE podcast (not found)

      const result = await deletePodcast('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Podcast not found or already deleted');
    });

    test('should handle database error during deletion', async () => {
      mockSql.mockRejectedValue(new Error('Foreign key constraint'));

      const result = await deletePodcast('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Foreign key constraint');
    });
  });

  describe('updatePodcastPublicStatus', () => {
    test('should successfully update podcast public status', async () => {
      mockSql.mockResolvedValue({
        rows: [{ id: 'test-id-123' }]
      } as any);

      const result = await updatePodcastPublicStatus('test-id-123', true);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'test-id-123', isPublic: true });
    });

    test('should return error when podcast not found for update', async () => {
      mockSql.mockResolvedValue({
        rows: []
      } as any);

      const result = await updatePodcastPublicStatus('non-existent-id', false);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Podcast not found');
    });

    test('should handle database error during update', async () => {
      mockSql.mockRejectedValue(new Error('Database lock timeout'));

      const result = await updatePodcastPublicStatus('test-id-123', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database lock timeout');
    });
  });

  describe('Error Handling', () => {
    test('should handle non-Error objects thrown by database', async () => {
      mockSql.mockRejectedValue('String error');

      const result = await getPodcast('test-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    test('should handle undefined/null errors', async () => {
      mockSql.mockRejectedValue(null);

      const result = await getPodcast('test-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('null');
    });
  });
}); 