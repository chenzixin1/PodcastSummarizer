import pkg from 'pg';
const { Pool } = pkg;

// 使用提供的连接URL
const connectionString = 'postgres://REDACTED:REDACTED@REDACTED';

async function testConnection() {
  const pool = new Pool({
    connectionString,
  });

  try {
    console.log("尝试连接数据库...");
    const client = await pool.connect();
    console.log("✅ 连接成功!");
    
    // 测试简单查询
    const result = await client.query('SELECT NOW() as current_time');
    console.log(`数据库当前时间: ${result.rows[0].current_time}`);
    
    // 尝试获取数据库中的表信息
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    if (tablesResult.rows.length === 0) {
      console.log("数据库中没有表，这可能是一个新数据库");
    } else {
      console.log("数据库中的表:");
      tablesResult.rows.forEach(row => {
        console.log(`- ${row.table_name}`);
      });
    }
    
    client.release();
  } catch (err) {
    console.error("❌ 连接失败:", err);
  } finally {
    await pool.end();
  }
}

testConnection(); 