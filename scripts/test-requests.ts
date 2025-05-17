#!/usr/bin/env node
/**
 * Duplicate API Request Detection Script
 * 
 * CONTEXT:
 * This script was created as part of resolving a critical issue in the Podcast Summarizer application
 * where duplicate API requests were being sent to the OpenRouter API when processing SRT files.
 * These duplicate requests caused:
 * 1. Interface flickering due to repeated state changes from multiple identical API calls
 * 2. Wasted resources and unnecessary costs due to redundant API calls to OpenRouter
 * 
 * PROBLEM BACKGROUND:
 * The issue stemmed from two main sources:
 * 1. A syntax error in the API route handler (app/api/process/route.ts) leading to improper
 *    response handling and duplicate processing
 * 2. The dashboard page (app/dashboard/[id]/page.tsx) not properly tracking if a request was
 *    already sent, causing multiple identical requests during React component lifecycle events
 * 
 * PURPOSE:
 * This automated script creates a controlled test environment to:
 * 1. Monitor and analyze all API requests made during simulated user navigation
 * 2. Detect duplicate requests to critical endpoints
 * 3. Provide detailed reporting on request patterns
 * 4. Automatically fail CI/CD pipelines if duplicate requests are detected
 * 
 * INTEGRATION:
 * This script can be integrated into development workflows in two ways:
 * 1. As a manual check during development (npm run test:requests)
 * 2. As an automated check in CI/CD pipelines to prevent regression
 */

/**
 * 请求重复检测脚本
 * 
 * 此脚本用于检测应用程序中的重复请求问题，可以集成到CI/CD流程中。
 * 使用方法:
 * 1. npm run test:requests
 * 2. 脚本将自动加载配置，运行仿真测试并报告潜在问题
 */

import { spawn } from 'child_process';
import { createServer } from 'http';
import { parse } from 'url';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import requestTracker from '../__tests__/utils/requestTracker';

// 配置项
const CONFIG = {
  appPort: 3000,            // 应用程序端口
  proxyPort: 3001,          // 代理服务器端口
  endpointsToMonitor: [     // 要监控的终端节点
    '/api/process',
  ],
  simulateStrictMode: true, // 是否模拟React严格模式（多次渲染）
  simulationTime: 10000,    // 模拟运行时间（毫秒）
  maxDuplicateThreshold: 0, // 允许的最大重复请求数（0表示不允许重复）
};

// 测试页面路径
const TEST_PATHS = [
  '/dashboard/test-id-1',
  '/dashboard/test-id-2',
  '/upload',
  '/'
];

// 控制台颜色
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// 启动Next.js服务器
function startNextServer(): Promise<ReturnType<typeof spawn>> {
  console.log(`${COLORS.blue}启动Next.js开发服务器...${COLORS.reset}`);
  
  return new Promise((resolve) => {
    const server = spawn('npm', ['run', 'dev', '--', '--port', CONFIG.appPort.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('Ready in')) {
        console.log(`${COLORS.green}Next.js服务器已启动，端口: ${CONFIG.appPort}${COLORS.reset}`);
        resolve(server);
      }
    });
    
    server.stderr.on('data', (data) => {
      console.error(`${COLORS.red}Next.js服务器错误: ${data}${COLORS.reset}`);
    });
  });
}

// 启动代理服务器
function startProxyServer(): Promise<ReturnType<typeof createServer>> {
  console.log(`${COLORS.blue}启动代理服务器...${COLORS.reset}`);
  
  return new Promise((resolve) => {
    const proxy = createServer((req, res) => {
      const url = parse(req.url || '');
      
      // 监控指定端点
      if (CONFIG.endpointsToMonitor.some(endpoint => url.pathname?.startsWith(endpoint))) {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          // 跟踪请求
          requestTracker.trackRequest(
            `http://localhost:${CONFIG.appPort}${url.path}`,
            req.method || 'GET',
            body
          );
        });
      }
      
      // 转发请求到实际应用
      const options = {
        hostname: 'localhost',
        port: CONFIG.appPort,
        path: url.path,
        method: req.method,
        headers: req.headers
      };
      
      const proxyReq = require('http').request(options, (proxyRes: any) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      
      req.pipe(proxyReq, { end: true });
    });
    
    proxy.listen(CONFIG.proxyPort, () => {
      console.log(`${COLORS.green}代理服务器已启动，端口: ${CONFIG.proxyPort}${COLORS.reset}`);
      resolve(proxy);
    });
  });
}

