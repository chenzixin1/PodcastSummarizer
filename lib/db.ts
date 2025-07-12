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
}

// 数据库操作结果类型
export interface DbResult {
  success: boolean;
  error?: string;
  data?: unknown;
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
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
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
    const result = await sql`
      INSERT INTO podcasts 
        (id, title, original_filename, file_size, blob_url, is_public, user_id)
      VALUES 
        (${podcast.id}, ${podcast.title}, ${podcast.originalFileName}, ${podcast.fileSize}, ${podcast.blobUrl}, ${podcast.isPublic}, ${podcast.userId || null})
      ON CONFLICT (id) 
      DO UPDATE SET
        title = ${podcast.title}, 
        original_filename = ${podcast.originalFileName},
        file_size = ${podcast.fileSize},
        blob_url = ${podcast.blobUrl},
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
    const dbResult = await sql`
      INSERT INTO analysis_results 
        (podcast_id, summary, translation, highlights)
      VALUES 
        (${result.podcastId}, ${result.summary}, ${result.translation}, ${result.highlights})
      ON CONFLICT (podcast_id) 
      DO UPDATE SET
        summary = ${result.summary},
        translation = ${result.translation},
        highlights = ${result.highlights},
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `;
    
    return { success: true, data: dbResult.rows[0] };
  } catch (error) {
    console.error('保存分析结果失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 获取播客信息
export async function getPodcast(id: string): Promise<DbResult> {
  try {
    const result = await sql`
      SELECT 
        id, title, original_filename as "originalFileName", 
        file_size as "fileSize", blob_url as "blobUrl", 
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
    const result = await sql`
      SELECT 
        podcast_id as "podcastId", summary, translation, 
        highlights, processed_at as "processedAt"
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
    let query;
    
    if (includePrivate) {
      query = sql`
        SELECT 
          p.id, p.title, p.original_filename as "originalFileName", 
          p.file_size as "fileSize", p.blob_url as "blobUrl", 
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
    const query = sql`
      SELECT 
        p.id, p.title, p.original_filename as "originalFileName", 
        p.file_size as "fileSize", p.blob_url as "blobUrl", 
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