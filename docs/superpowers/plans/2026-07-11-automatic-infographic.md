# PodSum Automatic Infographic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate a NotebookLM-style Chinese infographic for newly completed analyses, let editors generate one historical article on demand, and display/download a Polaroid-framed source-attributed artifact from the dashboard.

**Architecture:** Add a dedicated leased `infographic_jobs` queue in D1, a versioned prompt/OpenRouter/SVG composition pipeline, and podcast-scoped status/generate/retry APIs. The existing processing worker claims at most one infographic after normal transcript analysis, stores a self-contained SVG in R2, and the dashboard renders it through a focused `InfographicPanel` with client-side PNG export.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript 5, Jest/Testing Library, Cloudflare Workers/OpenNext, Cloudflare D1/R2, OpenRouter Images API, browser Canvas/SVG.

## Global Constraints

- Model: `google/gemini-3-pro-image` through `POST https://openrouter.ai/api/v1/images`; no silent fallback.
- Prompt version: `podsum-infographic-v1`; the checked-in constant must match Appendix A of the approved spec.
- Request parameters: `resolution: "2K"`, `aspect_ratio: "3:4"`, `n: 1`; do not send unsupported quality/seed/background/output fields.
- Newly completed analyses enqueue automatically without delaying Summary availability.
- Historical generation is one article at a time, requires existing `canEdit` permission, is idempotent, and does not consume an extra conversion credit in v1.
- Do not bulk-generate historical rows. Reconciliation uses `INFOGRAPHIC_AUTOMATION_STARTED_AT` as a hard lower bound.
- Maximum three total attempts: initial attempt plus two retries after approximately 1 and 5 minutes.
- The canonical stored artifact is a self-contained SVG in `PODSUM_BUCKET`; browser download exports PNG and falls back to SVG.
- Preserve the complete title. Grow the footer for long titles; never truncate or overlap text.
- SRT uploads without a source URL render a title-only footer.
- Never log keys, base64 payloads, raw transcripts, full model responses, or internal errors in public API responses.
- No native `sharp` dependency; production must remain Cloudflare Worker compatible.
- Every task follows TDD and ends in a focused commit.

---

## File Map

### New files

- `migrations/d1/0004_add_infographic_jobs.sql` — additive D1 schema and due-job indexes.
- `lib/infographicJobs.ts` — queue repository, leases, retries, reconciliation, and public status mapping.
- `lib/infographicPrompt.ts` — pinned Prompt 1 and grounded fact extraction.
- `lib/infographicImage.ts` — OpenRouter Images client, raster validation, dimensions, URL normalization, title wrapping, and SVG composition.
- `lib/infographicWorker.ts` — one-job orchestration from D1 claim through R2 completion.
- `lib/infographicAccess.ts` — shared public/private view and edit authorization for infographic routes.
- `lib/infographicDownload.ts` — browser SVG-to-PNG export with SVG fallback.
- `app/api/infographics/[id]/route.ts` — public/private safe status endpoint.
- `app/api/infographics/[id]/generate/route.ts` — editor-only idempotent historical enqueue.
- `app/api/infographics/[id]/retry/route.ts` — editor-only failed-job reset.
- `components/dashboard/InfographicPanel.tsx` — five states, polling, viewer controls, fullscreen, and download.
- `__tests__/lib/infographicJobs.test.ts`
- `__tests__/lib/infographicPrompt.test.ts`
- `__tests__/lib/infographicImage.test.ts`
- `__tests__/lib/infographicWorker.test.ts`
- `__tests__/lib/infographicDownload.test.ts`
- `__tests__/api/infographics.test.ts`
- `__tests__/dashboard/InfographicPanel.test.tsx`

### Existing files to modify

- `app/api/process/route.ts` — enqueue after successful final analysis persistence.
- `app/api/worker/process/route.ts` — reconcile and process one infographic job after normal work.
- `lib/db.ts` — best-effort artifact deletion before podcast deletion.
- `app/dashboard/[id]/page.tsx` — add the fourth view and mount the focused panel.
- `app/globals.css` — stable infographic viewer and responsive toolbar styles.
- `wrangler.jsonc` — non-secret model, activation, lease, and concurrency vars.
- `scripts/prepare-cloudflare-cutover.mjs` — preserve the one-minute production worker cron and generated vars.
- `__tests__/dashboard/DashboardPage.test.tsx` — integration-level fourth-tab assertion.
- `__tests__/scripts/preview-safety.test.ts` — generated production cron/vars contract.
- `scripts/verify-cloudflare-production.mjs` — optional infographic API/artifact verification when a completed row exists.
- `package.json` / `package-lock.json` — add `lucide-react` for familiar viewer control icons.

