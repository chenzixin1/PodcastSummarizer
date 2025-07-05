import { NextRequest, NextResponse } from 'next/server';
import { getAllPodcasts, getUserPodcasts } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';

export async function GET(request: NextRequest) {
  try {
    // 获取分页参数
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10);
    const includePrivate = searchParams.get('includePrivate') === 'true';
    
    // 获取用户会话
    const session = await getServerSession(authOptions);
    
    let result;
    
    if (includePrivate) {
      // 如果请求包含私有数据，需要验证用户认证
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: 'Authentication required for private data' }, 
          { status: 401 }
        );
      }
      
      // 返回当前用户的播客
      result = await getUserPodcasts(session.user.id, page, pageSize);
    } else {
      // 返回公开的播客，不需要认证
      result = await getAllPodcasts(page, pageSize, false);
    }
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch podcasts' }, 
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      data: result.data,
      user: session?.user?.email || null // 可选：返回当前用户信息
    });
  } catch (error) {
    console.error('Error fetching podcasts:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
} 