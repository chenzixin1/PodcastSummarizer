/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { prompts } from '../../../lib/prompts';
import { modelConfig } from '../../../lib/modelConfig';
import { saveAnalysisResults } from '../../../lib/db';
import { getPodcast } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';

export const runtime = 'edge';

// VERCEL DEBUG: Add version number to help track deployments
const API_VERSION = modelConfig.API_VERSION;
console.log(`[DEBUG-API] Podcast Summarizer API v${API_VERSION} loading...`);

// Define a type for stream updates
export interface ProcessStreamUpdate {
  type: 'status' | 'summary_token' | 'summary_chunk_result' | 'summary_final_result' | 'translation_token' | 'translation_chunk_result' | 'translation_final_result' | 'highlight_token' | 'highlight_chunk_result' | 'highlight_final_result' | 'error' | 'all_done';
  task?: 'summary' | 'translation' | 'highlights';
  message?: string; // For status or error messages
  content?: string; // For tokens or full results
  chunkIndex?: number; // For chunk-specific updates
  totalChunks?: number; // For chunk-specific updates
  isFinalChunk?: boolean; // To indicate the last chunk of a task
  finalResults?: { // Only with all_done type
    summary?: string;
    translation?: string;
    highlights?: string;
  };
  processingErrors?: string[]; // Add this for all_done or error types
}



// 添加计数器用于记录API调用次数
const openRouterCallCounter = {
  count: 0,
  calls: [] as { model: string, task: string, timestamp: number }[]
};

// 指定模型 - 使用环境变量中的模型
// 参考: https://openrouter.ai/docs#models
const MODEL = modelConfig.MODEL;

// 重试配置
const MAX_RETRIES = modelConfig.MAX_RETRIES;
const RETRY_DELAY = modelConfig.RETRY_DELAY; // 毫秒

// 内容处理配置 - 提高以利用Gemini 2.5 Flash的1M token能力
const MAX_CONTENT_LENGTH = modelConfig.MAX_CONTENT_LENGTH; // 提高到30万字符，减少分段需求
const MAX_TOKENS = modelConfig.MAX_TOKENS;

// 辅助函数：延迟执行
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数：处理较长内容
function chunkContent(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content];
  
  // 计算需要分成几个段落
  const chunks = [];
  let remainingContent = content;
  
  while (remainingContent.length > 0) {
    // 找到合适的断点（句号或段落）
    let breakPoint = Math.min(maxLength, remainingContent.length);
    if (breakPoint < remainingContent.length) {
      // 尝试在句号或换行处断开
      const lastPeriod = remainingContent.lastIndexOf('. ', breakPoint);
      const lastNewline = remainingContent.lastIndexOf('\n\n', breakPoint);
      if (lastPeriod > maxLength * 0.7) {
        breakPoint = lastPeriod + 1; // 包含句号
      } else if (lastNewline > maxLength * 0.7) {
        breakPoint = lastNewline + 2; // 包含换行
      }
    }
    
    chunks.push(remainingContent.substring(0, breakPoint));
    remainingContent = remainingContent.substring(breakPoint);
  }
  
  return chunks;
}


