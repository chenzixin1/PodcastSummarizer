# PodSum Core Ingest Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PodSum's SRT/YouTube ingestion path consistent, observable, and recoverable across web upload, Chrome extension upload, MCP upload, R2 storage, D1 records, and background processing.

**Architecture:** Keep storage, database save, queueing, and worker triggering as separate responsibilities, but route all upload endpoints through one small shared finalize layer. Verify R2 writes before returning a URL, surface queue failures explicitly, and add an integrity audit so production cannot silently accumulate D1 rows whose objects are missing.

**Tech Stack:** Next.js 15.5.18 App Router, React 19, TypeScript 5, Jest 29, Cloudflare Workers/OpenNext, Cloudflare R2, Cloudflare D1, NextAuth 4, APIFY transcript actor, Wrangler 4.98.0.

## Global Constraints

- Do not deploy from the current dirty worktree; create or use a clean branch/worktree before execution.
- Preserve the production domains `https://podsum.cc` and `https://www.podsum.cc`.
- Preserve Cloudflare bindings from `wrangler.jsonc`: `PODSUM_BUCKET` and `PODSUM_DB`.
- Use Node 22+ when invoking Wrangler; Node 20.19.6 is not sufficient for Wrangler 4.98.0.
- Do not print secrets from `.env.vercel.production`, Wrangler OAuth config, or API keys.
- Do not change dashboard UX, admin UX, or Chrome extension UI except for upload status surfaces named in this plan.
- Do not rewrite `app/dashboard/[id]/page.tsx`, `lib/db.ts`, or `app/api/process/route.ts` wholesale in this plan; those are separate follow-up refactor plans.
- If queueing fails after a podcast row is saved, do not delete the podcast row with `deletePodcast()` because that function does not refund the upload credit.

---

## Review Findings

1. `uploadObject()` previously trusted `PODSUM_BUCKET.put()` without verifying that the object could be read back. That allowed the observed production state: D1 row exists, `blob_url` points at `/api/files/...`, but R2 returns 404.
2. Upload finalization logic is duplicated in `app/api/upload/route.ts`, `app/api/extension/upload-youtube/route.ts`, `app/api/extension/upload-srt/route.ts`, `app/api/extension/transcribe-status/[jobId]/route.ts`, and `app/mcp/route.ts`.
3. Queue failures are logged but still returned as successful uploads. This is recoverable because dashboard can enqueue, but it is currently too easy for callers to miss `processingQueued: false`.
4. `lib/db.ts`, `app/api/process/route.ts`, and `app/dashboard/[id]/page.tsx` are too large to safely refactor in the same change as ingestion reliability.
5. Production diagnostics need an object integrity audit because Worker invocation metrics can show success while application-level queue/object failures are stored only in D1 or console logs.

## File Structure

- Modify `lib/objectStorage.ts`: enforce R2 write-read verification and keep the existing URL/key contract.
- Create `__tests__/lib/objectStorage.test.ts`: test the R2 write verification contract.
- Create `lib/podcastUploadPipeline.ts`: shared upload finalization helper that uploads verified SRT content, saves the podcast row with credit deduction, queues processing, and returns an explicit queue state.
- Create `__tests__/lib/podcastUploadPipeline.test.ts`: unit tests for successful finalize, DB save cleanup, and queue failure visibility.
- Modify `app/api/upload/route.ts`: web upload route uses `createPodcastFromSrt()` instead of local upload/save/queue code.
- Modify `app/api/extension/upload-youtube/route.ts`: extension YouTube path uses the shared helper and preserves monitor events.
- Modify `app/api/extension/upload-srt/route.ts`: extension direct SRT path uses the shared helper and preserves monitor events.
- Modify `app/mcp/route.ts`: MCP YouTube submit path uses the shared helper and returns the same queue result shape.
- Modify `app/upload/page.tsx`: web upload page records a session warning when `processingQueued === false`.
- Create `scripts/audit-podcast-ingest-integrity.mjs`: production-safe D1/R2 URL integrity audit.
- Modify `package.json`: add `audit:podcast-integrity`.

---

