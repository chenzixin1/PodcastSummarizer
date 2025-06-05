/**
 * Dashboard Page Component Tests - API Request Deduplication
 * 
 * CONTEXT:
 * These tests were created after discovering a critical issue in the application where duplicate API requests
 * were being sent to the OpenRouter API when processing SRT files. The issue manifested in two ways:
 * 1. Interface flickering due to repeated state changes from multiple identical API calls
 * 2. Wasted resources and unnecessary costs due to duplicate API calls to OpenRouter
 * 
 * ROOT CAUSE:
 * The issue was traced to two main problems:
 * 1. A syntax error in the API route handler (app/api/process/route.ts) where a missing closing brace
 *    caused improper response handling
 * 2. The dashboard page (app/dashboard/[id]/page.tsx) was not properly tracking if a request was already
 *    sent, leading to duplicate requests during component re-renders and React StrictMode's double rendering
 * 
 * FIX IMPLEMENTED:
 * 1. Fixed the API route handler to properly return streaming responses
 * 2. Added request deduplication in the dashboard page using useRef to track if a request was already sent
 * 3. Added proper cleanup functions to reset states
 * 4. Modified retry logic to prevent duplicate calls
 * 
 * THESE TESTS ENSURE:
 * - The dashboard page doesn't send duplicate requests during initial load
 * - Already processed files don't trigger unnecessary requests
 * - The retry functionality only sends one request at a time
 * - Multiple renders of the component (e.g., from React StrictMode) don't cause duplicate requests
 * - Error handling works properly for failed requests
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'next/navigation';
import DashboardPage from '../../app/dashboard/[id]/page';
import '@testing-library/jest-dom';

// 模拟useParams返回的ID
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

// 模拟全局fetch函数
const mockFetch = jest.fn();
global.fetch = mockFetch;

// 创建模拟ReadableStream
const createMockStream = () => {
  let onRead: ((value: { done: boolean; value: Uint8Array }) => void) | undefined;
  const mockReader = {
    read: jest.fn().mockImplementation(() => 
      new Promise(resolve => {
        onRead = resolve;
      })
    ),
  };
  
  const mockResponse = {
    ok: true,
    body: {
      getReader: jest.fn().mockReturnValue(mockReader),
    },
    text: jest.fn().mockResolvedValue(''),
  };
  
  const resolve = (done = false, value = new Uint8Array(0)) => {
    if (onRead) {
      onRead({ done, value });
    }
  };
  
  return { mockResponse, mockReader, resolve };
};

// 启用localStorage模拟
beforeEach(() => {
  // 清空localStorage
  window.localStorage.clear();
  
  // 重置所有模拟
  jest.clearAllMocks();
  
  // 模拟useParams返回一个固定的ID
  (useParams as jest.Mock).mockReturnValue({ id: 'test-id-123' });
  
  // 设置一些基本的localStorage数据
  window.localStorage.setItem(`srtfile-test-id-123-name`, 'test.srt');
  window.localStorage.setItem(`srtfile-test-id-123-size`, '1024');
  window.localStorage.setItem(`srtfile-test-id-123-url`, 'https://example.com/test.srt');
});

describe('DashboardPage API请求去重测试', () => {
  test('未处理文件时，仅发送一次API请求', async () => {
    // 设置localStorage状态为未处理
    window.localStorage.setItem(`srtfile-test-id-123-processed`, 'false');
    
    // 设置模拟响应
    const { mockResponse, resolve } = createMockStream();
    mockFetch.mockResolvedValue(mockResponse);
    
    // 渲染组件
    render(<DashboardPage />);
    
    // 等待一下组件渲染完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证仅调用一次fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/process', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
      body: expect.any(String),
    }));
    
    // 解析JSON body确认参数正确
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      id: 'test-id-123',
      blobUrl: 'https://example.com/test.srt',
      fileName: 'test.srt',
    });
    
    // 再次渲染组件模拟React StrictMode的重复渲染
    render(<DashboardPage />);
    
    // 等待一下重新渲染完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证仍然只有一次fetch调用（没有新的调用）
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // 清理
    resolve(true);
  });
  
  test('已处理文件不发送API请求', async () => {
    // 设置localStorage状态为已处理
    window.localStorage.setItem(`srtfile-test-id-123-processed`, 'true');
    window.localStorage.setItem(`srtfile-test-id-123-summary`, '测试摘要');
    window.localStorage.setItem(`srtfile-test-id-123-translation`, '测试翻译');
    window.localStorage.setItem(`srtfile-test-id-123-highlights`, '测试高亮');
    
    // 渲染组件
    render(<DashboardPage />);
    
    // 等待组件渲染完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证fetch没有被调用
    expect(mockFetch).not.toHaveBeenCalled();
  });
  
  test('点击重试按钮时，仅发送一次API请求', async () => {
    // 设置localStorage状态为已处理但需要重试
    window.localStorage.setItem(`srtfile-test-id-123-processed`, 'true');
    
    // 设置模拟响应
    const { mockResponse, resolve } = createMockStream();
    mockFetch.mockResolvedValue(mockResponse);
    
    // 渲染组件
    const { getByText } = render(<DashboardPage />);
    
    // 等待组件渲染完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 确认初始未发送请求
    expect(mockFetch).not.toHaveBeenCalled();
    
    // 找到并点击重试按钮
    const retryButton = getByText('重新处理文件');
    await userEvent.click(retryButton);
    
    // 等待点击事件处理完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证仅调用一次fetch，且带有allowRetry参数
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      id: 'test-id-123',
      blobUrl: 'https://example.com/test.srt',
      fileName: 'test.srt',
      allowRetry: true,
    });
    
    // 模拟重复点击重试按钮
    await userEvent.click(retryButton);
    
    // 等待处理完成
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证不会发送额外请求（isProcessing标记阻止了重复请求）
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // 清理
    resolve(true);
  });
  
  test('重复渲染组件不会导致重复请求', async () => {
    // 设置localStorage状态为未处理
    window.localStorage.setItem(`srtfile-test-id-123-processed`, 'false');
    
    // 设置模拟响应
    const { mockResponse, resolve } = createMockStream();
    mockFetch.mockResolvedValue(mockResponse);
    
    // 连续多次渲染组件模拟React StrictMode或开发模式中的行为
    const { unmount } = render(<DashboardPage />);
    
    // 第一次等待
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 卸载并重新渲染
    unmount();
    render(<DashboardPage />);
    
    // 第二次等待
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 再次卸载并重新渲染
    unmount();
    render(<DashboardPage />);
    
    // 第三次等待
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    
    // 验证仍然只有一次fetch调用（requestSentRef防止了重复请求）
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // 清理
    resolve(true);
  });
  
  test('解析API响应中的错误并显示', async () => {
    // 设置localStorage状态为未处理
    window.localStorage.setItem(`srtfile-test-id-123-processed`, 'false');
    
    // 设置模拟错误响应
    mockFetch.mockResolvedValue({
      ok: false,
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: '测试错误信息' })),
    });
    
    // 渲染组件
    const { findByText } = render(<DashboardPage />);
    
    // 等待错误消息显示
    const errorMessage = await findByText(/测试错误信息/);
    expect(errorMessage).toBeInTheDocument();
  });
}); 