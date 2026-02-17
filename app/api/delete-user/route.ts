import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireAdminAccess } from '../../../lib/adminGuard';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest) {
  try {
    const adminCheck = await requireAdminAccess();
    if (!adminCheck.ok) {
      return adminCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const email = (searchParams.get('email') || '').trim().toLowerCase();
    
    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'Email parameter is required'
      }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid email format'
      }, { status: 400 });
    }
    
    // 首先检查用户是否存在
    const userCheck = await sql`
      SELECT id, email FROM users WHERE email = ${email}
    `;
    
    if (userCheck.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'User not found'
      }, { status: 404 });
    }
    
    const userId = userCheck.rows[0].id;
    
    // 删除用户相关的播客分析结果
    const deleteAnalysisResults = await sql`
      DELETE FROM analysis_results 
      WHERE podcast_id IN (
        SELECT id FROM podcasts WHERE user_id = ${userId}
      )
    `;
    
    // 删除用户的播客
    const deletePodcasts = await sql`
      DELETE FROM podcasts WHERE user_id = ${userId}
    `;
    
    // 删除用户记录
    const deleteUser = await sql`
      DELETE FROM users WHERE id = ${userId}
    `;
    
    return NextResponse.json({
      success: true,
      message: `Successfully deleted user ${email}`,
      data: {
        userId,
        email,
        deletedAnalysisResults: deleteAnalysisResults.rowCount,
        deletedPodcasts: deletePodcasts.rowCount,
        deletedUser: deleteUser.rowCount
      }
    });
    
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to delete user',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 
