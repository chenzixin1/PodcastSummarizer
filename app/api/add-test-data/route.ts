import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { nanoid } from 'nanoid';
import { createUser } from '../../../lib/db';

export async function POST(request: NextRequest) {
  try {
    console.log('Adding test data to database...');
    
    // 创建测试用户或获取现有用户
    let userId;
    
    // 首先尝试获取现有用户
    const existingUserResult = await sql`
      SELECT id FROM users WHERE email = 'test@example.com'
    `;
    
    if (existingUserResult.rows.length > 0) {
      userId = existingUserResult.rows[0].id;
      console.log('Using existing user:', userId);
    } else {
      // 创建新用户
      userId = nanoid();
      const userResult = await createUser({
        id: userId,
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'dummy_hash'
      });
      
      if (!userResult.success) {
        throw new Error(`Failed to create user: ${userResult.error}`);
      }
      console.log('Created new user:', userId);
    }
    
    // 创建测试播客（暂时不关联用户）
    const podcastId = nanoid();
    await sql`
      INSERT INTO podcasts (
        id, title, original_filename, file_size, blob_url, 
        is_public, created_at
      )
      VALUES (
        ${podcastId}, 
        'AI Technology Discussion', 
        'test-podcast.srt', 
        '1.2 KB', 
        'https://example.com/test-podcast.srt',
        true,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
    
    // 创建分析结果
    await sql`
      INSERT INTO analysis_results (
        podcast_id, summary, highlights, translation
      )
      VALUES (
        ${podcastId},
        'This podcast discusses the latest developments in artificial intelligence and machine learning technologies. The conversation covers various applications of AI in different industries and explores how these technologies are transforming our daily lives.',
        '["AI and technology overview", "Machine learning applications", "Industry transformation", "Future of artificial intelligence"]',
        '{"zh": "这个播客讨论了人工智能和机器学习技术的最新发展。对话涵盖了人工智能在不同行业的各种应用，并探讨了这些技术如何改变我们的日常生活。"}'
      )
      ON CONFLICT (podcast_id) DO NOTHING
    `;
    
    return NextResponse.json({
      success: true,
      message: 'Test data added successfully',
      data: {
        podcastId,
        userId
      }
    });
    
  } catch (error) {
    console.error('Error adding test data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to add test data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 