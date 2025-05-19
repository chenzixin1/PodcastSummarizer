import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { savePodcast } from '../../../lib/db';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (request.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.type !== 'application/x-subrip' && !file.name.endsWith('.srt')) {
    return NextResponse.json({ error: 'Invalid file type. Only .srt files are allowed.' }, { status: 400 });
  }

  try {
    const id = nanoid();
    const filename = `${id}-${file.name}`;
    const fileSize = `${(file.size / 1024).toFixed(2)} KB`;
    const title = `Transcript Analysis: ${file.name.split('.')[0]}`;

    console.log('Attempting to upload file:', filename);
    console.log('File type:', file.type);
    console.log('File size:', file.size);

    // 检查Blob存储令牌是否配置
    let blobUrl = '#mock-blob-url';
    
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      // 上传到Vercel Blob
      const blob = await put(filename, file, {
        access: 'public',
      });
      blobUrl = blob.url;
      console.log('File uploaded successfully, URL:', blob.url);
    } else {
      console.warn('BLOB_READ_WRITE_TOKEN not configured, using mock storage');
    }

    // 保存到数据库
    const dbResult = await savePodcast({
      id,
      title,
      originalFileName: file.name,
      fileSize,
      blobUrl,
      isPublic: false // 默认不公开
    });

    if (!dbResult.success) {
      console.error('Error saving to database:', dbResult.error);
      // 即使数据库保存失败，我们也继续返回ID和URL，这样仍然可以在客户端缓存处理
    }

    // 为向后兼容，仍然返回所有信息，让客户端可以缓存在localStorage中
    return NextResponse.json({ 
      id, 
      blobUrl,
      fileName: file.name,
      fileSize
    }, { status: 200 });
  } catch (error) {
    console.error('Error uploading file:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: 'Failed to upload file.', details: errorMessage }, { status: 500 });
  }
} 