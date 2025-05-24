/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logDebug, logError, logUserAction, logPerformance, getBrowserInfo, getClientErrors } from '../../../lib/debugUtils';
import { ErrorBoundary } from '../../../components/ErrorBoundary';

// VERCEL DEBUG: Add version number to help track deployments
const APP_VERSION = '1.0.2'; // Increment version for tracking
console.log(`[DEBUG] Podcast Summarizer v${APP_VERSION} loading...`);

// Define types for the processed data (optional but good practice)
interface ProcessedData {
  title: string;
  originalFileName: string;
  originalFileSize: string; // Or number, formatted as string
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

// Helper function to safely parse JSON with appropriate type casting
const safelyParseJSON = (jsonString: string) => {
  try {
    return JSON.parse(jsonString) as any; // Use any here to bypass type checking
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return {}; // Return empty object for error cases
  }
};

// New debug interface to track application state
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
  localStorage: Record<string, boolean>;
  sessionInfo: {
    id: string;
    isProcessing: boolean;
    requestSent: boolean;
    lastHeightRef: number;
  };
}

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string; // Get ID from route
  
  console.log(`[DEBUG] Dashboard initializing for ID: ${id}`);
  logDebug(`Dashboard initializing for ID: ${id}`);

  // Add ID validation at the beginning
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
            <li>• You're using an old or broken bookmark</li>
          </ul>
          <div className="space-y-3">
            <Link 
              href="/upload" 
              className="block w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Upload New File
            </Link>
            <Link 
              href="/history" 
              className="block w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              View File History
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [activeView, setActiveView] = useState<ViewMode>('summary');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false); // 添加标记处理状态的变量
  
  // 添加ref用于滚动控制
  const contentRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const lastHeightRef = useRef(0);
  const requestSentRef = useRef(false); // 添加防止重复请求的引用

  // Add debug state
  const [debugMode, setDebugMode] = useState(false);
  const [debugState, setDebugState] = useState<DebugState>({
    appVersion: APP_VERSION,
    initialized: false,
    lastAction: 'init',
    processingState: 'idle',
    errors: [],
    networkRequests: [],
    localStorage: {},
    sessionInfo: {
      id: id || '',
      isProcessing: false,
      requestSent: false,
      lastHeightRef: 0
    }
  });
  
  // Track network requests for debugging
  const networkRequestsRef = useRef<DebugState['networkRequests']>([]);

  // Update debug state periodically
  useEffect(() => {
    if (!debugMode) return;
    
    // Initial debug state capture
    captureDebugState('init');
    
    const interval = setInterval(() => {
      if (debugMode) {
        captureDebugState('interval');
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [debugMode, isProcessing]);

  // Function to capture current debug state
  const captureDebugState = (action: string) => {
    try {
      // Check localStorage for all keys related to this ID
      const localStorageState: Record<string, boolean> = {};
      const keys = [
        `srtfile-${id}-name`,
        `srtfile-${id}-size`,
        `srtfile-${id}-url`,
        `srtfile-${id}-processed`,
        `srtfile-${id}-summary`,
        `srtfile-${id}-translation`,
        `srtfile-${id}-highlights`,
        `srtfile-${id}-processedAt`
      ];
      
      keys.forEach(key => {
        localStorageState[key] = localStorage.getItem(key) !== null;
      });
      
      setDebugState({
        appVersion: APP_VERSION,
        initialized: true,
        lastAction: action,
        processingState: isProcessing ? 'processing' : (data?.summary ? 'complete' : 'idle'),
        errors: getClientErrors(),
        networkRequests: networkRequestsRef.current,
        localStorage: localStorageState,
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
  };

  // Enhanced fetch with debugging
  const debugFetch = async (url: string, options: RequestInit) => {
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
        ...networkRequestsRef.current.slice(-9), // Keep last 10 requests
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
  };

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

  // Enhanced scroll function with debug
  const scrollToBottom = () => {
    console.log(`[DEBUG] Attempting to scroll to bottom, isProcessing: ${isProcessingRef.current}`);
    if (contentRef.current) {
      // Query for the last element
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
  };

  // Monitor content changes and scroll
  useEffect(() => {
    console.log(`[DEBUG] Content change detected, summary length: ${data?.summary?.length}, isProcessing: ${isProcessingRef.current}`);
    if (data?.summary && isProcessingRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [data?.summary, isProcessing]);

  useEffect(() => {
    if (id) {
      console.log(`[DEBUG] useEffect triggered for ID: ${id}, isProcessing: ${isProcessing}, requestSent: ${requestSentRef.current}`);
      logDebug('Dashboard useEffect triggered', { id, isProcessing, requestSent: requestSentRef.current });
      
      // Performance tracking
      const startTime = performance.now();
      
      // Loading from localStorage
      setIsLoading(true);
      setError(null);
      
      // Get file info
      const fileName = localStorage.getItem(`srtfile-${id}-name`);
      const fileSize = localStorage.getItem(`srtfile-${id}-size`);
      const fileUrl = localStorage.getItem(`srtfile-${id}-url`);
      const processed = localStorage.getItem(`srtfile-${id}-processed`);
      
      console.log(`[DEBUG] File status from localStorage - fileName: ${!!fileName}, fileUrl: ${!!fileUrl}, processed: ${processed}`);
      
      if (!fileName) {
        console.error('[DEBUG] File not found in localStorage');
        logError('File not found in localStorage', { id });
        setError('File not found.');
        setIsLoading(false);
        return;
      }
      
      if (processed === 'true') {
        console.log('[DEBUG] File was previously processed, loading from localStorage');
        // Retrieve processing results
        const summary = localStorage.getItem(`srtfile-${id}-summary`);
        const translation = localStorage.getItem(`srtfile-${id}-translation`);
        const highlights = localStorage.getItem(`srtfile-${id}-highlights`);
        const processedAt = localStorage.getItem(`srtfile-${id}-processedAt`) || undefined;

        console.log(`[DEBUG] Retrieved data lengths - summary: ${summary?.length}, translation: ${translation?.length}, highlights: ${highlights?.length}`);

        setData({
          title: `Transcript Analysis: ${fileName.split('.')[0]} (${id.substring(0,6)}...)`,
          originalFileName: fileName,
          originalFileSize: fileSize || 'Unknown size',
          summary: summary || 'Summary not available.',
          translation: translation || 'Translation not available.',
          fullTextHighlights: highlights || 'Highlights not available.',
          processedAt: processedAt,
        });
        setIsLoading(false);
        
        // Log performance for data loading
        const loadTime = performance.now() - startTime;
        logPerformance('dashboard-load-cached-data', loadTime, { id, dataSize: {
          summary: summary?.length || 0,
          translation: translation?.length || 0,
          highlights: highlights?.length || 0
        }});
        
      } else {
        console.log('[DEBUG] File needs processing or reprocessing');
        // File hasn't been processed or processing failed, attempt processing
        setData({
          title: `Transcript Analysis: ${fileName.split('.')[0]} (${id.substring(0,6)}...)`,
          originalFileName: fileName,
          originalFileSize: fileSize || 'Unknown size',
          summary: '正在处理中... 您将看到实时的处理结果!',
          translation: '处理中...',
          fullTextHighlights: '处理中...',
        });
        setIsLoading(false); // Important: immediately set loading to false so user sees streaming updates
        isProcessingRef.current = true; 
        
        if (fileUrl && !isProcessing && !requestSentRef.current) { 
          console.log('[DEBUG] Starting API processing request');
          logUserAction('start-processing', { id, fileName });
          
          // Mark as processing
          setIsProcessing(true);
          requestSentRef.current = true; 
          
          // Clear existing results (if any)
          localStorage.removeItem(`srtfile-${id}-summary`);
          localStorage.removeItem(`srtfile-${id}-translation`);
          localStorage.removeItem(`srtfile-${id}-highlights`);
          localStorage.removeItem(`srtfile-${id}-processed`);
          localStorage.removeItem(`srtfile-${id}-processedAt`);
          
          // Process the file
          console.log(`[DEBUG] Sending fetch request to /api/process with ID: ${id}`);
          const apiStartTime = performance.now();
          
          // Use debugFetch instead of regular fetch
          debugFetch('/api/process', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id,
              blobUrl: fileUrl,
              fileName,
              debug: true, // Add debug flag for backend
              appVersion: APP_VERSION // Send app version for tracking
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
            let streamStartTime = performance.now();
            
            // Create a Promise to process the stream
            return new Promise<ProcessResult>((resolve, reject) => {
              // Create a local variable that's definitely non-null
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
                    
                    // Finished processing stream, return final results
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
                            // Update UI with status
                            setData(prevData => prevData ? {
                              ...prevData,
                              summary: `${summary}\n\n> Status: ${eventData.message}`,
                            } : null);
                            break;
                          case 'summary_token':
                            // Handle summary token
                            const summaryContent = eventData.content;
                            summary += summaryContent;
                            
                            if (summary.length % 100 === 0) {
                              console.log(`[DEBUG] Summary accumulating, now at ${summary.length} characters`);
                            }
                            
                            // Update UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              summary: summary,
                            } : null);
                            break;
                          case 'translation_token':
                            // Handle translation token
                            const translationContent = eventData.content;
                            translation += translationContent;
                            
                            // Update UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              translation: translation,
                            } : null);
                            break;
                          case 'highlight_token':
                            // Handle highlight token
                            const highlightContent = eventData.content;
                            highlights += highlightContent;
                            
                            // Update UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              fullTextHighlights: highlights,
                            } : null);
                            break;
                          case 'summary_final_result':
                            // Handle summary final result
                            summary = eventData.content;
                            
                            // Update UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              summary: summary,
                            } : null);
                            break;
                          case 'translation_final_result':
                            // Handle translation final result
                            translation = eventData.content;
                            
                            // Update UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              translation: translation,
                            } : null);
                            break;
                          case 'highlight_final_result':
                            // Handle highlight final result
                            highlights = eventData.content;
                            
                            // Update UI
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
                              
                              // Update UI with all results
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
            console.log('[DEBUG] Processing completed, saving results to localStorage');
            // Save processing results to localStorage
            localStorage.setItem(`srtfile-${id}-summary`, result.summary);
            localStorage.setItem(`srtfile-${id}-translation`, result.translation);
            localStorage.setItem(`srtfile-${id}-highlights`, result.fullTextHighlights);
            localStorage.setItem(`srtfile-${id}-processed`, 'true');
            localStorage.setItem(`srtfile-${id}-processedAt`, result.processedAt);
            
            console.log('[DEBUG] Processing completed and results saved.');
            logPerformance('api-processing-complete', performance.now() - apiStartTime, { 
              id, 
              resultSizes: {
                summary: result.summary.length,
                translation: result.translation.length,
                highlights: result.fullTextHighlights.length
              }
            });
            
            isProcessingRef.current = false; // Processing completed, clear processing state
            setIsProcessing(false); // Reset processing state
            requestSentRef.current = false; // Reset request flag
          })
          .catch(err => {
            console.error('[DEBUG] Error processing file:', err);
            logError('Error processing file', { error: err.message });
            setError(`Failed to process file: ${err.message}`);
            isProcessingRef.current = false; // Error occurred, also clear processing state
            setIsProcessing(false); // Reset processing state
            requestSentRef.current = false; // Reset request flag to allow retry
          });
        } else if (!fileUrl) {
          console.error('[DEBUG] File URL not found in localStorage');
          logError('File URL missing', { id });
          setError('File URL not found. Cannot process this file.');
        } else if (isProcessing) {
          console.log(`[DEBUG] Already processing ID: ${id}, avoiding duplicate request`);
        }
      }
    }
    
    // Cleanup function
    return () => {
      console.log(`[DEBUG] Cleaning up for ID: ${id}`);
      isProcessingRef.current = false;
    };
  }, [id, isProcessing]);

  // Enhanced retry function with debug logging
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
    requestSentRef.current = false; // Reset request flag to allow retry
    
    // 获取文件信息
    const fileName = localStorage.getItem(`srtfile-${id}-name`);
    const fileSize = localStorage.getItem(`srtfile-${id}-size`);
    const fileUrl = localStorage.getItem(`srtfile-${id}-url`);
    
    if (!fileName || !fileUrl) {
      setError('文件信息不存在，无法重试');
      return;
    }
    
    // 更新状态
    setIsProcessing(true);
    isProcessingRef.current = true;
    setData({
      title: `Transcript Analysis: ${fileName.split('.')[0]} (${id.substring(0,6)}...)`,
      originalFileName: fileName,
      originalFileSize: fileSize || 'Unknown size',
      summary: '正在重新处理... 您将看到实时的处理结果!',
      translation: '处理中...',
      fullTextHighlights: '处理中...',
    });
    
    // 清除现有处理结果
    localStorage.removeItem(`srtfile-${id}-summary`);
    localStorage.removeItem(`srtfile-${id}-translation`);
    localStorage.removeItem(`srtfile-${id}-highlights`);
    localStorage.removeItem(`srtfile-${id}-processed`);
    localStorage.removeItem(`srtfile-${id}-processedAt`);
    
    // 发送强制重试请求
    requestSentRef.current = true; // 标记已发送请求
    fetch('/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        blobUrl: fileUrl,
        fileName,
        allowRetry: true, // 强制重试标志
      }),
    })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => {
          let errorMessage = 'Processing failed';
          try {
            // 确保text包含有效的JSON字符串
            if (text && (text.startsWith('{') || text.startsWith('['))) {
              const errorData = safelyParseJSON(text);
              errorMessage = errorData.error || errorMessage;
            } else {
              errorMessage = text || errorMessage;
            }
          } catch (e) {
            console.error('Error parsing error response:', e, text);
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        });
      }
      
      // 处理响应流
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Stream reader not available');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      let summary = '';
      let translation = '';
      let highlights = '';
      
      // 创建处理流的Promise
      return new Promise<ProcessResult>((resolve, reject) => {
        const streamReader = reader;
        function processStream() {
          streamReader.read().then(({ done, value }) => {
            if (done) {
              return resolve({
                summary,
                translation,
                fullTextHighlights: highlights,
                processedAt: new Date().toISOString()
              });
            }
            
            buffer += decoder.decode(value, { stream: true });
            let eolIndex;
            
            while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.substring(0, eolIndex);
              buffer = buffer.substring(eolIndex + 2);
              
              if (message.startsWith('data: ')) {
                try {
                  const jsonData = message.substring(5).trim();
                  const eventData = safelyParseJSON(jsonData);
                  
                  // 处理各种事件类型
                  switch (eventData.type) {
                    case 'status':
                      console.log('Status update:', eventData.message);
                      // 状态更新显示到UI
                      setData(prevData => prevData ? {
                        ...prevData,
                        summary: `${summary}\n\n> Status: ${eventData.message}`,
                      } : null);
                      break;
                    case 'summary_token':
                      // 处理摘要令牌
                      const summaryContent = eventData.content;
                      summary += summaryContent;
                      
                      // 更新UI
                      setData(prevData => prevData ? {
                        ...prevData,
                        summary: summary,
                      } : null);
                      break;
                    case 'translation_token':
                      // 处理翻译令牌
                      const translationContent = eventData.content;
                      translation += translationContent;
                      
                      // 更新UI
                      setData(prevData => prevData ? {
                        ...prevData,
                        translation: translation,
                      } : null);
                      break;
                    case 'highlight_token':
                      // 处理高亮令牌
                      const highlightContent = eventData.content;
                      highlights += highlightContent;
                      
                      // 更新UI
                      setData(prevData => prevData ? {
                        ...prevData,
                        fullTextHighlights: highlights,
                      } : null);
                      break;
                    case 'summary_final_result':
                    case 'translation_final_result':
                    case 'highlight_final_result':
                    case 'all_done':
                      // 处理最终结果...
                      if (eventData.type === 'summary_final_result') {
                        summary = eventData.content;
                        setData(prevData => prevData ? {
                          ...prevData,
                          summary: summary,
                        } : null);
                      } else if (eventData.type === 'translation_final_result') {
                        translation = eventData.content;
                        setData(prevData => prevData ? {
                          ...prevData,
                          translation: translation,
                        } : null);
                      } else if (eventData.type === 'highlight_final_result') {
                        highlights = eventData.content;
                        setData(prevData => prevData ? {
                          ...prevData,
                          fullTextHighlights: highlights,
                        } : null);
                      } else if (eventData.type === 'all_done' && eventData.finalResults) {
                        summary = eventData.finalResults.summary || summary;
                        translation = eventData.finalResults.translation || translation;
                        highlights = eventData.finalResults.highlights || highlights;
                        
                        // 全部结果更新UI
                        setData(prevData => prevData ? {
                          ...prevData,
                          summary,
                          translation,
                          fullTextHighlights: highlights,
                        } : null);
                      }
                      break;
                    case 'error':
                      console.error('Process error:', eventData.message);
                      setError(`处理错误: ${eventData.message}`);
                      break;
                  }
                } catch (e) {
                  console.error('Failed to parse event JSON:', e);
                }
              }
            }
            
            // 继续处理流
            processStream();
          }).catch(err => {
            console.error('Stream processing error:', err);
            reject(err);
          });
        }
        
        // 开始处理流
        processStream();
      });
    })
    .then((result: ProcessResult) => {
      // 保存处理结果到 localStorage
      localStorage.setItem(`srtfile-${id}-summary`, result.summary);
      localStorage.setItem(`srtfile-${id}-translation`, result.translation);
      localStorage.setItem(`srtfile-${id}-highlights`, result.fullTextHighlights);
      localStorage.setItem(`srtfile-${id}-processed`, 'true');
      localStorage.setItem(`srtfile-${id}-processedAt`, result.processedAt);
      
      console.log('Processing completed and results saved.');
      isProcessingRef.current = false; // 处理完成，取消处理状态
      setIsProcessing(false); // 重置处理状态
      requestSentRef.current = false; // 重置请求标记
    })
    .catch(err => {
      console.error('Error processing file:', err);
      setError(`处理文件失败: ${err.message}`);
      isProcessingRef.current = false; // 处理错误，也要取消处理状态
      setIsProcessing(false); // 重置处理状态
      requestSentRef.current = false; // 重置请求标记，允许重试
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
        
        <h4 className="text-sky-400 font-semibold mt-2 mb-1">localStorage:</h4>
        <div className="space-y-1 mb-2">
          {Object.entries(debugState.localStorage).map(([key, exists]) => (
            <div key={key}><span className="text-slate-400">{key.replace(`srtfile-${id}-`, '')}:</span> <span className={`${exists ? 'text-green-400' : 'text-red-400'}`}>
              {exists ? 'EXISTS' : 'MISSING'}</span></div>
          ))}
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
            <h1 className="text-xl font-semibold text-sky-400">SRT Processor / Dashboard</h1>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setDebugMode(!debugMode)}
                className="text-xs bg-slate-700 hover:bg-slate-600 py-1 px-2 rounded-md text-slate-300"
              >
                {debugMode ? 'Hide Debug' : 'Debug Mode'}
              </button>
              <Link href="/history" className="text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-3 rounded-md text-slate-300">
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