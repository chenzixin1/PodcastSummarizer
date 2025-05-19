import { initDatabase } from '../lib/db';

async function main() {
  console.log('开始初始化数据库...');
  
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