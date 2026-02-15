import { NextRequest, NextResponse, after } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { savePodcastWithCreditDeduction } from '../../../lib/db';
import { enqueueProcessingJob } from '../../../lib/processingJobs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { Blob } from 'buffer';
import { triggerWorkerProcessing } from '../../../lib/workerTrigger';
import { fetchYoutubeSrtViaApify, ApifyTranscriptError } from '../../../lib/apifyTranscript';
import { resolveFilePodcastTitle, resolveYoutubePodcastTitle } from '../../../lib/podcastTitle';

export const runtime = 'nodejs';
export const maxDuration = 300;

function createFileFromText(content: string, filename: string): File {
  const buffer = Buffer.from(content, 'utf8');
  if (typeof File !== 'undefined') {
    return new File([buffer], filename, { type: 'application/x-subrip' });
  }
  const blob = new Blob([buffer], { type: 'application/x-subrip' }) as Blob & { name: string };
  blob.name = filename;
  return blob as unknown as File;
}

function statusForApifyIngestError(error: ApifyTranscriptError): number {
  return error.status;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        success: false,
        error: 'Authentication required',
      },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  let file = formData.get('file') as File | null;
  const youtubeUrlRaw = formData.get('youtubeUrl') as string | null;
  const youtubeUrl = (youtubeUrlRaw || '').trim();
  const sourceReferenceRaw = formData.get('sourceReference');
  const sourceReference =
    typeof sourceReferenceRaw === 'string' && sourceReferenceRaw.trim() ? sourceReferenceRaw.trim() : youtubeUrl || null;

  let youtubeIngestMeta:
    | {
        source: 'apify_text_with_timestamps';
        videoId: string;
        entries: number;
      }
    | undefined;
  let youtubeVideoTitle: string | undefined;

  if (!file && youtubeUrl) {
    try {
      console.log('[UPLOAD] Resolving transcript from YouTube URL via APIFY', youtubeUrl);
      const youtubeResult = await fetchYoutubeSrtViaApify(youtubeUrl);

      file = createFileFromText(youtubeResult.srtContent, `${youtubeResult.videoId}.srt`);
      youtubeIngestMeta = {
        source: youtubeResult.source,
        videoId: youtubeResult.videoId,
        entries: youtubeResult.entries,
      };
      youtubeVideoTitle = youtubeResult.title;

      console.log('[UPLOAD] YouTube transcript resolved', {
        source: youtubeResult.source,
        videoId: youtubeResult.videoId,
        entries: youtubeResult.entries,
      });
    } catch (error) {
      if (error instanceof ApifyTranscriptError) {
        console.error('[UPLOAD] YouTube ingest failed:', {
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          { status: statusForApifyIngestError(error) },
        );
      }

      console.error('[UPLOAD] Unexpected YouTube ingest error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to process YouTube URL',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }

  if (!file) {
    return NextResponse.json(
      {
        success: false,
        error: 'No file uploaded',
      },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'File is empty',
      },
      { status: 400 },
    );
  }

  if (file.type !== 'application/x-subrip' && !file.name.endsWith('.srt')) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid file type. Only .srt files are allowed.',
      },
      { status: 400 },
    );
  }

  try {
    const id = nanoid();
    const filename = `${id}-${file.name}`;
    const fileSize = `${(file.size / 1024).toFixed(2)} KB`;
    const title = youtubeIngestMeta
      ? resolveYoutubePodcastTitle({
          videoTitle: youtubeVideoTitle,
          videoId: youtubeIngestMeta.videoId,
        })
      : resolveFilePodcastTitle(file.name);

    const isPublicRaw = formData.get('isPublic');
    const isPublic = String(isPublicRaw) === 'true';

    const userId = session.user.id;

    console.log('[UPLOAD] Start upload:', { id, filename, fileSize, title, isPublic, userId });

    let blobUrl = '#mock-blob-url';

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, file, {
        access: 'public',
      });
      blobUrl = blob.url;
      console.log('[UPLOAD] File uploaded to blob:', blobUrl);
    } else {
      console.warn('[UPLOAD] BLOB_READ_WRITE_TOKEN not configured, using mock storage');
    }

    const dbResult = await savePodcastWithCreditDeduction({
      id,
      title,
      originalFileName: file.name,
      fileSize,
      blobUrl,
      sourceReference,
      isPublic,
      userId,
    });
    console.log('[UPLOAD] savePodcast result:', dbResult);

    if (!dbResult.success) {
      if (dbResult.errorCode === 'INSUFFICIENT_CREDITS') {
        return NextResponse.json(
          {
            success: false,
            code: 'INSUFFICIENT_CREDITS',
            error: '积分不足，无法继续转换 SRT。',
          },
          { status: 402 },
        );
      }
      console.error('[UPLOAD] Error saving to database:', dbResult.error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to save podcast',
          details: dbResult.error,
        },
        { status: 500 },
      );
    }

    const queueResult = await enqueueProcessingJob(id);
    if (!queueResult.success) {
      console.error('[UPLOAD] enqueueProcessingJob failed:', queueResult.error);
    } else {
      console.log('[UPLOAD] Processing job queued:', queueResult.data?.status);
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[UPLOAD] Failed to trigger worker:', triggerResult.error);
        }
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id,
          blobUrl,
          fileName: file.name,
          fileSize,
          userId,
          remainingCredits: (dbResult.data as { remainingCredits?: number } | undefined)?.remainingCredits ?? null,
          processingQueued: queueResult.success,
          youtubeIngest: youtubeIngestMeta,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[UPLOAD] Error uploading file:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to upload file',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
