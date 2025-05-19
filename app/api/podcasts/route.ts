import { NextRequest, NextResponse } from 'next/server';
import { getAllPodcasts } from '../../../lib/db';

export async function GET(request: NextRequest) {
  try {
    // 获取分页参数
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10);
    const includePrivate = searchParams.get('includePrivate') === 'true';
    
    // 从数据库获取播客列表
    const result = await getAllPodcasts(page, pageSize, includePrivate);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch podcasts' }, 
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true, data: result.data });
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