### Task 1: Storage Write Verification

**Files:**
- Modify: `lib/objectStorage.ts:98-117`
- Create: `__tests__/lib/objectStorage.test.ts`

**Interfaces:**
- Consumes: `uploadObject(key, value, options)` existing signature.
- Produces: `uploadObject()` only returns after `PODSUM_BUCKET.get(safeKey)` succeeds for R2 writes.

- [ ] **Step 1: Write the failing storage verification test**

Create `__tests__/lib/objectStorage.test.ts`:

```ts
/**
 * @jest-environment node
 */

const mockGetCloudflareContext = jest.fn();

jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mockGetCloudflareContext,
}));

describe('objectStorage', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it('verifies an R2 object is readable before returning a successful upload', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: 'application/x-subrip' },
    });

    mockGetCloudflareContext.mockResolvedValue({
      env: {
        PODSUM_BUCKET: {
          put,
          get,
          delete: jest.fn(),
        },
        NEXTAUTH_URL: 'https://podsum.cc',
      },
    });

    const { uploadObject } = await import('../../lib/objectStorage');
    const result = await uploadObject('podcast 123/test.srt', 'hello', {
      contentType: 'application/x-subrip',
    });

    expect(put).toHaveBeenCalledWith(
      'podcast_123/test.srt',
      'hello',
      expect.objectContaining({
        httpMetadata: { contentType: 'application/x-subrip' },
      }),
    );
    expect(get).toHaveBeenCalledWith('podcast_123/test.srt');
    expect(result).toEqual({
      key: 'podcast_123/test.srt',
      provider: 'r2',
      url: 'https://podsum.cc/api/files/podcast_123/test.srt',
    });
  });

  it('fails the upload when R2 write verification cannot read the object', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockResolvedValue(null);

    mockGetCloudflareContext.mockResolvedValue({
      env: {
        PODSUM_BUCKET: {
          put,
          get,
          delete: jest.fn(),
        },
        NEXTAUTH_URL: 'https://podsum.cc',
      },
    });

    const { uploadObject } = await import('../../lib/objectStorage');

    await expect(uploadObject('missing.srt', 'hello')).rejects.toThrow(
      'Object storage write verification failed for key: missing.srt',
    );
    expect(put).toHaveBeenCalledWith(
      'missing.srt',
      'hello',
      expect.objectContaining({
        httpMetadata: { contentType: undefined },
      }),
    );
    expect(get).toHaveBeenCalledWith('missing.srt');
  });
});
```

- [ ] **Step 2: Run the storage test to verify it fails before implementation**

Run:

```bash
npm test -- --runInBand __tests__/lib/objectStorage.test.ts
```

Expected before implementation: FAIL because `PODSUM_BUCKET.get()` is not called after `PODSUM_BUCKET.put()`.

- [ ] **Step 3: Add R2 read-after-write verification**

In `lib/objectStorage.ts`, update the R2 branch of `uploadObject()` to:

```ts
  if (env?.PODSUM_BUCKET) {
    await env.PODSUM_BUCKET.put(safeKey, await toUploadBody(value), {
      httpMetadata: {
        contentType: options.contentType || (typeof value === 'object' && 'type' in value ? String(value.type || '') : undefined),
      },
    });
    const storedObject = await env.PODSUM_BUCKET.get(safeKey);
    if (!storedObject) {
      throw new Error(`Object storage write verification failed for key: ${safeKey}`);
    }
    return {
      key: safeKey,
      provider: 'r2',
      url: objectUrlForKey(safeKey, env),
    };
  }
```

- [ ] **Step 4: Run the storage test to verify it passes**

Run:

```bash
npm test -- --runInBand __tests__/lib/objectStorage.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run upload API tests to verify existing upload behavior still passes**

Run:

```bash
npm test -- --runInBand __tests__/api/upload.test.ts
```

Expected: PASS, existing upload API tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/objectStorage.ts __tests__/lib/objectStorage.test.ts
git commit -m "fix: verify r2 uploads before saving podcast urls"
```

---

### Task 2: Shared Podcast Upload Pipeline

