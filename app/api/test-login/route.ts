import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import { requireAdminAccess } from '../../../lib/adminGuard';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const adminCheck = await requireAdminAccess();
    if (!adminCheck.ok) {
      return adminCheck.response;
    }

    const { email, password } = await request.json();
    
    if (!email || !password) {
      return NextResponse.json({
        success: false,
        error: 'Email and password are required'
      }, { status: 400 });
    }
    
    // 查找用户
    const result = await sql`
      SELECT id, email, password_hash, name, created_at 
      FROM users 
      WHERE email = ${email}
    `;
    
    if (result.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'User not found',
        debug: {
          email,
          userExists: false
        }
      });
    }
    
    const user = result.rows[0];
    
    // 检查密码
    if (!user.password_hash) {
      return NextResponse.json({
        success: false,
        error: 'User has no password set',
        debug: {
          email,
          userExists: true,
          hasPassword: false,
          passwordHash: 'null or empty'
        }
      });
    }
    
    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    return NextResponse.json({
      success: true,
      message: isPasswordValid ? 'Login would succeed' : 'Password incorrect',
      debug: {
        email,
        userExists: true,
        hasPassword: true,
        passwordValid: isPasswordValid,
        passwordHashLength: user.password_hash.length,
        userId: user.id,
        userName: user.name
      }
    });
    
  } catch (error) {
    console.error('Test login error:', error);
    return NextResponse.json({
      success: false,
      error: 'Test login failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 
