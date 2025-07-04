import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { savePodcast } from '../../../lib/db';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
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

    console.log('Attempting to upload file:', filename);
    console.log('File type:', file.type);
    console.log('File size:', file.size);
    console.log('isPublic:', isPublic);

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
      isPublic
    });

    if (!dbResult.success) {
      console.error('Error saving to database:', dbResult.error);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to save podcast' 
      }, { status: 500 });
    }

    // 为向后兼容，仍然返回所有信息，让客户端可以缓存在localStorage中
    return NextResponse.json({ 
      success: true,
      data: {
        id, 
        blobUrl,
        fileName: file.name,
        fileSize
      }
    }, { status: 200 });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to upload file' 
    }, { status: 500 });
  }
} 