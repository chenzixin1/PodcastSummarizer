import { sql } from '@vercel/postgres';

const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || process.env.OPENROUTER_QA_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const EMBEDDING_BATCH_SIZE = Math.max(1, Math.min(32, Number.parseInt(process.env.QA_EMBEDDING_BATCH_SIZE || '16', 10)));
const MAX_TOTAL_CHUNKS = Math.max(40, Math.min(400, Number.parseInt(process.env.QA_MAX_TOTAL_CHUNKS || '180', 10)));

const CHINESE_STOPWORDS = new Set([
  '这个', '那个', '哪些', '什么', '如何', '为什么', '请问', '一下', '里面', '还有',
  '关于', '可以', '是否', '是不是', '有没有', '总结', '翻译', '全文', '重点', '相关',
]);

const ENGLISH_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'what', 'with', 'from', 'about', 'have', 'will',
  'would', 'could', 'should', 'which', 'where', 'when', 'how', 'why', 'are', 'is',
  'for', 'you', 'your', 'podcast', 'episode', 'into', 'than', 'then', 'there',
  'their', 'they', 'them', 'been', 'were', 'was', 'can', 'did', 'does', 'any',
  'more', 'less', 'just', 'also', 'talked', 'mention',
]);

const QUERY_EXPANSIONS: Array<{ triggers: string[]; terms: string[] }> = [
  {
    triggers: ['失业', '就业', '岗位', '裁员', '工作'],
    terms: ['就业', '失业', '岗位', '裁员', '工作', '职位', '劳动力', '招聘', '需求'],
  },
  {
    triggers: ['风险', '影响', '冲击'],
    terms: ['风险', '影响', '冲击', '副作用', '不确定性', '隐患'],
  },
  {
    triggers: ['ai', '人工智能', '模型', '自动化'],
    terms: ['ai', '人工智能', '模型', '自动化', 'agent', '智能体', '效率'],
  },
];

export type QaChunkSource = 'summary' | 'translation' | 'highlights' | 'transcript';

export interface QaChunkCandidate {
  source: QaChunkSource;
  chunkIndex: number;
  startSec: number | null;
  endSec: number | null;
  content: string;
}

interface StoredQaChunk extends QaChunkCandidate {
  id: number;
  embedding: number[] | null;
}

