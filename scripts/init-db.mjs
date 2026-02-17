// 直接导入@vercel/postgres，因为这是一个独立的脚本
import { sql } from '@vercel/postgres';

// 数据库表初始化函数
async function initDatabase() {
  try {
    // 创建播客表
    await sql`
      CREATE TABLE IF NOT EXISTS podcasts (
        id UUID PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_size VARCHAR(50) NOT NULL,
        blob_url TEXT,
        source_reference TEXT,
        tags_json JSONB DEFAULT '[]'::jsonb,
        is_public BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ 创建播客表成功');

    // 创建分析结果表
    await sql`
      CREATE TABLE IF NOT EXISTS analysis_results (
        podcast_id UUID REFERENCES podcasts(id),
        summary TEXT,
        summary_zh TEXT,
        summary_en TEXT,
        brief_summary TEXT,
        translation TEXT,
        highlights TEXT,
        mind_map_json JSONB,
        mind_map_json_zh JSONB,
        mind_map_json_en JSONB,
        full_text_bilingual_json JSONB,
        summary_bilingual_json JSONB,
        bilingual_alignment_version INTEGER DEFAULT 0,
        token_count INTEGER,
        word_count INTEGER,
        character_count INTEGER,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
    `;
    console.log('✅ 创建分析结果表成功');

    // 创建问答上下文分块索引表
    await sql`
      CREATE TABLE IF NOT EXISTS qa_context_chunks (
        id BIGSERIAL PRIMARY KEY,
        podcast_id UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
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
    console.log('✅ 创建 QA 上下文索引表成功');

    // 兼容历史表结构
    await sql`ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS source_reference TEXT`;
    await sql`ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS tags_json JSONB DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS token_count INTEGER`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS brief_summary TEXT`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS summary_zh TEXT`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS summary_en TEXT`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS word_count INTEGER`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS character_count INTEGER`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json JSONB`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json_zh JSONB`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json_en JSONB`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS full_text_bilingual_json JSONB`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS summary_bilingual_json JSONB`;
    await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS bilingual_alignment_version INTEGER DEFAULT 0`;

    // 测试查询
    const result = await sql`SELECT NOW() as current_time`;
    console.log(`✅ 数据库连接测试成功! 数据库时间: ${result.rows[0].current_time}`);

    // 获取表信息
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    
    console.log('✅ 数据库中的表:');
    tables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    return { success: true };
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error);
    return { success: false, error };
  }
}

async function main() {
  console.log('开始初始化数据库...');
  console.log('使用 POSTGRES_URL:', process.env.POSTGRES_URL?.substring(0, 20) + '...');
  
  try {
    const result = await initDatabase();
    
    if (result.success) {
      console.log('✅ 数据库初始化成功！');
    } else {
      console.error('❌ 数据库初始化失败:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 发生错误:', error);
    process.exit(1);
  }
}

main(); 
