import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { sql } from '@vercel/postgres';

export async function GET(request: NextRequest) {
  try {
    // 获取会话
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        message: 'No active session'
      });
    }
    
    // 检查用户是否在数据库中存在
    let userExists = false;
    let dbUser = null;
    
    if (session.user?.email) {
      const userCheck = await sql`
        SELECT id, email, name, credits, created_at FROM users WHERE email = ${session.user.email}
      `;
      userExists = userCheck.rows.length > 0;
      dbUser = userCheck.rows[0] || null;
    }
    
    return NextResponse.json({
      success: true,
      authenticated: true,
      session: {
        user: session.user,
        expires: session.expires
      },
      database: {
        userExists,
        user: dbUser
      },
      sessionUserId: session.user?.id,
      dbUserId: dbUser?.id
    });
    
  } catch (error) {
    console.error('Error checking auth status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to check auth status',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 
