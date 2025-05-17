/**
 * Request Tracking Utility - For Monitoring and Analyzing API Request Patterns
 * 
 * CONTEXT:
 * This utility was created as part of resolving a critical issue in the Podcast Summarizer application
 * where duplicate API requests were being sent to the OpenRouter API when processing SRT files.
 * These duplicate requests caused:
 * 1. Interface flickering as components repeatedly updated with identical data
 * 2. Wasted API calls to OpenRouter, increasing costs unnecessarily
 * 
 * PURPOSE:
 * This utility provides tools to monitor, track, and analyze HTTP request patterns in both
 * test and development environments. It helps identify:
 * - Duplicate API calls to the same endpoints
 * - Suspicious request timing patterns that may indicate unintentional requests
 * - Overall request efficiency and usage statistics
 * 
 * USAGE:
 * This tracker can be used in two primary ways:
 * 1. Direct integration in tests to verify request behavior
 * 2. As part of the request-testing script (scripts/test-requests.ts) for automated monitoring
 * 
 * KEY FEATURES:
 * - Request deduplication detection
 * - Time-based request pattern analysis
 * - Statistics on request efficiency
 * - Integration with the global fetch API
 * - Support for CI/CD pipeline integration
 */

/**
 * 请求跟踪工具 - 用于检测和分析请求模式，找出重复请求
 * 
 * 使用方法:
 * 1. 将此模块导入到需要测试的文件
 * 2. 使用 trackRequest 函数包装fetch调用
 * 3. 在测试结束后调用 getStats() 分析请求情况
 */

// 请求记录类型
interface RequestRecord {
  url: string;
  method: string;
  body?: any;
  timestamp: number;
  hash: string; // 请求的唯一标识
}

// 存储所有请求记录
const requests: RequestRecord[] = [];

// 清除所有记录
export function clearRequestTracker() {
  requests.length = 0;
}

// 计算请求哈希值，作为唯一标识
function hashRequest(url: string, method: string, body?: any): string {
  // 针对body，JSON序列化，确保相同内容产生相同哈希
  const bodyStr = body ? JSON.stringify(body) : '';
  return `${method}:${url}:${bodyStr}`;
}

// 跟踪请求
export function trackRequest(
  url: string, 
  method: string = 'GET', 
  body?: any
): RequestRecord {
  const hash = hashRequest(url, method, body);
  const record: RequestRecord = {
    url,
    method,
    body,
    timestamp: Date.now(),
    hash
  };
  
  requests.push(record);
  return record;
}

// 获取指定时间段内的请求数
export function getRequestCountInPeriod(
  startTime: number, 
  endTime: number
): number {
  return requests.filter(r => 
    r.timestamp >= startTime && r.timestamp <= endTime
  ).length;
}

// 检测重复请求
export function findDuplicateRequests(): { [hash: string]: RequestRecord[] } {
  const requestsByHash: { [hash: string]: RequestRecord[] } = {};
  
  requests.forEach(record => {
    if (!requestsByHash[record.hash]) {
      requestsByHash[record.hash] = [];
    }
    requestsByHash[record.hash].push(record);
  });
  
  // 过滤出重复的请求
  return Object.entries(requestsByHash)
    .filter(([_, records]) => records.length > 1)
    .reduce((result, [hash, records]) => {
      result[hash] = records;
      return result;
    }, {} as { [hash: string]: RequestRecord[] });
}

// 获取请求统计信息
export function getStats() {
  const duplicates = findDuplicateRequests();
  const totalRequests = requests.length;
  const uniqueRequests = Object.keys(
    requests.reduce((unique, record) => {
      unique[record.hash] = true;
      return unique;
    }, {} as { [hash: string]: boolean })
  ).length;
  
  const duplicateCount = totalRequests - uniqueRequests;
  
  return {
    totalRequests,
    uniqueRequests,
    duplicateCount,
    duplicatePercent: totalRequests > 0 
      ? Math.round((duplicateCount / totalRequests) * 100) 
      : 0,
    duplicates
  };
}

// 替换全局fetch以自动跟踪请求
export function enableAutoTracking() {
  const originalFetch = global.fetch;
  
  // 替换全局fetch
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method || 'GET';
    const body = init?.body;
    
    // 跟踪请求
    trackRequest(url, method, body);
    
    // 调用原始fetch
    return originalFetch(input, init);
  };
  
  return () => {
    // 返回恢复函数
    global.fetch = originalFetch;
  };
}

// 高级请求分析 - 识别请求组模式
export function analyzeRequestPatterns() {
  // 按URL分组
  const requestsByUrl: { [url: string]: RequestRecord[] } = {};
  
  requests.forEach(record => {
    if (!requestsByUrl[record.url]) {
      requestsByUrl[record.url] = [];
    }
    requestsByUrl[record.url].push(record);
  });
  
  // 分析每个URL的请求模式
  const patterns = Object.entries(requestsByUrl).map(([url, records]) => {
    const totalForUrl = records.length;
    
    // 计算请求间隔
    const intervals: number[] = [];
    if (records.length > 1) {
      for (let i = 1; i < records.length; i++) {
        intervals.push(records[i].timestamp - records[i-1].timestamp);
      }
    }
    
    // 计算平均间隔和标准差
    const avgInterval = intervals.length 
      ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
      : 0;
      
    // 标准差计算（请求间隔的离散程度）
    const stdDev = intervals.length 
      ? Math.sqrt(
          intervals.reduce((sum, interval) => 
            sum + Math.pow(interval - avgInterval, 2), 0
          ) / intervals.length
        )
      : 0;
    
    // 检测重复请求（基于时间模式）
    // 假设间隔小于100ms的连续请求可能是错误的重复
    const suspiciousRepeats = intervals.filter(interval => interval < 100).length;
    
    return {
      url,
      totalRequests: totalForUrl,
      avgIntervalMs: Math.round(avgInterval),
      stdDevMs: Math.round(stdDev),
      suspiciousRepeats,
      isProblematic: suspiciousRepeats > 0 || (totalForUrl > 2 && stdDev < avgInterval * 0.1)
    };
  });
  
  return {
    patterns,
    problematicUrls: patterns
      .filter(p => p.isProblematic)
      .map(p => p.url)
  };
}

// 导出请求跟踪器
export default {
  trackRequest,
  clearRequestTracker,
  getRequestCountInPeriod,
  findDuplicateRequests,
  getStats,
  enableAutoTracking,
  analyzeRequestPatterns
}; 