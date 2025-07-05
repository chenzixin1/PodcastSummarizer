/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/db-init/route';

// Mock Vercel Postgres
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn()
}));

// Mock 数据库初始化函数
jest.mock('../../lib/db', () => ({
  initDatabase: jest.fn()
}));

// 获取mock函数的引用
const { sql: mockSql } = require('@vercel/postgres');
const { initDatabase: mockInitDatabase } = require('../../lib/db');

describe('Database Initialization API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // 默认设置 mockSql 的模板字符串行为
    mockSql.mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('').toLowerCase();
      
      if (query.includes('drop table')) {
        return Promise.resolve({ rows: [] });
      } else if (query.includes('information_schema.tables')) {
        return Promise.resolve({
          rows: [
            { table_name: 'podcasts' },
            { table_name: 'analysis_results' }
          ]
        });
      }
      
      return Promise.resolve({ rows: [] });
    });
  });

  it('should successfully initialize database', async () => {
    mockInitDatabase.mockResolvedValue({ success: true });

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe('数据库表初始化成功');
    expect(data.tables).toEqual(['podcasts', 'analysis_results']);
    expect(mockInitDatabase).toHaveBeenCalledTimes(1);
  });

  it('should handle database initialization failure', async () => {
    mockInitDatabase.mockResolvedValue({ 
      success: false, 
      error: 'Table creation failed' 
    });

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Table creation failed');
    expect(data.message).toBe('数据库表初始化失败');
  });

  it('should handle database initialization exception', async () => {
    mockInitDatabase.mockRejectedValue(new Error('Connection timeout'));

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Connection timeout');
    expect(data.message).toBe('数据库初始化路由错误');
  });

  it('should handle SQL connection errors', async () => {
    mockSql.mockRejectedValue(new Error('Database connection failed'));
    mockInitDatabase.mockRejectedValue(new Error('Database connection failed'));

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.message).toBe('数据库初始化路由错误');
  });

  it('should handle DROP TABLE failure gracefully', async () => {
    // Mock DROP TABLE 失败，但继续执行
    mockSql.mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('').toLowerCase();
      
      if (query.includes('drop table')) {
        throw new Error('Cannot drop table');
      } else if (query.includes('information_schema.tables')) {
        return Promise.resolve({
          rows: [
            { table_name: 'podcasts' },
            { table_name: 'analysis_results' }
          ]
        });
      }
      
      return Promise.resolve({ rows: [] });
    });

    mockInitDatabase.mockResolvedValue({ success: true });

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    // 应该仍然成功，因为DROP失败不影响后续初始化
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should handle information_schema query failure', async () => {
    mockInitDatabase.mockResolvedValue({ success: true });

    // Mock information_schema查询失败
    mockSql.mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('').toLowerCase();
      
      if (query.includes('drop table')) {
        return Promise.resolve({ rows: [] });
      } else if (query.includes('information_schema.tables')) {
        throw new Error('Database query failed');
      }
      
      return Promise.resolve({ rows: [] });
    });

    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Database query failed');
  });

  it('should include timestamp in response', async () => {
    mockInitDatabase.mockResolvedValue({ success: true });

    const beforeTime = new Date();
    
    const url = new URL('http://localhost:3000/api/db-init');
    const request = new NextRequest(url);
    
    const response = await GET();
    const data = await response.json();

    const afterTime = new Date();
    const responseTime = new Date(data.currentTime);

    expect(responseTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(responseTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });
}); 