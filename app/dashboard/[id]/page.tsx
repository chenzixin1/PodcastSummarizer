'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string; // Get ID from route

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

  // 滚动函数：使用scrollIntoView自动滚动到最新内容
  const scrollToBottom = () => {
    if (contentRef.current) {
      // 查找内容的最后一个元素
      const lastElement = contentRef.current.querySelector('p:last-child, h1:last-child, h2:last-child, h3:last-child');
      
      // 如果找到最后一个元素，将其滚动到视图中
      if (lastElement) {
        lastElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      // 否则只是更新高度引用
      lastHeightRef.current = contentRef.current.scrollHeight;
    }
  };

  // 监控内容变化，并滚动
  useEffect(() => {
    // 只在流式处理中进行自动滚动
    if (data?.summary && isProcessingRef.current) {
      // 使用requestAnimationFrame确保DOM更新后再滚动
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [data?.summary, isProcessing]);

  useEffect(() => {
    if (id) {
      // 从localStorage加载处理结果
      setIsLoading(true);
      setError(null);
      console.log(`Loading data for ID: ${id}`);
      
      // 获取文件信息
      const fileName = localStorage.getItem(`srtfile-${id}-name`);
      const fileSize = localStorage.getItem(`srtfile-${id}-size`);
      const fileUrl = localStorage.getItem(`srtfile-${id}-url`);
      const processed = localStorage.getItem(`srtfile-${id}-processed`);
      
      if (!fileName) {
        setError('File not found.');
        setIsLoading(false);
        return;
      }
      
      if (processed === 'true') {
        // 获取处理结果
        const summary = localStorage.getItem(`srtfile-${id}-summary`);
        const translation = localStorage.getItem(`srtfile-${id}-translation`);
        const highlights = localStorage.getItem(`srtfile-${id}-highlights`);
        const processedAt = localStorage.getItem(`srtfile-${id}-processedAt`) || undefined;

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
      } else {
        // 文件未处理或处理失败，重新尝试处理
        setData({
          title: `Transcript Analysis: ${fileName.split('.')[0]} (${id.substring(0,6)}...)`,
          originalFileName: fileName,
          originalFileSize: fileSize || 'Unknown size',
          summary: '正在处理中... 您将看到实时的处理结果!',
          translation: '处理中...',
          fullTextHighlights: '处理中...',
        });
        setIsLoading(false); // 重要: 立即将加载状态设为false，这样用户可以看到流式更新
        isProcessingRef.current = true; // 标记正在处理状态
        
        if (fileUrl && !isProcessing && !requestSentRef.current) { // 确保请求只发送一次
          // 立即标记为处理中
          setIsProcessing(true);
          requestSentRef.current = true; // 标记请求已发送
          console.log(`开始处理ID为 ${id} 的文件...`);
          
          // 清除现有处理结果（如果有）
          localStorage.removeItem(`srtfile-${id}-summary`);
          localStorage.removeItem(`srtfile-${id}-translation`);
          localStorage.removeItem(`srtfile-${id}-highlights`);
          localStorage.removeItem(`srtfile-${id}-processed`);
          localStorage.removeItem(`srtfile-${id}-processedAt`);
          
          // 重新处理文件
          fetch('/api/process', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id,
              blobUrl: fileUrl,
              fileName,
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
            
            // 处理 EventStream 响应
            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error('Stream reader not available');
            }
            
            const decoder = new TextDecoder();
            let buffer = '';
            let summary = '';
            let translation = 'Translation not processed in this version.';
            let highlights = 'Highlights not processed in this version.';
            
            // 创建一个处理流的 Promise
            return new Promise<ProcessResult>((resolve, reject) => {
              // Create a local variable that's definitely non-null
              const streamReader = reader;
              function processStream() {
                streamReader.read().then(({ done, value }) => {
                  if (done) {
                    // 完成流处理，返回最终结果
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
                        
                        // 实时更新界面，显示分步处理结果
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
                            // 最终摘要结果
                            summary = eventData.content;
                            
                            // 更新UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              summary: summary,
                            } : null);
                            break;
                          case 'translation_final_result':
                            // 最终翻译结果
                            translation = eventData.content;
                            
                            // 更新UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              translation: translation,
                            } : null);
                            break;
                          case 'highlight_final_result':
                            // 最终高亮结果
                            highlights = eventData.content;
                            
                            // 更新UI
                            setData(prevData => prevData ? {
                              ...prevData,
                              fullTextHighlights: highlights,
                            } : null);
                            break;
                          case 'all_done':
                            if (eventData.finalResults) {
                              summary = eventData.finalResults.summary;
                              translation = eventData.finalResults.translation;
                              highlights = eventData.finalResults.highlights;
                              
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
                            reject(new Error(eventData.message));
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
            setError(`Failed to process file: ${err.message}`);
            isProcessingRef.current = false; // 处理错误，也要取消处理状态
            setIsProcessing(false); // 重置处理状态
            requestSentRef.current = false; // 重置请求标记，允许重试
          });
        } else if (!fileUrl) {
          setError('File URL not found. Cannot process this file.');
        } else if (isProcessing) {
          console.log(`已经在处理ID为 ${id} 的文件，避免重复请求`);
        }
      }
    }
    
    // 清理函数，防止内存泄漏和处理中断
    return () => {
      console.log(`清理ID为 ${id} 的处理状态`);
      isProcessingRef.current = false;
    };
  }, [id, isProcessing]);

  // 添加重试处理函数
  const retryProcessing = () => {
    // 如果已经在处理中，不要重复发送请求
    if (isProcessing) {
      console.log(`已经在处理ID为 ${id} 的文件，避免重复重试请求`);
      return;
    }
    
    setError(null);
    requestSentRef.current = false; // 重置请求标记，允许重试
    
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
                <div className="flex justify-end mb-4">
                    <label className="flex items-center cursor-pointer">
                        <span className="mr-2 text-sm text-slate-300">Toggle Highlights</span>
                        <div className="relative">
                            <input type="checkbox" className="sr-only" checked={showHighlights} onChange={() => setShowHighlights(!showHighlights)} />
                            <div className={`block w-10 h-6 rounded-full ${showHighlights ? 'bg-sky-500' : 'bg-slate-600'}`}></div>
                            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${showHighlights ? 'transform translate-x-full' : ''}`}></div>
                        </div>
                    </label>
                </div>
                <div className={`markdown-body ${showHighlights ? '' : '[&_strong]:font-normal'}`}>
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

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold text-sky-400">SRT Processor / Dashboard</h1>
          <div className="flex items-center gap-4">
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
      
      <footer className="p-4 text-center text-xs text-slate-600">
        SRT Processor Edge Demo
      </footer>
    </div>
  );
} 