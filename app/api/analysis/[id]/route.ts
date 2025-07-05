import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    
    if (!id) {
      return NextResponse.json({ error: 'Missing ID parameter' }, { status: 400 });
    }

    console.log(`获取分析结果 API 调用，ID: ${id}`);

    // 首先获取播客基本信息
    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      console.log(`播客不存在，ID: ${id}`);
      return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
    }

    const podcast = podcastResult.data as any;
    
    // 检查访问权限
    const session = await getServerSession(authOptions);
    
    // 如果播客不是公开的，需要验证用户权限
    if (!podcast.isPublic) {
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      
      // 验证用户是否是播客的所有者
      const ownershipResult = await verifyPodcastOwnership(id, session.user.id);
      if (!ownershipResult.success) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // 获取分析结果
    const analysisResult = await getAnalysisResults(id);
    if (!analysisResult.success) {
      console.log(`分析结果不存在，ID: ${id}`);
      // 返回播客信息但没有分析结果
      return NextResponse.json({
        success: true,
        data: {
          podcast: podcastResult.data,
          analysis: null,
          isProcessed: false,
          canEdit: session?.user?.id === podcast.userId // 是否可以编辑
        }
      });
    }

    console.log(`成功获取分析结果，ID: ${id}`);
    return NextResponse.json({
      success: true,
      data: {
        podcast: podcastResult.data,
        analysis: analysisResult.data,
        isProcessed: true,
        canEdit: session?.user?.id === podcast.userId // 是否可以编辑
      }
    });

  } catch (error) {
    console.error('获取分析结果失败:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      { status: 500 }
    );
  }
} 