---

### Task 1: Add the Infographic Queue Repository

**Files:**
- Create: `migrations/d1/0004_add_infographic_jobs.sql`
- Create: `lib/infographicJobs.ts`
- Create: `__tests__/lib/infographicJobs.test.ts`

**Interfaces:**
- Consumes: `sql()` and `isD1DatabaseProvider()` from `lib/sql.ts`.
- Produces: `InfographicJob`, `InfographicStatusResponse`, `enqueueInfographicJob()`, `getInfographicJob()`, `claimNextInfographicJob()`, `heartbeatInfographicJob()`, `completeInfographicJob()`, `recordInfographicFailure()`, `retryInfographicJob()`, and `reconcileInfographicJobs()`.

- [ ] **Step 1: Write repository tests for idempotency, claims, retries, and status mapping**

Create tests that mock `sql` by query intent and assert these exact behaviors:

```ts
expect(await enqueueInfographicJob('pod-1')).toMatchObject({
  success: true,
  data: { podcastId: 'pod-1', status: 'pending', promptVersion: 'podsum-infographic-v1' },
});
expect(await enqueueInfographicJob('pod-1')).toMatchObject({
  success: true,
  data: { podcastId: 'pod-1', status: 'pending' },
});
expect(await claimNextInfographicJob('worker-1', { leaseSeconds: 600 })).toMatchObject({
  success: true,
  data: { status: 'processing', attempts: 1, workerId: 'worker-1' },
});
expect(mapInfographicJobToResponse(null, false)).toEqual({
  status: 'unavailable', artifactUrl: null, mediaType: null, model: null,
  promptVersion: null, updatedAt: null, canRetry: false,
});
```

Cover a matching completed row remaining unchanged, a processing lease remaining owned, stale lease reclamation, transient failure returning to pending at attempts 1 and 2, terminal failure at attempt 3, editor retry of only failed rows, and reconciliation SQL including the activation timestamp and limit 20.

- [ ] **Step 2: Run the repository test and verify failure**

Run:

```bash
npx jest __tests__/lib/infographicJobs.test.ts --runInBand
```

Expected: FAIL because `lib/infographicJobs.ts` does not exist.

- [ ] **Step 3: Add the D1 migration**

Create `0004_add_infographic_jobs.sql`:

```sql
CREATE TABLE IF NOT EXISTS infographic_jobs (
  podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  artifact_url TEXT,
  artifact_media_type TEXT,
  source_title TEXT NOT NULL,
  source_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at DATETIME,
  lease_expires_at DATETIME,
  worker_id TEXT,
  cost_usd REAL,
  error_code TEXT,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_infographic_jobs_due
ON infographic_jobs(status, next_attempt_at, updated_at);
```

- [ ] **Step 4: Implement the repository contract**

Define exact public types:

```ts
export const INFOGRAPHIC_MODEL = process.env.OPENROUTER_INFOGRAPHIC_MODEL || 'google/gemini-3-pro-image';
export const INFOGRAPHIC_PROMPT_VERSION = 'podsum-infographic-v1';
export type InfographicJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export interface InfographicJob {
  podcastId: string;
  status: InfographicJobStatus;
  model: string;
  promptVersion: string;
  artifactUrl: string | null;
  artifactMediaType: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  workerId: string | null;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface InfographicStatusResponse {
  status: InfographicJobStatus | 'unavailable';
  artifactUrl: string | null;
  mediaType: string | null;
  model: string | null;
  promptVersion: string | null;
  updatedAt: string | null;
  canRetry: boolean;
}
```

Implement enqueue as one `INSERT ... SELECT` from `podcasts` joined to `analysis_results`, using `ON CONFLICT DO NOTHING`, then select the row. Implement claims with one `UPDATE ... WHERE podcast_id=(SELECT...) RETURNING`, matching the existing `processingJobs.ts` D1 pattern. Fence heartbeat/completion/failure updates by `worker_id`.

`recordInfographicFailure()` must receive `{ transient, errorCode, message }`; if transient and `attempts < 3`, set status back to pending and `next_attempt_at` to `+1 minute` after attempt 1 or `+5 minutes` after attempt 2. Otherwise set failed.