// API call handler with retry functionality
async function callModelWithRetry(
  systemPrompt: string, 
  userPrompt: string, 
  maxTokens: number = 1500, 
  temperature: number = 0.7,
  onTokenStream?: (token: string) => Promise<void>,
  taskType: 'summary' | 'translation' | 'highlights' = 'summary' // 添加任务类型参数
): Promise<string> {
  let lastError = null;
  
  // 更新计数器
  openRouterCallCounter.count++;
  openRouterCallCounter.calls.push({ model: MODEL, task: taskType, timestamp: Date.now() });
  
  // 记录API请求详情
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  console.log(`[OpenRouter Request ${requestId}] ---- START ----`);
  console.log(`[OpenRouter Request ${requestId}] Model: ${MODEL}`);
  console.log(`[OpenRouter Request ${requestId}] Task: ${taskType} (Call #${openRouterCallCounter.count}, Total: ${openRouterCallCounter.count})`);
  console.log(`[OpenRouter Request ${requestId}] System: ${systemPrompt.substring(0, 100)}...`);
  console.log(`[OpenRouter Request ${requestId}] User: ${userPrompt.substring(0, 100)}...`);
  console.log(`[OpenRouter Request ${requestId}] MaxTokens: ${maxTokens}`);
  console.log(`[OpenRouter Request ${requestId}] Temperature: ${temperature}`);
  console.log(`[OpenRouter Request ${requestId}] Streaming: ${!!onTokenStream}`);
  
  const startTime = Date.now();
  let fullContent = '';
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[OpenRouter Request ${requestId}] Retry attempt ${attempt}`);
        await delay(RETRY_DELAY * attempt); // 指数退避
      }
      
      // 记录实际请求时间
      const callStartTime = Date.now();
      console.log(`[OpenRouter Request ${requestId}] Making API call at ${new Date().toISOString()}`);
      
      const apiKey = process.env.OPENROUTER_API_KEY || '';
      console.log(`[OpenRouter Request ${requestId}] Using API key: ${apiKey.substring(0, 5)}...`);
      
      // 使用fetch而不是openai.createChatCompletion，以便我们可以完全控制请求
      const requestBody = {
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens,
        stream: !!onTokenStream,
      };
      
      // 按照官方文档设置正确的请求头
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
          'X-Title': 'PodSum.cc'
        },
        body: JSON.stringify(requestBody)
      });
      
      const callEndTime = Date.now();
      console.log(`[OpenRouter Request ${requestId}] API call initiated in ${callEndTime - callStartTime}ms (stream: ${!!onTokenStream})`);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => `Failed to get error text, status: ${response.status}`);
        console.error(`[OpenRouter Request ${requestId}] API ERROR: ${response.status} ${errorText}`);
        throw new Error(`API response not ok: ${response.status} ${errorText}`);
      }
      
      if (onTokenStream && response.body) {
        // Manually read from response.body ReadableStream
        const reader = response.body.getReader();
        const decoder = new TextDecoder(); // Standard TextDecoder
        
        console.log(`[OpenRouter Request ${requestId}] Streaming response started...`);
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process any final characters in the buffer if necessary
            // This might be important if the stream doesn't end with \n\n
            // However, for OpenAI/OpenRouter, stream closure or [DONE] is typical.
            if (buffer.startsWith('data: ')) { // Check if buffer has a pending data line
                try {
                    const jsonDataString = buffer.substring(5).trim();
                    if (jsonDataString && jsonDataString !== '[DONE]') {
                        const jsonData = parseJSON(jsonDataString);
                        if (jsonData.choices && jsonData.choices[0] && jsonData.choices[0].delta && jsonData.choices[0].delta.content) {
                            const content = jsonData.choices[0].delta.content;
                            fullContent += content;
                            await onTokenStream(content);
                        }
                    }
                } catch (e) {
                    console.error(`[OpenRouter Request ${requestId}] Error parsing final buffered data line: "${buffer}". Error:`, e);
                }
            }
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          let eventSeparatorIndex;
          // SSE events are separated by double newlines "\n\n"
          while ((eventSeparatorIndex = buffer.indexOf('\n\n')) >= 0) {
            const eventBlock = buffer.substring(0, eventSeparatorIndex);
            buffer = buffer.substring(eventSeparatorIndex + 2); // Consume the event block and the separator

            const lines = eventBlock.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonDataString = line.substring(5).trim();
                if (jsonDataString === '[DONE]') {
                  console.log(`[OpenRouter Request ${requestId}] Stream [DONE] signal received.`);
                  // No specific token to send for [DONE] itself, loop will break on next read if stream closes.
                  continue;
                }
                try {
                  const jsonData = parseJSON(jsonDataString);
                  if (jsonData.choices && jsonData.choices[0] && jsonData.choices[0].delta && jsonData.choices[0].delta.content) {
                    const content = jsonData.choices[0].delta.content;
                    fullContent += content;
                    await onTokenStream(content); // Stream only the actual content token
                  } else if (jsonData.choices && jsonData.choices[0] && jsonData.choices[0].finish_reason) {
                    console.log(`[OpenRouter Request ${requestId}] Stream finish reason: ${jsonData.choices[0].finish_reason}`);
                  }
                  // Other JSON structures from 'data:' line are ignored if not delta content or known signals.
                } catch (e) {
                  console.error(`[OpenRouter Request ${requestId}] Error parsing JSON from data line: "${line}". Error:`, e);
                  // Do NOT pass the raw 'line' or 'jsonDataString' if it failed to parse or didn't have content.
                }
              } else if (line.trim().startsWith(':')) {
                console.log(`[OpenRouter Request ${requestId}] Received SSE comment: "${line}"`);
                // SSE comments are ignored for content purposes.
              } else if (line.trim()) {
                console.log(`[OpenRouter Request ${requestId}] Received unexpected non-empty, non-data, non-comment line: "${line}"`);
                // Other lines are logged but not passed as content tokens.
              }
            }
          }
        }
        // The final decoder.decode() call is usually for completing multi-byte characters, not strictly for SSE logic.
        // const finalBufferedChunk = decoder.decode(); // Flush internal state of TextDecoder
        // if (finalBufferedChunk) {
        //     console.log(`[OpenRouter Request ${requestId}] Decoder flushed final chunk: ${finalBufferedChunk}`);
        //     // Decide if this needs to be processed like other buffer content
        //     // For OpenRouter, this is unlikely to be needed if stream ends cleanly or with [DONE]
        // }
        console.log(`[OpenRouter Request ${requestId}] Streaming response finished processing loop.`);
      } else {
        // Handle non-streaming response
        const data = await response.json();
        if (!data.choices?.[0]?.message?.content) {
          console.log(`[OpenRouter Request ${requestId}] No content in non-streaming response: ${JSON.stringify(data)}`);
          throw new Error(`No content in response: ${JSON.stringify(data)}`);
        }
        fullContent = data.choices[0].message.content;
        console.log(`[OpenRouter Request ${requestId}] Non-streaming Response: ${fullContent.substring(0, 100)}...`);
        if (data.usage) {
          console.log(`[OpenRouter Request ${requestId}] Token usage: ${JSON.stringify(data.usage)}`);
        }
      }
      
      // 记录完成时间
      const endTime = Date.now();
      console.log(`[OpenRouter Request ${requestId}] Processing completed in ${endTime - callStartTime}ms (total function time: ${endTime - startTime}ms)`);
      console.log(`[OpenRouter Request ${requestId}] ---- END ----`);
      return fullContent;
    } catch (error: any) {
      console.error(`[OpenRouter Request ${requestId}] Error (attempt ${attempt}):`, error);
      lastError = error;
      // 如果已经是最后一次尝试，直接抛出
      if (attempt === MAX_RETRIES) {
        console.log(`[OpenRouter Request ${requestId}] ---- FAILED (Max Retries) ----`);
        throw error;
      }
      
      // 非认证错误，继续重试
      continue;
    }
  }
  
  console.log(`[OpenRouter Request ${requestId}] ---- FAILED (Exhausted) ----`);
  throw lastError; // 不应该到达这里，但为了类型安全
}

async function parseSrtContent(srtText: string) {
  // 简单解析SRT内容为纯文本（忽略时间戳）
  const lines = srtText.split('\n');
  let plainText = '';
  let isTimestamp = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    // 跳过空行、数字行和时间戳行
    if (trimmedLine === '' || /^\d+$/.test(trimmedLine) || trimmedLine.includes(' --> ')) {
      isTimestamp = trimmedLine.includes(' --> ');
      continue;
    }
    
    // 如果上一行不是时间戳，添加空格
    if (!isTimestamp && plainText.length > 0) {
      plainText += ' ';
    }
    
    plainText += trimmedLine;
    isTimestamp = false;
  }

  return plainText;
}

// 修改generateSummary函数以支持模拟模式
async function generateSummary(
  plainText: string, 
  sendUpdate: (update: ProcessStreamUpdate) => Promise<void>
): Promise<string> {
  await sendUpdate({ type: 'status', task: 'summary', message: 'Starting summary generation...' });
  let accumulatedSummary = '';

  // 如果内容较短，直接处理
  if (plainText.length <= MAX_CONTENT_LENGTH) {
    await sendUpdate({ type: 'status', task: 'summary', message: 'Content is short, processing as a single chunk.' });
    accumulatedSummary = await callModelWithRetry(
      prompts.summarySystem,
      prompts.summaryUserFull(plainText),
      MAX_TOKENS.summary,
      0.5,
      async (token) => {
        await sendUpdate({ type: 'summary_token', content: token, chunkIndex: 0, totalChunks: 1 });
      },
      'summary'
    );
    await sendUpdate({ type: 'summary_final_result', content: accumulatedSummary, chunkIndex: 0, totalChunks: 1, isFinalChunk: true });
    return accumulatedSummary;
  }
  
  // 分段处理长内容
  const chunks = chunkContent(plainText, MAX_CONTENT_LENGTH);
  await sendUpdate({ type: 'status', task: 'summary', message: `Content divided into ${chunks.length} chunks. Processing sequentially.` });
  const chunkSummaries: string[] = [];
  
  // 处理每个分段
  for (let i = 0; i < chunks.length; i++) {
    await sendUpdate({ type: 'status', task: 'summary', message: `Processing summary for chunk ${i + 1} of ${chunks.length}...` });
    let currentChunkSummary = '';
    currentChunkSummary = await callModelWithRetry(
      prompts.summarySystem, 
      prompts.summaryUserSegment(chunks[i], i + 1, chunks.length),
      MAX_TOKENS.summary / 2, // Or a different token limit for chunks
      0.5,
      async (token) => {
        await sendUpdate({ type: 'summary_token', content: token, chunkIndex: i, totalChunks: chunks.length });
      },
      'summary'
    );
    chunkSummaries.push(currentChunkSummary);
    await sendUpdate({ 
      type: 'summary_chunk_result', 
      content: currentChunkSummary, 
      chunkIndex: i, 
      totalChunks: chunks.length,
      isFinalChunk: i === chunks.length - 1 && chunks.length > 1 // Only final if it's the last of multiple chunks
    });
  }
  
  // 如果只有一个分段 (已经被上面的逻辑覆盖了，但为了代码清晰保留，虽然实际不会执行到这里)
  if (chunkSummaries.length === 1) {
    accumulatedSummary = chunkSummaries[0];
    // This case is handled by the initial single-chunk logic, 
    // but if MAX_CONTENT_LENGTH forces a single large text into one chunk here, this would be it.
    // The summary_final_result was already sent if it was a single chunk from the start.
    // If it became a single chunk due to chunkContent, a chunk_result was sent.
    // To ensure a final_result is always sent for the summary task if it was chunked:
    if (chunks.length === 1) { // This means it was processed as one chunk via the loop
        await sendUpdate({ type: 'summary_final_result', content: accumulatedSummary, isFinalChunk: true });
    }
    return accumulatedSummary;
  }
  
  // 合并所有分段摘要成一个完整摘要
  await sendUpdate({ type: 'status', task: 'summary', message: 'Combining chunk summaries into a final summary...' });
  accumulatedSummary = await callModelWithRetry(
    prompts.summarySystem, // Consider a specific system prompt for combining summaries
    prompts.summaryUserCombine(chunkSummaries),
    MAX_TOKENS.summary,
    0.5,
    async (token) => {
      await sendUpdate({ type: 'summary_token', content: token, chunkIndex: -1, totalChunks: -1 }); // -1 indicates combination phase
    },
    'summary'
  );
  await sendUpdate({ type: 'summary_final_result', content: accumulatedSummary, isFinalChunk: true });
  return accumulatedSummary;
}

// 修改generateTranslation函数
async function generateTranslation(
  srtContent: string, 
  sendUpdate: (update: ProcessStreamUpdate) => Promise<void>
): Promise<string> {
  await sendUpdate({ type: 'status', task: 'translation', message: 'Starting translation...' });
  
  // 如果内容较短，直接处理
  if (srtContent.length <= MAX_CONTENT_LENGTH) {
    await sendUpdate({ type: 'status', task: 'translation', message: 'Content is short, processing as a single chunk.' });
    const result = await callModelWithRetry(
      prompts.translateSystem,
      prompts.translateUserFull(srtContent),
      MAX_TOKENS.translation,
      0.3,
      async (token) => {
        await sendUpdate({ type: 'translation_token', content: token, chunkIndex: 0, totalChunks: 1 });
      },
      'translation'
    );
    await sendUpdate({ type: 'translation_final_result', content: result, chunkIndex: 0, totalChunks: 1, isFinalChunk: true });
    return result;
  }
  
  // 分段处理长内容，但保持SRT格式
  const regex = /(\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*\n[^\n]*(?:\n[^\n]*)*?)(?=\n\s*\d+\s*\n|$)/g;
  let match;
  const srtBlocks = [];
  let lastIndex = 0;
  
  // 提取SRT块
  while ((match = regex.exec(srtContent)) !== null) {
    srtBlocks.push(match[0]);
    lastIndex = regex.lastIndex;
  }
  
  // 如果有剩余内容，添加到最后
  if (lastIndex < srtContent.length) {
    srtBlocks.push(srtContent.substring(lastIndex));
  }
  
  // 将SRT块分组
  const MAX_BLOCKS_PER_CHUNK = 200; // 增加每个分组最多包含的SRT块数
  const chunks = [];
  
  for (let i = 0; i < srtBlocks.length; i += MAX_BLOCKS_PER_CHUNK) {
    chunks.push(srtBlocks.slice(i, i + MAX_BLOCKS_PER_CHUNK).join('\n'));
  }
  
  await sendUpdate({ type: 'status', task: 'translation', message: `Content divided into ${chunks.length} chunks. Processing sequentially.` });
  
  // 处理每个分组
  const translatedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    await sendUpdate({ type: 'status', task: 'translation', message: `Processing translation for chunk ${i + 1} of ${chunks.length}...` });
    const translatedChunk = await callModelWithRetry(
      prompts.translateSystem,
      prompts.translateUserSegment(chunks[i], i + 1, chunks.length),
      MAX_TOKENS.translation,
      0.3,
      async (token) => {
        await sendUpdate({ type: 'translation_token', content: token, chunkIndex: i, totalChunks: chunks.length });
      },
      'translation'
    );
    translatedChunks.push(translatedChunk);
    await sendUpdate({ 
      type: 'translation_chunk_result', 
      content: translatedChunk, 
      chunkIndex: i, 
      totalChunks: chunks.length,
      isFinalChunk: i === chunks.length - 1
    });
  }
  
  // 合并所有翻译
  const finalTranslation = translatedChunks.join('\n');
  await sendUpdate({ type: 'translation_final_result', content: finalTranslation, isFinalChunk: true });
  return finalTranslation;
}

// 修改generateHighlights函数
async function generateHighlights(
  srtContent: string, 
  sendUpdate: (update: ProcessStreamUpdate) => Promise<void>
): Promise<string> {
  await sendUpdate({ type: 'status', task: 'highlights', message: 'Starting highlights generation...' });
  
  // 如果内容较短，直接处理
  if (srtContent.length <= MAX_CONTENT_LENGTH) {
    await sendUpdate({ type: 'status', task: 'highlights', message: 'Content is short, processing as a single chunk.' });
    const result = await callModelWithRetry(
      prompts.highlightSystem,
      prompts.highlightUserFull(srtContent),
      MAX_TOKENS.highlights,
      0.3,
      async (token) => {
        await sendUpdate({ type: 'highlight_token', content: token, chunkIndex: 0, totalChunks: 1 });
      },
      'highlights'
    );
    await sendUpdate({ type: 'highlight_final_result', content: result, chunkIndex: 0, totalChunks: 1, isFinalChunk: true });
    return result;
  }
  
  // 与翻译类似的方式处理
  const regex = /(\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*\n[^\n]*(?:\n[^\n]*)*?)(?=\n\s*\d+\s*\n|$)/g;
  let match;
  const srtBlocks = [];
  let lastIndex = 0;
  
  while ((match = regex.exec(srtContent)) !== null) {
    srtBlocks.push(match[0]);
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < srtContent.length) {
    srtBlocks.push(srtContent.substring(lastIndex));
  }
  
  const MAX_BLOCKS_PER_CHUNK = 200; 
  const chunks = [];
  
  for (let i = 0; i < srtBlocks.length; i += MAX_BLOCKS_PER_CHUNK) {
    chunks.push(srtBlocks.slice(i, i + MAX_BLOCKS_PER_CHUNK).join('\n'));
  }
  
  await sendUpdate({ type: 'status', task: 'highlights', message: `Content divided into ${chunks.length} chunks. Processing sequentially.` });
  
  const highlightedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    await sendUpdate({ type: 'status', task: 'highlights', message: `Processing highlights for chunk ${i + 1} of ${chunks.length}...` });
    const highlightedChunk = await callModelWithRetry(
      prompts.highlightSystem,
      prompts.highlightUserSegment(chunks[i], i + 1, chunks.length),
      MAX_TOKENS.highlights,
      0.3,
      async (token) => {
        await sendUpdate({ type: 'highlight_token', content: token, chunkIndex: i, totalChunks: chunks.length });
      },
      'highlights'
    );
    highlightedChunks.push(highlightedChunk);
    await sendUpdate({ 
      type: 'highlight_chunk_result', 
      content: highlightedChunk, 
      chunkIndex: i, 
      totalChunks: chunks.length,
      isFinalChunk: i === chunks.length - 1
    });
  }
  
  const finalHighlights = highlightedChunks.join('\n');
  await sendUpdate({ type: 'highlight_final_result', content: finalHighlights, isFinalChunk: true });
  return finalHighlights;
}


// For the parseJSON function - line 527
function parseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return {};
  }
}

export async function POST(request: NextRequest) {
  console.log('Process API called');
  
  // 解析请求数据
  const requestData = await request.json();
  
  if (!requestData || !requestData.id || !requestData.blobUrl) {
    return NextResponse.json({ error: 'Invalid request data. Missing required fields.' }, { status: 400 });
  }
  
  const { id, blobUrl } = requestData;
  
  // ====== 权限校验开始 ======
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const podcastResult = await getPodcast(id);
  if (!podcastResult.success) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }
  const podcast = podcastResult.data as any;
  if (!podcast.userId || podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  // ====== 权限校验结束 ======

  // 设置响应流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log(`Processing file with ID: ${id}, URL: ${blobUrl}`);
        
        // 发送状态更新的函数
        const sendUpdate = async (update: ProcessStreamUpdate) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
        };
        
        // 发送开始状态
        await sendUpdate({ type: 'status', message: 'Starting processing...' });
        
        // 从Blob URL获取文件内容
        const fileResponse = await fetch(blobUrl);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file content: ${fileResponse.statusText}`);
        }
        const srtContent = await fileResponse.text();
        
        // 移除BOM标记（如果存在）
        const cleanSrtContent = srtContent.replace(/^\uFEFF/, '');
        
        if (cleanSrtContent.length === 0) {
          throw new Error('SRT file is empty');
        }
        
        // 解析为纯文本用于摘要生成
        const plainText = await parseSrtContent(cleanSrtContent);
        
        // 发送状态更新
        await sendUpdate({ type: 'status', message: 'Content loaded, generating summary...' });
        
        // 生成摘要
        const summary = await generateSummary(plainText, sendUpdate);
        
        // 生成翻译
        const translation = await generateTranslation(cleanSrtContent, sendUpdate);
        
        // 生成高亮
        const highlights = await generateHighlights(cleanSrtContent, sendUpdate);
        
        // 保存处理结果到数据库
        console.log(`准备保存分析结果，podcastId: ${id}, 类型: ${typeof id}`);
        try {
          await saveAnalysisResults({
            podcastId: id,
            summary,
            translation,
            highlights
          });
          console.log(`分析结果保存成功，podcastId: ${id}`);
        } catch (dbError) {
          console.error('保存分析结果到数据库失败:', dbError);
          // 即使数据库保存失败，我们也继续返回结果给用户
        }
        
        // 发送全部完成事件
        await sendUpdate({
          type: 'all_done',
          finalResults: {
            summary,
            translation,
            highlights
          }
        });
        
        // 完成流
        controller.close();
      } catch (error) {
        console.error('Error in process stream:', error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown error during processing',
              task: 'process'
            })}\n\n`
          )
        );
        controller.close();
      }
    }
  });

  // 返回流式响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
} 