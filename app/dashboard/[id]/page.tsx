/* eslint-disable */
'use client';

import { useState, useEffect, useRef, useCallback, type WheelEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logDebug, logError, logUserAction, logPerformance, getBrowserInfo, getClientErrors } from '../../../lib/debugUtils';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import FloatingQaAssistant from '../../../components/FloatingQaAssistant';

// VERCEL DEBUG: Add version number to help track deployments
const APP_VERSION = '1.0.5'; // Increment version for tracking
console.log(`[DEBUG] Podcast Summarizer v${APP_VERSION} loading...`);

// Define types for the processed data
interface ProcessedData {
  title: string;
  originalFileName: string;
  originalFileSize: string;
  summary: string;
  translation: string;
  fullTextHighlights: string;
  processedAt?: string;
}

interface ProcessingJobData {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  currentTask?: 'summary' | 'translation' | 'highlights' | null;
  progressCurrent?: number;
  progressTotal?: number;
  statusMessage?: string | null;
  lastError?: string | null;
}

type ViewMode = 'summary' | 'translate' | 'fullText';
type ProcessingTask = 'summary' | 'translation' | 'highlights';

interface ProcessingProgress {
  task: ProcessingTask | null;
  completed: number;
  total: number;
}

const COPY_STATUS_RESET_MS = 1500;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 64;
const ANALYSIS_POLL_INTERVAL_MS = 5000;
const TASK_LABELS: Record<ProcessingTask, string> = {
  summary: 'Summary',
  translation: 'Translation',
  highlights: 'Highlights',
};

// Normalize highlight text by ensuring each timestamp starts on a new line
// Supports patterns like "** [00:00:00]**" as well as plain "[00:00:00]"
const enforceLineBreaks = (text: string) => {
  // Split by timestamps and ensure each timestamp starts on a new line
  const timestampRegex = /(\*\*\s*)?(\[[0-9]{2}:[0-9]{2}:[0-9]{1,3}\])(\*\*)?/g;
  let result = text.replace(timestampRegex, (match, boldStart, timestamp, boldEnd) => {
    return `\n${boldStart || ''}${timestamp}${boldEnd || ''}`;
  });
  // Remove leading newlines and trim
  return result.replace(/^\n+/, '').trim();
};

const normalizeMarkdownOutput = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*•[ \t]+/gm, '- ')
    .replace(/\u00A0/g, ' ')
    .trim();
};

const normalizePlainTextOutput = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ');
};

// Debug interface to track application state
interface DebugState {
  appVersion: string;
  initialized: boolean;
  lastAction: string;
  processingState: string;
  errors: any[];
  networkRequests: {
    url: string;
    status: number;
    timestamp: string;
    duration: number;
  }[];
  sessionInfo: {
    id: string;
    isProcessing: boolean;
    requestSent: boolean;
    lastHeightRef: number;
  };
}

