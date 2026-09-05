import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../../../lib/db';
import { getQaMessages, saveQaMessage } from '../../../../lib/qaMessages';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { callQaModel, QaModelError } from '../../../../lib/qaModel';
import { consumeQaRequestQuota, QA_REQUESTS_PER_HOUR } from '../../../../lib/qaQuota';
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

const MAX_QUESTION_LENGTH = 1000;
const MAX_RETRIEVED_CHUNKS = Math.max(4, Math.min(12, Number.parseInt(process.env.QA_MAX_RETRIEVED_CHUNKS || '8', 10)));

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

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
    const { getObjectText } = await import('../../../../lib/objectStorage');
    const content = await getObjectText(blobUrl);
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

async function ensureAccess(
  podcastId: string
): Promise<
  | { success: true; podcast: PodcastData; userId: string }
  | { success: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id;
  if (typeof sessionUserId !== 'string' || !sessionUserId.trim()) {
    return { success: false, response: json({ success: false, error: '请登录后使用问答。' }, 401) };
  }
  const podcastResult = await getPodcast(podcastId);
  if (!podcastResult.success) {
    return {
      success: false,
      response: json({ success: false, error: 'Podcast not found' }, 404),
    };
  }

  const podcast = podcastResult.data as PodcastData;
  if (!podcast.isPublic) {
    const ownership = await verifyPodcastOwnership(podcastId, sessionUserId);
    if (!ownership.success) {
      return {
        success: false,
        response: json({ success: false, error: 'Access denied' }, 403),
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
      return json({ success: false, error: 'Missing ID parameter' }, 400);
    }

    const access = await ensureAccess(id);
    if (!access.success) {
      return access.response;
    }

    const rawLimit = request.nextUrl.searchParams.get('limit');
    const parsedLimit = rawLimit ? Number(rawLimit) : 30;
    const historyResult = await getQaMessages(id, access.userId, Number.isFinite(parsedLimit) ? parsedLimit : 30);
    if (!historyResult.success) {
      return json({ success: false, error: '暂时无法读取问答历史，请稍后重试。' }, 500);
    }

    return json({
      success: true,
      data: {
        messages: historyResult.data || [],
      },
    });
  } catch {
    console.error('QA history API failed');
    return json({ success: false, error: '暂时无法读取问答历史，请稍后重试。' }, 500);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return json({ success: false, error: 'Missing ID parameter' }, 400);
    }

    const access = await ensureAccess(id);
    if (!access.success) {
      return access.response;
    }

    let body: QaRequestBody;
    try { body = (await request.json()) as QaRequestBody; }
    catch { return json({ success: false, error: '请求格式不正确。' }, 400); }
    const question = normalizeText(body?.question);
    if (!question) {
      return json({ success: false, error: 'Question is required' }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return json(
        { success: false, error: `Question is too long (max ${MAX_QUESTION_LENGTH} chars)` },
        400
      );
    }

    const analysisResult = await getAnalysisResults(id);
    if (!analysisResult.success) {
      return json(
        { success: false, error: 'Analysis is not ready yet. Please wait until processing finishes.' },
        409
      );
    }
    const analysis = (analysisResult.data || {}) as AnalysisData;

    if (!await consumeQaRequestQuota(access.userId)) {
      return json({ success: false, error: `每小时最多提问 ${QA_REQUESTS_PER_HOUR} 次，请稍后再试。` }, 429);
    }

    let retrievedChunks = await retrieveHybridQaChunks(id, question, MAX_RETRIEVED_CHUNKS);
    let contextText = '';
    let mode: 'hybrid' | 'legacy' = 'hybrid';

    if (retrievedChunks.length > 0) {
      contextText = buildRetrievedContext(retrievedChunks);
    } else {
      const transcript = await fetchTranscript(access.podcast.blobUrl);

      // Lexical-only deployments can answer from source without a racing, paid index rebuild.
      const rebuildResult = process.env.QA_EMBEDDINGS_ENABLED === 'false' ? { success: true, chunkCount: 0 } : await rebuildQaContextChunksForPodcast({
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
      return json({ success: false, error: '问答结果暂时无法保存，请稍后重试。' }, 500);
    }

    return json({
      success: true,
      data: saveResult.data,
    });
  } catch (error) {
    if (error instanceof QaModelError) return json({ success: false, error: error.message }, error.status);
    console.error('QA ask API failed');
    return json({ success: false, error: '问答暂时不可用，请稍后重试。' }, 500);
  }
}