- [ ] **Step 5: Run repository tests**

Run the command from Step 2.

Expected: PASS with all queue, lease, reconciliation, and redaction cases.

- [ ] **Step 6: Commit Task 1**

```bash
git add migrations/d1/0004_add_infographic_jobs.sql lib/infographicJobs.ts __tests__/lib/infographicJobs.test.ts
git commit -m "feat: add infographic job queue"
```

---

### Task 2: Build the Versioned Prompt, OpenRouter Client, and Polaroid SVG

**Files:**
- Create: `lib/infographicPrompt.ts`
- Create: `lib/infographicImage.ts`
- Create: `__tests__/lib/infographicPrompt.test.ts`
- Create: `__tests__/lib/infographicImage.test.ts`

**Interfaces:**
- Produces: `buildInfographicPrompt(input)`, `generateInfographicRaster(prompt, options?)`, `normalizeSourceUrl(url)`, `wrapInfographicTitle(title, width)`, `readRasterDimensions(bytes, mediaType)`, and `composeInfographicSvg(input)`.
- Consumed by: Task 3 `processInfographicJob()`.

- [ ] **Step 1: Write prompt snapshot and grounding tests**

Use a fixture containing the accepted article numbers and assert:

```ts
const prompt = buildInfographicPrompt({
  originalTitle: 'What does the next training paradigm look like?',
  summaryZh: '# 中文总结\n## 核心观点\n- 部署后持续学习。\n## 关键数据\n- 30%–50% 用于推理。',
});
expect(prompt).toContain('视觉学习者');
expect(prompt).toContain('ARTICLE FACTS');
expect(prompt).toContain('30%–50%');
expect(prompt).toContain('不要在信息图主体中显示 YouTube 标题');
expect(prompt).not.toContain('https://youtu.be/');
expect(prompt).toMatchSnapshot();
```

Also prove input is capped, empty headings are omitted, and only supplied facts appear.

- [ ] **Step 2: Write image client and SVG tests**

Mock `fetch` and assert the exact request body:

```ts
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
  model: 'google/gemini-3-pro-image',
  prompt: 'grounded prompt',
  resolution: '2K',
  aspect_ratio: '3:4',
  n: 1,
});
```

Cover timeout, `429`, `5xx`, content-policy `4xx`, malformed JSON, missing `b64_json`, unsupported media type, decoded payload over the configured limit, PNG dimensions, JPEG dimensions, XML escaping, YouTube timestamp removal, title-only SRT footer, mixed Chinese/English wrapping, and a 100-character title that increases SVG height without truncation.

- [ ] **Step 3: Run both suites and verify failure**

```bash
npx jest __tests__/lib/infographicPrompt.test.ts __tests__/lib/infographicImage.test.ts --runInBand
```

Expected: FAIL because both implementation files are absent.

- [ ] **Step 4: Implement the pinned Prompt 1 builder**

Export:

```ts
export const INFOGRAPHIC_PROMPT_TEMPLATE = `为 PodSum 文章《{{TITLE_ZH}}》（{{ORIGINAL_TITLE}}）创作一张竖版中文信息图。
你是一位专门为视觉学习者设计高效信息图的艺术总监。目标是在 60 秒内让读者理解文章核心逻辑。信息图必须准确、清晰、信息密度高但不拥挤。
ARTICLE FACTS — 只可使用以下事实：
{{GROUNDED_FACTS}}
视觉风格：手绘编辑式信息图（Hand-drawn Editorial Infographic），暖白背景，深绿色结构色，金黄色强调发现，少量砖红色标记瓶颈。
不要在信息图主体中显示 YouTube 标题、YouTube URL、PodSum URL 或来源脚注；这些信息将由程序在生成后加入图片白边。
竖版 3:4，高分辨率，安全边距充足。`;
```

The actual constant must include every instruction from approved spec Appendix A, not only the shortened excerpt above. Extract high-signal Markdown lines from `summaryZh`, cap the grounded section at 6,000 characters, and escape only template delimiters rather than altering article facts.

- [ ] **Step 5: Implement OpenRouter response validation**

Use a six-minute default timeout and return:

```ts
export interface GeneratedRaster {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
  costUsd: number | null;
}
```

Throw an `InfographicGenerationError` with `code` and `transient` so Task 3 can apply the repository retry policy. Do not include response bodies or base64 in the error message.

- [ ] **Step 6: Implement deterministic SVG composition**