// 模拟用户浏览
async function simulateUserBrowsing() {
  console.log(`${COLORS.blue}模拟用户浏览...${COLORS.reset}`);
  
  for (const path of TEST_PATHS) {
    try {
      console.log(`${COLORS.cyan}访问页面: ${path}${COLORS.reset}`);
      
      // 正常访问
      await fetch(`http://localhost:${CONFIG.proxyPort}${path}`);
      
      // 模拟React严格模式的多次渲染
      if (CONFIG.simulateStrictMode) {
        console.log(`${COLORS.cyan}模拟React严格模式重复渲染: ${path}${COLORS.reset}`);
        await fetch(`http://localhost:${CONFIG.proxyPort}${path}`);
      }
      
      // 间隔一秒
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`${COLORS.red}访问页面失败: ${path}${COLORS.reset}`, error);
    }
  }
}

// 分析请求并生成报告
function analyzeRequests(): boolean {
  console.log(`${COLORS.blue}分析请求模式...${COLORS.reset}`);
  
  const stats = requestTracker.getStats();
  const patterns = requestTracker.analyzeRequestPatterns();
  
  console.log(`
${COLORS.cyan}请求统计:${COLORS.reset}
  总请求数: ${stats.totalRequests}
  唯一请求数: ${stats.uniqueRequests}
  重复请求数: ${stats.duplicateCount}
  重复请求百分比: ${stats.duplicatePercent}%
  `);
  
  if (patterns.problematicUrls.length > 0) {
    console.log(`${COLORS.yellow}发现可能存在问题的URL:${COLORS.reset}`);
    patterns.problematicUrls.forEach(url => {
      console.log(`  - ${url}`);
    });
  }
  
  // 保存报告到文件
  const reportPath = path.join(process.cwd(), 'request-analysis-report.json');
  fs.writeFileSync(
    reportPath, 
    JSON.stringify({ stats, patterns }, null, 2)
  );
  console.log(`${COLORS.green}报告已保存到: ${reportPath}${COLORS.reset}`);
  
  // 检查是否超过重复阈值
  const hasTooManyDuplicates = stats.duplicateCount > CONFIG.maxDuplicateThreshold;
  
  if (hasTooManyDuplicates) {
    console.log(`${COLORS.red}警告: 检测到 ${stats.duplicateCount} 个重复请求，超过阈值 ${CONFIG.maxDuplicateThreshold}${COLORS.reset}`);
  } else {
    console.log(`${COLORS.green}成功: 重复请求数 ${stats.duplicateCount} 在允许范围内${COLORS.reset}`);
  }
  
  return !hasTooManyDuplicates;
}

// 主函数
async function main() {
  console.log(`${COLORS.magenta}开始测试请求重复问题...${COLORS.reset}`);
  
  // 清空请求记录
  requestTracker.clearRequestTracker();
  
  // 启动服务器
  const nextServer = await startNextServer();
  const proxyServer = await startProxyServer();
  
  try {
    // 模拟用户浏览
    await simulateUserBrowsing();
    
    // 等待一段时间，确保所有请求完成
    console.log(`${COLORS.blue}等待所有请求完成...${COLORS.reset}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 分析请求
    const success = analyzeRequests();
    
    // 根据分析结果退出
    process.exit(success ? 0 : 1);
  } finally {
    // 关闭服务器
    console.log(`${COLORS.blue}关闭服务器...${COLORS.reset}`);
    if (nextServer && nextServer.pid) {
      process.kill(-nextServer.pid);
    }
    proxyServer.close();
  }
}

// 运行主函数
main().catch(error => {
  console.error(`${COLORS.red}测试失败:${COLORS.reset}`, error);
  process.exit(1);
}); 