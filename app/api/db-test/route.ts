import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 测试连接
    const result = await sql`SELECT NOW() as current_time`;
    
    // 查询表信息
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    
    const tableList = tables.rows.map(row => row.table_name);
    
    return NextResponse.json({
      success: true,
      message: '数据库连接成功',
      currentTime: result.rows[0].current_time,
      tables: tableList
    });
  } catch (error) {
    console.error('数据库连接测试失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 