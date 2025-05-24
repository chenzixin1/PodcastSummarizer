/**
 * @jest-environment node
 */

/**
 * Upload API Route Tests
 * 
 * 测试文件上传API的各种场景：
 * 1. 正常上传SRT文件
 * 2. 文件类型验证
 * 3. 错误处理
 * 4. 数据库保存
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/upload/route';

// Mock dependencies
jest.mock('@vercel/blob', () => ({
  put: jest.fn()
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn()
}));

jest.mock('../../lib/db', () => ({
  savePodcast: jest.fn()
}));

// 获取mock函数的引用
const mockPut = jest.fn();
const mockNanoid = jest.fn();
const mockSavePodcast = jest.fn();

// 在每个测试中重新设置mock
beforeEach(() => {
  jest.clearAllMocks();
  require('@vercel/blob').put = mockPut;
  require('nanoid').nanoid = mockNanoid;
  require('../../lib/db').savePodcast = mockSavePodcast;
  
  // 设置默认的mock返回值
  mockNanoid.mockReturnValue('mock-id-12345');
  mockPut.mockResolvedValue({ url: 'https://blob.example.com/mock-id-12345-test.srt' });
  mockSavePodcast.mockResolvedValue({ success: true });
});

describe('Upload API Tests', () => {
  it('should successfully upload valid SRT file', async () => {
    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe('mock-id-12345');
  });

  it('should reject invalid file type', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid file type');
  });

  it('should reject request without file', async () => {
    const formData = new FormData();
    // No file appended

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('No file uploaded');
  });

  it('should reject empty file', async () => {
    const file = new File([], 'empty.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('File is empty');
  });

  it('should handle .srt file extension correctly', async () => {
    const file = new File(['test content'], 'test.srt', { type: '' }); // Empty type but .srt extension
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should handle database save failure gracefully', async () => {
    mockSavePodcast.mockResolvedValue({
      success: false,
      error: 'Database error'
    });

    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to save podcast');
  });
}); 