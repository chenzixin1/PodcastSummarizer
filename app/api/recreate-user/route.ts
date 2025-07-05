import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const { email, name, password } = await request.json();
    
    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'Email is required'
      }, { status: 400 });
    }

    console.log(`Recreating user: ${email}`);
    
    // 检查用户是否已存在
    const existingUser = await sql`
      SELECT id, email FROM users WHERE email = ${email}
    `;
    
    if (existingUser.rows.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'User already exists'
      }, { status: 409 });
    }
    
    // 创建新用户
    const userId = nanoid();
    const hashedPassword = password ? await bcrypt.hash(password, 12) : '';
    const userName = name || email.split('@')[0];
    
    const newUser = await sql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (${userId}, ${email}, ${userName}, ${hashedPassword}, NOW())
      RETURNING id, email, name, created_at
    `;
    
    return NextResponse.json({
      success: true,
      message: `Successfully recreated user ${email}`,
      data: newUser.rows[0]
    });
    
  } catch (error) {
    console.error('Error recreating user:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to recreate user',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 