Return UTF-8 SVG bytes with an embedded data URL and `<text><tspan>` caption. Use script-aware title weights, a readable minimum font size, unlimited additional lines after the preferred three, and a footer height calculated from the final line count. Omit the URL line and its vertical space when `normalizeSourceUrl()` returns null.

- [ ] **Step 7: Run tests and type-check the new modules**

```bash
npx jest __tests__/lib/infographicPrompt.test.ts __tests__/lib/infographicImage.test.ts --runInBand
npm run type-check
```

Expected: both suites PASS; type-check exits 0.

- [ ] **Step 8: Commit Task 2**

```bash
git add lib/infographicPrompt.ts lib/infographicImage.ts __tests__/lib/infographicPrompt.test.ts __tests__/lib/infographicImage.test.ts
git commit -m "feat: generate framed infographic artifacts"
```

---

### Task 3: Process Infographic Jobs Reliably

**Files:**
- Create: `lib/infographicWorker.ts`
- Create: `__tests__/lib/infographicWorker.test.ts`
- Modify: `app/api/process/route.ts`
- Modify: `app/api/worker/process/route.ts`
- Modify: `lib/db.ts`
- Modify: `__tests__/lib/db.test.ts`

**Interfaces:**
- Consumes Task 1 repository functions, Task 2 generation/composition functions, `getPodcast()`, `getAnalysisResults()`, `uploadObject()`, and `deleteObject()`.
- Produces: `processNextInfographicJob(workerId)`; automatic analysis enqueue calls Task 1 `enqueueInfographicJob(podcastId)` directly.

- [ ] **Step 1: Write worker orchestration tests**

Mock every boundary and assert the successful order:

```ts
expect(mockClaim).toHaveBeenCalledWith('worker-info');
expect(mockBuildPrompt).toHaveBeenCalledWith(expect.objectContaining({ originalTitle: 'Video title' }));
expect(mockUploadObject).toHaveBeenCalledWith(
  'infographics/pod-1/podsum-infographic-v1.svg',
  expect.any(String),
  { contentType: 'image/svg+xml' },
);
expect(mockComplete).toHaveBeenCalledWith('pod-1', 'worker-info', expect.objectContaining({ costUsd: 0.14 }));
```

Cover no due job, missing analysis, transient generation failure, permanent policy failure, R2 verification failure, lease heartbeat, source URL absence, and redacted logs.

Extend `__tests__/lib/db.test.ts` so `deletePodcast()` deletes the stored infographic artifact when present, continues after a storage deletion failure, and still deletes the podcast row.

- [ ] **Step 2: Run the worker test and verify failure**

```bash
npx jest __tests__/lib/infographicWorker.test.ts --runInBand
```

Expected: FAIL because `lib/infographicWorker.ts` does not exist.

- [ ] **Step 3: Implement one-job orchestration**

Define:

```ts
export async function processNextInfographicJob(workerId: string): Promise<{
  processed: boolean;
  podcastId: string | null;
  status: 'idle' | 'completed' | 'retry_scheduled' | 'failed';
}>;
```

Start a lease heartbeat while the paid request is active, stop it in `finally`, compose the SVG, upload through existing read-after-write verification, and only then complete the row. Map `InfographicGenerationError.transient` into Task 1 failure policy.

- [ ] **Step 4: Enqueue after final analysis save**

In the `saveResult.success` branch of `app/api/process/route.ts`, call:

```ts
const infographicEnqueue = await enqueueInfographicJob(id);
if (!infographicEnqueue.success) {
  console.warn('[infographic] enqueue after analysis failed', {
    podcastId: id,
    error: infographicEnqueue.error || 'unknown enqueue failure',
  });
}
```

Do not await generation itself and do not change the analysis success response.

- [ ] **Step 5: Reconcile and claim after normal processing**

Refactor `app/api/worker/process/route.ts` so a no-normal-job result does not return before infographic work. After normal job handling, call:

```ts
await reconcileInfographicJobs({
  activationTime: process.env.INFOGRAPHIC_AUTOMATION_STARTED_AT || '',
  limit: 20,
});
const infographic = await processNextInfographicJob(`${workerId}:infographic`);
```

Return a combined JSON result that preserves existing fields and adds `infographic` without changing existing success semantics.

- [ ] **Step 6: Delete artifacts with podcasts**

