/* eslint-disable */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logDebug, logError, logUserAction, logPerformance, getBrowserInfo, getClientErrors } from '../../../lib/debugUtils';
import { ErrorBoundary } from '../../../components/ErrorBoundary';

// VERCEL DEBUG: Add version number to help track deployments
const APP_VERSION = '1.0.3'; // Increment version for tracking
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

interface StreamingBuffers {
  summary: string;
  translation: string;
  highlights: string;
}

// Define types for streamed process results
interface ProcessResult {
  summary: string;
  translation: string;
  fullTextHighlights: string;
  processedAt: string;
}

type ViewMode = 'summary' | 'translate' | 'fullText';
type ProcessingTask = 'summary' | 'translation' | 'highlights';

interface ProcessingProgress {
  task: ProcessingTask | null;
  completed: number;
  total: number;
}

const STREAM_FLUSH_INTERVAL_MS = 80;
const COPY_STATUS_RESET_MS = 1500;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 64;
const TASK_LABELS: Record<ProcessingTask, string> = {
  summary: 'Summary',
  translation: 'Translation',
  highlights: 'Highlights',
};

// Helper function to safely parse JSON
const safelyParseJSON = (jsonString: string) => {
  try {
    return JSON.parse(jsonString) as any;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return {};
  }
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
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamBuffersRef = useRef<StreamingBuffers>({
    summary: '',
    translation: '',
    highlights: '',
  });

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

  const flushStreamBuffers = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    const { summary, translation, highlights } = streamBuffersRef.current;
    setData(prevData => prevData ? {
      ...prevData,
      summary,
      translation,
      fullTextHighlights: highlights,
    } : prevData);
  }, []);

  const queueStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      return;
    }
    streamFlushTimerRef.current = setTimeout(flushStreamBuffers, STREAM_FLUSH_INTERVAL_MS);
  }, [flushStreamBuffers]);

  const syncStreamBuffersFromData = useCallback((nextData: ProcessedData) => {
    streamBuffersRef.current = {
      summary: nextData.summary,
      translation: nextData.translation,
      highlights: nextData.fullTextHighlights,
    };
  }, []);

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

  const markTaskComplete = useCallback((task: ProcessingTask) => {
    setProcessingProgress(prev => {
      const total = prev.total > 0 ? prev.total : 1;
      return {
        task,
        completed: total,
        total,
      };
    });
  }, []);

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

  useEffect(() => {
    return () => {
      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
      }
      if (copyStatusTimerRef.current !== null) {
        clearTimeout(copyStatusTimerRef.current);
      }
    };
  }, []);


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
      
      setIsLoading(true);
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
          const { podcast, analysis, isProcessed, canEdit } = result.data;
          
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
            syncStreamBuffersFromData(loadedData);
            setIsSummaryFinal(true);
            setIsHighlightsFinal(true);
            setProcessingStatus(null);
            setCopyStatusWithReset('idle');
            resetProcessingProgress();
            setIsLoading(false);
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
            const processingData: ProcessedData = {
              title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: '',
              translation: '',
              fullTextHighlights: '',
            };
            setData(processingData);
            syncStreamBuffersFromData(processingData);
            setIsSummaryFinal(false);
            setIsHighlightsFinal(false);
            setProcessingStatus('正在处理中，稍后显示结果...');
            setCopyStatusWithReset('idle');
            resetProcessingProgress();
            setIsLoading(false);
            
            // 开始处理
            if (podcast.blobUrl && !isProcessing && !requestSentRef.current) {
              startProcessing(podcast.blobUrl, podcast.originalFileName);
            }
          } else {
            // 数据库中完全没有该ID的信息
            console.log('[DEBUG] 数据库中没有找到该ID的信息');
            setError('File not found in database. The file may have been deleted or never uploaded.');
            setIsLoading(false);
          }
        } else {
          // API调用失败
          console.log('[DEBUG] 数据库API调用失败');
          setError(result.error || 'Failed to load file information from database.');
          setIsLoading(false);
        }
      })
      .catch(error => {
        console.error('[DEBUG] 数据库API调用出错:', error);
        setError('Failed to connect to database: ' + error.message);
        setIsLoading(false);
      });
    }
  }, [id]); // 只依赖 id，避免无限循环

  // Start processing function
  function startProcessing(fileUrl: string, fileName: string) {
    console.log('[DEBUG] 开始API处理请求');
    logUserAction('start-processing', { id, fileName });
    
    // 标记为处理中
    setIsProcessing(true);
    setIsSummaryFinal(false);
    setIsHighlightsFinal(false);
    setProcessingStatus('正在启动处理流程...');
    setCopyStatusWithReset('idle');
    setProcessingProgress({
      task: 'summary',
      completed: 0,
      total: 0,
    });
    requestSentRef.current = true;
    isProcessingRef.current = true;
    isAutoScrollEnabledRef.current = true;
    streamBuffersRef.current = {
      summary: '',
      translation: '',
      highlights: '',
    };
    
    // 处理文件
    console.log(`[DEBUG] 发送处理请求到 /api/process，ID: ${id}`);
    const apiStartTime = performance.now();
    
    debugFetch('/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        blobUrl: fileUrl,
        fileName,
        debug: true,
        appVersion: APP_VERSION
      }),
    })
    .then(response => {
      console.log(`[DEBUG] API response received, status: ${response.status}, ok: ${response.ok}`);
      logDebug('API response received', { 
        status: response.status, 
        ok: response.ok, 
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (!response.ok) {
        return response.text().then(text => {
          console.error(`[DEBUG] Error response text: ${text}`);
          let errorMessage = 'Processing failed';
          try {
            if (text && (text.startsWith('{') || text.startsWith('['))) {
              const errorData = safelyParseJSON(text);
              errorMessage = errorData.error || errorMessage;
              console.error(`[DEBUG] Parsed error data: ${JSON.stringify(errorData)}`);
              logError('API error response', { errorData, status: response.status });
            } else {
              errorMessage = text || errorMessage;
              logError('API plain text error', { text, status: response.status });
            }
          } catch (e) {
            console.error('[DEBUG] Error parsing error response:', e, text);
            logError('Failed to parse error response', { error: e, text });
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        });
      }
      
      // Handle EventStream response
      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[DEBUG] Stream reader not available');
        logError('Stream reader not available');
        throw new Error('Stream reader not available');
      }
      
      console.log('[DEBUG] Stream reader created, beginning to process stream');
      logDebug('Stream processing started');
      const decoder = new TextDecoder();
      let buffer = '';
      let summary = '';
      let translation = '';
      let highlights = '';
      
      // Track events received
      let eventsReceived = 0;
      const streamStartTime = performance.now();
      
      // Create a Promise to process the stream
      return new Promise<ProcessResult>((resolve, reject) => {
        const streamReader = reader;
        function processStream() {
          streamReader.read().then(({ done, value }) => {
            if (done) {
              console.log('[DEBUG] Stream processing completed');
              logDebug('Stream processing completed', { 
                eventsReceived,
                processingTime: performance.now() - streamStartTime,
                summaryLength: summary.length
              });
              
              return resolve({
                summary,
                translation,
                fullTextHighlights: enforceLineBreaks(highlights),
                processedAt: new Date().toISOString()
              });
            }
            
            const newChunk = decoder.decode(value, { stream: true });
            console.log(`[DEBUG] Received chunk of length: ${newChunk.length}`);
            buffer += newChunk;
            let eolIndex;
            
            while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.substring(0, eolIndex);
              buffer = buffer.substring(eolIndex + 2);
              
              if (message.startsWith('data: ')) {
                try {
                  const jsonData = message.substring(5).trim();
                  console.log(`[DEBUG] Processing stream event: ${jsonData.substring(0, 50)}...`);
                  eventsReceived++;
                  
                  const eventData = safelyParseJSON(jsonData);
                  
                  // Update UI with real-time processing results
                  switch (eventData.type) {
                    case 'status':
                      console.log('[DEBUG] Status update:', eventData.message);
                      if (
                        eventData.task === 'summary' ||
                        eventData.task === 'translation' ||
                        eventData.task === 'highlights'
                      ) {
                        updateProcessingProgress(eventData.task);
                      }
                      setProcessingStatus(typeof eventData.message === 'string' ? eventData.message : null);
                      break;
                    case 'summary_token':
                      if (typeof eventData.content !== 'string') {
                        break;
                      }
                      const summaryContent = eventData.content;
                      summary += summaryContent;
                      
                      if (summary.length % 100 === 0) {
                        console.log(`[DEBUG] Summary accumulating, now at ${summary.length} characters`);
                      }

                      streamBuffersRef.current.summary = summary;
                      queueStreamFlush();
                      break;
                    case 'translation_token':
                      if (typeof eventData.content !== 'string') {
                        break;
                      }
                      const translationContent = eventData.content;
                      translation += translationContent;

                      streamBuffersRef.current.translation = translation;
                      queueStreamFlush();
                      break;
                    case 'highlight_token':
                      if (typeof eventData.content !== 'string') {
                        break;
                      }
                      const highlightContent = eventData.content;
                      highlights += highlightContent;

                      streamBuffersRef.current.highlights = highlights;
                      queueStreamFlush();
                      break;
                    case 'summary_chunk_result':
                      updateProcessingProgress('summary', eventData.chunkIndex, eventData.totalChunks);
                      break;
                    case 'translation_chunk_result':
                      updateProcessingProgress('translation', eventData.chunkIndex, eventData.totalChunks);
                      break;
                    case 'highlight_chunk_result':
                      updateProcessingProgress('highlights', eventData.chunkIndex, eventData.totalChunks);
                      break;
                    case 'summary_final_result':
                      summary = typeof eventData.content === 'string'
                        ? normalizeMarkdownOutput(eventData.content)
                        : summary;
                      streamBuffersRef.current.summary = summary;
                      flushStreamBuffers();
                      setIsSummaryFinal(true);
                      markTaskComplete('summary');
                      break;
                    case 'translation_final_result':
                      translation = typeof eventData.content === 'string'
                        ? normalizePlainTextOutput(eventData.content)
                        : translation;
                      streamBuffersRef.current.translation = translation;
                      flushStreamBuffers();
                      markTaskComplete('translation');
                      break;
                    case 'highlight_final_result':
                      if (typeof eventData.content === 'string') {
                        highlights = normalizeMarkdownOutput(enforceLineBreaks(eventData.content));
                      }
                      streamBuffersRef.current.highlights = highlights;
                      flushStreamBuffers();
                      setIsHighlightsFinal(true);
                      markTaskComplete('highlights');
                      break;
                    case 'all_done':
                      console.log('[DEBUG] Received all_done event');
                      if (eventData.finalResults) {
                        if (typeof eventData.finalResults.summary === 'string') {
                          summary = normalizeMarkdownOutput(eventData.finalResults.summary);
                        }
                        if (typeof eventData.finalResults.translation === 'string') {
                          translation = normalizePlainTextOutput(eventData.finalResults.translation);
                        }
                        if (typeof eventData.finalResults.highlights === 'string') {
                          highlights = normalizeMarkdownOutput(enforceLineBreaks(eventData.finalResults.highlights));
                        }
                        
                        console.log(`[DEBUG] Final results received - summary: ${summary?.length} chars, translation: ${translation?.length} chars`);
                        
                        streamBuffersRef.current = {
                          summary,
                          translation,
                          highlights,
                        };
                        flushStreamBuffers();
                        setIsSummaryFinal(true);
                        setIsHighlightsFinal(true);
                        setProcessingStatus(null);
                        resetProcessingProgress();
                      }
                      break;
                    case 'error':
                      const streamErrorMessage = typeof eventData.message === 'string' ? eventData.message : 'Unknown stream error';
                      console.error('[DEBUG] Process error:', streamErrorMessage);
                      logError('Process stream error', { message: streamErrorMessage, task: eventData.task });
                      setError(`处理错误: ${streamErrorMessage}`);
                      reject(new Error(streamErrorMessage));
                      break;
                  }
                } catch (e) {
                  console.error('[DEBUG] Failed to parse event JSON:', e);
                  logError('Failed to parse stream event', { error: e });
                }
              }
            }
            
            // Continue processing stream
            processStream();
          }).catch(err => {
            console.error('[DEBUG] Stream processing error:', err);
            logError('Stream processing error', { error: err });
            reject(err);
          });
        }
        
        // Start processing the stream
        processStream();
      });
    })
    .then((result: ProcessResult) => {
      console.log('[DEBUG] Processing completed, results available in database');
      
      logPerformance('api-processing-complete', performance.now() - apiStartTime, { 
        id, 
        resultSizes: {
          summary: result.summary.length,
          translation: result.translation.length,
          highlights: result.fullTextHighlights.length
        }
      });
      
      isProcessingRef.current = false;
      setIsProcessing(false);
      setProcessingStatus(null);
      requestSentRef.current = false;
      setIsSummaryFinal(true);
      setIsHighlightsFinal(true);
      resetProcessingProgress();
      flushStreamBuffers();
    })
    .catch(error => {
      console.error('[DEBUG] Processing error:', error);
      logError('Processing failed', { error: error.message, id });
      setError(error.message || 'Unknown error occurred during processing');
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
      setProcessingStatus(null);
      setIsSummaryFinal(true);
      setIsHighlightsFinal(true);
      resetProcessingProgress();
    });
  }

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
    
    // 重新从数据库获取文件信息并开始处理
    debugFetch(`/api/analysis/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    .then(response => response.json())
    .then(result => {
      if (result.success && result.data && result.data.podcast) {
        const { podcast } = result.data;
        
        setData({
          title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
          originalFileName: podcast.originalFileName,
          originalFileSize: podcast.fileSize,
          summary: '',
          translation: '',
          fullTextHighlights: '',
        });
        streamBuffersRef.current = {
          summary: '',
          translation: '',
          highlights: '',
        };
        setIsSummaryFinal(false);
        setIsHighlightsFinal(false);
        setProcessingStatus('正在重新处理...');
        setCopyStatusWithReset('idle');
        resetProcessingProgress();
        
        startProcessing(podcast.blobUrl, podcast.originalFileName);
      } else {
        setError('无法获取文件信息，无法重试');
      }
    })
    .catch(error => {
      setError('获取文件信息失败: ' + error.message);
    });
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
    if (isLoading) {
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
          <div className="p-4 sm:p-6 bg-slate-800 rounded-lg">
            <div className="streaming-content" ref={setContentElement} onScroll={handleContentScroll}>
              {!isSummaryFinal && isProcessing ? (
                <pre className="streaming-plain">{data.summary || '正在生成摘要...'}</pre>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {data.summary}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        );
      case 'translate':
        return (
          <pre
            ref={setContentElement}
            onScroll={handleContentScroll}
            className="streaming-content p-4 sm:p-6 bg-slate-800 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto"
          >
            {data.translation}
          </pre>
        );
      case 'fullText':
        return (
            <div className="p-4 sm:p-6 bg-slate-800 rounded-lg">
            <div className="streaming-content" ref={setContentElement} onScroll={handleContentScroll}>
                  {!isHighlightsFinal && isProcessing ? (
                    <pre className="streaming-plain">{data.fullTextHighlights || '正在生成重点内容...'}</pre>
                  ) : (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {data.fullTextHighlights}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
            </div>
        );
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) => 
    `px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors 
     ${activeView === view 
       ? 'bg-sky-600 text-white' 
       : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`;

  // Add Debug Status Panel component
  const DebugStatusPanel = () => {
    if (!debugMode) return null;
    
    return (
      <div className="fixed bottom-0 right-0 w-80 max-h-80 overflow-auto bg-slate-900 border border-sky-700 rounded-tl-md p-3 text-xs z-50 opacity-90">
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
  
  // Modify rendering to wrap in ErrorBoundary and include Debug Panel
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        <header className="p-3 md:p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
          <div className="container mx-auto flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center space-x-2 text-sm sm:text-base lg:text-xl min-w-0 w-full md:w-auto">
              <Link href="/" className="text-sky-400 hover:underline font-semibold shrink-0">PodSum.cc</Link>
              <span className="text-slate-400">/</span>
              <span
                className="text-white font-medium truncate max-w-[60vw] sm:max-w-[68vw] md:max-w-xl lg:max-w-2xl"
                title={data?.title || ''}
              >
                {data?.title || ''}
              </span>
            </nav>
            <div className="flex items-center gap-2 flex-wrap justify-end w-full md:w-auto">
              <button 
                onClick={() => setDebugMode(!debugMode)}
                className="hidden sm:inline-flex text-xs bg-slate-700 hover:bg-slate-600 py-1 px-2 rounded-md text-slate-300"
              >
                {debugMode ? 'Hide Debug' : 'Debug Mode'}
              </button>
              <Link href="/my" className="text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-3 rounded-md text-slate-300">
                View All Files
              </Link>
              {id && <span className="hidden md:inline text-xs text-slate-500">ID: {id}</span>}
            </div>
          </div>
        </header>

        {/* 中间内容区域 */}
        {!data && !error && isLoading && (
          <div className="flex-grow flex items-center justify-center">
              <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
                  <p className="text-slate-400">Loading transcript data...</p>
              </div>
          </div>
        )}

        {error && (
           <div className="flex-grow flex items-center justify-center">
             <div className="text-red-400 bg-red-900/30 p-6 rounded-lg flex flex-col items-center max-w-md">
                <p className="mb-4 text-center">{error}</p>
                <button 
                  onClick={retryProcessing}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm font-medium transition-colors"
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
          <main className="container mx-auto p-3 sm:p-4 md:p-6 flex-grow flex flex-col md:flex-row gap-4 md:gap-6">
            {/* Left Sidebar */} 
            <aside className="w-full md:w-1/3 lg:w-1/4 bg-slate-800 p-4 sm:p-5 md:p-6 rounded-lg shadow-xl self-start">
              <h2 className="text-xl font-semibold mb-1 text-sky-400 truncate" title={data.title}>{data.title}</h2>
              <p className="text-xs text-slate-500 mb-4">ID: {id}</p>
              
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-slate-400">Original File:</span> 
                  <p className="text-slate-300 truncate" title={data.originalFileName}>{data.originalFileName}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-400">File Size:</span> 
                  <p className="text-slate-300">{data.originalFileSize}</p>
                </div>
                {data.processedAt && (
                  <div>
                    <span className="font-medium text-slate-400">Processed:</span> 
                    <p className="text-slate-300">{new Date(data.processedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
              
              {/* 添加重新处理按钮 */}
              {canEdit && (
                <div className="mt-6">
                  <button 
                    onClick={retryProcessing}
                    className="w-full py-2 bg-sky-600 hover:bg-sky-700 rounded text-white text-sm transition-colors flex items-center justify-center"
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
                <div className="mt-6 p-4 bg-slate-700 rounded text-xs text-slate-300">
                  <h3 className="font-bold mb-2">Debug Info:</h3>
                  <div>canEdit: {canEdit.toString()}</div>
                  <div>isLoading: {isLoading.toString()}</div>
                  <div>isProcessing: {isProcessing.toString()}</div>
                  <div>hasError: {!!error}</div>
                  <button 
                    onClick={() => console.log('window.__PODSUM_DEBUG__:', window.__PODSUM_DEBUG__)}
                    className="mt-2 px-2 py-1 bg-sky-600 rounded text-xs"
                  >
                    Log Debug to Console
                  </button>
                </div>
              )}
              
              {/* Placeholder for future elements like download original, re-process options, etc. */}
            </aside>

            {/* Right Content Area */} 
            <section className="w-full md:w-2/3 lg:w-3/4">
              <div className="mb-4 sm:mb-6 space-y-3">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button onClick={() => switchActiveView('summary')} className={`${getButtonClass('summary')} shrink-0`}>Summary</button>
                      <button onClick={() => switchActiveView('translate')} className={`${getButtonClass('translate')} shrink-0`}>Translate</button>
                      <button onClick={() => switchActiveView('fullText')} className={`${getButtonClass('fullText')} shrink-0`}>Full Text</button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={copyCurrentView}
                      className="text-[11px] sm:text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-2.5 sm:px-3 rounded-md text-slate-300"
                    >
                      {copyStatus === 'copied' ? 'Copied' : (copyStatus === 'failed' ? 'No Content' : 'Copy View')}
                    </button>
                    <button
                      onClick={scrollCurrentViewToTop}
                      className="text-[11px] sm:text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-2.5 sm:px-3 rounded-md text-slate-300"
                    >
                      Top
                    </button>
                    <button
                      onClick={scrollCurrentViewToBottom}
                      className="text-[11px] sm:text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-2.5 sm:px-3 rounded-md text-slate-300"
                    >
                      Bottom
                    </button>
                  </div>
              </div>

              {isProcessing && (
                <div className="mb-4 rounded-lg border border-sky-800/60 bg-slate-800/70 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <div className="text-sky-200 flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-sky-400 animate-pulse"></span>
                      <span>{processingStatus || '处理中...'}</span>
                    </div>
                    <span className="text-slate-300">
                      {processingProgress.task ? TASK_LABELS[processingProgress.task] : 'Preparing'}
                      {processingProgress.total > 0 ? ` · ${processingProgress.completed}/${processingProgress.total}` : ''}
                    </span>
                  </div>
                  {processingProgress.total > 0 && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-sky-500 transition-all duration-300 ease-out"
                        style={{ width: `${Math.min(100, Math.round((processingProgress.completed / processingProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              
              <div className="bg-slate-800/50 backdrop-blur-md rounded-lg shadow-xl min-h-[240px] sm:min-h-[300px]">
                {renderContent()}
              </div>
            </section>
          </main>
        )}
        
        {/* Add Debug Status Panel */}
        <DebugStatusPanel />
        
        <footer className="p-4 text-center text-xs text-slate-600">
          SRT Processor Edge Demo v{APP_VERSION}
        </footer>
      </div>
    </ErrorBoundary>
  );
} 