// 声明 window.__PODSUM_DEBUG__ 用于调试
declare global {
  interface Window {
    __PODSUM_DEBUG__?: any;
  }
}

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string;
  
  // Initialize all hooks first, before any conditional returns
  const [activeView, setActiveView] = useState<ViewMode>('summary');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isSummaryFinal, setIsSummaryFinal] = useState(true);
  const [isHighlightsFinal, setIsHighlightsFinal] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pollTick, setPollTick] = useState(0);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    task: null,
    completed: 0,
    total: 0,
  });
  
  // Refs for scroll control and processing state
  const contentRef = useRef<HTMLElement | null>(null);
  const isProcessingRef = useRef(false);
  const isAutoScrollEnabledRef = useRef(true);
  const viewScrollPositionsRef = useRef<Record<ViewMode, number>>({
    summary: 0,
    translate: 0,
    fullText: 0,
  });
  const lastHeightRef = useRef(0);
  const requestSentRef = useRef(false);
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasResolvedInitialFetchRef = useRef(false);
  const lastLoadedIdRef = useRef<string | null>(null);

  // Debug state
  const [debugMode, setDebugMode] = useState(false);
  const [debugState, setDebugState] = useState<DebugState>({
    appVersion: APP_VERSION,
    initialized: false,
    lastAction: 'init',
    processingState: 'idle',
    errors: [],
    networkRequests: [],
    sessionInfo: {
      id: id || '',
      isProcessing: false,
      requestSent: false,
      lastHeightRef: 0
    }
  });
  
  // Track network requests for debugging
  const networkRequestsRef = useRef<DebugState['networkRequests']>([]);

  console.log(`[DEBUG] Dashboard initializing for ID: ${id}`);
  logDebug(`Dashboard initializing for ID: ${id}`);

  const setContentElement = useCallback((element: HTMLElement | null) => {
    contentRef.current = element;
    if (!element) {
      return;
    }
    const savedTop = viewScrollPositionsRef.current[activeView] || 0;
    element.scrollTop = savedTop;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isAutoScrollEnabledRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, [activeView]);

  const handleContentScroll = useCallback(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    viewScrollPositionsRef.current[activeView] = element.scrollTop;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isAutoScrollEnabledRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, [activeView]);

  const handleContentWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    if (element.scrollHeight <= element.clientHeight) {
      return;
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;
    const modeMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const normalizedDeltaY = event.deltaY * modeMultiplier;
    const boostedDeltaY =
      Math.sign(normalizedDeltaY) * Math.max(Math.abs(normalizedDeltaY) * 1.35, 22);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, element.scrollTop + boostedDeltaY));

    if (nextScrollTop !== element.scrollTop) {
      element.scrollTop = nextScrollTop;
      event.preventDefault();
    }
  }, []);

  const switchActiveView = (nextView: ViewMode) => {
    if (nextView === activeView) {
      return;
    }
    if (contentRef.current) {
      viewScrollPositionsRef.current[activeView] = contentRef.current.scrollTop;
    }
    if (copyStatusTimerRef.current !== null) {
      clearTimeout(copyStatusTimerRef.current);
      copyStatusTimerRef.current = null;
    }
    setCopyStatus('idle');
    setActiveView(nextView);
  };

  const resetProcessingProgress = useCallback(() => {
    setProcessingProgress({
      task: null,
      completed: 0,
      total: 0,
    });
  }, []);

  const updateProcessingProgress = useCallback(
    (task: ProcessingTask, chunkIndex?: unknown, totalChunks?: unknown) => {
      if (typeof chunkIndex === 'number' && typeof totalChunks === 'number' && totalChunks > 0) {
        setProcessingProgress({
          task,
          completed: Math.min(Math.max(chunkIndex + 1, 0), totalChunks),
          total: totalChunks,
        });
        return;
      }
      setProcessingProgress(prev => ({ ...prev, task }));
    },
    [],
  );

  const setCopyStatusWithReset = useCallback((nextStatus: 'idle' | 'copied' | 'failed') => {
    setCopyStatus(nextStatus);
    if (copyStatusTimerRef.current !== null) {
      clearTimeout(copyStatusTimerRef.current);
      copyStatusTimerRef.current = null;
    }
    if (nextStatus !== 'idle') {
      copyStatusTimerRef.current = setTimeout(() => {
        setCopyStatus('idle');
      }, COPY_STATUS_RESET_MS);
    }
  }, []);

  const applyProcessingJobState = useCallback((job: ProcessingJobData | null) => {
    if (!job) {
      setIsProcessing(false);
      isProcessingRef.current = false;
      setProcessingStatus(null);
      requestSentRef.current = false;
      resetProcessingProgress();
      return;
    }

    if (job.status === 'queued' || job.status === 'processing') {
      setError(null);
      setIsProcessing(true);
      isProcessingRef.current = true;
      requestSentRef.current = true;
      setIsSummaryFinal(false);
      setIsHighlightsFinal(false);
      setProcessingStatus(job.statusMessage || (job.status === 'queued' ? '已进入后台队列' : '后台处理中...'));

      const task =
        job.currentTask === 'summary' || job.currentTask === 'translation' || job.currentTask === 'highlights'
          ? job.currentTask
          : 'summary';
      const completed = typeof job.progressCurrent === 'number' ? job.progressCurrent : 0;
      const total = typeof job.progressTotal === 'number' ? job.progressTotal : 0;
      setProcessingProgress({
        task,
        completed,
        total,
      });
      return;
    }

    if (job.status === 'failed') {
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
      setProcessingStatus(job.statusMessage || null);
      if (job.lastError) {
        setError(`后台处理失败: ${job.lastError}`);
      }
      resetProcessingProgress();
      return;
    }

    setIsProcessing(false);
    isProcessingRef.current = false;
    requestSentRef.current = false;
    setError(null);
    setProcessingStatus(null);
    setIsSummaryFinal(true);
    setIsHighlightsFinal(true);
    resetProcessingProgress();
  }, [resetProcessingProgress]);

  const enqueueBackgroundProcessing = useCallback(async (force = false) => {
    if (!id) return;
    if (!force && requestSentRef.current) return;

    requestSentRef.current = true;
    setError(null);
    setIsProcessing(true);
    isProcessingRef.current = true;
    setIsSummaryFinal(false);
    setIsHighlightsFinal(false);
    setProcessingStatus(force ? '已提交重新处理任务...' : '已提交后台处理任务...');
    setProcessingProgress({
      task: 'summary',
      completed: 0,
      total: 0,
    });

    try {
      const response = await fetch('/api/process/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, force }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to enqueue job (${response.status})`);
      }

      if (result.data?.job) {
        applyProcessingJobState(result.data.job as ProcessingJobData);
      }
    } catch (enqueueError) {
      const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      setError(`提交后台任务失败: ${message}`);
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
      setProcessingStatus(null);
      resetProcessingProgress();
    }
  }, [applyProcessingJobState, id, resetProcessingProgress]);

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current !== null) {
        clearTimeout(copyStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!id) {
      return;
    }
    if (lastLoadedIdRef.current !== id) {
      lastLoadedIdRef.current = id;
      hasResolvedInitialFetchRef.current = false;
      setIsLoading(true);
    }
  }, [id]);


  // Add ID validation after all hooks and functions are defined
  if (!id || id === 'undefined' || id === 'null') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md p-8 bg-slate-800 rounded-lg shadow-xl">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Invalid File ID</h1>
          <p className="text-slate-300 mb-6">
            The file ID in the URL is invalid or missing. This usually happens when:
          </p>
          <ul className="text-left text-sm text-slate-400 mb-6 space-y-2">
            <li>• You navigated to an incomplete URL</li>
            <li>• The file upload process was interrupted</li>
            <li>• You&rsquo;re using an old or broken bookmark</li>
          </ul>
          <div className="space-y-3">
            <Link 
              href="/upload" 
              className="block w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Upload New File
            </Link>
            <Link 
              href="/my" 
              className="block w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              View File History
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Function to capture current debug state (use useCallback to fix hook dependency issues)
  const captureDebugState = useCallback((action: string) => {
    try {
      setDebugState({
        appVersion: APP_VERSION,
        initialized: true,
        lastAction: action,
        processingState: isProcessing ? 'processing' : (data?.summary ? 'complete' : 'idle'),
        errors: getClientErrors(),
        networkRequests: networkRequestsRef.current,
        sessionInfo: {
          id,
          isProcessing,
          requestSent: requestSentRef.current,
          lastHeightRef: lastHeightRef.current
        }
      });
    } catch (error) {
      console.error('[DEBUG] Error capturing debug state:', error);
    }
  }, [id]); // 简化依赖，避免无限循环

  // Update debug state periodically
  useEffect(() => {
    if (!debugMode) return;
    
    captureDebugState('init');
    
    const interval = setInterval(() => {
      if (debugMode) {
        captureDebugState('interval');
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [debugMode, isProcessing, captureDebugState]);

  // Enhanced fetch with debugging (use useCallback to fix hook dependency issues)
  const debugFetch = useCallback(async (url: string, options: RequestInit) => {
    const startTime = performance.now();
    const requestId = Date.now().toString(36);
    
    try {
      console.log(`[DEBUG-NET-${requestId}] Starting request to ${url}`);
      logDebug(`Network request started`, { url, options: { 
        method: options.method,
        headers: options.headers
      }});
      
      const response = await fetch(url, options);
      
      const duration = performance.now() - startTime;
      console.log(`[DEBUG-NET-${requestId}] Response received: ${response.status} in ${duration.toFixed(0)}ms`);
      
      // Track network request
      networkRequestsRef.current = [
        ...networkRequestsRef.current.slice(-9),
        {
          url,
          status: response.status,
          timestamp: new Date().toISOString(),
          duration: Number(duration.toFixed(0))
        }
      ];
      
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`[DEBUG-NET-${requestId}] Request failed after ${duration.toFixed(0)}ms:`, error);
      logError(`Network request failed`, { url, error, duration });
      throw error;
    }
  }, []); // 移除所有依赖，避免无限循环

  // Copy debug info to clipboard
  const copyDebugInfo = () => {
    try {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        app: {
          version: APP_VERSION,
          url: window.location.href,
          id
        },
        state: {
          isLoading,
          isProcessing,
          requestSent: requestSentRef.current,
          hasError: !!error,
          errorMessage: error,
          dataSummaryLength: data?.summary?.length
        },
        debug: debugState,
        browser: getBrowserInfo(),
        errors: getClientErrors()
      };
      
      const debugString = JSON.stringify(debugInfo, null, 2);
      navigator.clipboard.writeText(debugString);
      
      alert('Debug info copied to clipboard!');
      logUserAction('copy-debug-info');
    } catch (error) {
      console.error('[DEBUG] Failed to copy debug info:', error);
      alert('Failed to copy debug info: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Enhanced scroll function with debug (use useCallback to fix hook dependency issues)
  const scrollToBottom = useCallback(() => {
    console.log(`[DEBUG] Attempting to scroll to bottom, isProcessing: ${isProcessingRef.current}, autoScroll: ${isAutoScrollEnabledRef.current}`);
    if (!isAutoScrollEnabledRef.current) {
      return;
    }
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
      lastHeightRef.current = contentRef.current.scrollHeight;
      console.log(`[DEBUG] Updated lastHeightRef to ${lastHeightRef.current}`);
    }
  }, []); // 移除所有依赖，避免无限循环

  // Monitor content changes and scroll
  useEffect(() => {
    console.log(`[DEBUG] Content change detected, summary length: ${data?.summary?.length}, isProcessing: ${isProcessingRef.current}`);
    if (activeView === 'summary' && data?.summary && isProcessingRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [activeView, data?.summary, scrollToBottom]);

  // Main data loading effect - only use database
  useEffect(() => {
    if (id) {
      console.log(`[DEBUG] useEffect triggered for ID: ${id}, isProcessing: ${isProcessing}, requestSent: ${requestSentRef.current}`);
      logDebug('Dashboard useEffect triggered', { id, isProcessing, requestSent: requestSentRef.current });
      
      const startTime = performance.now();
      const isInitialLoadForCurrentId = !hasResolvedInitialFetchRef.current;
      const finishLoadCycle = () => {
        hasResolvedInitialFetchRef.current = true;
        setIsLoading(false);
      };
      
      if (isInitialLoadForCurrentId) {
        setIsLoading(true);
      }
      setError(null);
      
      // Only load from database API
      console.log('[DEBUG] 从数据库获取分析结果...');
      debugFetch(`/api/analysis/${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      .then(response => response.json())
      .then(result => {
        console.log('[DEBUG] 数据库API响应:', result);
        // 调试：打印 canEdit 相关信息
        if (typeof window !== 'undefined') {
          window.__PODSUM_DEBUG__ = result;
          // 强制在页面显示调试信息
          console.log('[DEBUG] 完整API响应:', JSON.stringify(result, null, 2));
          console.log('[DEBUG] canEdit值:', result.data?.canEdit);
          console.log('[DEBUG] 用户会话:', result.data?.session);
          console.log('[DEBUG] podcast.userId:', result.data?.podcast?.userId);
        }
        
        if (result.success && result.data) {
          const { podcast, analysis, isProcessed, canEdit, processingJob } = result.data;
          
          if (isProcessed && analysis) {
            // 数据库中有完整的分析结果
            console.log('[DEBUG] 从数据库加载完整分析结果');
            const loadedData: ProcessedData = {
              title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: normalizeMarkdownOutput(analysis.summary || 'Summary not available.'),
              translation: normalizePlainTextOutput(analysis.translation || 'Translation not available.'),
              fullTextHighlights: normalizeMarkdownOutput(
                enforceLineBreaks(analysis.highlights || 'Highlights not available.')
              ),
              processedAt: analysis.processedAt,
            };
            setData(loadedData);
            setIsSummaryFinal(true);
            setIsHighlightsFinal(true);
            setProcessingStatus(null);
            setCopyStatusWithReset('idle');
            resetProcessingProgress();
            setIsProcessing(false);
            isProcessingRef.current = false;
            requestSentRef.current = false;
            finishLoadCycle();
            setCanEdit(canEdit); // 新增
            
            const loadTime = performance.now() - startTime;
            logPerformance('dashboard-load-database-data', loadTime, { 
              id, 
              dataSize: {
                summary: analysis.summary?.length || 0,
                translation: analysis.translation?.length || 0,
                highlights: analysis.highlights?.length || 0
              }
            });
          } else if (podcast) {
            // 数据库中有播客信息但没有分析结果，需要处理
            console.log('[DEBUG] 数据库中有播客信息但无分析结果，开始处理');
            setData(prev => ({
              title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: analysis?.summary
                ? normalizeMarkdownOutput(analysis.summary)
                : prev?.summary || '',
              translation: analysis?.translation
                ? normalizePlainTextOutput(analysis.translation)
                : prev?.translation || '',
              fullTextHighlights: analysis?.highlights
                ? normalizeMarkdownOutput(
                    enforceLineBreaks(analysis.highlights)
                  )
                : prev?.fullTextHighlights || '',
              processedAt: analysis?.processedAt || prev?.processedAt || undefined,
            }));
            setIsSummaryFinal(false);
            setIsHighlightsFinal(false);
            setProcessingStatus('等待后台处理...');
            if (isInitialLoadForCurrentId) {
              setCopyStatusWithReset('idle');
              resetProcessingProgress();
            }
            finishLoadCycle();
            setCanEdit(canEdit);
            
            if (processingJob) {
              applyProcessingJobState(processingJob as ProcessingJobData);
            } else if (canEdit) {
              enqueueBackgroundProcessing(false);
            } else {
              setIsProcessing(false);
              isProcessingRef.current = false;
              requestSentRef.current = false;
            }
          } else {
            // 数据库中完全没有该ID的信息
            console.log('[DEBUG] 数据库中没有找到该ID的信息');
            setError('File not found in database. The file may have been deleted or never uploaded.');
            finishLoadCycle();
          }
        } else {
          // API调用失败
          console.log('[DEBUG] 数据库API调用失败');
          setError(result.error || 'Failed to load file information from database.');
          finishLoadCycle();
        }
      })
      .catch(error => {
        console.error('[DEBUG] 数据库API调用出错:', error);
        setError('Failed to connect to database: ' + error.message);
        finishLoadCycle();
      });
    }
  }, [id, pollTick]); // 轮询时刷新状态

  // 后台处理中时轮询数据库状态（页面只做展示）
  useEffect(() => {
    if (!id || !isProcessing) {
      return;
    }
    const interval = setInterval(() => {
      setPollTick(prev => prev + 1);
    }, ANALYSIS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [id, isProcessing]);

  // Retry processing function
  const retryProcessing = () => {
    console.log('[DEBUG] Retry button clicked');
    logUserAction('retry-processing', { id });
    captureDebugState('retry-clicked');
    
    if (isProcessing) {
      console.log(`[DEBUG] Already processing ID: ${id}, avoiding duplicate retry request`);
      return;
    }
    
    console.log('[DEBUG] Starting retry process');
    setError(null);
    requestSentRef.current = false;
    enqueueBackgroundProcessing(true);
  };

  const getActiveViewContent = useCallback(() => {
    if (!data) {
      return '';
    }
    if (activeView === 'summary') {
      return data.summary;
    }
    if (activeView === 'translate') {
      return data.translation;
    }
    return data.fullTextHighlights;
  }, [activeView, data]);

  const copyCurrentView = async () => {
    const content = getActiveViewContent().trim();
    if (!content) {
      setCopyStatusWithReset('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatusWithReset('copied');
    } catch (copyError) {
      console.error('[DEBUG] Failed to copy current view:', copyError);
      setCopyStatusWithReset('failed');
    }
  };

  const scrollCurrentViewToTop = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      viewScrollPositionsRef.current[activeView] = 0;
      isAutoScrollEnabledRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollCurrentViewToBottom = () => {
    if (!contentRef.current) {
      return;
    }
    contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    viewScrollPositionsRef.current[activeView] = contentRef.current.scrollHeight;
    isAutoScrollEnabledRef.current = true;
  };

  const renderContent = () => {
    if (isLoading && !data) {
      return <div className="text-center p-10 text-slate-400">Loading content...</div>;
    }
    if (error) {
      return <div className="text-center p-10 text-red-400">Error: {error}</div>;
    }
    if (!data) {
      return <div className="text-center p-10 text-slate-400">No data available.</div>;
    }

    switch (activeView) {
      case 'summary':
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll} onWheel={handleContentWheel}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {data.summary || '正在生成摘要...'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      case 'translate':
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll} onWheel={handleContentWheel}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {data.translation || '正在生成翻译...'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      case 'fullText':
        return (
            <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll} onWheel={handleContentWheel}>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {data.fullTextHighlights || '正在生成重点内容...'}
                    </ReactMarkdown>
                  </div>
                </div>
            </div>
        );
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) => 
    `px-3.5 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold tracking-wide border transition-all duration-200 whitespace-nowrap
     ${activeView === view 
       ? 'bg-sky-500/90 text-white border-sky-300/45 shadow-[0_12px_30px_-14px_rgba(56,189,248,0.9)]' 
       : 'bg-slate-800/75 text-slate-300 border-slate-600/45 hover:bg-slate-700/80 hover:text-slate-100 hover:border-slate-500/60'}`;

  // Add Debug Status Panel component
  const DebugStatusPanel = () => {
    if (!debugMode) return null;
    
    return (
      <div className="fixed bottom-0 right-0 w-80 max-h-80 overflow-auto bg-slate-950/90 border border-sky-700/55 rounded-tl-xl p-3 text-xs z-50 backdrop-blur-sm">
        <h3 className="text-sky-400 font-semibold mb-2">Debug Status v{APP_VERSION}</h3>
        <div className="space-y-1 mb-2">
          <div><span className="text-slate-400">ID:</span> <span className="text-white">{id}</span></div>
          <div><span className="text-slate-400">State:</span> <span className={`${isProcessing ? 'text-yellow-400' : 'text-green-400'}`}>
            {isProcessing ? 'PROCESSING' : (data ? 'LOADED' : 'IDLE')}</span></div>
          <div><span className="text-slate-400">Request Sent:</span> <span className={`${requestSentRef.current ? 'text-yellow-400' : 'text-green-400'}`}>
            {requestSentRef.current ? 'YES' : 'NO'}</span></div>
          {error && <div><span className="text-red-400">Error:</span> <span className="text-white">{error}</span></div>}
        </div>
        
        <h4 className="text-sky-400 font-semibold mt-2 mb-1">Last Requests:</h4>
        <div className="space-y-1 mb-2 max-h-20 overflow-y-auto">
          {debugState.networkRequests.slice(-3).reverse().map((req, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-slate-400 truncate">{req.url.split('/').pop()}</span>
              <span className={`${req.status < 300 ? 'text-green-400' : 'text-red-400'}`}>
                {req.status} ({req.duration}ms)
              </span>
            </div>
          ))}
        </div>
        
        <div className="pt-2 border-t border-slate-700 flex space-x-2">
          <button 
            onClick={() => captureDebugState('refresh-clicked')} 
            className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded hover:bg-slate-600"
          >
            Refresh
          </button>
          <button 
            onClick={copyDebugInfo}
            className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded hover:bg-slate-600"
          >
            Copy Debug Info
          </button>
        </div>
      </div>
    );
  };

  const isQaAssistantEnabled = Boolean(
    data &&
    !isProcessing &&
    isSummaryFinal &&
    isHighlightsFinal
  );
  
  // Modify rendering to wrap in ErrorBoundary and include Debug Panel
  return (
    <ErrorBoundary>
      <div className="dashboard-shell min-h-screen text-slate-100 flex flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-700/55 bg-slate-950/70 backdrop-blur-xl">
          <div className="container mx-auto px-3 py-3.5 md:px-4 md:py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center space-x-2 text-sm sm:text-base lg:text-xl min-w-0 w-full md:w-auto">
              <Link href="/" className="text-sky-300 hover:text-sky-200 transition-colors font-bold shrink-0 tracking-wide">PodSum.cc</Link>
              <span className="text-slate-400">/</span>
              <span
                className="text-slate-100 font-medium truncate max-w-[60vw] sm:max-w-[68vw] md:max-w-xl lg:max-w-2xl"
                title={data?.title || ''}
              >
                {data?.title || ''}
              </span>
            </nav>
            <div className="flex items-center gap-2 flex-wrap justify-end w-full md:w-auto">
              <button 
                onClick={() => setDebugMode(!debugMode)}
                className="hidden sm:inline-flex text-xs bg-slate-800/85 hover:bg-slate-700 border border-slate-600/45 py-1.5 px-2.5 rounded-lg text-slate-300 transition-colors"
              >
                {debugMode ? 'Hide Debug' : 'Debug Mode'}
              </button>
              <Link href="/my" className="text-xs bg-slate-800/85 hover:bg-slate-700 border border-slate-600/45 py-1.5 px-3 rounded-lg text-slate-200 transition-colors">
                View All Files
              </Link>
              {id && <span className="hidden md:inline text-xs text-slate-500 font-medium">ID: {id}</span>}
            </div>
          </div>
        </header>

        {/* 中间内容区域 */}
        {!data && !error && isLoading && (
          <div className="flex-grow flex items-center justify-center">
              <div className="text-center rounded-2xl border border-slate-700/50 bg-slate-900/55 px-8 py-8 shadow-2xl backdrop-blur-sm">
                  <div className="animate-spin rounded-full h-12 w-12 border-2 border-slate-500 border-t-sky-400 mx-auto mb-4"></div>
                  <p className="text-slate-300 text-sm sm:text-base tracking-wide">Loading transcript data...</p>
              </div>
          </div>
        )}

        {error && (
           <div className="flex-grow flex items-center justify-center">
             <div className="text-red-300 border border-red-700/45 bg-red-950/30 p-6 sm:p-7 rounded-2xl flex flex-col items-center max-w-md shadow-2xl">
                <p className="mb-4 text-center leading-7">{error}</p>
                <button 
                  onClick={retryProcessing}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-white text-sm font-semibold transition-colors"
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <span className="inline-block animate-spin mr-2">↻</span>
                      处理中...
                    </>
                  ) : '重新处理文件'}
                </button>
              </div>
          </div>
        )}

        {data && (
          <main className="container mx-auto w-full max-w-[1560px] p-3 sm:p-4 md:p-6 lg:p-8 flex-grow flex flex-col md:flex-row gap-4 md:gap-6">
            {/* Left Sidebar */} 
            <aside className="w-full md:w-[320px] lg:w-[340px] xl:w-[360px] dashboard-panel p-4 sm:p-5 md:p-6 rounded-2xl shadow-2xl self-start md:sticky md:top-24">
              <h2 className="text-lg sm:text-xl font-semibold mb-1 text-sky-300 truncate leading-8" title={data.title}>{data.title}</h2>
              <p className="text-xs text-slate-500 mb-5 tracking-wide">ID: {id}</p>
              
              <div className="space-y-4 text-sm">
                <div>
                  <span className="font-semibold text-slate-400 tracking-wide">Original File</span> 
                  <p className="text-slate-200 mt-1 break-words leading-6" title={data.originalFileName}>{data.originalFileName}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-400 tracking-wide">File Size</span> 
                  <p className="text-slate-200 mt-1">{data.originalFileSize}</p>
                </div>
                {data.processedAt && (
                  <div>
                    <span className="font-semibold text-slate-400 tracking-wide">Processed</span> 
                    <p className="text-slate-200 mt-1">{new Date(data.processedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
              
              {/* 添加重新处理按钮 */}
              {canEdit && (
                <div className="mt-6">
                  <button 
                    onClick={retryProcessing}
                    className="w-full py-2.5 bg-sky-500 hover:bg-sky-400 rounded-xl text-white text-sm font-semibold transition-colors flex items-center justify-center shadow-[0_16px_36px_-18px_rgba(56,189,248,0.95)]"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                        处理中...
                      </>
                    ) : '重新处理文件'}
                  </button>
                </div>
              )}
              
              {/* Debug Mode 显示调试信息 */}
              {debugMode && (
                <div className="mt-6 p-4 bg-slate-900/60 border border-slate-700/60 rounded-xl text-xs text-slate-300">
                  <h3 className="font-bold mb-2 tracking-wide">Debug Info</h3>
                  <div>canEdit: {canEdit.toString()}</div>
                  <div>isLoading: {isLoading.toString()}</div>
                  <div>isProcessing: {isProcessing.toString()}</div>
                  <div>hasError: {!!error}</div>
                  <button 
                    onClick={() => console.log('window.__PODSUM_DEBUG__:', window.__PODSUM_DEBUG__)}
                    className="mt-2 px-2.5 py-1 bg-sky-600 hover:bg-sky-500 rounded-lg text-xs transition-colors"
                  >
                    Log Debug to Console
                  </button>
                </div>
              )}
              
              {/* Placeholder for future elements like download original, re-process options, etc. */}
            </aside>

            {/* Right Content Area */} 
            <section className="w-full min-w-0 md:flex-1">
              <div className="mb-4 sm:mb-6 space-y-3">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button onClick={() => switchActiveView('summary')} className={`${getButtonClass('summary')} shrink-0`}>Summary</button>
                      <button onClick={() => switchActiveView('translate')} className={`${getButtonClass('translate')} shrink-0`}>Translate</button>
                      <button onClick={() => switchActiveView('fullText')} className={`${getButtonClass('fullText')} shrink-0`}>Full Text</button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={copyCurrentView}
                      className="text-[11px] sm:text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-600/45 py-1.5 px-2.5 sm:px-3 rounded-lg text-slate-300 transition-colors"
                    >
                      {copyStatus === 'copied' ? 'Copied' : (copyStatus === 'failed' ? 'No Content' : 'Copy View')}
                    </button>
                    <button
                      onClick={scrollCurrentViewToTop}
                      className="text-[11px] sm:text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-600/45 py-1.5 px-2.5 sm:px-3 rounded-lg text-slate-300 transition-colors"
                    >
                      Top
                    </button>
                    <button
                      onClick={scrollCurrentViewToBottom}
                      className="text-[11px] sm:text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-600/45 py-1.5 px-2.5 sm:px-3 rounded-lg text-slate-300 transition-colors"
                    >
                      Bottom
                    </button>
                  </div>
              </div>

              {isProcessing && (
                <div className="mb-4 rounded-2xl border border-sky-700/45 bg-slate-900/55 p-3.5 sm:p-4 shadow-xl backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <div className="text-sky-200 flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-sky-400 animate-pulse"></span>
                      <span>{processingStatus || '处理中...'}</span>
                    </div>
                    <span className="text-slate-300 tracking-wide">
                      {processingProgress.task ? TASK_LABELS[processingProgress.task] : 'Preparing'}
                      {processingProgress.total > 0 ? ` · ${processingProgress.completed}/${processingProgress.total}` : ''}
                    </span>
                  </div>
                  {processingProgress.total > 0 && (
                    <div className="mt-2.5 h-2 w-full rounded-full bg-slate-700/80 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300 ease-out"
                        style={{ width: `${Math.min(100, Math.round((processingProgress.completed / processingProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              
              <div className="dashboard-panel min-h-[240px] sm:min-h-[320px] rounded-2xl shadow-2xl overflow-hidden">
                {renderContent()}
              </div>
            </section>
          </main>
        )}
        
        {/* Add Debug Status Panel */}
        <DebugStatusPanel />

        <FloatingQaAssistant
          podcastId={id}
          enabled={isQaAssistantEnabled}
          summary={data?.summary}
          translation={data?.translation}
          highlights={data?.fullTextHighlights}
        />
        
        <footer className="p-4 text-center text-xs text-slate-500 tracking-wide">
          SRT Processor Edge Demo v{APP_VERSION}
        </footer>
      </div>
    </ErrorBoundary>
  );
} 