Before deleting the podcast row in `deletePodcast()`, read the infographic job and best-effort call `deleteObject(artifactUrl)`. Log a warning on storage deletion failure, then continue database deletion so FK cascade removes the job row.

- [ ] **Step 7: Run focused and existing worker tests**

```bash
npx jest __tests__/lib/infographicWorker.test.ts __tests__/lib/db.test.ts __tests__/api/process.test.ts __tests__/api/worker-process.test.ts --runInBand
npm run type-check
```

Expected: PASS; no existing processing response assertions regress.

- [ ] **Step 8: Commit Task 3**

```bash
git add lib/infographicWorker.ts __tests__/lib/infographicWorker.test.ts __tests__/lib/db.test.ts app/api/process/route.ts app/api/worker/process/route.ts lib/db.ts
git commit -m "feat: process infographic jobs"
```

---

### Task 4: Add Safe Status, Generate, and Retry APIs

**Files:**
- Create: `lib/infographicAccess.ts`
- Create: `app/api/infographics/[id]/route.ts`
- Create: `app/api/infographics/[id]/generate/route.ts`
- Create: `app/api/infographics/[id]/retry/route.ts`
- Create: `__tests__/api/infographics.test.ts`

**Interfaces:**
- Consumes: `getPodcast()`, `getAnalysisResults()`, `verifyPodcastOwnership()`, NextAuth session, Task 1 repository functions, and `triggerWorkerProcessing()`.
- Produces: the approved `InfographicStatusResponse` envelope and editor-only commands.

- [ ] **Step 1: Write route tests**

Cover public GET, private anonymous 401, private non-editor 403, editor `canRetry`, historical editor generate, public generate 401, non-editor 403, incomplete analysis 409, repeated generate returning the existing job, failed retry, and public redaction of `costUsd`, `errorMessage`, and prompt text.

Expected successful generate response:

```ts
expect(await response.json()).toEqual({
  success: true,
  data: expect.objectContaining({ status: 'pending', canRetry: false }),
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx jest __tests__/api/infographics.test.ts --runInBand
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement shared access resolution**

Return one of:

```ts
type InfographicAccessResult =
  | { ok: true; podcast: Podcast; canEdit: boolean }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };
```

Match `GET /api/analysis/[id]`: public podcasts are viewable anonymously; private podcasts require ownership; edits require exact `session.user.id === podcast.userId`.

- [ ] **Step 4: Implement GET and command routes**

`GET` maps null jobs to unavailable. `POST /generate` requires a completed analysis and calls idempotent enqueue. `POST /retry` requires a failed row and calls `retryInfographicJob()`.

After successful generate/retry, schedule:

```ts
after(() => triggerWorkerProcessing('infographic_command', id));
```

Never expose cost or internal error fields.

- [ ] **Step 5: Run API tests and type-check**

```bash
npx jest __tests__/api/infographics.test.ts --runInBand
npm run type-check
```

Expected: PASS and exit 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add lib/infographicAccess.ts app/api/infographics __tests__/api/infographics.test.ts
git commit -m "feat: expose infographic status and commands"
```

---

### Task 5: Build the Infographic Viewer and PNG Download

**Files:**
- Create: `lib/infographicDownload.ts`
- Create: `components/dashboard/InfographicPanel.tsx`
- Create: `__tests__/lib/infographicDownload.test.ts`
- Create: `__tests__/dashboard/InfographicPanel.test.tsx`
- Modify: `app/globals.css`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `podcastId`, `canEdit`, `title`, and the three Task 4 endpoints.
- Produces: `<InfographicPanel podcastId canEdit title />` for Task 6.

- [ ] **Step 1: Test SVG-to-PNG export and fallback**

Mock `Image`, canvas, Blob, and URL APIs. Assert a successful path downloads `<safe-title>-infographic.png`; a tainted/failed canvas path downloads the original SVG URL instead; object URLs are revoked.

- [ ] **Step 2: Test all five panel states and polling**

Assert:

```ts
expect(screen.getByText('Infographic was not generated for this analysis.')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Generate infographic' })).toBeEnabled();
```

Cover unavailable public/editor variants, pending, processing, completed viewer, failed public/editor variants, successful unavailable-to-pending transition, retry, 5-second polling only for pending/processing, polling stopped when hidden/terminal, zoom bounds, reset, fullscreen, and download.

- [ ] **Step 3: Run tests and verify failure**

```bash
npx jest __tests__/lib/infographicDownload.test.ts __tests__/dashboard/InfographicPanel.test.tsx --runInBand
```

