import { savePodcastWithCreditDeduction } from './db';
import { deleteObject, uploadObject } from './objectStorage';
import { enqueueProcessingJob, type ProcessingJob } from './processingJobs';

type SrtUploadBody = File | Blob | Buffer | Uint8Array | ArrayBuffer | string;

export type PodcastUploadErrorCode =
  | 'UPLOAD_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'USER_NOT_FOUND'
  | 'SAVE_FAILED';

export class PodcastUploadError extends Error {
  code: PodcastUploadErrorCode;
  status: number;
  details?: string;

  constructor(code: PodcastUploadErrorCode, status: number, message: string, details?: string) {
    super(message);
    this.name = 'PodcastUploadError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface CreatePodcastFromSrtInput {
  id: string;
  title: string;
  originalFileName: string;
  srtContent: SrtUploadBody;
  sourceReference: string | null;
  sourcePublishedAt?: string | null;
  tags?: string[];
  isPublic: boolean;
  userId: string;
  objectKey?: string;
  contentType?: string;
}

export interface CreatePodcastFromSrtResult {
  id: string;
  blobUrl: string;
  objectKey: string;
  originalFileName: string;
  fileSize: string;
  remainingCredits: number | null;
  processingQueued: boolean;
  processingJob: ProcessingJob | null;
  queueError: string | null;
}

function byteLength(value: SrtUploadBody): number {
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8');
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  if (typeof value === 'object' && value && 'size' in value && typeof value.size === 'number') {
    return value.size;
  }
  return 0;
}

function fileSizeLabel(value: SrtUploadBody): string {
  return `${(byteLength(value) / 1024).toFixed(2)} KB`;
}

function saveErrorToUploadError(errorCode: string | undefined, error: string | undefined): PodcastUploadError {
  if (errorCode === 'INSUFFICIENT_CREDITS') {
    return new PodcastUploadError('INSUFFICIENT_CREDITS', 402, '积分不足，无法继续转换 SRT。', error);
  }
  if (errorCode === 'USER_NOT_FOUND') {
    return new PodcastUploadError('USER_NOT_FOUND', 404, 'User not found.', error);
  }
  return new PodcastUploadError('SAVE_FAILED', 500, 'Failed to save podcast.', error);
}

export async function createPodcastFromSrt(input: CreatePodcastFromSrtInput): Promise<CreatePodcastFromSrtResult> {
  const objectKey = input.objectKey || `${input.id}-${input.originalFileName}`;
  let blobUrl: string | null = null;

  try {
    const object = await uploadObject(objectKey, input.srtContent, {
      contentType: input.contentType || 'application/x-subrip',
    });
    blobUrl = object.url;
    const fileSize = fileSizeLabel(input.srtContent);

    const savePayload = {
      id: input.id,
      title: input.title,
      originalFileName: input.originalFileName,
      fileSize,
      blobUrl,
      sourceReference: input.sourceReference,
      sourcePublishedAt: input.sourcePublishedAt ?? null,
      tags: input.tags,
      isPublic: input.isPublic,
      userId: input.userId,
    };

    const saveResult = await savePodcastWithCreditDeduction(savePayload);

    if (!saveResult.success) {
      await deleteObject(blobUrl).catch((deleteError) => {
        console.error('[UPLOAD_PIPELINE] Failed to delete orphaned object:', deleteError);
      });
      throw saveErrorToUploadError(saveResult.errorCode, saveResult.error);
    }

    const queueResult = await enqueueProcessingJob(input.id);
    return {
      id: input.id,
      blobUrl,
      objectKey: object.key,
      originalFileName: input.originalFileName,
      fileSize,
      remainingCredits: (saveResult.data as { remainingCredits?: number } | undefined)?.remainingCredits ?? null,
      processingQueued: queueResult.success,
      processingJob: queueResult.success ? queueResult.data || null : null,
      queueError: queueResult.success ? null : queueResult.error || 'Failed to queue processing.',
    };
  } catch (error) {
    if (error instanceof PodcastUploadError) {
      throw error;
    }
    throw new PodcastUploadError(
      'UPLOAD_FAILED',
      502,
      'Failed to store uploaded transcript.',
      error instanceof Error ? error.message : String(error),
    );
  }
}
