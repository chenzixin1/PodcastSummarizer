import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { savePodcast } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  // 验证用户认证
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ 
      success: false, 
      error: 'Authentication required' 
    }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ 
      success: false, 
      error: 'No file uploaded' 
    }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ 
      success: false, 
      error: 'File is empty' 
    }, { status: 400 });
  }

  if (file.type !== 'application/x-subrip' && !file.name.endsWith('.srt')) {
    return NextResponse.json({ 
      success: false, 
      error: 'Invalid file type. Only .srt files are allowed.' 
    }, { status: 400 });
  }

  try {
    const id = nanoid();
    const filename = `${id}-${file.name}`;
    const fileSize = `${(file.size / 1024).toFixed(2)} KB`;
    const title = `Transcript Analysis: ${file.name.split('.')[0]}`;

    // 读取 isPublic 字段
    const isPublicRaw = formData.get('isPublic');
    const isPublic = String(isPublicRaw) === 'true';

    // 获取用户ID
    const userId = session.user.id;

    console.log('[UPLOAD] Start upload:', { id, filename, fileSize, title, isPublic, userId });

    // 检查Blob存储令牌是否配置
    let blobUrl = '#mock-blob-url';
    
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      // 上传到Vercel Blob
      const blob = await put(filename, file, {
        access: 'public',
      });
      blobUrl = blob.url;
      console.log('[UPLOAD] File uploaded to blob:', blobUrl);
    } else {
      console.warn('[UPLOAD] BLOB_READ_WRITE_TOKEN not configured, using mock storage');
    }

    // 保存到数据库，包含用户ID
    const dbResult = await savePodcast({
      id,
      title,
      originalFileName: file.name,
      fileSize,
      blobUrl,
      isPublic,
      userId // 添加用户ID
    });
    console.log('[UPLOAD] savePodcast result:', dbResult);

    if (!dbResult.success) {
      console.error('[UPLOAD] Error saving to database:', dbResult.error);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to save podcast',
        details: dbResult.error
      }, { status: 500 });
    }

    // 为向后兼容，仍然返回所有信息，让客户端可以缓存在localStorage中
    return NextResponse.json({ 
      success: true,
      data: {
        id, 
        blobUrl,
        fileName: file.name,
        fileSize,
        userId
      }
    }, { status: 200 });
  } catch (error) {
    console.error('[UPLOAD] Error uploading file:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to upload file',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 