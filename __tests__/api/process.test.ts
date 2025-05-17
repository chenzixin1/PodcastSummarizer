/**
 * API Process Route Tests - Request Deduplication
 * 
 * CONTEXT:
 * These tests were created after discovering a critical issue in the application where duplicate API requests
 * were being sent to the OpenRouter API when processing SRT files. The issue manifested in two ways:
 * 1. Interface flickering due to repeated state changes from multiple identical API calls
 * 2. Wasted resources and unnecessary costs due to duplicate API calls to OpenRouter
 * 
 * ROOT CAUSE:
 * The issue was traced to two main problems:
 * 1. A syntax error in this API route handler (app/api/process/route.ts) where a missing closing brace
 *    caused improper response handling
 * 2. The dashboard page (app/dashboard/[id]/page.tsx) was not properly tracking if a request was already
 *    sent, leading to duplicate requests during component re-renders
 * 
 * FIX IMPLEMENTED:
 * 1. Fixed the API route handler to properly return streaming responses by:
 *    - Removing internal return statements from the ReadableStream's start callback
 *    - Using controller.close() to properly end streams
 *    - Adding a proper return statement with the stream at the handler's end
 * 2. Added server-side request deduplication to prevent processing the same file multiple times
 *    - Implemented request tracking with timeout mechanism
 *    - Added special handling for explicit retry requests
 * 
 * THESE TESTS ENSURE:
 * - Duplicate requests for the same file ID are properly rejected with 409 status
 * - Requests with allowRetry=true can bypass the duplicate detection (for explicit retries)
 * - Requests are automatically cleared from the deduplication system after timeout
 * - Invalid requests are properly rejected with appropriate error messages
 */

/**
 * API Route测试 - 测试process路由的请求去重功能
 */
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/process/route';

// 模拟OpenRouter调用
jest.mock('openai-edge', () => {
  return {
    Configuration: jest.fn().mockImplementation(() => ({})),
    OpenAIApi: jest.fn().mockImplementation(() => ({
      createChatCompletion: jest.fn().mockImplementation(() => {
        const mockResponse = {
          ok: true,
          body: {
            getReader: jest.fn().mockReturnValue({
              read: jest.fn().mockResolvedValue({ done: true })
            })
          }
        };
        return mockResponse;
      })
    }))
  };
});

// 模拟fetch
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    text: jest.fn().mockResolvedValue('测试SRT内容')
  })
);

// 使用Date.now模拟处理请求时间
const originalDateNow = Date.now;
let mockNow = 1683000000000; // 固定时间戳起点
Date.now = jest.fn().mockImplementation(() => mockNow);

describe('处理API路由测试', () => {
  // 每个测试前重置模拟
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 1683000000000; // 重置时间戳
  });
  
  // 测试结束后恢复Date.now
  afterAll(() => {
    Date.now = originalDateNow;
  });
  
  test('重复请求同一ID被正确拒绝', async () => {
    // 创建请求对象
    const makeRequest = (allowRetry = false) => new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      body: JSON.stringify({
        id: 'duplicate-test-id',
        blobUrl: 'https://example.com/test.srt',
        fileName: 'test.srt',
        allowRetry,
      }),
    });
    
    // 第一个请求应正常处理
    const firstResponse = await POST(makeRequest());
    expect(firstResponse.status).toBe(200);
    
    // 第二个请求（同一ID）应被拒绝，返回409冲突
    const secondResponse = await POST(makeRequest());
    expect(secondResponse.status).toBe(409);
    
    // 检查错误消息
    const secondResponseData = await secondResponse.json();
    expect(secondResponseData.error).toBe('This file is already being processed');
    expect(secondResponseData.status).toBe('duplicate');
  });
  
  test('带有allowRetry参数的请求应绕过重复检查', async () => {
    // 第一个正常请求
    const firstResponse = await POST(
      new NextRequest('http://localhost:3000/api/process', {
        method: 'POST',
        body: JSON.stringify({
          id: 'retry-test-id',
          blobUrl: 'https://example.com/test.srt',
          fileName: 'test.srt',
        }),
      })
    );
    expect(firstResponse.status).toBe(200);
    
    // 第二个请求使用同一ID但带allowRetry=true
    const secondResponse = await POST(
      new NextRequest('http://localhost:3000/api/process', {
        method: 'POST',
        body: JSON.stringify({
          id: 'retry-test-id',
          blobUrl: 'https://example.com/test.srt',
          fileName: 'test.srt',
          allowRetry: true,
        }),
      })
    );
    
    // 应被允许处理
    expect(secondResponse.status).toBe(200);
  });
  
  test('超时的请求应允许重新处理', async () => {
    // 第一个请求
    const firstResponse = await POST(
      new NextRequest('http://localhost:3000/api/process', {
        method: 'POST',
        body: JSON.stringify({
          id: 'timeout-test-id',
          blobUrl: 'https://example.com/test.srt',
          fileName: 'test.srt',
        }),
      })
    );
    expect(firstResponse.status).toBe(200);
    
    // 模拟时间前进4分钟（超出3分钟超时限制）
    mockNow += 4 * 60 * 1000;
    
    // 第二个请求使用同一ID，不带allowRetry
    const secondResponse = await POST(
      new NextRequest('http://localhost:3000/api/process', {
        method: 'POST',
        body: JSON.stringify({
          id: 'timeout-test-id',
          blobUrl: 'https://example.com/test.srt',
          fileName: 'test.srt',
        }),
      })
    );
    
    // 应被允许处理，因为前一个请求已超时
    expect(secondResponse.status).toBe(200);
  });
  
  test('验证错误请求处理', async () => {
    // 缺少必需字段的请求
    const invalidResponse = await POST(
      new NextRequest('http://localhost:3000/api/process', {
        method: 'POST',
        body: JSON.stringify({
          // 缺少id和fileName
          blobUrl: 'https://example.com/test.srt',
        }),
      })
    );
    
    expect(invalidResponse.status).toBe(400);
    const errorData = await invalidResponse.json();
    expect(errorData.error).toContain('Missing required fields');
  });
}); 