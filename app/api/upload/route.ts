import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { savePodcast } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { YoutubeTranscript } from 'youtube-transcript';
import { Blob } from 'buffer';

function createFileFromText(content: string, filename: string): File {
  const buffer = Buffer.from(content, 'utf8');
  if (typeof File !== 'undefined') {
    return new File([buffer], filename, { type: 'application/x-subrip' });
  }
  const blob: any = new Blob([buffer], { type: 'application/x-subrip' });
  blob.name = filename;
  blob.size = buffer.length;
  return blob as File;
}

function formatTime(seconds: number): string {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
  const ms = String(Math.floor((seconds % 1) * 1000)).padStart(3, '0');
  return `${hrs}:${mins}:${secs},${ms}`;
}

function extractVideoId(url: string): string {
  const match = url.match(/(?:v=|be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : url;
}

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
  let file = formData.get('file') as File | null;
  const youtubeUrl = formData.get('youtubeUrl') as string | null;

  if (!file && youtubeUrl) {
    try {
      console.log('[UPLOAD] Fetching subtitles from YouTube', youtubeUrl);
      let transcript = await YoutubeTranscript.fetchTranscript(youtubeUrl, { lang: 'zh-Hans' }).catch(err => {
        console.error('[UPLOAD] zh-Hans subtitle fetch failed:', err);
        return [];
      });
      if (!transcript || transcript.length === 0) {
        console.warn('[UPLOAD] zh-Hans subtitles not found, trying English');
        transcript = await YoutubeTranscript.fetchTranscript(youtubeUrl, { lang: 'en' }).catch(err => {
          console.error('[UPLOAD] en subtitle fetch failed:', err);
          return [];
        });
      }
      if (!transcript || transcript.length === 0) {
        console.error('[UPLOAD] No subtitles available for', youtubeUrl);
        return NextResponse.json(
          { success: false, error: 'No subtitles found on YouTube for the provided URL.' },
          { status: 400 }
        );
      }

      const srtContent = transcript
        .map((item, idx) => {
          const start = formatTime(item.offset);
          const end = formatTime(item.offset + item.duration);
          const text = item.text.replace(/\n/g, ' ');
          return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
        })
        .join('\n');

      const videoId = extractVideoId(youtubeUrl);
      console.log('[UPLOAD] Subtitle fetched, building file for videoId:', videoId);
      file = createFileFromText(srtContent, `${videoId}.srt`);
    } catch (err) {
      console.error('[UPLOAD] Error fetching YouTube subtitles:', err);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch YouTube subtitles',
          details: err instanceof Error ? err.message : String(err)
        },
        { status: 500 }
      );
    }
  }

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