**Files:**
- Create: `lib/podcastUploadPipeline.ts`
- Create: `__tests__/lib/podcastUploadPipeline.test.ts`

**Interfaces:**
- Consumes: `uploadObject()`, `deleteObject()`, `savePodcastWithCreditDeduction()`, `enqueueProcessingJob()`.
- Produces: `createPodcastFromSrt(input: CreatePodcastFromSrtInput): Promise<CreatePodcastFromSrtResult>` and `PodcastUploadError`.

- [ ] **Step 1: Write the failing pipeline tests**

Create `__tests__/lib/podcastUploadPipeline.test.ts`:

```ts
/**
 * @jest-environment node
 */

import { createPodcastFromSrt, PodcastUploadError } from '../../lib/podcastUploadPipeline';
import { savePodcastWithCreditDeduction } from '../../lib/db';
import { deleteObject, uploadObject } from '../../lib/objectStorage';
import { enqueueProcessingJob } from '../../lib/processingJobs';

jest.mock('../../lib/db', () => ({
  savePodcastWithCreditDeduction: jest.fn(),
}));

jest.mock('../../lib/objectStorage', () => ({
  deleteObject: jest.fn(),
  uploadObject: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  enqueueProcessingJob: jest.fn(),
}));

const mockSavePodcastWithCreditDeduction = savePodcastWithCreditDeduction as jest.Mock;
const mockDeleteObject = deleteObject as jest.Mock;
const mockUploadObject = uploadObject as jest.Mock;
const mockEnqueueProcessingJob = enqueueProcessingJob as jest.Mock;

const baseInput = {
  id: 'podcast-123',
  title: 'Jensen Huang: Why companies need open agent systems',
  originalFileName: 'Yy3JH6dDugc.srt',
  srtContent: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nhello', 'utf8'),
  sourceReference: 'https://www.youtube.com/watch?v=Yy3JH6dDugc',
  sourcePublishedAt: null,
  tags: ['Jensen'],
  isPublic: true,
  userId: 'user-123',
};

describe('podcastUploadPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadObject.mockResolvedValue({
      key: 'podcast-123-Yy3JH6dDugc.srt',
      provider: 'r2',
      url: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
    });
    mockSavePodcastWithCreditDeduction.mockResolvedValue({
      success: true,
      data: { id: 'podcast-123', remainingCredits: 9 },
    });
    mockEnqueueProcessingJob.mockResolvedValue({
      success: true,
      data: { podcastId: 'podcast-123', status: 'queued' },
    });
    mockDeleteObject.mockResolvedValue(undefined);
  });

  it('stores a verified SRT, saves the podcast row, and queues processing', async () => {
    const result = await createPodcastFromSrt(baseInput);

    expect(mockUploadObject).toHaveBeenCalledWith(
      'podcast-123-Yy3JH6dDugc.srt',
      baseInput.srtContent,
      { contentType: 'application/x-subrip' },
    );
    expect(mockSavePodcastWithCreditDeduction).toHaveBeenCalledWith({
      id: 'podcast-123',
      title: 'Jensen Huang: Why companies need open agent systems',
      originalFileName: 'Yy3JH6dDugc.srt',
      fileSize: '0.04 KB',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
      sourceReference: 'https://www.youtube.com/watch?v=Yy3JH6dDugc',
      sourcePublishedAt: null,
      tags: ['Jensen'],
      isPublic: true,
      userId: 'user-123',
    });
    expect(mockEnqueueProcessingJob).toHaveBeenCalledWith('podcast-123');
    expect(result).toEqual({
      id: 'podcast-123',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
      objectKey: 'podcast-123-Yy3JH6dDugc.srt',
      originalFileName: 'Yy3JH6dDugc.srt',
      fileSize: '0.04 KB',
      remainingCredits: 9,
      processingQueued: true,
      processingJob: { podcastId: 'podcast-123', status: 'queued' },
      queueError: null,
    });
  });

  it('deletes the uploaded object when saving the podcast row fails', async () => {
    mockSavePodcastWithCreditDeduction.mockResolvedValueOnce({
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      error: 'Insufficient credits.',
    });

    await expect(createPodcastFromSrt(baseInput)).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
      message: '积分不足，无法继续转换 SRT。',
    });
    expect(mockDeleteObject).toHaveBeenCalledWith('https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt');
  });

  it('returns a recoverable queue failure without deleting the saved podcast row', async () => {
    mockEnqueueProcessingJob.mockResolvedValueOnce({
      success: false,
      error: 'D1 insert failed',
    });

    const result = await createPodcastFromSrt(baseInput);

    expect(result.processingQueued).toBe(false);
    expect(result.queueError).toBe('D1 insert failed');
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('classifies storage failures before any podcast row is saved', async () => {
    mockUploadObject.mockRejectedValueOnce(new Error('Object storage write verification failed for key: podcast-123-Yy3JH6dDugc.srt'));
    const promise = createPodcastFromSrt(baseInput);

    await expect(promise).rejects.toBeInstanceOf(PodcastUploadError);
    await expect(promise).rejects.toMatchObject({
      code: 'UPLOAD_FAILED',
      status: 502,
    });
    expect(mockSavePodcastWithCreditDeduction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the pipeline test to verify it fails before implementation**

Run:

```bash
npm test -- --runInBand __tests__/lib/podcastUploadPipeline.test.ts
```

Expected before implementation: FAIL because `lib/podcastUploadPipeline.ts` does not exist.

- [ ] **Step 3: Create the shared upload pipeline**

Create `lib/podcastUploadPipeline.ts`:

```ts
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

    const saveResult = await savePodcastWithCreditDeduction({
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
    });

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
```

- [ ] **Step 4: Run the pipeline test to verify it passes**

Run:

```bash
npm test -- --runInBand __tests__/lib/podcastUploadPipeline.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run TypeScript**

