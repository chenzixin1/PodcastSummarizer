import { sql } from '@vercel/postgres';

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
}

// 用户类型
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

// 分析结果类型
export interface AnalysisResult {
  podcastId: string;
  summary: string;
  translation: string;
  highlights: string;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

export interface PartialAnalysisResult {
  podcastId: string;
  summary?: string | null;
  translation?: string | null;
  highlights?: string | null;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

// 数据库操作结果类型
export interface DbResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

let schemaUpgradeEnsured = false;
let schemaUpgradePromise: Promise<void> | null = null;

async function ensureSchemaUpgrades(): Promise<void> {
  if (schemaUpgradeEnsured) {
    return;
  }

  if (!schemaUpgradePromise) {
    schemaUpgradePromise = (async () => {
      await sql`
        ALTER TABLE podcasts
        ADD COLUMN IF NOT EXISTS source_reference TEXT
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS token_count INTEGER
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS word_count INTEGER
      `;
      await sql`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS character_count INTEGER
      `;
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
        translation TEXT,
        highlights TEXT,
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

    console.log('✅ 数据库表初始化成功');
    return { success: true };
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
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
    const dbResult = await sql`
      INSERT INTO analysis_results 
        (podcast_id, summary, translation, highlights, token_count, word_count, character_count)
      VALUES 
        (
          ${result.podcastId},
          ${result.summary},
          ${result.translation},
          ${result.highlights},
          ${result.tokenCount ?? null},
          ${result.wordCount ?? null},
          ${result.characterCount ?? null}
        )
      ON CONFLICT (podcast_id) 
      DO UPDATE SET
        summary = ${result.summary},
        translation = ${result.translation},
        highlights = ${result.highlights},
        token_count = ${result.tokenCount ?? null},
        word_count = ${result.wordCount ?? null},
        character_count = ${result.characterCount ?? null},
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `;
    
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
    const dbResult = await sql`
      INSERT INTO analysis_results
        (podcast_id, summary, translation, highlights, token_count, word_count, character_count)
      VALUES
        (
          ${result.podcastId},
          ${result.summary ?? null},
          ${result.translation ?? null},
          ${result.highlights ?? null},
          ${result.tokenCount ?? null},
          ${result.wordCount ?? null},
          ${result.characterCount ?? null}
        )
      ON CONFLICT (podcast_id)
      DO UPDATE SET
        summary = COALESCE(EXCLUDED.summary, analysis_results.summary),
        translation = COALESCE(EXCLUDED.translation, analysis_results.translation),
        highlights = COALESCE(EXCLUDED.highlights, analysis_results.highlights),
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
        podcast_id as "podcastId", summary, translation, 
        highlights,
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
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed"
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
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed"
        FROM podcasts p
        LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
        WHERE p.is_public = true
        ORDER BY p.created_at DESC 
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
    }
    
    const result = await query;
    
    return { success: true, data: result.rows };
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
        p.is_public as "isPublic", p.created_at as "createdAt",
        p.user_id as "userId",
        CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed"
      FROM podcasts p
      LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
      WHERE p.user_id = ${userId}
      ORDER BY p.created_at DESC 
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    
    const result = await query;
    return { success: true, data: result.rows };
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
    const hasSourceUpdate = Object.prototype.hasOwnProperty.call(updates, 'sourceReference');

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
export async function createUser(user: Omit<User, 'createdAt'>): Promise<DbResult> {
  try {
    const result = await sql`
      INSERT INTO users (id, email, password_hash, name)
      VALUES (${user.id}, ${user.email}, ${user.passwordHash}, ${user.name})
      RETURNING id, email, name, created_at
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
    const result = await sql`
      SELECT id, email, password_hash, name, created_at
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
    const result = await sql`
      SELECT id, email, name, created_at
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