export interface HybridRetrievedChunk extends QaChunkCandidate {
  id: number;
  lexicalScore: number;
  semanticScore: number;
  finalScore: number;
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

function getRefererValue(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function parseEmbedding(raw: unknown): number[] | null {
  if (!raw) {
    return null;
  }
  if (Array.isArray(raw)) {
    const vector = raw.map(item => Number(item)).filter(item => Number.isFinite(item));
    return vector.length > 0 ? vector : null;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const vector = parsed.map(item => Number(item)).filter(item => Number.isFinite(item));
        return vector.length > 0 ? vector : null;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function toSeconds(time: string): number | null {
  const matched = time.match(/^(\d{2}):(\d{2}):(\d{2})(?:[,.:](\d{1,3}))?$/);
  if (!matched) {
    return null;
  }
  const hours = Number.parseInt(matched[1], 10);
  const minutes = Number.parseInt(matched[2], 10);
  const seconds = Number.parseInt(matched[3], 10);
  const millis = Number.parseInt((matched[4] || '0').padEnd(3, '0').slice(0, 3), 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(millis)) {
    return null;
  }
  return Math.floor(hours * 3600 + minutes * 60 + seconds + millis / 1000);
}

function parseSrtBlocks(srtContent: string): Array<{ startSec: number | null; endSec: number | null; text: string }> {
  const normalized = normalizeText(srtContent);
  if (!normalized) {
    return [];
  }

  const rawBlocks = normalized.split(/\n\s*\n+/g);
  const blocks: Array<{ startSec: number | null; endSec: number | null; text: string }> = [];

  for (const block of rawBlocks) {
    const lines = block
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }

    let cursor = 0;
    if (/^\d+$/.test(lines[0])) {
      cursor = 1;
    }
    const timeLine = lines[cursor];
    if (!timeLine || !timeLine.includes('-->')) {
      continue;
    }
    const [startRaw, endRaw] = timeLine.split('-->').map(part => part.trim());
    const startSec = toSeconds(startRaw);
    const endSec = toSeconds(endRaw);
    const text = lines.slice(cursor + 1).join(' ').trim();
    if (!text) {
      continue;
    }
    blocks.push({ startSec, endSec, text });
  }

  return blocks;
}

function splitTextWithOverlap(
  text: string,
  maxChars: number,
  overlapChars: number,
  source: QaChunkSource
): QaChunkCandidate[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [{ source, chunkIndex: 0, startSec: null, endSec: null, content: normalized }];
  }

  const chunks: QaChunkCandidate[] = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < normalized.length) {
    const limit = Math.min(normalized.length, start + maxChars);
    let end = limit;
    if (limit < normalized.length) {
      const window = normalized.slice(start, limit);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('。'), window.lastIndexOf('. '));
      if (breakAt > Math.floor(maxChars * 0.55)) {
        end = start + breakAt + 1;
      }
    }
    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({
        source,
        chunkIndex,
        startSec: null,
        endSec: null,
        content,
      });
      chunkIndex += 1;
    }
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

function buildTranscriptChunks(srtContent: string): QaChunkCandidate[] {
  const blocks = parseSrtBlocks(srtContent);
  if (blocks.length === 0) {
    return [];
  }

  const chunks: QaChunkCandidate[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < blocks.length) {
    const group = blocks.slice(cursor, cursor + 8);
    const content = group
      .map((item) => {
        const start = item.startSec ?? 0;
        const end = item.endSec ?? start;
        return `[${formatSeconds(start)} --> ${formatSeconds(end)}] ${item.text}`;
      })
      .join('\n')
      .trim();
    if (content) {
      chunks.push({
        source: 'transcript',
        chunkIndex,
        startSec: group[0]?.startSec ?? null,
        endSec: group[group.length - 1]?.endSec ?? null,
        content,
      });
      chunkIndex += 1;
    }
    cursor += 6;
  }
  return chunks;
}

function buildTranslationChunks(translation: string): QaChunkCandidate[] {
  const normalized = normalizeText(translation);
  if (!normalized) {
    return [];
  }

  const lineMatches = normalized.match(/\[\d{2}:\d{2}:\d{2}\s*-->\s*\d{2}:\d{2}:\d{2}\][^\n]*/g) || [];
  if (lineMatches.length === 0) {
    return splitTextWithOverlap(normalized, 900, 120, 'translation');
  }

  const chunks: QaChunkCandidate[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < lineMatches.length) {
    const group = lineMatches.slice(cursor, cursor + 10);
    const content = group.join('\n').trim();
    if (content) {
      const first = group[0].match(/\[(\d{2}:\d{2}:\d{2})\s*-->\s*(\d{2}:\d{2}:\d{2})\]/);
      const last = group[group.length - 1].match(/\[(\d{2}:\d{2}:\d{2})\s*-->\s*(\d{2}:\d{2}:\d{2})\]/);
      chunks.push({
        source: 'translation',
        chunkIndex,
        startSec: first ? toSeconds(first[1]) : null,
        endSec: last ? toSeconds(last[2]) : null,
        content,
      });
      chunkIndex += 1;
    }
    cursor += 8;
  }
  return chunks;
}

function dedupeAndTrimChunks(chunks: QaChunkCandidate[]): QaChunkCandidate[] {
  const dedupe = new Set<string>();
  const result: QaChunkCandidate[] = [];

  for (const chunk of chunks) {
    const normalizedContent = normalizeText(chunk.content);
    if (!normalizedContent) {
      continue;
    }
    const key = `${chunk.source}:${normalizedContent}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    result.push({
      ...chunk,
      content: normalizedContent,
    });
    if (result.length >= MAX_TOTAL_CHUNKS) {
      break;
    }
  }

  return result.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}

function formatSeconds(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '00:00:00';
  }
  const hours = Math.floor(value / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((value % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function expandQuestion(question: string): string {
  const normalized = normalizeText(question).toLowerCase();
  if (!normalized) {
    return '';
  }
  const terms = new Set<string>([normalized]);
  for (const expansion of QUERY_EXPANSIONS) {
    if (expansion.triggers.some(trigger => normalized.includes(trigger))) {
      for (const term of expansion.terms) {
        terms.add(term);
      }
    }
  }
  return Array.from(terms).join(' ');
}

function extractTerms(question: string): string[] {
  const expanded = expandQuestion(question);
  const english = expanded.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const chineseWords = expanded.match(/[\u4e00-\u9fff]{2,6}/g) || [];
  const chineseChars = expanded.match(/[\u4e00-\u9fff]/g) || [];

  const chineseBigrams: string[] = [];
  for (let i = 0; i < chineseChars.length - 1; i++) {
    chineseBigrams.push(`${chineseChars[i]}${chineseChars[i + 1]}`);
  }

  return unique(
    [...english, ...chineseWords, ...chineseBigrams]
      .map(term => term.trim())
      .filter(Boolean)
      .filter(term => {
        if (/^[a-z]/.test(term)) {
          return !ENGLISH_STOPWORDS.has(term);
        }
        return !CHINESE_STOPWORDS.has(term);
      })
      .slice(0, 24)
  );
}

function lexicalScore(content: string, terms: string[]): number {
  if (!content || terms.length === 0) {
    return 0;
  }
  const normalized = content.toLowerCase();
  let matched = 0;
  let occurrences = 0;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const localMatches = normalized.match(regex);
    if (localMatches && localMatches.length > 0) {
      matched += 1;
      occurrences += localMatches.length;
    }
  }

  if (matched === 0) {
    return 0;
  }
  const coverage = matched / terms.length;
  const density = Math.min(1, occurrences / 10);
  return Math.min(1, coverage * 0.75 + density * 0.25);
}

function cosineSimilarity(vecA: number[] | null, vecB: number[] | null): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(similarity) ? similarity : 0;
}

async function fetchEmbeddingsBatch(texts: string[]): Promise<Array<number[] | null>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return texts.map(() => null);
  }
  if (texts.length === 0) {
    return [];
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getRefererValue(),
        'X-Title': 'PodSum.cc QA Embeddings',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts.map(text => text.slice(0, 3000)),
      }),
    });

    if (!response.ok) {
      return texts.map(() => null);
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    if (!Array.isArray(data.data)) {
      return texts.map(() => null);
    }

    const vectors = data.data.map(item => parseEmbedding(item.embedding));
    if (vectors.length < texts.length) {
      return [...vectors, ...Array.from({ length: texts.length - vectors.length }, () => null)];
    }
    return vectors.slice(0, texts.length);
  } catch {
    return texts.map(() => null);
  }
}

async function fetchEmbeddings(texts: string[]): Promise<Array<number[] | null>> {
  if (texts.length === 0) {
    return [];
  }
  const result: Array<number[] | null> = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const vectors = await fetchEmbeddingsBatch(batch);
    result.push(...vectors);
  }
  return result;
}

function sourcePrior(source: QaChunkSource): number {
  if (source === 'transcript') {
    return 0.08;
  }
  if (source === 'highlights') {
    return 0.07;
  }
  if (source === 'translation') {
    return 0.05;
  }
  return 0.04;
}

export async function ensureQaContextChunksTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS qa_context_chunks (
      id BIGSERIAL PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      source TEXT NOT NULL,
      start_sec INTEGER,
      end_sec INTEGER,
      content TEXT NOT NULL,
      content_tsv TSVECTOR,
      embedding_json JSONB,
      embedding_model TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (podcast_id, source, chunk_index)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_podcast
    ON qa_context_chunks (podcast_id, source, chunk_index)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_content_tsv
    ON qa_context_chunks USING GIN (content_tsv)
  `;
}

export function buildQaChunkCandidates(input: {
  summary?: string | null;
  translation?: string | null;
  highlights?: string | null;
  transcriptSrt?: string | null;
}): QaChunkCandidate[] {
  const summaryChunks = splitTextWithOverlap(normalizeText(input.summary), 900, 120, 'summary');
  const highlightsChunks = splitTextWithOverlap(normalizeText(input.highlights), 1100, 140, 'highlights');
  const translationChunks = buildTranslationChunks(normalizeText(input.translation));
  const transcriptChunks = buildTranscriptChunks(normalizeText(input.transcriptSrt));

  return dedupeAndTrimChunks([
    ...summaryChunks.slice(0, 24),
    ...highlightsChunks.slice(0, 48),
    ...translationChunks.slice(0, 48),
    ...transcriptChunks.slice(0, 96),
  ]);
}

export async function rebuildQaContextChunksForPodcast(input: {
  podcastId: string;
  summary?: string | null;
  translation?: string | null;
  highlights?: string | null;
  transcriptSrt?: string | null;
}): Promise<{ success: boolean; chunkCount: number; error?: string }> {
  try {
    await ensureQaContextChunksTable();
    const chunks = buildQaChunkCandidates(input);
    const embeddingVectors = await fetchEmbeddings(chunks.map(chunk => chunk.content));

    await sql`DELETE FROM qa_context_chunks WHERE podcast_id = ${input.podcastId}`;

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = embeddingVectors[i];
      await sql`
        INSERT INTO qa_context_chunks (
          podcast_id,
          chunk_index,
          source,
          start_sec,
          end_sec,
          content,
          content_tsv,
          embedding_json,
          embedding_model
        )
        VALUES (
          ${input.podcastId},
          ${chunk.chunkIndex},
          ${chunk.source},
          ${chunk.startSec},
          ${chunk.endSec},
          ${chunk.content},
          to_tsvector('simple', ${chunk.content}),
          ${embedding ? JSON.stringify(embedding) : null}::jsonb,
          ${embedding ? EMBEDDING_MODEL : null}
        )
      `;
    }

    return { success: true, chunkCount: chunks.length };
  } catch (error) {
    return { success: false, chunkCount: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getStoredQaChunks(podcastId: string): Promise<StoredQaChunk[]> {
  await ensureQaContextChunksTable();
  const result = await sql`
    SELECT
      id,
      chunk_index as "chunkIndex",
      source,
      start_sec as "startSec",
      end_sec as "endSec",
      content,
      embedding_json as "embeddingJson"
    FROM qa_context_chunks
    WHERE podcast_id = ${podcastId}
    ORDER BY source ASC, chunk_index ASC
    LIMIT 1000
  `;

  return result.rows.map((row) => ({
    id: Number(row.id),
    chunkIndex: Number(row.chunkIndex),
    source: String(row.source) as QaChunkSource,
    startSec: row.startSec === null || row.startSec === undefined ? null : Number(row.startSec),
    endSec: row.endSec === null || row.endSec === undefined ? null : Number(row.endSec),
    content: String(row.content || ''),
    embedding: parseEmbedding(row.embeddingJson),
  }));
}

export async function retrieveHybridQaChunks(
  podcastId: string,
  question: string,
  maxChunks = 8
): Promise<HybridRetrievedChunk[]> {
  const chunks = await getStoredQaChunks(podcastId);
  if (chunks.length === 0) {
    return [];
  }

  const terms = extractTerms(question);
  const expanded = expandQuestion(question);
  const queryEmbedding = (await fetchEmbeddings([expanded || question]))[0] || null;
  const hasSemantic = Boolean(queryEmbedding && queryEmbedding.length > 0);

  const scored = chunks.map((chunk) => {
    const lexical = lexicalScore(chunk.content, terms);
    const semanticRaw = hasSemantic ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
    const semantic = hasSemantic ? (semanticRaw + 1) / 2 : 0;
    const finalScore = hasSemantic
      ? semantic * 0.6 + lexical * 0.3 + sourcePrior(chunk.source)
      : lexical * 0.9 + sourcePrior(chunk.source);
    return {
      ...chunk,
      lexicalScore: Number(lexical.toFixed(4)),
      semanticScore: Number(semantic.toFixed(4)),
      finalScore: Number(finalScore.toFixed(4)),
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const selected: HybridRetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const chunk of scored) {
    if (selected.length >= maxChunks) {
      break;
    }
    if (chunk.finalScore < 0.16) {
      continue;
    }
    const key = `${chunk.source}:${chunk.chunkIndex}:${chunk.content.slice(0, 120)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(chunk);
  }

  if (selected.length > 0) {
    return selected;
  }

  return scored.slice(0, Math.min(maxChunks, 4));
}

export function renderChunkLabel(chunk: QaChunkCandidate): string {
  if (typeof chunk.startSec === 'number' || typeof chunk.endSec === 'number') {
    return `${chunk.source.toUpperCase()} ${formatSeconds(chunk.startSec)}-${formatSeconds(chunk.endSec)}`;
  }
  return `${chunk.source.toUpperCase()} #${chunk.chunkIndex + 1}`;
}
