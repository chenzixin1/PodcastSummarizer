import { NextRequest, NextResponse, after } from 'next/server';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import { getProcessingJob } from '../../../../lib/processingJobs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { triggerWorkerProcessing } from '../../../../lib/workerTrigger';

const ANALYSIS_DEBUG_ENABLED = process.env.ANALYSIS_DEBUG_LOGS === 'true';
function analysisDebug(...args: unknown[]) {
  if (!ANALYSIS_DEBUG_ENABLED) {
    return;
  }
  console.log(...args);
}

interface AnalysisData {
  summary?: string | null;
  summaryZh?: string | null;
  summaryEn?: string | null;
  translation?: string | null;
  highlights?: string | null;
  mindMapJson?: unknown;
  mindMapJsonZh?: unknown;
  mindMapJsonEn?: unknown;
  fullTextBilingualJson?: unknown;
  summaryBilingualJson?: unknown;
  bilingualAlignmentVersion?: number | null;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

interface ProcessingJobData {
  status?: string | null;
  updatedAt?: string | null;
}

function extractLegacySummary(summary: string): { zh: string; en: string } {
  const normalized = String(summary || '').trim();
  if (!normalized) {
    return { zh: '', en: '' };
  }
  const enIndex = normalized.search(/#\s*English Summary/i);
  const zhIndex = normalized.search(/#\s*中文总结/i);
  if (enIndex >= 0 && zhIndex > enIndex) {
    return {
      en: normalized.slice(enIndex, zhIndex).trim(),
      zh: normalized.slice(zhIndex).trim(),
    };
  }
  if (zhIndex >= 0) {
    return {
      en: normalized.slice(0, zhIndex).trim(),
      zh: normalized.slice(zhIndex).trim(),
    };
  }
  return { zh: normalized, en: '' };
}

function hasCompleteAnalysis(analysis: AnalysisData | null, processingStatus: string | null): boolean {
  if (!analysis) {
    return false;
  }
  const legacySummary = extractLegacySummary(String(analysis.summary || ''));
  const summaryZh = (analysis.summaryZh || legacySummary.zh || analysis.summary || '').trim();
  const hasAllFields = Boolean(
    summaryZh &&
    (analysis.highlights || '').trim()
  );
  if (!hasAllFields) {
    return false;
  }
  if (!processingStatus) {
    return true;
  }
  return processingStatus === 'completed';
}

function shouldKickWorker(processingJob: ProcessingJobData | null): boolean {
  if (!processingJob || !processingJob.status) {
    return false;
  }

  const isQueued = processingJob.status === 'queued';
  const isStaleProcessing = processingJob.status === 'processing';
  if (!isQueued && !isStaleProcessing) {
    return false;
  }

  if (!processingJob.updatedAt) {
    return true;
  }
  const updatedAt = new Date(processingJob.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  const staleMs = Date.now() - updatedAt;
  if (isQueued) {
    return staleMs > 8000;
  }
  return staleMs > 120000;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    
    if (!id) {
      return NextResponse.json({ error: 'Missing ID parameter' }, { status: 400 });
    }

    analysisDebug(`获取分析结果 API 调用，ID: ${id}`);

    // 首先获取播客基本信息
    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      analysisDebug(`播客不存在，ID: ${id}`);
      return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
    }

    const podcast = podcastResult.data as { isPublic: boolean; userId?: string };
    
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
    const processingJobResult = await getProcessingJob(id);
    const processingJob = processingJobResult.success ? processingJobResult.data : null;

    if (shouldKickWorker(processingJob as ProcessingJobData | null)) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('analysis_poll', id);
        if (!triggerResult.success) {
          console.error('Failed to trigger worker from analysis poll:', triggerResult.error);
        }
      });
    }

    const analysisResult = await getAnalysisResults(id);
    if (!analysisResult.success) {
      analysisDebug(`分析结果不存在，ID: ${id}`);
      // 返回播客信息但没有分析结果
      return NextResponse.json({
        success: true,
        data: {
          podcast: podcastResult.data,
          analysis: null,
          isProcessed: false,
          processingJob,
          canEdit: session?.user?.id === podcast.userId // 是否可以编辑
        }
      });
    }

    const analysisData = (analysisResult.data || null) as AnalysisData | null;
    const isProcessed = hasCompleteAnalysis(analysisData, processingJob?.status || null);

    analysisDebug(`成功获取分析结果，ID: ${id}`);
    return NextResponse.json({
      success: true,
      data: {
        podcast: podcastResult.data,
        analysis: analysisData,
        isProcessed,
        processingJob,
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
