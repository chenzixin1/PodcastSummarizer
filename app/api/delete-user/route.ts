import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    
    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'Email parameter is required'
      }, { status: 400 });
    }

    console.log(`Attempting to delete user: ${email}`);
    
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
    console.log(`Found user ID: ${userId}`);
    
    // 删除用户相关的播客分析结果
    const deleteAnalysisResults = await sql`
      DELETE FROM analysis_results 
      WHERE podcast_id IN (
        SELECT id FROM podcasts WHERE user_id = ${userId}
      )
    `;
    console.log(`Deleted ${deleteAnalysisResults.rowCount} analysis results`);
    
    // 删除用户的播客
    const deletePodcasts = await sql`
      DELETE FROM podcasts WHERE user_id = ${userId}
    `;
    console.log(`Deleted ${deletePodcasts.rowCount} podcasts`);
    
    // 删除用户记录
    const deleteUser = await sql`
      DELETE FROM users WHERE id = ${userId}
    `;
    console.log(`Deleted ${deleteUser.rowCount} user record`);
    
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