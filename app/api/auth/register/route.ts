import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { sql } from '@vercel/postgres'
import { nanoid } from 'nanoid'
import { ensureUserCreditsSchema, getInitialSrtCreditsForEmail } from '../../../../lib/db'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    // 验证输入
    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      )
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // 验证密码长度
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      )
    }

    // 检查用户是否已存在
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${email}
    `

    if (existingUser.rows.length > 0) {
      return NextResponse.json(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 12)
    const initialCredits = getInitialSrtCreditsForEmail(email)
    await ensureUserCreditsSchema()

    // 创建用户
    const userId = nanoid()
    await sql`
      INSERT INTO users (id, email, password_hash, name, credits)
      VALUES (${userId}, ${email}, ${hashedPassword}, ${name}, ${initialCredits})
    `

    return NextResponse.json(
      { message: 'User created successfully', userId, credits: initialCredits },
      { status: 201 }
    )
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 
