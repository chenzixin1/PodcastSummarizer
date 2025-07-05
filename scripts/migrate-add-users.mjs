#!/usr/bin/env node

import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.local' });

async function migrateDatabase() {
  console.log('🔄 开始数据库迁移：添加用户系统...');
  
  try {
    // 1. 创建 users 表
    console.log('📝 创建 users 表...');
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ users 表创建成功');

    // 2. 检查 podcasts 表是否已有 user_id 字段
    console.log('🔍 检查 podcasts 表结构...');
    const tableInfo = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'podcasts' AND column_name = 'user_id'
    `;

    if (tableInfo.rows.length === 0) {
      // 3. 添加 user_id 字段到 podcasts 表
      console.log('📝 添加 user_id 字段到 podcasts 表...');
      await sql`
        ALTER TABLE podcasts 
        ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE
      `;
      console.log('✅ user_id 字段添加成功');
    } else {
      console.log('ℹ️ user_id 字段已存在，跳过添加');
    }

    // 4. 创建一个默认的系统用户，用于现有数据
    console.log('👤 创建系统用户用于现有数据...');
    const systemUserId = 'system-user-legacy';
    await sql`
      INSERT INTO users (id, email, password_hash, name)
      VALUES (${systemUserId}, 'system@podsum.cc', 'no-password', 'System User (Legacy Data)')
      ON CONFLICT (id) DO NOTHING
    `;

    // 5. 将现有的无用户数据关联到系统用户
    console.log('🔗 关联现有数据到系统用户...');
    const updateResult = await sql`
      UPDATE podcasts 
      SET user_id = ${systemUserId} 
      WHERE user_id IS NULL
    `;
    console.log(`✅ 更新了 ${updateResult.rowCount} 条现有记录`);

    console.log('🎉 数据库迁移完成！');
    console.log('📊 迁移摘要：');
    console.log('  - ✅ 创建了 users 表');
    console.log('  - ✅ 添加了 user_id 字段到 podcasts 表');
    console.log('  - ✅ 创建了系统用户用于现有数据');
    console.log(`  - ✅ 更新了 ${updateResult.rowCount} 条现有记录`);
    
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    process.exit(1);
  }
}

// 执行迁移
migrateDatabase().then(() => {
  console.log('🚀 迁移脚本执行完成');
  process.exit(0);
}).catch(error => {
  console.error('💥 迁移脚本执行失败:', error);
  process.exit(1);
}); 