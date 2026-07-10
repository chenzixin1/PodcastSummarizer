import { NextRequest, NextResponse, after } from 'next/server';
import { nanoid } from 'nanoid';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { Blob } from 'buffer';
import { triggerWorkerProcessing } from '../../../lib/workerTrigger';
import { fetchYoutubeSrtViaApify, ApifyTranscriptError } from '../../../lib/apifyTranscript';
import { resolveFilePodcastTitle, resolveYoutubePodcastTitle } from '../../../lib/podcastTitle';
import { createPodcastFromSrt, PodcastUploadError } from '../../../lib/podcastUploadPipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const UPLOAD_DEBUG_ENABLED = process.env.UPLOAD_DEBUG_LOGS === 'true';
function uploadDebug(...args: unknown[]) {
  if (!UPLOAD_DEBUG_ENABLED) {
    return;
  }
  console.log(...args);
}

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
  const channelNameRaw = formData.get('channelName');
  const channelName = typeof channelNameRaw === 'string' ? channelNameRaw.trim().slice(0, 80) : '';
  const sourcePublishedAtRaw = formData.get('sourcePublishedAt');
  const sourcePublishedAt =
    typeof sourcePublishedAtRaw === 'string' && sourcePublishedAtRaw.trim()
      ? sourcePublishedAtRaw.trim().slice(0, 40)
      : null;

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
      uploadDebug('[UPLOAD] Resolving transcript from YouTube URL via APIFY', youtubeUrl);
      const youtubeResult = await fetchYoutubeSrtViaApify(youtubeUrl);

      file = createFileFromText(youtubeResult.srtContent, `${youtubeResult.videoId}.srt`);
      youtubeIngestMeta = {
        source: youtubeResult.source,
        videoId: youtubeResult.videoId,
        entries: youtubeResult.entries,
      };
      youtubeVideoTitle = youtubeResult.title;

      uploadDebug('[UPLOAD] YouTube transcript resolved', {
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
    const title = youtubeIngestMeta
      ? resolveYoutubePodcastTitle({
          videoTitle: youtubeVideoTitle,
          videoId: youtubeIngestMeta.videoId,
        })
      : resolveFilePodcastTitle(file.name);

    const isPublicRaw = formData.get('isPublic');
    const isPublic = String(isPublicRaw) === 'true';

    const userId = session.user.id;

    uploadDebug('[UPLOAD] Start upload:', { id, filename: `${id}-${file.name}`, title, isPublic });

    const result = await createPodcastFromSrt({
      id,
      title,
      originalFileName: file.name,
      srtContent: file,
      sourceReference,
      sourcePublishedAt,
      tags: channelName ? [channelName] : undefined,
      isPublic,
      userId,
      contentType: file.type || 'application/x-subrip',
    });

    if (result.processingQueued) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[UPLOAD] Failed to trigger worker:', triggerResult.error);
        }
      });
    } else {
      console.error('[UPLOAD] enqueueProcessingJob failed:', result.queueError);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id,
          blobUrl: result.blobUrl,
          fileName: file.name,
          fileSize: result.fileSize,
          userId,
          remainingCredits: result.remainingCredits,
          processingQueued: result.processingQueued,
          queueError: result.queueError,
          youtubeIngest: youtubeIngestMeta,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof PodcastUploadError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

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
