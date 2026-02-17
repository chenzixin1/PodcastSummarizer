/**
 * Process API Route Tests
 * 
 * 测试播客处理API的各种场景：
 * 1. 正常处理流程（流式响应）
 * 2. 错误处理
 * 3. 参数验证
 * 4. 内容解析和处理
 */

/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/process/route';

// Mock 全局 fetch
global.fetch = jest.fn();

// Mock 数据库操作
jest.mock('../../lib/db', () => ({
  saveAnalysisResults: jest.fn(),
  saveAnalysisPartialResults: jest.fn(),
  getPodcast: jest.fn(),
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/workerAuth', () => ({
  isWorkerAuthorizedBySecret: jest.fn(() => true),
}));

// 获取mock函数的引用
const {
  saveAnalysisResults: mockSaveAnalysisResults,
  saveAnalysisPartialResults: mockSaveAnalysisPartialResults,
  getPodcast: mockGetPodcast,
} = require('../../lib/db');

// Helper function to read stream response
async function readStreamResponse(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  
  if (!reader) return events;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data.trim()) {
            events.push(data);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return events;
}

describe('Process API Tests', () => {
  const previousWorkerSecret = process.env.PROCESS_WORKER_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROCESS_WORKER_SECRET = 'test-worker-secret';
    mockSaveAnalysisPartialResults.mockResolvedValue({ success: true });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'test-id',
        title: 'Test Podcast',
        sourceReference: null,
        userId: 'user-001',
      },
    });
  });

  afterAll(() => {
    process.env.PROCESS_WORKER_SECRET = previousWorkerSecret;
  });

  it('should return error for missing required fields', async () => {
    const requestData = {
      id: 'test-id'
      // Missing blobUrl
    };

    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-process-worker-secret': 'test-worker-secret',
      },
      body: JSON.stringify(requestData)
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });

  it('should return error for empty request body', async () => {
    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });

  it('should return stream response with correct headers for valid request', async () => {
    // Mock successful file fetch
    const mockSrtContent = `1
00:00:00,000 --> 00:00:02,000
Hello world`;

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockSrtContent)
    });

    mockSaveAnalysisResults.mockResolvedValue({
      success: true
    });

    const requestData = {
      id: 'test-id',
      blobUrl: 'https://example.com/test.srt',
      fileName: 'test.srt'
    };

    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    const response = await POST(request);

    if (response.headers.get('Content-Type') === 'application/json') {
      const payload = await response.json();
      throw new Error(`Expected stream response but got JSON: ${JSON.stringify(payload)}`);
    }

    // Check response headers for streaming
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    
    // Check that response body exists (is a stream)
    expect(response.body).toBeDefined();
  });

  it('should handle missing id field', async () => {
    const requestData = {
      blobUrl: 'https://example.com/test.srt'
      // Missing id
    };

    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });
}); 