Run:

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/podcastUploadPipeline.ts __tests__/lib/podcastUploadPipeline.test.ts
git commit -m "refactor: centralize podcast upload finalization"
```

---

### Task 3: Migrate Web Upload Route

**Files:**
- Modify: `app/api/upload/route.ts:1-255`
- Modify: `__tests__/api/upload.test.ts`
- Modify: `app/upload/page.tsx:122-145`

**Interfaces:**
- Consumes: `createPodcastFromSrt()` and `PodcastUploadError` from Task 2.
- Produces: `/api/upload` response shape remains `{ success: true, data: { id, blobUrl, fileName, fileSize, userId, remainingCredits, processingQueued, queueError, youtubeIngest } }`.

- [ ] **Step 1: Update upload route imports**

In `app/api/upload/route.ts`, keep the existing first import:

```ts
import { NextRequest, NextResponse, after } from 'next/server';
```

Remove these imports:

```ts
import { savePodcastWithCreditDeduction } from '../../../lib/db';
import { enqueueProcessingJob } from '../../../lib/processingJobs';
import { deleteObject, uploadObject } from '../../../lib/objectStorage';
```

Keep this import:

```ts
import { triggerWorkerProcessing } from '../../../lib/workerTrigger';
```

Add:

```ts
import { createPodcastFromSrt, PodcastUploadError } from '../../../lib/podcastUploadPipeline';
```

Keep the existing `NextRequest`, `NextResponse`, `nanoid`, auth, APIFY, title, and `Blob` imports.

- [ ] **Step 2: Replace local upload/save/queue code with the pipeline**

In `app/api/upload/route.ts`, replace the body of the `try` block beginning at `const id = nanoid();` with:

```ts
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
```

- [ ] **Step 3: Add typed upload error handling**

In the `catch` block of `app/api/upload/route.ts`, before the generic 500 response, add:

```ts
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
```

- [ ] **Step 4: Update upload API tests to mock the pipeline**

In `__tests__/api/upload.test.ts`, replace the `lib/objectStorage`, `lib/db`, and `lib/processingJobs` mocks for route finalization with:

```ts
jest.mock('../../lib/podcastUploadPipeline', () => {
  class MockPodcastUploadError extends Error {
    code: string;
    status: number;
    details?: string;

    constructor(code: string, status: number, message: string, details?: string) {
      super(message);
      this.name = 'PodcastUploadError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  return {
    createPodcastFromSrt: jest.fn(),
    PodcastUploadError: MockPodcastUploadError,
  };
});
```

Set the default in `beforeEach()`:

```ts
const mockCreatePodcastFromSrt = jest.fn();

beforeEach(() => {
  require('../../lib/podcastUploadPipeline').createPodcastFromSrt = mockCreatePodcastFromSrt;
  mockCreatePodcastFromSrt.mockResolvedValue({
    id: 'mock-id-12345',
    blobUrl: 'https://podsum.cc/api/files/mock-id-12345-test.srt',
    objectKey: 'mock-id-12345-test.srt',
    originalFileName: 'test.srt',
    fileSize: '0.01 KB',
    remainingCredits: 9,
    processingQueued: true,
    processingJob: { podcastId: 'mock-id-12345', status: 'queued' },
    queueError: null,
  });
});
```

- [ ] **Step 5: Add queue failure visibility test**

Add this test to `__tests__/api/upload.test.ts`:

```ts
it('should return successful upload with explicit queue failure metadata', async () => {
  mockCreatePodcastFromSrt.mockResolvedValueOnce({
    id: 'mock-id-12345',
    blobUrl: 'https://podsum.cc/api/files/mock-id-12345-test.srt',
    objectKey: 'mock-id-12345-test.srt',
    originalFileName: 'test.srt',
    fileSize: '0.01 KB',
    remainingCredits: 9,
    processingQueued: false,
    processingJob: null,
    queueError: 'D1 insert failed',
  });

  const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
  const formData = new FormData();
  formData.append('file', file);

  const request = new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST',
    body: formData,
  });

  const response = await POST(request);
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.success).toBe(true);
  expect(data.data.processingQueued).toBe(false);
  expect(data.data.queueError).toBe('D1 insert failed');
  expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Record queue warning on the upload page**

