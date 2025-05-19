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
        translation TEXT,
        highlights TEXT,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (podcast_id)
      )
    `;
    console.log('✅ 创建分析结果表成功');

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