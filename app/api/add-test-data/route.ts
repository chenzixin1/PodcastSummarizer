import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { nanoid } from 'nanoid';

export async function POST(request: NextRequest) {
  try {
    console.log('Adding test data to database...');
    
    // 创建测试用户
    const userId = nanoid();
    await sql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (${userId}, 'test@example.com', 'Test User', 'dummy_hash', NOW())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    `;
    
    // 创建测试播客
    const podcastId = nanoid();
    await sql`
      INSERT INTO podcasts (
        id, title, original_filename, file_size, blob_url, 
        is_public, user_id, created_at
      )
      VALUES (
        ${podcastId}, 
        'AI Technology Discussion', 
        'test-podcast.srt', 
        '1.2 KB', 
        'https://example.com/test-podcast.srt',
        true,
        ${userId},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
    
    // 创建分析结果
    await sql`
      INSERT INTO analysis_results (
        id, podcast_id, summary, highlights, translations, created_at
      )
      VALUES (
        ${nanoid()},
        ${podcastId},
        'This podcast discusses the latest developments in artificial intelligence and machine learning technologies. The conversation covers various applications of AI in different industries and explores how these technologies are transforming our daily lives.',
        '["AI and technology overview", "Machine learning applications", "Industry transformation", "Future of artificial intelligence"]',
        '{"zh": "这个播客讨论了人工智能和机器学习技术的最新发展。对话涵盖了人工智能在不同行业的各种应用，并探讨了这些技术如何改变我们的日常生活。"}',
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
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