In `app/upload/page.tsx`, after `const id = result?.data?.id as string | undefined;`, add:

```ts
      if (result?.data?.processingQueued === false) {
        window.sessionStorage.setItem(
          `podsum-upload-warning-${id}`,
          result?.data?.queueError || 'Upload saved, but processing was not queued automatically.',
        );
      }
```

- [ ] **Step 7: Run route and type tests**

Run:

```bash
npm test -- --runInBand __tests__/api/upload.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/upload/route.ts app/upload/page.tsx __tests__/api/upload.test.ts
git commit -m "refactor: route web uploads through shared ingest pipeline"
```

---

### Task 4: Migrate Extension And MCP Upload Endpoints

**Files:**
- Modify: `app/api/extension/upload-youtube/route.ts:195-318`
- Modify: `app/api/extension/upload-srt/route.ts:163-334`
- Modify: `app/api/extension/transcribe-status/[jobId]/route.ts:350-430`
- Modify: `app/mcp/route.ts:544-622`
- Modify: `__tests__/api/extension-upload-youtube.test.ts`
- Modify: `__tests__/api/mcp.test.ts`

**Interfaces:**
- Consumes: `createPodcastFromSrt()` from Task 2.
- Produces: Extension and MCP responses keep `processingQueued`, `queueError`, and `remainingCredits` with the same semantics as web upload.

- [ ] **Step 1: Update extension upload-youtube route**

In `app/api/extension/upload-youtube/route.ts`, replace direct `uploadObject()`, `savePodcastWithCreditDeduction()`, and `enqueueProcessingJob()` calls with:

```ts
    const result = await createPodcastFromSrt({
      id,
      title,
      originalFileName,
      srtContent: srtBuffer,
      sourceReference,
      isPublic,
      userId: user.id,
    });
    const blobUrl = result.blobUrl;

    if (result.processingQueued) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[EXT_UPLOAD_YOUTUBE] Failed to trigger worker:', triggerResult.error);
        }
      });
    }
```

Preserve monitor events by changing queue metadata to:

```ts
        status: result.processingQueued ? 'queued' : 'accepted',
        stage: result.processingQueued ? 'processing_queued' : 'response_sent',
```

