import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireAdminAccess } from '../../../lib/adminGuard';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const adminCheck = await requireAdminAccess();
    if (!adminCheck.ok) {
      return adminCheck.response;
    }

    const users = await sql`
      SELECT 
        u.id, 
        u.email, 
        u.name, 
        u.credits,
        u.created_at,
        COALESCE(COUNT(p.id), 0)::int as podcast_count,
        CASE 
          WHEN u.password_hash = '' THEN 'Google OAuth'
          WHEN u.password_hash IS NULL THEN 'No Password'
          ELSE 'Email/Password'
        END as auth_type
      FROM users u
      LEFT JOIN podcasts p ON p.user_id = u.id
      GROUP BY u.id, u.email, u.name, u.credits, u.created_at, u.password_hash
      ORDER BY u.created_at DESC
    `;

    return NextResponse.json({
      success: true,
      data: users.rows,
      count: users.rows.length,
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
