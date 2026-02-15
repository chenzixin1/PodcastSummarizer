/* eslint-disable */
'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logDebug, logError, logUserAction, logPerformance, getBrowserInfo, getClientErrors } from '../../../lib/debugUtils';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import FloatingQaAssistant from '../../../components/FloatingQaAssistant';
import type { MindMapData, MindMapNode } from '../../../lib/mindMap';

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
  mindMapJson?: MindMapData | null;
  processedAt?: string;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
  sourceReference?: string | null;
}

interface ProcessingJobData {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  currentTask?: 'summary' | 'translation' | 'highlights' | null;
  progressCurrent?: number;
  progressTotal?: number;
  statusMessage?: string | null;
  lastError?: string | null;
}

type ViewMode = 'summary' | 'translate' | 'fullText' | 'mindMap';
type ProcessingTask = 'summary' | 'translation' | 'highlights';
type ThemeMode = 'light' | 'dark';

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

const MindMapCanvas = dynamic(() => import('../../../components/MindMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      Loading mind map...
    </div>
  ),
});

const normalizeMindMapNode = (value: unknown, depth: number): MindMapNode | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const label = typeof source.label === 'string' ? source.label.trim() : '';
  if (!label) {
    return null;
  }

  const node: MindMapNode = {
    label: label.slice(0, 64),
  };
  if (depth >= 3) {
    return node;
  }

  const childrenRaw = Array.isArray(source.children) ? source.children : [];
  const children = childrenRaw
    .map((child) => normalizeMindMapNode(child, depth + 1))
    .filter((child): child is MindMapNode => Boolean(child))
    .slice(0, 10);

  if (children.length > 0) {
    node.children = children;
  }
  return node;
};

const parseMindMapData = (value: unknown): MindMapData | null => {
  if (!value) {
    return null;
  }

  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const rootCandidate = (parsed as Record<string, unknown>).root ?? parsed;
  const root = normalizeMindMapNode(rootCandidate, 0);
  if (!root || !root.children || root.children.length === 0) {
    return null;
  }

  return { root };
};

const TIMESTAMP_ONLY_PATTERN = /^\[[0-9]{2}:[0-9]{2}:[0-9]{1,3}(?:\s*-->\s*[0-9]{2}:[0-9]{2}:[0-9]{1,3})?\]$/;

const flattenReactNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenReactNodeText).join('');
  }
  if (node && typeof node === 'object' && 'props' in node) {
    return flattenReactNodeText((node as { props?: { children?: ReactNode } }).props?.children ?? '');
  }
  return '';
};

const markdownComponents: Components = {
  strong({ children }) {
    const normalized = flattenReactNodeText(children).replace(/\s+/g, ' ').trim();
    const isTimestampOnly = TIMESTAMP_ONLY_PATTERN.test(normalized);
    return <strong className={isTimestampOnly ? 'markdown-timestamp-strong' : undefined}>{children}</strong>;
  },
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const formatMetricValue = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toLocaleString();
};