and:

```ts
          queueSuccess: result.processingQueued,
          queueError: result.queueError,
```

- [ ] **Step 2: Update extension upload-srt route**

In `app/api/extension/upload-srt/route.ts`, replace the upload/save/queue block with:

```ts
    const result = await createPodcastFromSrt({
      id,
      title,
      originalFileName,
      srtContent: srtBuffer,
      sourceReference,
      isPublic,
      userId: user.id,
    });
    const blobUrl = result.blobUrl;

    if (result.processingQueued) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[EXTENSION_UPLOAD] Failed to trigger worker:', triggerResult.error);
        }
      });
    }
```

Return:

```ts
    return NextResponse.json({
      success: true,
      data: {
        podcastId: id,
        dashboardUrl: `${getAppBaseUrl(request)}/dashboard/${id}`,
        processingQueued: result.processingQueued,
        queueError: result.queueError,
        monitorTaskId,
        remainingCredits: result.remainingCredits,
      },
    });
```

- [ ] **Step 3: Update extension transcribe-status completion path**

In `app/api/extension/transcribe-status/[jobId]/route.ts`, after transcription has produced `srtBuffer`, call:

```ts
    const result = await createPodcastFromSrt({
      id: podcastId,
      title,
      originalFileName,
      srtContent: srtBuffer,
      sourceReference: job.sourceReference || null,
      isPublic: Boolean(job.isPublic),
      userId: job.userId,
    });
```

Use `result.blobUrl`, `result.processingQueued`, `result.queueError`, and `result.remainingCredits` in the existing response and monitor event bodies.

- [ ] **Step 4: Update MCP route**

In `app/mcp/route.ts`, replace the upload/save/queue block with:

```ts
  const result = await createPodcastFromSrt({
    id,
    title,
    originalFileName,
    srtContent: srtBuffer,
    sourceReference,
    sourcePublishedAt,
    tags: channelName ? [channelName] : undefined,
    isPublic,
    userId: context.userId,
  });

  if (result.processingQueued) {
    after(async () => {
      const triggerResult = await triggerWorkerProcessing('upload', id);
      if (!triggerResult.success) {
        console.error('[MCP] Failed to trigger worker:', triggerResult.error);
      }
    });
  }
```

Return:

```ts
    remainingCredits: result.remainingCredits,
    processingQueued: result.processingQueued,
    processingJob: result.processingJob,
    queueError: result.queueError,
```

- [ ] **Step 5: Convert tests to mock the shared helper**

In `__tests__/api/extension-upload-youtube.test.ts` and `__tests__/api/mcp.test.ts`, mock:

```ts
jest.mock('../../lib/podcastUploadPipeline', () => ({
  createPodcastFromSrt: jest.fn(),
  PodcastUploadError: class PodcastUploadError extends Error {
    code: string;
    status: number;
    details?: string;

    constructor(code: string, status: number, message: string, details?: string) {
      super(message);
      this.name = 'PodcastUploadError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));
```

Default helper result:

```ts
mockCreatePodcastFromSrt.mockResolvedValue({
  id: 'podcast-123',
  blobUrl: 'https://podsum.cc/api/files/podcast-123-I9aGC6Ui3eE.srt',
  objectKey: 'podcast-123-I9aGC6Ui3eE.srt',
  originalFileName: 'I9aGC6Ui3eE.srt',
  fileSize: '0.04 KB',
  remainingCredits: 9,
  processingQueued: true,
  processingJob: { podcastId: 'podcast-123', status: 'queued' },
  queueError: null,
});
```

- [ ] **Step 6: Run extension and MCP tests**

Run:

```bash
npm test -- --runInBand __tests__/api/extension-upload-youtube.test.ts __tests__/api/mcp.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/extension/upload-youtube/route.ts app/api/extension/upload-srt/route.ts app/api/extension/transcribe-status/[jobId]/route.ts app/mcp/route.ts __tests__/api/extension-upload-youtube.test.ts __tests__/api/mcp.test.ts
git commit -m "refactor: share upload finalization across ingest endpoints"
```

---

### Task 5: Production Ingest Integrity Audit

