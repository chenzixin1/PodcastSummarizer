import { sql } from '@vercel/postgres';
import { extractPodcastTags } from './podcastTags';
import type { MindMapData } from './mindMap';

// 播客类型
export interface Podcast {
  id: string;
  title: string;
  originalFileName: string;
  fileSize: string;
  blobUrl: string;
  isPublic: boolean;
  userId?: string;
  sourceReference?: string | null;
  tags?: string[];
}

// 用户类型
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  credits: number;
  createdAt: string;
}

// 分析结果类型
export interface AnalysisResult {
  podcastId: string;
  summary: string;
  summaryZh?: string | null;
  summaryEn?: string | null;
  briefSummary?: string | null;
  translation: string;
  highlights: string;
  mindMapJson?: MindMapData | null;
  mindMapJsonZh?: MindMapData | null;
  mindMapJsonEn?: MindMapData | null;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

export interface PartialAnalysisResult {
  podcastId: string;
  summary?: string | null;
  summaryZh?: string | null;
  summaryEn?: string | null;
  briefSummary?: string | null;
  translation?: string | null;
  highlights?: string | null;
  mindMapJson?: MindMapData | null;
  mindMapJsonZh?: MindMapData | null;
  mindMapJsonEn?: MindMapData | null;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

// 数据库操作结果类型
export interface DbResult {
  success: boolean;
  error?: string;
  data?: unknown;
  errorCode?: string;
}

export const DEFAULT_SRT_CREDITS = 10;
export const SPECIAL_CREDITS_EMAIL = '1195021@qq.com';
export const SPECIAL_SRT_CREDITS = 10000;

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function getInitialSrtCreditsForEmail(email: string): number {
  return normalizeEmail(email) === SPECIAL_CREDITS_EMAIL ? SPECIAL_SRT_CREDITS : DEFAULT_SRT_CREDITS;
}

let schemaUpgradeEnsured = false;
let schemaUpgradePromise: Promise<void> | null = null;
let userCreditsSchemaEnsured = false;
let userCreditsSchemaPromise: Promise<void> | null = null;

export async function ensureUserCreditsSchema(): Promise<void> {
  if (userCreditsSchemaEnsured) {
    return;
  }

  if (!userCreditsSchemaPromise) {
    userCreditsSchemaPromise = (async () => {
      await sql`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 10
      `;
      userCreditsSchemaEnsured = true;
    })().catch((error) => {
      userCreditsSchemaPromise = null;
      throw error;
    });
  }

  await userCreditsSchemaPromise;
}

function toJsonb(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error('JSONB serialization failed:', error);
    return null;
  }
}

const LIST_BRIEF_SUMMARY_MAX_CHARS = 220;

function stripMarkdownToPlainText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimToNaturalBoundary(input: string, maxChars: number): string {
  const normalized = input.trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  const candidate = normalized.slice(0, maxChars);
  const punctuation = ['。', '！', '？', '.', '!', '?', '；', ';', '，', ','];
  let best = -1;
  for (const token of punctuation) {
    const index = candidate.lastIndexOf(token);
    if (index > best) {
      best = index;
    }
  }
  if (best >= Math.floor(maxChars * 0.6)) {
    return candidate.slice(0, best + 1).trim();
  }
  return candidate.trim();
}

function extractChineseSummaryBody(summary: string): string {
  const normalized = String(summary || '');
  if (!normalized) {
    return '';
  }
  const chineseHeaderIndex = normalized.indexOf('# 中文总结');
  if (chineseHeaderIndex >= 0) {
    return normalized.slice(chineseHeaderIndex);
  }
  return normalized;
}

function buildListBriefSummary(rawBrief: unknown, rawSummary: unknown): string | null {
  const brief = typeof rawBrief === 'string' ? rawBrief.trim() : '';
  if (brief) {
    return trimToNaturalBoundary(stripMarkdownToPlainText(brief), LIST_BRIEF_SUMMARY_MAX_CHARS) || null;
  }

  const summary = typeof rawSummary === 'string' ? rawSummary.trim() : '';
  if (!summary) {
    return null;
  }

  const chineseSource = extractChineseSummaryBody(summary);
  const lines = chineseSource
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
  const base = bullets.length > 0 ? bullets.slice(0, 4).join('；') : chineseSource;
  const plain = stripMarkdownToPlainText(base);
  const finalText = trimToNaturalBoundary(plain, LIST_BRIEF_SUMMARY_MAX_CHARS);
  return finalText || null;
}

export async function ensureExtensionTranscriptionJobsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS extension_transcription_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      provider_task_id TEXT,
      podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
      audio_blob_url TEXT,
      source_reference TEXT,
      original_file_name TEXT,
      title TEXT,
      video_id TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_user_created
    ON extension_transcription_jobs (user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_provider_task
    ON extension_transcription_jobs (provider_task_id)
  `;
}

export async function ensureExtensionMonitorTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS extension_monitor_tasks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      client_task_id TEXT,
      trace_id TEXT,
      source_reference TEXT,
      video_id TEXT,
      title TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      transcription_job_id TEXT,
      podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
      provider_task_id TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      last_http_status INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS extension_monitor_events (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES extension_monitor_tasks(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'info',
      stage TEXT NOT NULL,
      endpoint TEXT,
      http_status INTEGER,
      message TEXT,
      request_headers JSONB,
      request_body JSONB,
      response_headers JSONB,
      response_body JSONB,
      error_stack TEXT,
      meta JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_created
    ON extension_monitor_tasks (created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_status_path_updated
    ON extension_monitor_tasks (status, path, updated_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_user_created
    ON extension_monitor_tasks (user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_transcription_job
    ON extension_monitor_tasks (transcription_job_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_podcast
    ON extension_monitor_tasks (podcast_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_trace
    ON extension_monitor_tasks (trace_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_events_task_created
    ON extension_monitor_events (task_id, created_at ASC)
  `;
}

async function ensureSchemaUpgrades(): Promise<void> {
  if (schemaUpgradeEnsured) {
    return;
  }

  if (!schemaUpgradePromise) {
    schemaUpgradePromise = (async () => {
      await ensureUserCreditsSchema();
      await sql`
        ALTER TABLE podcasts
        ADD COLUMN IF NOT EXISTS source_reference TEXT
      `;
      await sql`
        ALTER TABLE podcasts
        ADD COLUMN IF NOT EXISTS tags_json JSONB DEFAULT '[]'::jsonb
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS token_count INTEGER
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS brief_summary TEXT
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS summary_zh TEXT
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS summary_en TEXT
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS word_count INTEGER
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS character_count INTEGER
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json JSONB
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json_zh JSONB
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json_en JSONB
      `;
      await ensureExtensionTranscriptionJobsTable().catch((error) => {
        console.warn('[DB] ensureExtensionTranscriptionJobsTable skipped:', error);
      });
      await ensureExtensionMonitorTables().catch((error) => {
        console.warn('[DB] ensureExtensionMonitorTables skipped:', error);
      });
      schemaUpgradeEnsured = true;
    })().catch((error) => {
      schemaUpgradePromise = null;
      throw error;
    });
  }

  await schemaUpgradePromise;
}

// 数据库表初始化函数
export async function initDatabase(): Promise<DbResult> {
  try {
    console.log('🔄 开始初始化数据库表...');
    
    // 创建 users 表
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        credits INTEGER NOT NULL DEFAULT 10,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 创建 podcasts 表（添加 user_id 字段）
    await sql`
      CREATE TABLE IF NOT EXISTS podcasts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_size TEXT NOT NULL,
        blob_url TEXT,
        source_reference TEXT,
        tags_json JSONB DEFAULT '[]'::jsonb,
        is_public BOOLEAN DEFAULT FALSE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 创建 analysis_results 表
    await sql`
      CREATE TABLE IF NOT EXISTS analysis_results (
        podcast_id TEXT REFERENCES podcasts(id),
        summary TEXT,
        summary_zh TEXT,
        summary_en TEXT,
        brief_summary TEXT,
        translation TEXT,
        highlights TEXT,
        mind_map_json JSONB,
        mind_map_json_zh JSONB,
        mind_map_json_en JSONB,
        token_count INTEGER,
        word_count INTEGER,
        character_count INTEGER,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
    `;

    // 兼容历史环境：为已存在表补充新增字段
    await ensureSchemaUpgrades();

    // 创建处理任务队列表
    await sql`
      CREATE TABLE IF NOT EXISTS processing_jobs (
        podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        current_task TEXT,
        progress_current INTEGER DEFAULT 0,
        progress_total INTEGER DEFAULT 0,
        status_message TEXT,
        attempts INTEGER DEFAULT 0,
        worker_id TEXT,
        last_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      )
    `;

    // 创建问答记录表
    await sql`
      CREATE TABLE IF NOT EXISTS qa_messages (
        id TEXT PRIMARY KEY,
        podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        suggested_question BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qa_messages_podcast_created_at
      ON qa_messages (podcast_id, created_at DESC)
    `;

    // 创建问答上下文分块索引表（用于混合召回）
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

    await ensureExtensionTranscriptionJobsTable();
    await ensureExtensionMonitorTables();

    console.log('✅ 数据库表初始化成功');
    return { success: true };
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 保存播客信息并扣除 1 个转换积分（原子操作）
export async function savePodcastWithCreditDeduction(podcast: Podcast): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();

    if (!podcast.userId) {
      return { success: false, errorCode: 'USER_REQUIRED', error: 'userId is required for credit deduction.' };
    }

    const result = await sql`
      WITH charged AS (
        UPDATE users
        SET credits = credits - 1
        WHERE id = ${podcast.userId}
          AND credits >= 1
        RETURNING id, credits
      ),
      inserted AS (
        INSERT INTO podcasts
          (id, title, original_filename, file_size, blob_url, source_reference, is_public, user_id)
        SELECT
          ${podcast.id},
          ${podcast.title},
          ${podcast.originalFileName},
          ${podcast.fileSize},
          ${podcast.blobUrl},
          ${podcast.sourceReference ?? null},
          ${podcast.isPublic},
          ${podcast.userId}
        FROM charged
        RETURNING id
      )
      SELECT
        (SELECT id FROM inserted LIMIT 1) AS podcast_id,
        (SELECT credits FROM charged LIMIT 1) AS remaining_credits
    `;

    const podcastId = result.rows[0]?.podcast_id as string | null;
    if (podcastId) {
      const remainingCreditsRaw = result.rows[0]?.remaining_credits;
      const remainingCredits =
        typeof remainingCreditsRaw === 'number' ? remainingCreditsRaw : Number.parseInt(String(remainingCreditsRaw), 10);

      return {
        success: true,
        data: {
          id: podcastId,
          remainingCredits: Number.isFinite(remainingCredits) ? remainingCredits : null,
        },
      };
    }

    const userCheck = await sql`
      SELECT id FROM users WHERE id = ${podcast.userId}
    `;

    if (userCheck.rows.length === 0) {
      return {
        success: false,
        errorCode: 'USER_NOT_FOUND',
        error: 'User not found.',
      };
    }

    return {
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      error: 'Insufficient credits.',
    };
  } catch (error) {
    console.error('保存播客并扣除积分失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 保存播客信息
export async function savePodcast(podcast: Podcast): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      INSERT INTO podcasts 
        (id, title, original_filename, file_size, blob_url, source_reference, is_public, user_id)
      VALUES 
        (${podcast.id}, ${podcast.title}, ${podcast.originalFileName}, ${podcast.fileSize}, ${podcast.blobUrl}, ${podcast.sourceReference ?? null}, ${podcast.isPublic}, ${podcast.userId || null})
      ON CONFLICT (id) 
      DO UPDATE SET
        title = ${podcast.title}, 
        original_filename = ${podcast.originalFileName},
        file_size = ${podcast.fileSize},
        blob_url = ${podcast.blobUrl},
        source_reference = ${podcast.sourceReference ?? null},
        is_public = ${podcast.isPublic},
        user_id = ${podcast.userId || null}
      RETURNING id
    `;
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('保存播客信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 保存分析结果
export async function saveAnalysisResults(result: AnalysisResult): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const summaryZh = result.summaryZh ?? result.summary ?? null;
    const summaryEn = result.summaryEn ?? null;
    const summaryLegacy = summaryZh ?? result.summary ?? '';
    const mindMapZh = result.mindMapJsonZh ?? result.mindMapJson ?? null;
    const mindMapEn = result.mindMapJsonEn ?? null;
    const mindMapLegacy = result.mindMapJson ?? mindMapZh ?? null;

    const dbResult = await sql`
      INSERT INTO analysis_results 
        (
          podcast_id,
          summary,
          summary_zh,
          summary_en,
          brief_summary,
          translation,
          highlights,
          mind_map_json,
          mind_map_json_zh,
          mind_map_json_en,
          token_count,
          word_count,
          character_count
        )
      VALUES 
        (
          ${result.podcastId},
          ${summaryLegacy},
          ${summaryZh},
          ${summaryEn},
          ${result.briefSummary ?? null},
          ${result.translation},
          ${result.highlights},
          ${toJsonb(mindMapLegacy)}::jsonb,
          ${toJsonb(mindMapZh)}::jsonb,
          ${toJsonb(mindMapEn)}::jsonb,
          ${result.tokenCount ?? null},
          ${result.wordCount ?? null},
          ${result.characterCount ?? null}
        )
      ON CONFLICT (podcast_id) 
      DO UPDATE SET
        summary = ${summaryLegacy},
        summary_zh = ${summaryZh},
        summary_en = ${summaryEn},
        brief_summary = ${result.briefSummary ?? null},
        translation = ${result.translation},
        highlights = ${result.highlights},
        mind_map_json = ${toJsonb(mindMapLegacy)}::jsonb,
        mind_map_json_zh = ${toJsonb(mindMapZh)}::jsonb,
        mind_map_json_en = ${toJsonb(mindMapEn)}::jsonb,
        token_count = ${result.tokenCount ?? null},
        word_count = ${result.wordCount ?? null},
        character_count = ${result.characterCount ?? null},
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `;

    // 根据最新摘要重建标签并写回 podcasts
    const podcastInfo = await sql`
      SELECT title, original_filename as "originalFileName", source_reference as "sourceReference"
      FROM podcasts
      WHERE id = ${result.podcastId}
      LIMIT 1
    `;
    if (podcastInfo.rows.length > 0) {
      const row = podcastInfo.rows[0] as {
        title?: string | null;
        originalFileName?: string | null;
        sourceReference?: string | null;
      };
      const tags = extractPodcastTags({
        title: row.title || null,
        fallbackName: row.originalFileName || null,
        summary: summaryLegacy || '',
        sourceReference: row.sourceReference || null,
      });
      await sql`
        UPDATE podcasts
        SET tags_json = ${JSON.stringify(tags)}::jsonb
        WHERE id = ${result.podcastId}
      `;
    }
    
    return { success: true, data: dbResult.rows[0] };
  } catch (error) {
    console.error('保存分析结果失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 保存分析结果增量（只更新传入字段）
export async function saveAnalysisPartialResults(result: PartialAnalysisResult): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const summaryZh = result.summaryZh ?? null;
    const summaryEn = result.summaryEn ?? null;
    const summaryLegacy = result.summary ?? summaryZh ?? null;
    const mindMapZh = result.mindMapJsonZh ?? null;
    const mindMapEn = result.mindMapJsonEn ?? null;
    const mindMapLegacy = result.mindMapJson ?? mindMapZh ?? null;

    const dbResult = await sql`
      INSERT INTO analysis_results
        (
          podcast_id,
          summary,
          summary_zh,
          summary_en,
          brief_summary,
          translation,
          highlights,
          mind_map_json,
          mind_map_json_zh,
          mind_map_json_en,
          token_count,
          word_count,
          character_count
        )
      VALUES
        (
          ${result.podcastId},
          ${summaryLegacy},
          ${summaryZh},
          ${summaryEn},
          ${result.briefSummary ?? null},
          ${result.translation ?? null},
          ${result.highlights ?? null},
          ${toJsonb(mindMapLegacy)}::jsonb,
          ${toJsonb(mindMapZh)}::jsonb,
          ${toJsonb(mindMapEn)}::jsonb,
          ${result.tokenCount ?? null},
          ${result.wordCount ?? null},
          ${result.characterCount ?? null}
        )
      ON CONFLICT (podcast_id)
      DO UPDATE SET
        summary = COALESCE(EXCLUDED.summary, analysis_results.summary),
        summary_zh = COALESCE(EXCLUDED.summary_zh, analysis_results.summary_zh),
        summary_en = COALESCE(EXCLUDED.summary_en, analysis_results.summary_en),
        brief_summary = COALESCE(EXCLUDED.brief_summary, analysis_results.brief_summary),
        translation = COALESCE(EXCLUDED.translation, analysis_results.translation),
        highlights = COALESCE(EXCLUDED.highlights, analysis_results.highlights),
        mind_map_json = COALESCE(EXCLUDED.mind_map_json, analysis_results.mind_map_json),
        mind_map_json_zh = COALESCE(EXCLUDED.mind_map_json_zh, analysis_results.mind_map_json_zh),
        mind_map_json_en = COALESCE(EXCLUDED.mind_map_json_en, analysis_results.mind_map_json_en),
        token_count = COALESCE(EXCLUDED.token_count, analysis_results.token_count),
        word_count = COALESCE(EXCLUDED.word_count, analysis_results.word_count),
        character_count = COALESCE(EXCLUDED.character_count, analysis_results.character_count),
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `;

    return { success: true, data: dbResult.rows[0] };
  } catch (error) {
    console.error('保存分析结果增量失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 获取播客信息
export async function getPodcast(id: string): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      SELECT 
        id, title, original_filename as "originalFileName", 
        file_size as "fileSize", blob_url as "blobUrl", 
        source_reference as "sourceReference",
        tags_json as "tags",
        is_public as "isPublic", user_id as "userId", created_at as "createdAt"
      FROM podcasts 
      WHERE id = ${id}
    `;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Podcast not found' };
    }
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('获取播客信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 获取分析结果
export async function getAnalysisResults(podcastId: string): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      SELECT 
        podcast_id as "podcastId",
        summary,
        summary_zh as "summaryZh",
        summary_en as "summaryEn",
        brief_summary as "briefSummary",
        translation, 
        highlights,
        mind_map_json as "mindMapJson",
        mind_map_json_zh as "mindMapJsonZh",
        mind_map_json_en as "mindMapJsonEn",
        token_count as "tokenCount",
        word_count as "wordCount",
        character_count as "characterCount",
        processed_at as "processedAt"
      FROM analysis_results 
      WHERE podcast_id = ${podcastId}
    `;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Analysis results not found' };
    }
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('获取分析结果失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 获取所有播客信息（支持分页）
export async function getAllPodcasts(page = 1, pageSize = 10, includePrivate = false): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    let query;
    
    if (includePrivate) {
      query = sql`
        SELECT 
          p.id, p.title, p.original_filename as "originalFileName", 
          p.file_size as "fileSize", p.blob_url as "blobUrl", 
          p.source_reference as "sourceReference",
          p.tags_json as "tags",
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
          ar.brief_summary as "__briefSummaryRaw",
          COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
          ar.word_count as "wordCount",
          CASE
            WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
              THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
            ELSE NULL
          END as "durationSec"
        FROM podcasts p
        LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
        ORDER BY p.created_at DESC 
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
    } else {
      query = sql`
        SELECT 
          p.id, p.title, p.original_filename as "originalFileName", 
          p.file_size as "fileSize", p.blob_url as "blobUrl", 
          p.source_reference as "sourceReference",
          p.tags_json as "tags",
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
          ar.brief_summary as "__briefSummaryRaw",
          COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
          ar.word_count as "wordCount",
          CASE
            WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
              THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
            ELSE NULL
          END as "durationSec"
        FROM podcasts p
        LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
        WHERE p.is_public = true
        ORDER BY p.created_at DESC 
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
    }
    
    const result = await query;

    const rows = result.rows.map((row) => {
      const normalized = {
        ...row,
        briefSummary: buildListBriefSummary(row.__briefSummaryRaw, row.__summaryRaw),
      } as Record<string, unknown>;
      delete normalized.__briefSummaryRaw;
      delete normalized.__summaryRaw;
      return normalized;
    });

    return { success: true, data: rows };
  } catch (error) {
    console.error('获取所有播客信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 获取用户上传的所有播客信息
export async function getUserPodcasts(userId: string, page = 1, pageSize = 10): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const query = sql`
      SELECT 
        p.id, p.title, p.original_filename as "originalFileName", 
        p.file_size as "fileSize", p.blob_url as "blobUrl", 
        p.source_reference as "sourceReference",
        p.tags_json as "tags",
        p.is_public as "isPublic", p.created_at as "createdAt",
        p.user_id as "userId",
        CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
        ar.brief_summary as "__briefSummaryRaw",
        COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
        ar.word_count as "wordCount",
        CASE
          WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
            THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
          ELSE NULL
        END as "durationSec"
      FROM podcasts p
      LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
      WHERE p.user_id = ${userId}
      ORDER BY p.created_at DESC 
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    
    const result = await query;
    const rows = result.rows.map((row) => {
      const normalized = {
        ...row,
        briefSummary: buildListBriefSummary(row.__briefSummaryRaw, row.__summaryRaw),
      } as Record<string, unknown>;
      delete normalized.__briefSummaryRaw;
      delete normalized.__summaryRaw;
      return normalized;
    });
    return { success: true, data: rows };
  } catch (error) {
    console.error('获取用户播客信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 删除播客及其分析结果
export async function deletePodcast(id: string): Promise<DbResult> {
  try {
    // 首先删除分析结果（由于外键约束）
    await sql`DELETE FROM analysis_results WHERE podcast_id = ${id}`;
    
    // 然后删除播客记录
    const result = await sql`DELETE FROM podcasts WHERE id = ${id} RETURNING id`;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Podcast not found or already deleted' };
    }
    
    return { success: true, data: { id: result.rows[0].id } };
  } catch (error) {
    console.error('删除播客失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 更新播客的公开状态
export async function updatePodcastPublicStatus(id: string, isPublic: boolean): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      UPDATE podcasts 
      SET is_public = ${isPublic} 
      WHERE id = ${id}
      RETURNING id
    `;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Podcast not found' };
    }
    
    return { success: true, data: { id: result.rows[0].id, isPublic } };
  } catch (error) {
    console.error('更新播客公开状态失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface PodcastMetadataUpdateInput {
  isPublic?: boolean;
  sourceReference?: string | null;
}

// 更新播客元信息（支持公开状态与来源备注）
export async function updatePodcastMetadata(id: string, updates: PodcastMetadataUpdateInput): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const hasIsPublicUpdate = typeof updates.isPublic === 'boolean';
    const hasSourceUpdate =
      Object.prototype.hasOwnProperty.call(updates, 'sourceReference') &&
      updates.sourceReference !== undefined;

    if (!hasIsPublicUpdate && !hasSourceUpdate) {
      return { success: false, error: 'No fields to update' };
    }

    let result;
    if (hasIsPublicUpdate && hasSourceUpdate) {
      result = await sql`
        UPDATE podcasts
        SET is_public = ${updates.isPublic as boolean},
            source_reference = ${updates.sourceReference ?? null}
        WHERE id = ${id}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `;
    } else if (hasIsPublicUpdate) {
      result = await sql`
        UPDATE podcasts
        SET is_public = ${updates.isPublic as boolean}
        WHERE id = ${id}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `;
    } else {
      result = await sql`
        UPDATE podcasts
        SET source_reference = ${updates.sourceReference ?? null}
        WHERE id = ${id}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `;
    }

    if (result.rows.length === 0) {
      return { success: false, error: 'Podcast not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('更新播客元信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 创建用户
export async function createUser(
  user: Omit<User, 'createdAt' | 'credits'> & { credits?: number },
): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const credits = Number.isFinite(user.credits as number)
      ? Math.max(0, Math.floor(user.credits as number))
      : getInitialSrtCreditsForEmail(user.email);

    const result = await sql`
      INSERT INTO users (id, email, password_hash, name, credits)
      VALUES (${user.id}, ${user.email}, ${user.passwordHash}, ${user.name}, ${credits})
      RETURNING id, email, name, credits, created_at
    `;
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('创建用户失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 根据邮箱获取用户
export async function getUserByEmail(email: string): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      SELECT id, email, password_hash, name, credits, created_at
      FROM users
      WHERE email = ${email}
    `;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 根据ID获取用户
export async function getUserById(id: string): Promise<DbResult> {
  try {
    await ensureSchemaUpgrades();
    const result = await sql`
      SELECT id, email, name, credits, created_at
      FROM users
      WHERE id = ${id}
    `;
    
    if (result.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }
    
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 验证播客所有权
export async function verifyPodcastOwnership(podcastId: string, userId: string): Promise<DbResult> {
  try {
    const result = await sql`
      SELECT id FROM podcasts
      WHERE id = ${podcastId} AND user_id = ${userId}
    `;
    
    return { success: result.rows.length > 0, data: result.rows[0] };
  } catch (error) {
    console.error('验证播客所有权失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
} 
