import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    
    if (email) {
      // 检查特定用户
      const user = await sql`
        SELECT id, email, name, created_at FROM users WHERE email = ${email}
      `;
      
      return NextResponse.json({
        success: true,
        data: user.rows[0] || null,
        message: user.rows.length > 0 ? 'User found' : 'User not found'
      });
    } else {
      // 列出所有用户
      const users = await sql`
        SELECT id, email, name, created_at FROM users ORDER BY created_at DESC
      `;
      
      return NextResponse.json({
        success: true,
        data: users.rows,
        count: users.rows.length
      });
    }
    
  } catch (error) {
    console.error('Error checking users:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to check users',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 