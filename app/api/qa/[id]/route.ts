import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import { getQaMessages, saveQaMessage } from '../../../../lib/qaMessages';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { modelConfig } from '../../../../lib/modelConfig';
import { rebuildQaContextChunksForPodcast, renderChunkLabel, retrieveHybridQaChunks } from '../../../../lib/qaContextChunks';

interface PodcastData {
  isPublic: boolean;
  userId?: string | null;
  blobUrl?: string | null;
}

interface AnalysisData {
  summary?: string | null;
  translation?: string | null;
  highlights?: string | null;
}

interface QaRequestBody {
  question?: unknown;
  suggested?: unknown;
}

const QA_MODEL = process.env.OPENROUTER_QA_MODEL || modelConfig.MODEL;
const MAX_QUESTION_LENGTH = 1000;
const MAX_RETRIEVED_CHUNKS = Math.max(4, Math.min(12, Number.parseInt(process.env.QA_MAX_RETRIEVED_CHUNKS || '8', 10)));

const ENGLISH_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'what', 'with', 'from', 'about', 'have', 'will',
  'would', 'could', 'should', 'which', 'where', 'when', 'how', 'why', 'are', 'is',
  'for', 'you', 'your', 'podcast', 'episode', 'into', 'than', 'then', 'there',
  'their', 'they', 'them', 'been', 'were', 'was', 'can', 'did', 'does', 'any',
  'more', 'less', 'just', 'also',
]);

const CHINESE_STOPWORDS = new Set([
  '这个', '那个', '哪些', '什么', '如何', '为什么', '请问', '一下', '里面', '还有',
  '关于', '可以', '是否', '是不是', '有没有', '总结', '翻译', '全文', '重点',
]);

function getRefererValue(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\r\n/g, '\n').trim();
}

function extractKeywords(question: string): string[] {
  const normalized = question.toLowerCase();
  const english = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  const chinese = question.match(/[\u4e00-\u9fff]{2,6}/g) || [];

  const keywords = new Set<string>();
  for (const word of english) {
    if (!ENGLISH_STOPWORDS.has(word)) {
      keywords.add(word);
    }
  }
  for (const word of chinese) {
    if (!CHINESE_STOPWORDS.has(word)) {
      keywords.add(word);
    }
  }

  return Array.from(keywords).slice(0, 12);
}

function buildRelevantSnippet(text: string, question: string, maxChars: number): string {
  if (!text) {
    return '';
  }
  const normalizedText = normalizeText(text);
  if (normalizedText.length <= maxChars) {
    return normalizedText;
  }

  const keywords = extractKeywords(question);
  if (keywords.length === 0) {
    return normalizedText.slice(0, maxChars);
  }

  const lines = normalizedText.split('\n');
  const matchedIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    if (keywords.some(keyword => lineLower.includes(keyword.toLowerCase()))) {
      matchedIndexes.push(i);
    }
  }

  if (matchedIndexes.length === 0) {
    return normalizedText.slice(0, maxChars);
  }

  const snippets: string[] = [];
  let consumed = 0;
  const dedupe = new Set<string>();

  for (const index of matchedIndexes) {
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 3);
    const block = lines.slice(start, end).join('\n').trim();
    if (!block || dedupe.has(block)) {
      continue;
    }
    dedupe.add(block);
    const nextConsumed = consumed + block.length + 6;
    if (nextConsumed > maxChars) {
      break;
    }
    snippets.push(block);
    consumed = nextConsumed;
  }

  if (snippets.length === 0) {
    return normalizedText.slice(0, maxChars);
  }

  return snippets.join('\n\n---\n\n');
}

async function fetchTranscript(blobUrl?: string | null): Promise<string> {
  if (!blobUrl) {
    return '';
  }
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return '';
    }
    const content = await response.text();
    return normalizeText(content);
  } catch {
    return '';
  }
}

function buildLegacyContext(question: string, analysis: AnalysisData, transcript: string): string {
  const summary = buildRelevantSnippet(normalizeText(analysis.summary), question, 12000);
  const translation = buildRelevantSnippet(normalizeText(analysis.translation), question, 35000);
  const highlights = buildRelevantSnippet(normalizeText(analysis.highlights), question, 15000);
  const transcriptSnippet = buildRelevantSnippet(transcript, question, 30000);

  return [
    '### Summary',
    summary || '未提供',
    '',
    '### Translation',
    translation || '未提供',
    '',
    '### Highlights',
    highlights || '未提供',
    '',
    '### Transcript Snippets',
    transcriptSnippet || '未提供',
  ].join('\n');
}