Expected: FAIL because the files do not exist.

- [ ] **Step 4: Implement download helper**

Expose:

```ts
export async function downloadInfographicAsPng(input: {
  artifactUrl: string;
  filename: string;
}): Promise<'png' | 'svg-fallback'>;
```

Fetch same-origin SVG, create a Blob URL, draw the loaded SVG to a canvas at intrinsic dimensions, export PNG, click a temporary anchor, and clean up in `finally`.

- [ ] **Step 5: Add the icon dependency**

```bash
npm install lucide-react@1.24.0
```

Expected: `package.json` and `package-lock.json` add `lucide-react` without changing unrelated dependencies.

- [ ] **Step 6: Implement the focused panel**

Use Lucide icons `ZoomIn`, `ZoomOut`, `Scan`, `Maximize2`, and `Download`. Keep the viewer unframed, with a stable responsive viewport. Use an `<img>` for the self-contained SVG and `object-fit: contain`; never crop. Add tooltips through `title` and accessible labels.

- [ ] **Step 7: Add responsive CSS**

Use fixed toolbar button dimensions, bounded zoom transforms, an overflow container, and mobile wrapping. Avoid nested cards and prevent the toolbar or image from overlapping Podcast AI.

- [ ] **Step 8: Run focused tests**

Run Step 3 command.

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add lib/infographicDownload.ts components/dashboard/InfographicPanel.tsx app/globals.css package.json package-lock.json __tests__/lib/infographicDownload.test.ts __tests__/dashboard/InfographicPanel.test.tsx
git commit -m "feat: add infographic viewer"
```

---

### Task 6: Integrate the Fourth Dashboard View

**Files:**
- Modify: `app/dashboard/[id]/page.tsx`
- Modify: `__tests__/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: Task 5 `InfographicPanel`.
- Produces: `ViewMode = 'summary' | 'fullText' | 'mindMap' | 'infographic'` and a fourth visible tab.

- [ ] **Step 1: Add failing page integration tests**

Assert the tab exists, selecting it renders the panel with the current podcast ID and `canEdit`, and the Summary/Full Text/Mind Map behavior remains unchanged.

```ts
fireEvent.click(screen.getByRole('button', { name: 'Infographic' }));
expect(screen.getByTestId('infographic-panel')).toHaveAttribute('data-podcast-id', 'podcast-123');
```

- [ ] **Step 2: Run dashboard tests and verify failure**

```bash
npx jest __tests__/dashboard/DashboardPage.test.tsx --runInBand
```

Expected: FAIL because the tab does not exist.

- [ ] **Step 3: Add the new view without expanding markdown logic**

Import `InfographicPanel`, extend `ViewMode`, add the fourth tab beside Mind Map, and add an early `infographic` branch in `renderContent()`:

```tsx
if (activeView === 'infographic') {
  return <InfographicPanel podcastId={id} canEdit={canEdit} title={data.title} />;
}
```

Do not route infographic content through ReactMarkdown or `getRenderableViewContent()`.

- [ ] **Step 4: Run dashboard and panel suites**

