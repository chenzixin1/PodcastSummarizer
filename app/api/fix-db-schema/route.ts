import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: NextRequest) {
  try {
    console.log('Fixing database schema...');
    
    // 删除现有的 analysis_results 表
    await sql`DROP TABLE IF EXISTS analysis_results`;
    
    // 重新创建 analysis_results 表
    await sql`
      CREATE TABLE IF NOT EXISTS analysis_results (
        podcast_id TEXT REFERENCES podcasts(id),
        summary TEXT,
        translation TEXT,
        highlights TEXT,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
    `;
    
    return NextResponse.json({
      success: true,
      message: 'Database schema fixed successfully'
    });
    
  } catch (error) {
    console.error('Error fixing database schema:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fix database schema',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 