**Files:**
- Create: `scripts/audit-podcast-ingest-integrity.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Wrangler OAuth token from `/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml` or `CLOUDFLARE_API_TOKEN`.
- Produces: CLI report with `checked`, `missingObjects`, `missingJobs`, and `unprocessedWithoutJob` counts. Exit code `1` when any missing object is found.

- [ ] **Step 1: Create the audit script**

Create `scripts/audit-podcast-ingest-integrity.mjs`:

```js
import fs from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '29bbd7941ce035396dd966247e42c44f';
const databaseId = process.env.PRODUCTION_D1_DATABASE_ID || process.env.D1_DATABASE_ID || '5d0b65e0-d556-4aa4-953f-4d680d11c34a';
const baseUrl = (process.env.PRODUCTION_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const limit = Number.parseInt(process.env.PODSUM_INGEST_AUDIT_LIMIT || '100', 10);
const wranglerConfigPath =
  process.env.WRANGLER_OAUTH_CONFIG || '/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml';

function readCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }
  const text = fs.readFileSync(wranglerConfigPath, 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) {
    throw new Error(`Unable to read Wrangler OAuth token from ${wranglerConfigPath}`);
  }
  return token;
}

const cloudflareToken = readCloudflareToken();

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cloudflareToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(payload.errors || payload)}`);
  }
  return payload.result?.[0]?.results || [];
}

async function headOk(url) {
  const response = await fetch(url, { method: 'HEAD' });
  return {
    ok: response.ok,
    status: response.status,
  };
}

function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  if (url.startsWith('/api/files/')) {
    return `${baseUrl}${url}`;
  }
  return url;
}

const rows = await d1Query(
  `
  SELECT
    p.id,
    p.title,
    p.blob_url AS blobUrl,
    p.source_reference AS sourceReference,
    p.created_at AS createdAt,
    j.status AS jobStatus,
    a.podcast_id AS analysisPodcastId
  FROM podcasts p
  LEFT JOIN processing_jobs j ON j.podcast_id = p.id
  LEFT JOIN analysis_results a ON a.podcast_id = p.id
  ORDER BY p.created_at DESC
  LIMIT ?
  `,
  [limit],
);

const missingObjects = [];
const missingJobs = [];
const unprocessedWithoutJob = [];

for (const row of rows) {
  const blobUrl = normalizeUrl(row.blobUrl);
  const objectResult = blobUrl ? await headOk(blobUrl) : { ok: false, status: 0 };
  if (!objectResult.ok) {
    missingObjects.push({
      id: row.id,
      status: objectResult.status,
      blobUrl,
      title: row.title,
      sourceReference: row.sourceReference,
      createdAt: row.createdAt,
    });
  }
  if (!row.jobStatus) {
    missingJobs.push({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
    });
  }
  if (!row.analysisPodcastId && !row.jobStatus) {
    unprocessedWithoutJob.push({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
    });
  }
}

const report = {
  checked: rows.length,
  missingObjects,
  missingJobs,
  unprocessedWithoutJob,
};

console.log(JSON.stringify(report, null, 2));

if (missingObjects.length > 0) {
  process.exitCode = 1;
}
```

- [ ] **Step 2: Add package script**

In `package.json`, add:

```json
"audit:podcast-integrity": "node scripts/audit-podcast-ingest-integrity.mjs"
```

Place it near the existing Cloudflare verification scripts.

- [ ] **Step 3: Run audit locally against production**

Run:

```bash
PODSUM_INGEST_AUDIT_LIMIT=25 npm run audit:podcast-integrity
```