```bash
npx jest __tests__/dashboard/DashboardPage.test.tsx __tests__/dashboard/InfographicPanel.test.tsx --runInBand
npm run type-check
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit Task 6**

```bash
git add app/dashboard/[id]/page.tsx __tests__/dashboard/DashboardPage.test.tsx
git commit -m "feat: add dashboard infographic tab"
```

---

### Task 7: Configure, Verify, Migrate, and Deploy Production

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `scripts/prepare-cloudflare-cutover.mjs`
- Modify: `__tests__/scripts/preview-safety.test.ts`
- Modify: `scripts/verify-cloudflare-production.mjs`

**Interfaces:**
- Consumes all previous tasks.
- Produces a migrated and verified production Worker on `podsum.cc` and `www.podsum.cc`.

- [ ] **Step 1: Add failing configuration contract tests**

Assert generated production config contains:

```ts
expect(config.vars.OPENROUTER_INFOGRAPHIC_MODEL).toBe('google/gemini-3-pro-image');
expect(config.vars.INFOGRAPHIC_AUTOMATION_STARTED_AT).toMatch(/^2026-07-11T/);
expect(config.triggers.crons).toContain('* * * * *');
```

Also assert preview cron remains disabled and no production D1/R2 binding is accidentally copied into preview.

- [ ] **Step 2: Run config tests and verify failure**

```bash
npx jest __tests__/scripts/preview-safety.test.ts --runInBand
```

Expected: FAIL because the new vars and generated one-minute cron contract are missing.

- [ ] **Step 3: Add non-secret runtime vars and preserve cron**

Set in `wrangler.jsonc`:

```json
"OPENROUTER_INFOGRAPHIC_MODEL": "google/gemini-3-pro-image",
"INFOGRAPHIC_AUTOMATION_STARTED_AT": "2026-07-11T09:15:46.000Z",
"INFOGRAPHIC_WORKER_CONCURRENCY": "1",
"INFOGRAPHIC_JOB_LEASE_SECONDS": "600"
```

Update `productionCrons` in `prepare-cloudflare-cutover.mjs` to include `'* * * * *'`, `'0 3 * * *'`, and `'0 4 * * *'` so generated production deploys do not remove normal background processing.

- [ ] **Step 4: Extend production verification safely**

When the sampled analysis has an infographic status, verify the endpoint shape. If status is completed, fetch `artifactUrl` and require HTTP 200 plus `image/svg+xml`. Do not require every historical analysis to have an artifact.

- [ ] **Step 5: Run the complete local gate**

```bash
npx jest --runInBand --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/.next/' --testPathIgnorePatterns='/.worktrees/'
npm run type-check
npm run cutover:prepare
npx opennextjs-cloudflare build
```

Expected: all tests PASS, type-check exits 0, and OpenNext build completes. Existing non-blocking ESLint warnings may remain but no new warnings are introduced in changed files.

- [ ] **Step 6: Commit Task 7 before external mutation**

```bash
git add wrangler.jsonc scripts/prepare-cloudflare-cutover.mjs __tests__/scripts/preview-safety.test.ts scripts/verify-cloudflare-production.mjs
git commit -m "chore: configure infographic rollout"
```

- [ ] **Step 7: Apply the additive production D1 migration**

```bash
set -a
source .env.vercel.production
source .env.google.oauth
set +a
npm run cutover:prepare
npx wrangler d1 migrations apply PODSUM_DB --remote --config output/cutover/wrangler.production.jsonc
```

Expected: migration `0004_add_infographic_jobs.sql` applies successfully; existing podcast and analysis counts remain unchanged.

- [ ] **Step 8: Deploy the production Worker**

```bash
NEXTAUTH_URL=https://podsum.cc NEXT_PUBLIC_APP_URL=https://podsum.cc npx opennextjs-cloudflare build
NODE_OPTIONS=--dns-result-order=ipv4first node node_modules/wrangler/bin/wrangler.js deploy -c output/cutover/wrangler.production.jsonc
```

Expected: a new Worker version ID and custom domains `podsum.cc`, `www.podsum.cc`.

- [ ] **Step 9: Seed and verify the controlled acceptance article**

Sign in as the article editor, open:

```text
https://podsum.cc/dashboard/9fkYzwONjN1Z6a1B-ZICn
```

Select `Infographic`, click `Generate infographic`, and verify state transitions `Unavailable -> Pending -> Generating -> Ready`. Confirm exactly one D1 row, one R2 SVG, complete title, canonical `https://youtu.be/20p5-kQXF_Q`, automatic footer growth behavior using the unit fixture, zoom/fullscreen, and PNG download.

- [ ] **Step 10: Run production smoke checks and push**

```bash
npm run verify:cf-production
curl -fsS https://podsum.cc/api/infographics/9fkYzwONjN1Z6a1B-ZICn
curl -fsSI https://podsum.cc
curl -fsSI https://www.podsum.cc
git status --short
git push origin main
```

Expected: verification passes, both domains return 200, infographic API is non-sensitive and completed, worktree is clean, and `origin/main` matches local `main`.

---

## Self-Review Checklist

- Spec coverage: queue, automatic enqueue, reconciliation, manual historical generation, permissions, fixed model/prompt, retries, SVG/PNG, dynamic footer, R2, UI states, deletion, observability, migration, and production verification each map to a task.
- Placeholder scan: no unfinished markers, unspecified error handling, or unnamed test steps remain.
- Type consistency: `InfographicJobStatus`, `InfographicStatusResponse`, `GeneratedRaster`, and `processNextInfographicJob()` names are identical across producer and consumer tasks.
- Scope: no bulk backfill, custom prompt UI, multiple styles, gallery, billing system, or unrelated dashboard refactor is included.
