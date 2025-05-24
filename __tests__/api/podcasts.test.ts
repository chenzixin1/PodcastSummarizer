/**
 * Podcasts API Route Tests
 * 
 * 测试获取播客列表API的各种场景：
 * 1. 正常获取播客列表
 * 2. 分页功能
 * 3. 公开/私有播客过滤
 * 4. 错误处理
 * 5. 参数验证
 */

/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/podcasts/route';

// Mock 数据库操作 - 必须在导入API路由之前
jest.mock('../../lib/db', () => ({
  getAllPodcasts: jest.fn()
}));

// 获取mock函数的引用
const mockGetAllPodcasts = jest.fn();

// 在每个测试中重新设置mock
beforeEach(() => {
  jest.clearAllMocks();
  // 重新设置mock实现
  require('../../lib/db').getAllPodcasts = mockGetAllPodcasts;
});

describe('Podcasts API Tests', () => {
  it('should return paginated podcasts with default parameters', async () => {
    const mockPodcasts = [
      { id: '1', title: 'Test Podcast 1', created_at: '2024-01-01' },
      { id: '2', title: 'Test Podcast 2', created_at: '2024-01-02' }
    ];

    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: mockPodcasts
    });

    const url = new URL('http://localhost:3000/api/podcasts');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockPodcasts);
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 10, false);
  });

  it('should handle custom pagination parameters', async () => {
    const mockPodcasts = [
      { id: '3', title: 'Test Podcast 3', created_at: '2024-01-03' }
    ];

    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: mockPodcasts
    });

    const url = new URL('http://localhost:3000/api/podcasts?page=2&pageSize=5');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockPodcasts);
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(2, 5, false);
  });

  it('should handle includePrivate parameter', async () => {
    const mockPodcasts = [
      { id: '1', title: 'Private Podcast', created_at: '2024-01-01', isPublic: false }
    ];

    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: mockPodcasts
    });

    const url = new URL('http://localhost:3000/api/podcasts?includePrivate=true');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockPodcasts);
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 10, true);
  });

  it('should handle database errors gracefully', async () => {
    mockGetAllPodcasts.mockResolvedValue({
      success: false,
      error: 'Database connection failed'
    });

    const url = new URL('http://localhost:3000/api/podcasts');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Database connection failed');
  });

  it('should handle database exceptions', async () => {
    mockGetAllPodcasts.mockRejectedValue(new Error('Connection timeout'));

    const url = new URL('http://localhost:3000/api/podcasts');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
    expect(data.details).toBe('Connection timeout');
  });

  it('should handle empty results', async () => {
    mockGetAllPodcasts.mockResolvedValue({
      success: true,
      data: []
    });

    const url = new URL('http://localhost:3000/api/podcasts');
    const request = new NextRequest(url);
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
  });
}); 