const resolveDashboardTitle = (podcast: { title?: string | null; originalFileName?: string | null }) => {
  const normalizedTitle = typeof podcast.title === 'string' ? podcast.title.trim() : '';
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const fileBaseName = String(podcast.originalFileName || '')
    .replace(/\.[^.]+$/g, '')
    .trim();
  return fileBaseName || 'Transcript';
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
  const [contentPanelHeight, setContentPanelHeight] = useState<number | undefined>(undefined);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    task: null,
    completed: 0,
    total: 0,
  });
  const [sourceInput, setSourceInput] = useState('');
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [sourceSaveStatus, setSourceSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [sourceSaveError, setSourceSaveError] = useState<string | null>(null);
  
  // Refs for scroll control and processing state
  const contentRef = useRef<HTMLElement | null>(null);
  const contentPanelRef = useRef<HTMLDivElement | null>(null);
  const isProcessingRef = useRef(false);
  const isAutoScrollEnabledRef = useRef(true);
  const viewScrollPositionsRef = useRef<Record<ViewMode, number>>({
    summary: 0,
    translate: 0,
    fullText: 0,
    mindMap: 0,
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

  const syncContentPanelHeight = useCallback(() => {
    const panel = contentPanelRef.current;
    if (!panel) {
      setContentPanelHeight(undefined);
      return;
    }
    const nextHeight = Math.round(panel.getBoundingClientRect().height);
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setContentPanelHeight(nextHeight);
    }
  }, []);

  const handleContentScroll = useCallback(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    viewScrollPositionsRef.current[activeView] = element.scrollTop;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isAutoScrollEnabledRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, [activeView]);

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

  useEffect(() => {
    const panel = contentPanelRef.current;
    if (!panel) {
      return;
    }

    syncContentPanelHeight();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncContentPanelHeight();
    });
    observer.observe(panel);

    return () => observer.disconnect();
  }, [syncContentPanelHeight, activeView, data, isProcessing, processingProgress.completed, processingProgress.total]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem('podsum-dashboard-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setThemeMode(storedTheme);
      return;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setThemeMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('podsum-dashboard-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!data) {
      setSourceInput('');
      setSourceSaveStatus('idle');
      setSourceSaveError(null);
      return;
    }
    setSourceInput(data.sourceReference || '');
    setSourceSaveStatus('idle');
    setSourceSaveError(null);
  }, [data?.sourceReference, id]);


  // Add ID validation after all hooks and functions are defined
  if (!id || id === 'undefined' || id === 'null') {
    return (
      <div className="min-h-screen bg-[#f3eee3] text-[var(--text-main)] flex items-center justify-center px-4">
        <div className="text-center max-w-md p-8 bg-[var(--paper-base)] border border-[var(--border-soft)] rounded-2xl shadow-[0_18px_42px_-30px_rgba(80,67,44,0.55)]">
          <h1 className="text-2xl font-bold text-[var(--danger)] mb-4">Invalid File ID</h1>
          <p className="text-[var(--text-secondary)] mb-6">
            The file ID in the URL is invalid or missing. This usually happens when:
          </p>
          <ul className="text-left text-sm text-[var(--text-muted)] mb-6 space-y-2">
            <li>• You navigated to an incomplete URL</li>
            <li>• The file upload process was interrupted</li>
            <li>• You&rsquo;re using an old or broken bookmark</li>
          </ul>
          <div className="space-y-3">
            <Link 
              href="/upload" 
              className="block w-full bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Upload New File
            </Link>
            <Link 
              href="/my" 
              className="block w-full bg-[var(--paper-subtle)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] font-semibold py-3 px-4 rounded-lg transition-colors"
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
              title: resolveDashboardTitle(podcast),
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: normalizeMarkdownOutput(analysis.summary || 'Summary not available.'),
              translation: normalizePlainTextOutput(analysis.translation || 'Translation not available.'),
              fullTextHighlights: normalizeMarkdownOutput(
                enforceLineBreaks(analysis.highlights || 'Highlights not available.')
              ),
              mindMapJson: parseMindMapData(analysis.mindMapJson),
              processedAt: analysis.processedAt,
              tokenCount: analysis.tokenCount ?? null,
              wordCount: analysis.wordCount ?? null,
              characterCount: analysis.characterCount ?? null,
              sourceReference: podcast.sourceReference ?? null,
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
              title: resolveDashboardTitle(podcast),
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
              mindMapJson: parseMindMapData(analysis?.mindMapJson) ?? prev?.mindMapJson ?? null,
              processedAt: analysis?.processedAt || prev?.processedAt || undefined,
              tokenCount: analysis?.tokenCount ?? prev?.tokenCount ?? null,
              wordCount: analysis?.wordCount ?? prev?.wordCount ?? null,
              characterCount: analysis?.characterCount ?? prev?.characterCount ?? null,
              sourceReference: podcast.sourceReference ?? prev?.sourceReference ?? null,
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

  const saveSourceReference = async () => {
    if (!id || !canEdit || isSavingSource) {
      return;
    }

    const normalizedSource = sourceInput.trim();
    setIsSavingSource(true);
    setSourceSaveError(null);
    setSourceSaveStatus('idle');

    try {
      const response = await fetch(`/api/podcasts/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceReference: normalizedSource || null,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Save failed (${response.status})`);
      }

      setData(prev => prev ? { ...prev, sourceReference: normalizedSource || null } : prev);
      setSourceSaveStatus('saved');
    } catch (saveError) {
      setSourceSaveStatus('failed');
      setSourceSaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSavingSource(false);
    }
  };

  const currentSourceReference = (data?.sourceReference || '').trim();
  const sourceReferenceIsUrl = currentSourceReference ? isValidHttpUrl(currentSourceReference) : false;

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
    if (activeView === 'mindMap') {
      return data.mindMapJson ? JSON.stringify(data.mindMapJson, null, 2) : '';
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
      return <div className="text-center p-10 text-[var(--text-muted)]">Loading content...</div>;
    }
    if (error) {
      return <div className="text-center p-10 text-[var(--danger)]">Error: {error}</div>;
    }
    if (!data) {
      return <div className="text-center p-10 text-[var(--text-muted)]">No data available.</div>;
    }

    switch (activeView) {
      case 'summary':
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {data.summary || '正在生成摘要...'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      case 'translate':
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {data.translation || '正在生成翻译...'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      case 'fullText':
        return (
            <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll}>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {data.fullTextHighlights || '正在生成重点内容...'}
                    </ReactMarkdown>
                  </div>
                </div>
            </div>
        );
      case 'mindMap':
        return (
          <div className="p-2 sm:p-3 lg:p-4 h-[62vh] min-h-[440px] max-h-[840px]">
            {data.mindMapJson ? (
              <MindMapCanvas data={data.mindMapJson} themeMode={themeMode} />
            ) : (
              <div className="h-full w-full flex items-center justify-center rounded-xl border border-dashed border-[var(--border-medium)] bg-[var(--paper-base)] px-6 text-center text-sm text-[var(--text-muted)] leading-7">
                {isProcessing ? '脑图正在生成中，请稍候...' : '当前内容还没有脑图数据，可点击“重新处理文件”后生成。'}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) =>
    `shrink-0 px-3 sm:px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap
     ${activeView === view
       ? 'text-[var(--heading)] border-[var(--btn-primary)]'
       : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)] hover:border-[var(--border-medium)]'}`;

  // Add Debug Status Panel component
  const DebugStatusPanel = () => {
    if (!debugMode) return null;
    
    return (
      <div className="fixed bottom-0 right-0 w-80 max-h-80 overflow-auto bg-[var(--paper-base)] border border-[var(--border-medium)] rounded-tl-xl p-3 text-xs z-50 shadow-[0_16px_32px_-24px_rgba(80,67,44,0.5)]">
        <h3 className="text-[var(--accent-strong)] font-semibold mb-2">Debug Status v{APP_VERSION}</h3>
        <div className="space-y-1 mb-2">
          <div><span className="text-[var(--text-muted)]">ID:</span> <span className="text-[var(--text-main)]">{id}</span></div>
          <div><span className="text-[var(--text-muted)]">State:</span> <span className={`${isProcessing ? 'text-amber-700' : 'text-emerald-700'}`}>
            {isProcessing ? 'PROCESSING' : (data ? 'LOADED' : 'IDLE')}</span></div>
          <div><span className="text-[var(--text-muted)]">Request Sent:</span> <span className={`${requestSentRef.current ? 'text-amber-700' : 'text-emerald-700'}`}>
            {requestSentRef.current ? 'YES' : 'NO'}</span></div>
          {error && <div><span className="text-[var(--danger)]">Error:</span> <span className="text-[var(--text-main)]">{error}</span></div>}
        </div>
        
        <h4 className="text-[var(--accent-strong)] font-semibold mt-2 mb-1">Last Requests:</h4>
        <div className="space-y-1 mb-2 max-h-20 overflow-y-auto">
          {debugState.networkRequests.slice(-3).reverse().map((req, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-[var(--text-muted)] truncate">{req.url.split('/').pop()}</span>
              <span className={`${req.status < 300 ? 'text-emerald-700' : 'text-[var(--danger)]'}`}>
                {req.status} ({req.duration}ms)
              </span>
            </div>
          ))}
        </div>
        
        <div className="pt-2 border-t border-[var(--border-soft)] flex space-x-2">
          <button 
            onClick={() => captureDebugState('refresh-clicked')} 
            className="text-xs bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] px-2 py-1 rounded hover:bg-[var(--paper-muted)]"
          >
            Refresh
          </button>
          <button 
            onClick={copyDebugInfo}
            className="text-xs bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] px-2 py-1 rounded hover:bg-[var(--paper-muted)]"
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
      <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col" data-theme={themeMode}>
        <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[1900px] px-3 sm:px-4 md:px-6 lg:px-8 py-3.5 md:py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
            {/* Breadcrumb Navigation */}
            <nav className="app-breadcrumb-nav w-full md:w-auto">
              <Link href="/" className="app-breadcrumb-link tracking-wide">
                <Image src="/podcast-summarizer-icon.svg" alt="PodSum logo" width={28} height={28} />
                <span>PodSum.cc</span>
              </Link>
              <span className="app-breadcrumb-divider">/</span>
              <span
                className="app-breadcrumb-current max-w-[60vw] sm:max-w-[68vw] md:max-w-xl lg:max-w-2xl"
                title={data?.title || ''}
              >
                {data?.title || ''}
              </span>
            </nav>
            <div className="flex items-center gap-2 flex-wrap justify-end w-full md:w-auto">
              <div className="inline-flex items-center rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-0.5">
                <button
                  onClick={() => setThemeMode('light')}
                  className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                    themeMode === 'light'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  Light Mode
                </button>
                <button
                  onClick={() => setThemeMode('dark')}
                  className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                    themeMode === 'dark'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  Dark Mode
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* 中间内容区域 */}
        {!data && !error && isLoading && (
          <div className="flex-grow flex items-center justify-center">
              <div className="text-center rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-8 py-8 shadow-[0_18px_40px_-28px_rgba(80,67,44,0.45)]">
                  <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
                  <p className="text-[var(--text-secondary)] text-sm sm:text-base tracking-wide">Loading transcript data...</p>
              </div>
          </div>
        )}

        {error && (
           <div className="flex-grow flex items-center justify-center">
             <div className="text-[var(--danger)] border border-[#d8b7b7] bg-[#fff5f5] p-6 sm:p-7 rounded-2xl flex flex-col items-center max-w-md shadow-[0_18px_42px_-30px_rgba(125,73,73,0.52)]">
                <p className="mb-4 text-center leading-7">{error}</p>
                <button 
                  onClick={retryProcessing}
                  className="px-6 py-2.5 bg-[var(--danger)] hover:bg-[#8f4343] rounded-xl text-white text-sm font-semibold transition-colors"
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
          <main className="container mx-auto w-full max-w-[1900px] p-3 sm:p-4 md:p-6 lg:p-8 flex-grow flex flex-col gap-4 md:gap-6">
            <section className="dashboard-panel rounded-2xl p-3 sm:p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--paper-base)] px-2 py-0.5 text-[var(--text-secondary)]">
                      <span className="text-[var(--text-muted)]">Original</span>
                      <span className="truncate max-w-[200px] sm:max-w-[300px]" title={data.originalFileName}>{data.originalFileName}</span>
                    </span>
                    {data.processedAt && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--paper-base)] px-2 py-0.5 text-[var(--text-secondary)]">
                        <span className="text-[var(--text-muted)]">Time</span>
                        <span>{new Date(data.processedAt).toLocaleString()}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--paper-base)] px-2 py-0.5 text-[var(--text-secondary)]">
                      <span className="text-[var(--text-muted)]">Tokens</span>
                      <span>{formatMetricValue(data.tokenCount)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--paper-base)] px-2 py-0.5 text-[var(--text-secondary)]">
                      <span className="text-[var(--text-muted)]">Words</span>
                      <span>{formatMetricValue(data.wordCount)}</span>
                    </span>
                  </div>

                  <div>
                    {canEdit ? (
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                        <input
                          type="text"
                          value={sourceInput}
                          onChange={(event) => {
                            setSourceInput(event.target.value);
                            setSourceSaveStatus('idle');
                            setSourceSaveError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveSourceReference();
                            }
                          }}
                          placeholder="Source URL 或备注"
                          className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:border-[var(--border-medium)]"
                        />
                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                          <button
                            onClick={saveSourceReference}
                            disabled={isSavingSource}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--paper-subtle)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isSavingSource ? 'Saving...' : 'Save Source'}
                          </button>
                          {sourceSaveStatus === 'saved' && (
                            <span className="text-xs text-emerald-700">Saved</span>
                          )}
                          {sourceSaveStatus === 'failed' && (
                            <span className="text-xs text-[var(--danger)]">{sourceSaveError || 'Save failed'}</span>
                          )}
                          {currentSourceReference && sourceReferenceIsUrl && (
                            <a
                              href={currentSourceReference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[var(--btn-primary)] underline"
                            >
                              打开来源链接
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">
                        {currentSourceReference ? (
                          sourceReferenceIsUrl ? (
                            <a
                              href={currentSourceReference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--btn-primary)] underline break-all"
                            >
                              {currentSourceReference}
                            </a>
                          ) : (
                            <p className="text-[var(--text-main)] break-words leading-6">{currentSourceReference}</p>
                          )
                        ) : (
                          <p className="text-[var(--text-muted)]">-</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={retryProcessing}
                    className="w-full lg:w-auto lg:min-w-[140px] py-2 px-4 bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] rounded-xl text-[var(--btn-primary-text)] text-sm font-semibold transition-colors flex items-center justify-center shadow-[0_16px_36px_-20px_rgba(63,122,104,0.8)]"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                        处理中...
                      </>
                    ) : '重新处理文件'}
                  </button>
                )}
              </div>

              {debugMode && (
                <div className="mt-4 p-3 bg-[var(--paper-subtle)] border border-[var(--border-soft)] rounded-xl text-xs text-[var(--text-secondary)]">
                  <h3 className="font-bold mb-2 tracking-wide">Debug Info</h3>
                  <div>canEdit: {canEdit.toString()}</div>
                  <div>isLoading: {isLoading.toString()}</div>
                  <div>isProcessing: {isProcessing.toString()}</div>
                  <div>hasError: {!!error}</div>
                  <button
                    onClick={() => console.log('window.__PODSUM_DEBUG__:', window.__PODSUM_DEBUG__)}
                    className="mt-2 px-2.5 py-1 bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] rounded-lg text-xs transition-colors"
                  >
                    Log Debug to Console
                  </button>
                </div>
              )}
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] gap-4 md:gap-6 xl:items-start">
              <section className="w-full min-w-0">
                <div className="mb-4 sm:mb-6">
                  <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-soft)] pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button onClick={() => switchActiveView('summary')} className={`${getButtonClass('summary')} shrink-0`}>Summary</button>
                    <button onClick={() => switchActiveView('fullText')} className={`${getButtonClass('fullText')} shrink-0`}>Full Text Translated</button>
                    <button onClick={() => switchActiveView('translate')} className={`${getButtonClass('translate')} shrink-0`}>Full Text</button>
                    <button onClick={() => switchActiveView('mindMap')} className={`${getButtonClass('mindMap')} shrink-0`}>Mind Map</button>
                  </div>
                </div>

                {isProcessing && (
                  <div className="mb-4 rounded-2xl border border-[#bed3c9] bg-[var(--paper-base)] p-3.5 sm:p-4 shadow-[0_12px_28px_-24px_rgba(73,93,83,0.5)]">
                    <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                      <div className="text-[var(--text-secondary)] flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
                        <span>{processingStatus || '处理中...'}</span>
                      </div>
                      <span className="text-[var(--text-muted)] tracking-wide">
                        {processingProgress.task ? TASK_LABELS[processingProgress.task] : 'Preparing'}
                        {processingProgress.total > 0 ? ` · ${processingProgress.completed}/${processingProgress.total}` : ''}
                      </span>
                    </div>
                    {processingProgress.total > 0 && (
                      <div className="mt-2.5 h-2 w-full rounded-full bg-[#d9d3c7] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#7ea08f] to-[#3f7a68] transition-all duration-300 ease-out"
                          style={{ width: `${Math.min(100, Math.round((processingProgress.completed / processingProgress.total) * 100))}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div ref={contentPanelRef} className="dashboard-panel min-h-[240px] sm:min-h-[320px] rounded-2xl overflow-hidden">
                  {renderContent()}
                </div>
              </section>

              <div className="w-full self-start">
                {isQaAssistantEnabled ? (
                  <FloatingQaAssistant
                    podcastId={id}
                    enabled={isQaAssistantEnabled}
                    panelHeight={contentPanelHeight}
                  />
                ) : (
                  <aside
                    className="dashboard-panel w-full min-h-[320px] rounded-2xl overflow-hidden flex flex-col justify-center px-5 text-sm text-[var(--text-secondary)]"
                    style={typeof contentPanelHeight === 'number' && contentPanelHeight > 0 ? { height: contentPanelHeight } : undefined}
                  >
                    Copilot 会在当前文件处理完成后启用。
                  </aside>
                )}
              </div>
            </div>
          </main>
        )}
        
        {/* Add Debug Status Panel */}
        <DebugStatusPanel />
        
        <footer className="p-4 text-center text-xs text-[var(--text-muted)] tracking-wide">
          SRT Processor Edge Demo v{APP_VERSION}
        </footer>
      </div>
    </ErrorBoundary>
  );
} 
