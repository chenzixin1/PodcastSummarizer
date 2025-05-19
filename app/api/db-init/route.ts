import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 创建播客表
    await sql`
      CREATE TABLE IF NOT EXISTS podcasts (
        id UUID PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_size VARCHAR(50) NOT NULL,
        blob_url TEXT,
        is_public BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 创建分析结果表
    await sql`
      CREATE TABLE IF NOT EXISTS analysis_results (
        podcast_id UUID REFERENCES podcasts(id),
        summary TEXT,
        translation TEXT,
        highlights TEXT,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
    `;

    // 测试查询
    const result = await sql`SELECT NOW() as current_time`;
    
    // 获取表信息
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    
    const tableList = tables.rows.map(row => row.table_name);
    
    return NextResponse.json({
      success: true,
      message: '数据库表初始化成功',
      currentTime: result.rows[0].current_time,
      tables: tableList
    });
  } catch (error) {
    console.error('数据库表初始化失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 