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

// Define types for streamed process results
interface ProcessResult {
  summary: string;
  translation: string;
  fullTextHighlights: string;
  processedAt: string;
}

type ViewMode = 'summary' | 'translate' | 'fullText';

// Helper function to safely parse JSON
const safelyParseJSON = (jsonString: string) => {
  try {
    return JSON.parse(jsonString) as any;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return {};
  }
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

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string;
  
  // Initialize all hooks first, before any conditional returns
  const [activeView, setActiveView] = useState<ViewMode>('summary');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Refs for scroll control and processing state
  const contentRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const lastHeightRef = useRef(0);
  const requestSentRef = useRef(false);

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
  }, [id, isProcessing, data?.summary]);

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
  }, [id, isProcessing, data?.summary]);

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
    console.log(`[DEBUG] Attempting to scroll to bottom, isProcessing: ${isProcessingRef.current}`);
    if (contentRef.current) {
      const lastElement = contentRef.current.querySelector('p:last-child, h1:last-child, h2:last-child, h3:last-child');
      
      if (lastElement) {
        console.log('[DEBUG] Found last element, scrolling into view');
        lastElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        console.log('[DEBUG] No last element found for scrolling');
        logDebug('No last element found for scrolling', { 
          contentHeight: contentRef.current.scrollHeight,
          contentHtml: contentRef.current.innerHTML.substring(0, 200) + '...'
        });
      }
      
      lastHeightRef.current = contentRef.current.scrollHeight;
      console.log(`[DEBUG] Updated lastHeightRef to ${lastHeightRef.current}`);
    }
  }, [id, isProcessing, data?.summary]);

  // Monitor content changes and scroll
  useEffect(() => {
    console.log(`[DEBUG] Content change detected, summary length: ${data?.summary?.length}, isProcessing: ${isProcessingRef.current}`);
    if (data?.summary && isProcessingRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [data?.summary, isProcessing]);

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
        
        if (result.success && result.data) {
          const { podcast, analysis, isProcessed } = result.data;
          
          if (isProcessed && analysis) {
            // 数据库中有完整的分析结果
            console.log('[DEBUG] 从数据库加载完整分析结果');
            setData({
              title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: analysis.summary || 'Summary not available.',
              translation: analysis.translation || 'Translation not available.',
              fullTextHighlights: analysis.highlights || 'Highlights not available.',
              processedAt: analysis.processedAt,
            });
            setIsLoading(false);
            
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
            setData({
              title: `Transcript Analysis: ${podcast.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
              originalFileName: podcast.originalFileName,
              originalFileSize: podcast.fileSize,
              summary: '正在处理中... 您将看到实时的处理结果!',
              translation: '处理中...',
              fullTextHighlights: '处理中...',
            });
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
  }, [id, isProcessing, requestSentRef]);

  // Start processing function
  function startProcessing(fileUrl: string, fileName: string) {
    console.log('[DEBUG] 开始API处理请求');
    logUserAction('start-processing', { id, fileName });
    
    // 标记为处理中
    setIsProcessing(true);
    requestSentRef.current = true;
    isProcessingRef.current = true;
    
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
      let translation = 'Translation not processed in this version.';
      let highlights = 'Highlights not processed in this version.';
      
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
                fullTextHighlights: highlights,
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
                      setData(prevData => prevData ? {
                        ...prevData,
                        summary: `${summary}\n\n> Status: ${eventData.message}`,
                      } : null);
                      break;
                    case 'summary_token':
                      const summaryContent = eventData.content;
                      summary += summaryContent;
                      
                      if (summary.length % 100 === 0) {
                        console.log(`[DEBUG] Summary accumulating, now at ${summary.length} characters`);
                      }
                      
                      setData(prevData => prevData ? {
                        ...prevData,
                        summary: summary,
                      } : null);
                      break;
                    case 'translation_token':
                      const translationContent = eventData.content;
                      translation += translationContent;
                      
                      setData(prevData => prevData ? {
                        ...prevData,
                        translation: translation,
                      } : null);
                      break;
                    case 'highlight_token':
                      const highlightContent = eventData.content;
                      highlights += highlightContent;
                      
                      setData(prevData => prevData ? {
                        ...prevData,
                        fullTextHighlights: highlights,
                      } : null);
                      break;
                    case 'summary_final_result':
                      summary = eventData.content;
                      setData(prevData => prevData ? {
                        ...prevData,
                        summary: summary,
                      } : null);
                      break;
                    case 'translation_final_result':
                      translation = eventData.content;
                      setData(prevData => prevData ? {
                        ...prevData,
                        translation: translation,
                      } : null);
                      break;
                    case 'highlight_final_result':
                      highlights = eventData.content;
                      setData(prevData => prevData ? {
                        ...prevData,
                        fullTextHighlights: highlights,
                      } : null);
                      break;
                    case 'all_done':
                      console.log('[DEBUG] Received all_done event');
                      if (eventData.finalResults) {
                        summary = eventData.finalResults.summary;
                        translation = eventData.finalResults.translation;
                        highlights = eventData.finalResults.highlights;
                        
                        console.log(`[DEBUG] Final results received - summary: ${summary?.length} chars, translation: ${translation?.length} chars`);
                        
                        setData(prevData => prevData ? {
                          ...prevData,
                          summary,
                          translation,
                          fullTextHighlights: highlights,
                        } : null);
                      }
                      break;
                    case 'error':
                      console.error('[DEBUG] Process error:', eventData.message);
                      logError('Process stream error', { message: eventData.message, task: eventData.task });
                      setError(`处理错误: ${eventData.message}`);
                      reject(new Error(eventData.message));
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
      requestSentRef.current = false;
    })
    .catch(error => {
      console.error('[DEBUG] Processing error:', error);
      logError('Processing failed', { error: error.message, id });
      setError(error.message || 'Unknown error occurred during processing');
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
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
          summary: '正在重新处理... 您将看到实时的处理结果!',
          translation: '处理中...',
          fullTextHighlights: '处理中...',
        });
        
        startProcessing(podcast.blobUrl, podcast.originalFileName);
      } else {
        setError('无法获取文件信息，无法重试');
      }
    })
    .catch(error => {
      setError('获取文件信息失败: ' + error.message);
    });
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
          <div className="p-6 bg-slate-800 rounded-lg">
            <div className="markdown-body streaming-content" ref={contentRef}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {data.summary}
              </ReactMarkdown>
            </div>
          </div>
        );
      case 'translate':
        return <pre className="p-6 bg-slate-800 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto">{data.translation}</pre>;
      case 'fullText':
        return (
            <div className="p-6 bg-slate-800 rounded-lg">
            <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {data.fullTextHighlights}
                  </ReactMarkdown>
                </div>
            </div>
        );
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) => 
    `px-4 py-2 rounded-md text-sm font-medium transition-colors 
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
        <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
          <div className="container mx-auto flex justify-between items-center">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center space-x-2 text-xl">
              <Link href="/" className="text-sky-400 hover:underline font-semibold">PodSum.cc</Link>
              <span className="text-slate-400">/</span>
              <span className="text-white font-medium truncate max-w-xl lg:max-w-2xl" title={data?.title || ''}>{data?.title || ''}</span>
            </nav>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setDebugMode(!debugMode)}
                className="text-xs bg-slate-700 hover:bg-slate-600 py-1 px-2 rounded-md text-slate-300"
              >
                {debugMode ? 'Hide Debug' : 'Debug Mode'}
              </button>
              <Link href="/my" className="text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-3 rounded-md text-slate-300">
                View All Files
              </Link>
              {id && <span className="text-xs text-slate-500">ID: {id}</span>}
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
          <main className="container mx-auto p-4 md:p-6 flex-grow flex flex-col md:flex-row gap-6">
            {/* Left Sidebar */} 
            <aside className="w-full md:w-1/3 lg:w-1/4 bg-slate-800 p-6 rounded-lg shadow-xl self-start">
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
              
              {/* Placeholder for future elements like download original, re-process options, etc. */}
            </aside>

            {/* Right Content Area */} 
            <section className="w-full md:w-2/3 lg:w-3/4">
              <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
                  <div className="flex space-x-2 sm:space-x-3 flex-wrap gap-y-2">
                      <button onClick={() => setActiveView('summary')} className={getButtonClass('summary')}>Summary</button>
                      <button onClick={() => setActiveView('translate')} className={getButtonClass('translate')}>Translate</button>
                      <button onClick={() => setActiveView('fullText')} className={getButtonClass('fullText')}>Full Text w/ Highlights</button>
                  </div>
              </div>
              
              <div className="bg-slate-800/50 backdrop-blur-md rounded-lg shadow-xl min-h-[300px]">
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