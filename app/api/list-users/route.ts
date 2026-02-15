import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(request: NextRequest) {
  try {
    // 获取所有用户信息
    const users = await sql`
      SELECT 
        id, 
        email, 
        name, 
        credits,
        created_at,
        CASE 
          WHEN password_hash = '' THEN 'Google OAuth'
          WHEN password_hash IS NULL THEN 'No Password'
          ELSE 'Email/Password'
        END as auth_type
      FROM users 
      ORDER BY created_at DESC
    `;
    
    // 获取每个用户的播客数量
    const usersWithStats = await Promise.all(
      users.rows.map(async (user) => {
        const podcastCount = await sql`
          SELECT COUNT(*) as count FROM podcasts WHERE user_id = ${user.id}
        `;
        
        return {
          ...user,
          podcast_count: parseInt(podcastCount.rows[0].count)
        };
      })
    );
    
    return NextResponse.json({
      success: true,
      data: usersWithStats,
      count: usersWithStats.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error listing users:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to list users',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 