Expected after the repaired incident row: JSON report prints `checked: 25` and `missingObjects: []`.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-podcast-ingest-integrity.mjs package.json
git commit -m "chore: add podcast ingest integrity audit"
```

---

### Task 6: Final Verification And Deployment Gate

**Files:**
- Modify only files changed by Tasks 1-5.
- Do not stage unrelated dirty files.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a verified branch that is safe to review and deploy.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --runInBand \
  __tests__/lib/objectStorage.test.ts \
  __tests__/lib/podcastUploadPipeline.test.ts \
  __tests__/api/upload.test.ts \
  __tests__/api/extension-upload-youtube.test.ts \
  __tests__/api/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type-check**

Run:

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 3: Run lint on changed files**

Run:

```bash
npm run lint -- lib/objectStorage.ts lib/podcastUploadPipeline.ts app/api/upload/route.ts app/api/extension/upload-youtube/route.ts app/api/extension/upload-srt/route.ts app/api/extension/transcribe-status/[jobId]/route.ts app/mcp/route.ts app/upload/page.tsx
```

Expected: PASS or only pre-existing repository-wide lint warnings outside these files.

- [ ] **Step 4: Run production integrity audit**

Run:

```bash
PODSUM_INGEST_AUDIT_LIMIT=50 npm run audit:podcast-integrity
```

Expected: JSON report with `missingObjects: []`.

- [ ] **Step 5: Build Cloudflare bundle without deploying**

Run with Node 22+:

```bash
~/.nvm/versions/node/v22.21.1/bin/node ./node_modules/.bin/opennextjs-cloudflare build
```

Expected: build completes and `.open-next/` is regenerated.

- [ ] **Step 6: Review staged files only**

Run:

```bash
git status --short
git diff --staged --stat
```

Expected staged files include only:

```text
lib/objectStorage.ts
lib/podcastUploadPipeline.ts
__tests__/lib/objectStorage.test.ts
__tests__/lib/podcastUploadPipeline.test.ts
app/api/upload/route.ts
app/api/extension/upload-youtube/route.ts
app/api/extension/upload-srt/route.ts
app/api/extension/transcribe-status/[jobId]/route.ts
app/mcp/route.ts
app/upload/page.tsx
__tests__/api/upload.test.ts
__tests__/api/extension-upload-youtube.test.ts
__tests__/api/mcp.test.ts
scripts/audit-podcast-ingest-integrity.mjs
package.json
```

- [ ] **Step 7: Commit verification cleanup if needed**

If Task 6 changed only plan-approved files, run:

```bash
git add lib/objectStorage.ts lib/podcastUploadPipeline.ts __tests__/lib/objectStorage.test.ts __tests__/lib/podcastUploadPipeline.test.ts app/api/upload/route.ts app/api/extension/upload-youtube/route.ts app/api/extension/upload-srt/route.ts app/api/extension/transcribe-status/[jobId]/route.ts app/mcp/route.ts app/upload/page.tsx __tests__/api/upload.test.ts __tests__/api/extension-upload-youtube.test.ts __tests__/api/mcp.test.ts scripts/audit-podcast-ingest-integrity.mjs package.json
git commit -m "test: verify core ingest refactor"
```

Expected: commit succeeds or reports nothing to commit because earlier task commits already captured all files.

---

## Follow-Up Plans

Create separate plans for these after this core ingest plan lands:

1. Dashboard decomposition: split `app/dashboard/[id]/page.tsx` into data hooks, processing status component, analysis panels, and QA assistant integration.
2. Process pipeline decomposition: split `app/api/process/route.ts` into SRT loading, chunking, model orchestration, partial persistence, and SSE response utilities.
3. Database module decomposition: split `lib/db.ts` into users, podcasts, analysis results, schema upgrades, and D1/Postgres adapters.
4. Best Partners automation cleanup: isolate `scripts/sync-youtube-channel-transcripts.mjs` and submit workflow into tested modules.

## Self-Review

**Spec coverage:** This plan covers the requested review, cleanup, and refactor for the highest-risk existing code path: upload ingestion, storage, queueing, and production integrity. Whole-dashboard and whole-database refactors are intentionally split into follow-up plans because they are independent subsystems.

**Banned phrase scan:** The plan contains concrete file paths, commands, and code snippets for every implementation task. It does not rely on unspecified implementation instructions.

**Type consistency:** `createPodcastFromSrt()`, `CreatePodcastFromSrtInput`, `CreatePodcastFromSrtResult`, and `PodcastUploadError` are defined in Task 2 and consumed by Tasks 3 and 4 with matching property names.
