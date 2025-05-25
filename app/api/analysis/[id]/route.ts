import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisResults, getPodcast } from '../../../../lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
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
          isProcessed: false
        }
      });
    }

    console.log(`成功获取分析结果，ID: ${id}`);
    return NextResponse.json({
      success: true,
      data: {
        podcast: podcastResult.data,
        analysis: analysisResult.data,
        isProcessed: true
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