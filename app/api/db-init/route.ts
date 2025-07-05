import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { initDatabase } from '../../../lib/db';

export const runtime = 'edge';

export async function GET() {
  try {
    // 先尝试删除表（如果存在）
    try {
      await sql`DROP TABLE IF EXISTS analysis_results`;
      await sql`DROP TABLE IF EXISTS podcasts`;
      console.log('✅ 已删除旧表结构');
    } catch (error) {
      console.error('❌ 删除表失败，但将继续尝试创建:', error);
    }
    
    // 初始化数据库
    const result = await initDatabase();
    
    if (result.success) {
      // 检查表是否创建成功
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `;
      
      return NextResponse.json({
        success: true,
        message: '数据库表初始化成功',
        currentTime: new Date().toISOString(),
        tables: tables.rows.map(row => row.table_name)
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        message: '数据库表初始化失败',
        currentTime: new Date().toISOString()
      }, { status: 500 });
    }
  } catch (error) {
    console.error('数据库初始化路由错误:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      message: '数据库初始化路由错误',
      currentTime: new Date().toISOString()
    }, { status: 500 });
  }
} 