function buildRetrievedContext(
  chunks: Awaited<ReturnType<typeof retrieveHybridQaChunks>>
): string {
  return chunks
    .map((chunk, index) => {
      const label = renderChunkLabel(chunk);
      return [
        `### Evidence ${index + 1}`,
        `id: chunk-${chunk.id}`,
        `label: ${label}`,
        `score: ${chunk.finalScore.toFixed(4)} (semantic=${chunk.semanticScore.toFixed(4)}, lexical=${chunk.lexicalScore.toFixed(4)})`,
        chunk.content,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

async function callQaModel(question: string, context: string, mode: 'hybrid' | 'legacy'): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const systemPrompt =
    mode === 'hybrid'
      ? '你是播客问答助手。你只能基于提供的证据回答，不要编造。' +
        '请用中文输出，结构为：1) 直接答案；2) 依据要点（最多3条）。' +
        '每条依据后追加对应证据 id（格式例如：chunk-12）。' +
        '如果证据只支持“间接提及”，请明确写“属于间接提及，未直接下结论”。' +
        '如果证据不足，请明确写“在当前上下文中未找到明确依据”。'
      : '你是播客问答助手。只能基于提供的上下文回答，不要编造。请用中文输出，结构为：' +
        '1) 直接答案；2) 依据要点（最多3条）。如果上下文不足，请明确写“在当前上下文中未找到明确依据”。';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': getRefererValue(),
      'X-Title': 'PodSum.cc QA',
    },
    body: JSON.stringify({
      model: QA_MODEL,
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `问题：${question}\n\n上下文：\n${context}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QA model request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const answer = data.choices?.[0]?.message?.content;
  if (!answer || typeof answer !== 'string') {
    throw new Error('No answer generated');
  }
  return answer.trim();
}

async function ensureAccess(
  podcastId: string
): Promise<
  | { success: true; podcast: PodcastData; userId: string | null }
  | { success: false; response: NextResponse }
> {
  const podcastResult = await getPodcast(podcastId);
  if (!podcastResult.success) {
    return {
      success: false,
      response: NextResponse.json({ success: false, error: 'Podcast not found' }, { status: 404 }),
    };
  }

  const podcast = podcastResult.data as PodcastData;
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id || null;

  if (!podcast.isPublic) {
    if (!sessionUserId) {
      return {
        success: false,
        response: NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }),
      };
    }
    const ownership = await verifyPodcastOwnership(podcastId, sessionUserId);
    if (!ownership.success) {
      return {
        success: false,
        response: NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }),
      };
    }
  }

  return { success: true, podcast, userId: sessionUserId };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing ID parameter' }, { status: 400 });
    }

    const access = await ensureAccess(id);
    if (!access.success) {
      return access.response;
    }

    const rawLimit = request.nextUrl.searchParams.get('limit');
    const parsedLimit = rawLimit ? Number(rawLimit) : 30;
    const historyResult = await getQaMessages(id, Number.isFinite(parsedLimit) ? parsedLimit : 30);
    if (!historyResult.success) {
      return NextResponse.json(
        { success: false, error: historyResult.error || 'Failed to fetch QA history' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        messages: historyResult.data || [],
      },
    });
  } catch (error) {
    console.error('QA history API failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing ID parameter' }, { status: 400 });
    }

    const access = await ensureAccess(id);
    if (!access.success) {
      return access.response;
    }

    const body = (await request.json()) as QaRequestBody;
    const question = normalizeText(body?.question);
    if (!question) {
      return NextResponse.json({ success: false, error: 'Question is required' }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Question is too long (max ${MAX_QUESTION_LENGTH} chars)` },
        { status: 400 }
      );
    }

    const analysisResult = await getAnalysisResults(id);
    if (!analysisResult.success) {
      return NextResponse.json(
        { success: false, error: 'Analysis is not ready yet. Please wait until processing finishes.' },
        { status: 409 }
      );
    }
    const analysis = (analysisResult.data || {}) as AnalysisData;

    let retrievedChunks = await retrieveHybridQaChunks(id, question, MAX_RETRIEVED_CHUNKS);
    let contextText = '';
    let mode: 'hybrid' | 'legacy' = 'hybrid';

    if (retrievedChunks.length > 0) {
      contextText = buildRetrievedContext(retrievedChunks);
    } else {
      const transcript = await fetchTranscript(access.podcast.blobUrl);

      const rebuildResult = await rebuildQaContextChunksForPodcast({
        podcastId: id,
        summary: analysis.summary,
        translation: analysis.translation,
        highlights: analysis.highlights,
        transcriptSrt: transcript,
      });
      if (rebuildResult.success && rebuildResult.chunkCount > 0) {
        retrievedChunks = await retrieveHybridQaChunks(id, question, MAX_RETRIEVED_CHUNKS);
      }

      if (retrievedChunks.length > 0) {
        contextText = buildRetrievedContext(retrievedChunks);
      } else {
        contextText = buildLegacyContext(question, analysis, transcript);
        mode = 'legacy';
      }
    }

    const answer = await callQaModel(question, contextText, mode);

    const saveResult = await saveQaMessage({
      podcastId: id,
      userId: access.userId,
      question,
      answer,
      suggestedQuestion: Boolean(body?.suggested),
    });
    if (!saveResult.success) {
      return NextResponse.json(
        { success: false, error: saveResult.error || 'Failed to save QA result' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: saveResult.data,
    });
  } catch (error) {
    console.error('QA ask API failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
