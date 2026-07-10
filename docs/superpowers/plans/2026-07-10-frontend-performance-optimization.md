# PodSum Frontend Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PodSum homepage visibly useful sooner and reduce avoidable frontend network, rendering, and cache work without exposing private data or changing product behavior.

**Architecture:** Establish repeatable laboratory and bundle baselines first, then deliver low-risk asset/cache wins, remove the homepage CSR/auth waterfall by server-rendering only the public first page, and eliminate proven dead work on the Dashboard. Keep authenticated `My Summaries` private and client-fetched. Treat Dashboard payload splitting, public-snapshot edge caching, QA pagination, and full-text virtualization as a separate second-phase plan because they change API/data contracts.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript, Jest/Testing Library, Playwright, Lighthouse CI, OpenNext Cloudflare Workers, Cloudflare Static Assets/D1/R2.

## Global Constraints

- Re-fetch `origin/main` before implementation; this plan was written against merge commit `5f7446440748f38db79f69ca2e2f62f8bd78bb48`.
- Preserve all existing authentication, upload, summary, topic, starred, and Dashboard behavior.
- Never place authenticated/private podcast rows in cacheable HTML, public snapshots, fixtures, Lighthouse artifacts, or CI logs.
- Keep public Explore snapshot fallback behavior; an R2/snapshot failure must degrade to the existing API/client path rather than fail the page.
- Use Node.js 22 and `npm ci` in CI; do not invoke `npm run deploy` from PR CI because it targets production.
- Run mobile performance measurements five times with a fresh browser context and use the median; do not compare one-off local timings as if they were equivalent to Lighthouse.
- Preserve accessibility, keyboard behavior, focus order, reduced-motion behavior, and the light/dark theme.
- Removing the default homepage `/api/auth/session` -> public-list request waterfall is a release-blocking requirement; asset/cache wins alone are not sufficient.
- Do not add list virtualization in this cycle. First use `content-visibility`, stable props, and deferred filtering; reconsider virtualization only after a trace with more than 60 rendered cards proves it is needed.
- Do not build a custom RUM ingestion API in this cycle. Prefer Cloudflare Web Analytics; use Next.js `useReportWebVitals` only if Cloudflare Web Analytics cannot be enabled.
- Every implementation task uses TDD, passes `npm test`, and ends with a focused commit.

## Execution Order Decision

To make preview-only acceptance available before the homepage changes, execute Task 6 Steps 1-4 immediately after Task 1. Execute Task 6 Steps 5-6 after Tasks 2-5. Task 3 remains mandatory and cannot be replaced by only completing the static-asset or cache tasks.

Runtime decision (user-authorized on 2026-07-10): the checked-in bare `defineCloudflareConfig()` resolves OpenNext incremental cache to the `dummy` adapter, so Task 3 must not wrap the public loader in `unstable_cache` and claim a false 60-second cross-request cache. Use the direct public-only snapshot -> D1 loader and gate it on live Preview TTFB/LCP. A dedicated incremental-cache R2 plus revalidation queue is authorized only as the Task 6B fallback if those gates fail.

---

## Confirmed Baseline (2026-07-10)

Production target: `https://podsum.cc/`, Worker version 66, build `iOx-Zzm1IIsSrblLN2Ywn`.

| Metric | Current evidence | First-cycle target |
|---|---:|---:|
| Lighthouse mobile Performance | 95 | >= 90; score is warning-only |
| Mobile FCP | 0.9 s | <= 1.8 s |
| Mobile LCP | 2.9 s | <= 2.5 s |
| Mobile TBT | 60 ms | <= 200 ms |
| Mobile CLS | 0.001 | <= 0.10 |
| Speed Index | 3.0 s | <= 2.5 s |
| Homepage cold requests | 24-25 | <= 20 |
| Homepage cold transfer | 362-378 KiB | <= 250 KiB |
| Homepage JS, Brotli | 112.2-112.6 KiB | <= 110 KiB and never >5% over baseline |
| Homepage CSS, Brotli | about 11 KiB | <= 16 KiB |
| Homepage fonts | about 51-56 KiB | <= 36 KiB |
| Header logo transfer | about 134.6-138 KiB | <= 12 KiB |
| Public homepage TTFB | 189 ms median, 126-296 ms range | <= 500 ms median after SSR change |

Key facts that determine task order:

- The generated homepage HTML contains `BAILOUT_TO_CLIENT_SIDE_RENDERING` and only renders `Loading workspace...`.
- The default `/` path waits for `/api/auth/session` before requesting the public list snapshot.
- The 36 px header logo requests a 512 px PNG and transfers roughly 138 KiB because Workers Static Assets does not resize it.
- Hashed static assets currently use `Cache-Control: public, max-age=0, must-revalidate`.
- Dashboard opens with an unconditional SRT download and CPU formatting pass, but `fullTextOriginal` is never read.
- CrUX has no field data for this origin, so laboratory results are the initial gate; enable RUM before treating INP as verified.

Official references:

- [Lighthouse CI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)
- [Next.js useReportWebVitals](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)
- [Cloudflare Static Asset custom headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Cloudflare Web Analytics Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)

---

## File Map

### New files

- `performance-budget.json` — machine-readable bundle/resource thresholds.
- `lighthouserc.cjs` — five-run mobile Lighthouse assertions for preview/production URLs.
- `scripts/performance/check-next-bundles.mjs` — deterministic `.next` route bundle budget check.
- `scripts/performance/measure-home.mjs` — Playwright cold/warm resource and Web Vitals capture.
- `scripts/performance/fixtures/home-public.json` — synthetic public rows only; no production data.
- `__tests__/scripts/performance-budget.test.ts` — budget parser and pass/fail behavior.
- `docs/performance/home-baseline.md` — durable before/after report.
- `public/podcast-summarizer-icon-96-v1.png` — 96 px header-specific image under 12 KiB.
- `public/_headers` — immutable cache policy for fingerprinted Next assets and the versioned header icon.
- `components/home/HomeWorkspace.tsx` — interactive client portion of the homepage.
- `components/home/homeModel.ts` — shared pure mapping, query, sorting, and view parsing.
- `lib/homepagePublicData.ts` — server-only, public-only first-page loader with snapshot fallback.
- `__tests__/home/homeModel.test.ts` — pure homepage model coverage.
- `__tests__/home/HomeWorkspace.test.tsx` — initial rows, session parallelism, prefetch, and interactions.
- `__tests__/components/AppHeader.test.tsx` — header asset size/path and prefetch behavior.
- `components/LiteYouTubeEmbed.tsx` — click-to-load private YouTube embed.
- `__tests__/components/LiteYouTubeEmbed.test.tsx` — no iframe before user intent.
- `.github/workflows/ci.yml` — Node 22 tests, build, and bundle budget gate; never deploys.

### Existing files to modify

- `package.json` / `package-lock.json` — performance scripts and pinned Lighthouse CI dependency.
- `.gitignore` — ignore `output/performance/` while CI uploads it as an artifact.
- `app/page.tsx` — become a small Server Component and provide public initial rows.
- `app/layout.tsx` — remove global Geist Mono preload.
- `app/globals.css` — system mono fallback and summary-card containment.
- `components/AppHeader.tsx` — use the 96 px icon and disable non-critical prefetch.
- `components/AppFrame.tsx` — preserve theme without a post-hydration repaint.
- `app/dashboard/[id]/page.tsx` — remove dead SRT work and use lite YouTube embed.
- `__tests__/dashboard/DashboardPage.test.tsx` — prove Summary load performs no transcript request.
- `wrangler.preview.jsonc` — create a safe, non-production preview Worker configuration.

---

### Task 1: Establish Reproducible Performance Baselines and Budgets

**Files:**
- Create: `performance-budget.json`
- Create: `lighthouserc.cjs`
- Create: `scripts/performance/check-next-bundles.mjs`
- Create: `scripts/performance/measure-home.mjs`
- Create: `scripts/performance/fixtures/home-public.json`
- Create: `__tests__/scripts/performance-budget.test.ts`
- Create: `docs/performance/home-baseline.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `.next/app-build-manifest.json`, `.next/build-manifest.json`, `PERF_BASE_URL`.
- Produces: `npm run perf:bundle`, `npm run perf:home`, `npm run perf:lab`, and JSON under `output/performance/`.

- [ ] **Step 1: Add the initial defensive budget**

Create `performance-budget.json` with limits that pass the current build while preventing regression:

```json
{
  "version": 1,
  "routes": {
    "/": {
      "javascriptBrotliBytes": 122880,
      "cssBrotliBytes": 20480
    }
  },
  "homepage": {
    "requests": 30,
    "transferBytes": 409600,
    "scriptBytes": 163840,
    "styleBytes": 20480,
    "fontBytes": 61440,
    "imageBytes": 153600,
    "fcpMs": 1800,
    "lcpMs": 2800,
    "tbtMs": 250,
    "cls": 0.1
  }
}
```

- [ ] **Step 2: Write failing budget tests**

In `__tests__/scripts/performance-budget.test.ts`, import exported `assertWithinBudget` and test exact pass/fail behavior:

```ts
import { assertWithinBudget } from '../../scripts/performance/check-next-bundles.mjs';

test('accepts a route below its Brotli budgets', () => {
  expect(() => assertWithinBudget(
    { javascriptBrotliBytes: 110_000, cssBrotliBytes: 12_000 },
    { javascriptBrotliBytes: 122_880, cssBrotliBytes: 20_480 },
  )).not.toThrow();
});

test('reports the exact metric that exceeds budget', () => {
  expect(() => assertWithinBudget(
    { javascriptBrotliBytes: 123_000, cssBrotliBytes: 12_000 },
    { javascriptBrotliBytes: 122_880, cssBrotliBytes: 20_480 },
  )).toThrow('javascriptBrotliBytes: 123000 > 122880');
});
```

Run: `npm test -- __tests__/scripts/performance-budget.test.ts --runInBand`

Expected: FAIL because `check-next-bundles.mjs` does not exist.

- [ ] **Step 3: Implement deterministic bundle accounting**

Implement `check-next-bundles.mjs` so it:

1. Reads both Next manifests.
2. Resolves the root route's shared and route-specific `.js`/`.css` files.
3. Deduplicates file paths with a `Set`.
4. Calculates raw, gzip, and Brotli sizes using `node:zlib`.
5. Exports `assertWithinBudget(actual, budget)`.
6. Prints JSON and exits non-zero on a budget violation.

The exported assertion must be:

```js
export function assertWithinBudget(actual, budget) {
  for (const key of ['javascriptBrotliBytes', 'cssBrotliBytes']) {
    if (actual[key] > budget[key]) {
      throw new Error(`${key}: ${actual[key]} > ${budget[key]}`);
    }
  }
}
```

Run: `npm test -- __tests__/scripts/performance-budget.test.ts --runInBand`

Expected: PASS, 2 tests.

- [ ] **Step 4: Add a five-run Playwright measurement script**

`measure-home.mjs` must use the existing `playwright` dependency and:

- default `PERF_BASE_URL` to `https://podsum.cc`;
- create a fresh mobile browser context per cold run;
- run five cold measurements and one warm measurement;
- collect navigation timing, LCP, CLS, long tasks, request count, transfer size by resource type, failed requests, and cache headers;
- write `output/performance/home-${buildId}.json`, where `buildId` is read from `/BUILD_ID`;
- print median FCP/LCP/CLS and resource totals.

Use this init script before navigation:

```js
await context.addInitScript(() => {
  window.__podsumPerf = { lcp: 0, cls: 0, longTasks: [] };
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    window.__podsumPerf.lcp = entries.at(-1)?.startTime || 0;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__podsumPerf.cls += entry.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    window.__podsumPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration));
  }).observe({ type: 'longtask', buffered: true });
});
```

- [ ] **Step 5: Add Lighthouse CI in warning-first mode**

Add `@lhci/cli` as a pinned dev dependency and create `lighthouserc.cjs`:

```js
module.exports = {
  ci: {
    collect: {
      url: [process.env.PERF_BASE_URL || 'https://podsum.cc/'],
      numberOfRuns: 5,
      settings: { formFactor: 'mobile' },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.9, aggregationMethod: 'median' }],
        'first-contentful-paint': ['error', { maxNumericValue: 1800, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2800, aggregationMethod: 'median' }],
        'total-blocking-time': ['error', { maxNumericValue: 250, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        'resource-summary:script:size': ['error', { maxNumericValue: 163840, aggregationMethod: 'median' }],
        'resource-summary:image:size': ['error', { maxNumericValue: 153600, aggregationMethod: 'median' }],
      },
    },
    upload: { target: 'filesystem', outputDir: 'output/performance/lhci' },
  },
};
```

- [ ] **Step 6: Wire package scripts and write the durable baseline**

Add:

```json
{
  "perf:bundle": "node scripts/performance/check-next-bundles.mjs",
  "perf:home": "node scripts/performance/measure-home.mjs",
  "perf:lab": "lhci autorun",
  "perf:ci": "npm run build && npm run perf:bundle"
}
```

Record the confirmed baseline table from this plan in `docs/performance/home-baseline.md`, including measurement date, Worker version, build ID, device profile, five-run rule, and the PageSpeed report URL.

Run:

```bash
npm run build
npm run perf:bundle
npm run perf:home
PERF_BASE_URL=https://podsum.cc npm run perf:lab
```

Expected: bundle gate passes; measurement JSON and five Lighthouse reports exist; Lighthouse LCP is initially allowed to warn.

- [ ] **Step 7: Commit**

```bash
git add performance-budget.json lighthouserc.cjs scripts/performance __tests__/scripts/performance-budget.test.ts docs/performance/home-baseline.md package.json package-lock.json .gitignore
git commit -m "test: add frontend performance baselines"
```

---

### Task 2: Remove the Largest Static-Asset Waste

**Files:**
- Create: `public/podcast-summarizer-icon-96-v1.png`
- Create: `public/_headers`
- Modify: `components/AppHeader.tsx:166`
- Modify: `app/layout.tsx:1-15,29-31`
- Modify: `app/globals.css:46-56`
- Modify: `.gitignore`
- Create: `__tests__/components/AppHeader.test.tsx`

**Interfaces:**
- Consumes: current 512 px source logo.
- Produces: an 8-12 KiB header asset and immutable cache headers for hashed assets.

- [ ] **Step 1: Add a failing header-asset assertion**

In `__tests__/components/AppHeader.test.tsx`, test that `AppHeader` renders `/podcast-summarizer-icon-96-v1.png`, has width/height 36, and does not render the 512 px source path.

Run: `npm test -- __tests__/components/AppHeader.test.tsx --runInBand`

Expected: FAIL because the header still references `/podcast-summarizer-icon.png`.

- [ ] **Step 2: Generate the display-size asset**

Run:

```bash
cp public/podcast-summarizer-icon.png public/podcast-summarizer-icon-96-v1.png
sips -Z 96 public/podcast-summarizer-icon-96-v1.png
test "$(wc -c < public/podcast-summarizer-icon-96-v1.png)" -le 12288
```

Expected: 96 x 96 PNG and size <= 12,288 bytes.

- [ ] **Step 3: Serve the small image directly**

Update `AppHeader`:

```tsx
<Image
  src="/podcast-summarizer-icon-96-v1.png"
  alt="PodSum logo"
  width={36}
  height={36}
  unoptimized
  className="app-breadcrumb-logo"
/>
```

- [ ] **Step 4: Add Workers Static Asset cache headers**

Create `public/_headers`:

```text
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/podcast-summarizer-icon-96-v1.png
  Cache-Control: public, max-age=31536000, immutable
```

After `npm run build`, verify `.open-next/assets/_headers` exists. In preview, verify both paths return the exact header.

- [ ] **Step 5: Remove the global mono-font preload**

Remove `Geist_Mono` from `app/layout.tsx` and set this fallback in `app/globals.css`:

```css
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
```

Keep Geist Sans unchanged. Verify MCP code blocks and the error boundary remain readable at mobile and desktop widths.

- [ ] **Step 6: Verify the quick wins**

Run:

```bash
npm test
npm run build
npm run perf:bundle
PREVIEW_BASE_URL=https://podcast-summarizer-preview.chenzixin1.workers.dev
PERF_BASE_URL=$PREVIEW_BASE_URL npm run perf:home
```

Expected after a real preview URL is supplied: image transfer <= 12 KiB, fonts <= 36 KiB, total homepage transfer <= 250 KiB.

- [ ] **Step 7: Tighten the image and font budgets, then commit**

Change `homepage.imageBytes` to `20480` and `homepage.fontBytes` to `36864` in `performance-budget.json`.

```bash
git add public/podcast-summarizer-icon-96-v1.png public/_headers components/AppHeader.tsx app/layout.tsx app/globals.css performance-budget.json __tests__/components/AppHeader.test.tsx
git commit -m "perf: reduce global asset transfer"
```

---

### Task 3: Put Public Homepage Cards in the Initial HTML

**Files:**
- Create: `components/home/homeModel.ts`
- Create: `components/home/HomeWorkspace.tsx`
- Create: `lib/homepagePublicData.ts`
- Create: `__tests__/home/homeModel.test.ts`
- Create: `__tests__/home/HomeWorkspace.test.tsx`
- Modify: `app/page.tsx`
- Test: `__tests__/lib/staticSnapshots.test.ts`

**Interfaces:**
- `getHomepagePublicData(): Promise<{ rows: PodcastApiRow[]; generatedAt: string | null }>` returns public rows only.
- `HomeWorkspaceProps` contains `initialView`, `initialTag`, `hasExplicitView`, and `initialExploreRows`.
- Existing `/api/podcasts?includePrivate=true` remains the only private-list source.

- [ ] **Step 1: Extract and test pure homepage model functions**

Move `PodcastApiRow`, `SummaryItem`, `mapPodcastRow`, view parsing, filtering, and sorting into `components/home/homeModel.ts`.

Add tests for:

```ts
expect(parseHomeView('topics')).toBe('topics');
expect(parseHomeView(['starred'])).toBe('starred');
expect(parseHomeView('private')).toBe('explore');
expect(mapPodcastRow(publicRow, 'explore').scope).toBe('explore');
```

Run: `npm test -- __tests__/home/homeModel.test.ts --runInBand`

Expected: FAIL before extraction, PASS after extraction.

- [ ] **Step 2: Add public-only server loader tests**

Mock `getPublicListSnapshot` and `getAllPodcasts` and verify:

1. snapshot hit returns its first 12 public rows;
2. snapshot miss falls back to `getAllPodcasts(1, 12, false)`;
3. both sources are normalized to public rows only;
4. both source failures return an empty row array instead of throwing.

The server loader must begin with:

```ts
import 'server-only';
```

Export the direct public-only loader without `unstable_cache`:

```ts
export const getHomepagePublicData = loadHomepagePublicData;
```

Reason: the current OpenNext runtime uses its dummy incremental-cache adapter, so a `revalidate: 60` wrapper would not persist data across Worker requests. Do not add R2/queue infrastructure in Task 3; Task 6B owns the live TTFB/LCP decision.

- [ ] **Step 3: Split the Server and Client Components**

Move the existing interactive workspace to `components/home/HomeWorkspace.tsx` and remove `useSearchParams` from it.

Define props exactly:

```ts
export interface HomeWorkspaceProps {
  initialView: HomeView;
  initialTag: string;
  hasExplicitView: boolean;
  initialExploreRows: PodcastApiRow[];
}
```

Initialize `exploreItems`, `explorePage`, and `hasMoreExplore` from the server rows so page 1 is not fetched again after hydration.

- [ ] **Step 4: Make `app/page.tsx` a small Server Component**

Use the Next.js 15 async `searchParams` shape:

```tsx
import HomeWorkspace from '../components/home/HomeWorkspace';
import { parseHomeView, readSearchParam } from '../components/home/homeModel';
import { getHomepagePublicData } from '../lib/homepagePublicData';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, publicData] = await Promise.all([
    searchParams,
    getHomepagePublicData(),
  ]);
  const rawView = readSearchParam(params.view);
  return (
    <HomeWorkspace
      initialView={parseHomeView(rawView)}
      initialTag={readSearchParam(params.tag) || ''}
      hasExplicitView={Boolean(rawView)}
      initialExploreRows={publicData.rows}
    />
  );
}
```

Do not pass session or private rows through the server-cached loader.

- [ ] **Step 5: Preserve authenticated default behavior without blocking Explore**

On `/` with no explicit view, render Explore immediately. When `useSession()` resolves authenticated, switch to `my` and request the private list. The public rows remain available for Explore/Topics and are never discarded.

The initial public load must not contain this old gate:

```ts
if (status === 'loading' && !explicitView) return;
```

Private loading must still require `status === 'authenticated'`.

- [ ] **Step 6: Add regression tests for HTML/data boundaries**

Tests must prove:

- 12 initial public rows render while `useSession` is `loading`;
- no public snapshot fetch is made for page 1 after hydration;
- an authenticated session triggers only the private request;
- an unauthenticated session never requests `includePrivate=true`;
- a synthetic private title is absent from the serialized public initial props.

Run:

```bash
npm test -- __tests__/home __tests__/lib/staticSnapshots.test.ts --runInBand
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Verify initial HTML and performance before commit**

Against an OpenNext preview:

```bash
PREVIEW_BASE_URL=https://podcast-summarizer-preview.chenzixin1.workers.dev
curl -sS "$PREVIEW_BASE_URL/?view=explore" > /tmp/podsum-home.html
rg 'BAILOUT_TO_CLIENT_SIDE_RENDERING|Loading workspace' /tmp/podsum-home.html && exit 1 || true
PUBLIC_ID=$(curl -sS "$PREVIEW_BASE_URL/api/snapshots/lists/public?page=1&pageSize=12" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).data[0].id))")
rg "/dashboard/$PUBLIC_ID" /tmp/podsum-home.html
```

Expected: no CSR bailout/fallback marker; a known public card title exists; no private fixture title exists. Median TTFB must remain <= 500 ms and median mobile LCP must improve by at least 15% or reach <= 2.5 s.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx components/home lib/homepagePublicData.ts __tests__/home __tests__/lib/staticSnapshots.test.ts
git commit -m "perf: render public homepage data on the server"
```

---

### Task 4: Reduce Homepage Re-render, Prefetch, and Long-list Work

**Files:**
- Modify: `components/home/HomeWorkspace.tsx`
- Modify: `components/home/homeModel.ts`
- Modify: `components/AppHeader.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Test: `__tests__/home/HomeWorkspace.test.tsx`

**Interfaces:**
- Consumes: server-seeded public rows from Task 3.
- Produces: intent-based navigation prefetch and stable summary cards.

- [ ] **Step 1: Test that card links do not prefetch before intent**

Mock `next/link` and assert Dashboard, About, and account integration links receive `prefetch={false}` on homepage initial render. Add a router mock and assert `router.prefetch('/dashboard/podcast-123')` is called only after card hover or focus.

Run: `npm test -- __tests__/home/HomeWorkspace.test.tsx --runInBand`

Expected: FAIL because current links use default viewport prefetch.

- [ ] **Step 2: Replace viewport prefetch with intent prefetch**

For each summary card:

```tsx
const dashboardHref = `/dashboard/${item.id}`;
const preloadDashboard = () => router.prefetch(dashboardHref);

<Link
  href={dashboardHref}
  prefetch={false}
  onMouseEnter={preloadDashboard}
  onFocus={preloadDashboard}
>
  {item.title}
</Link>
```

Set `prefetch={false}` for About and account-menu links that are not part of the current task flow.

- [ ] **Step 3: Remove the per-card second render**

Delete the idle-callback/state effect from `SummaryCover`. Compute the cover from stable fields:

```tsx
const coverSpec = useMemo(
  () => buildEditorialCoverSpec(item),
  [item.id, item.title, item.sourceReference],
);
```

Wrap `SummaryCard` in `memo` and pass a stable `onToggleStar(item.id)` callback rather than the whole item object.

- [ ] **Step 4: Keep search responsive and skip offscreen paint**

Use:

```tsx
const deferredQuery = useDeferredValue(query.trim().toLowerCase());
```

Filter with `deferredQuery`. Add a class to cards:

```css
.summary-card {
  content-visibility: auto;
  contain-intrinsic-size: 0 152px;
}
```

Do not virtualize the list in this cycle.

- [ ] **Step 5: Verify request count and interaction behavior**

Run the homepage tests, full suite, build, bundle budget, and five-run preview measurement.

Expected:

- no Dashboard/About/auth RSC prefetch before intent;
- cold request count <= 20;
- input typing remains responsive with at least 60 fixture cards;
- no layout shift when offscreen cards enter the viewport;
- homepage JS Brotli <= 110 KiB or at least no >5% regression if server/client splitting changes chunk boundaries.

- [ ] **Step 6: Tighten budgets and commit**

Set homepage requests to `24`, total transfer to `256000`, JS Brotli to `112640`, LCP to `2500`, and TBT to `200` after the preview passes.

```bash
git add components/home components/AppHeader.tsx app/layout.tsx app/globals.css __tests__/home performance-budget.json
git commit -m "perf: reduce homepage client work"
```

---

### Task 5: Remove Proven Dashboard Waste and Defer YouTube

**Files:**
- Create: `components/LiteYouTubeEmbed.tsx`
- Create: `__tests__/components/LiteYouTubeEmbed.test.tsx`
- Modify: `app/dashboard/[id]/page.tsx:60,1492,1558,1728-1786,2065`
- Modify: `__tests__/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- `LiteYouTubeEmbed({ videoId, title }: { videoId: string; title: string })` renders a placeholder and creates the iframe only after activation.
- Dashboard no longer owns `fullTextOriginal` or fetches the source SRT during Summary load.

- [ ] **Step 1: Add the dead-request regression test**

Render a completed Dashboard payload whose `blobUrl` is `/api/files/test.srt`. Wait for Summary content, then assert:

```ts
expect(mockFetch.mock.calls.some(([input]) => String(input) === '/api/files/test.srt')).toBe(false);
```

Run: `npm test -- __tests__/dashboard/DashboardPage.test.tsx --runInBand`

Expected: FAIL because the current effect fetches the transcript.

- [ ] **Step 2: Delete the unused transcript path**

Remove:

- `fullTextOriginal` from the data type and initial/update objects;
- `transcriptCacheRef` if it has no remaining callers;
- the entire effect at current lines 1728-1786;
- `formatOriginalSrtAsMarkdown` and related imports if no remaining caller exists.

Run the focused Dashboard tests. Expected: PASS and no transcript request.

- [ ] **Step 3: Write the lite embed tests**

Tests must assert:

1. thumbnail/button renders with an accessible label;
2. no `youtube-nocookie.com` iframe exists initially;
3. click or Enter creates exactly one iframe;
4. iframe keeps `allowFullScreen` and the existing permission policy.

Run: `npm test -- __tests__/components/LiteYouTubeEmbed.test.tsx --runInBand`

Expected: FAIL before component creation.

- [ ] **Step 4: Implement the click-to-load embed**

The initial state must render a fixed-aspect placeholder. Only activation sets `active=true` and renders:

```tsx
<iframe
  src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
  title={title}
  loading="lazy"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowFullScreen
/>
```

Do not load YouTube scripts or iframe content before intent.

- [ ] **Step 5: Verify Dashboard before/after evidence**

On the same public podcast ID, record:

- initial request count and transfer;
- absence of `/api/files/...` request;
- absence of YouTube-domain requests before click;
- Summary rendering, language tabs, QA, Mind Map, and playback after click.

Run:

```bash
npm test -- __tests__/dashboard __tests__/components/LiteYouTubeEmbed.test.tsx --runInBand
npm test
npm run build
```

Expected: all tests/build pass; no transcript or YouTube request occurs before intent.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/[id]/page.tsx components/LiteYouTubeEmbed.tsx __tests__/components/LiteYouTubeEmbed.test.tsx __tests__/dashboard/DashboardPage.test.tsx
git commit -m "perf: remove dashboard startup waste"
```

---

### Task 6: Add CI Guardrails and a Safe Performance Preview

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `wrangler.preview.jsonc`
- Modify: `package.json`
- Modify: `scripts/verify-cloudflare-visual.mjs`

**Interfaces:**
- PR CI has no Cloudflare credentials and never deploys.
- Preview deploy uses Worker `podcast-summarizer-preview`, has no production route, and has cron disabled.

- [ ] **Step 1: Add non-deploying Node 22 CI**

Create `.github/workflows/ci.yml` with checkout, Node 22/npm cache, `npm ci`, lint, tests, build, and `npm run perf:bundle`. Upload `output/performance/` only when present.

The workflow must not reference `wrangler deploy`, `npm run deploy`, Cloudflare secrets, production domains, D1 migrations, or R2 mutations.

- [ ] **Step 2: Add an isolated preview config**

Base it on current compatibility settings but enforce:

```jsonc
{
  "name": "podcast-summarizer-preview",
  "workers_dev": true,
  "routes": [],
  "vars": {
    "DEPLOYMENT_STAGE": "preview",
    "ENABLE_CRON": "false",
    "NEXTAUTH_URL": "https://podcast-summarizer-preview.chenzixin1.workers.dev",
    "NEXT_PUBLIC_APP_URL": "https://podcast-summarizer-preview.chenzixin1.workers.dev"
  }
}
```

Use the existing preview D1 database ID `adbd887b-dd92-4180-bdee-0b185c61fefe`, no cron triggers, and no `podsum.cc` custom-domain routes. The account Workers subdomain was verified through the Cloudflare API as `chenzixin1`; re-check it before execution and stop if it has changed.

- [ ] **Step 3: Add explicit preview commands**

Add:

```json
{
  "deploy:preview": "npm run guard:worktree-drift && opennextjs-cloudflare build && wrangler deploy --config wrangler.preview.jsonc",
  "verify:preview:perf": "PERF_BASE_URL=$PREVIEW_BASE_URL npm run perf:lab"
}
```

Update `verify-cloudflare-visual.mjs` to require `CF_PREVIEW_BASE_URL` rather than silently using the now-missing `cf-preview.podsum.cc`.

- [ ] **Step 4: Verify preview isolation before first deploy**

Run:

```bash
rg 'podsum.cc|ENABLE_CRON|triggers|database_id' wrangler.preview.jsonc
npx wrangler deploy --dry-run --config wrangler.preview.jsonc
```

Expected: no production routes, `ENABLE_CRON=false`, no triggers, preview D1 ID only.

- [ ] **Step 5: Deploy preview and run the complete gate**

After setting preview-only secrets interactively, run:

```bash
npm run deploy:preview
PREVIEW_BASE_URL=https://podcast-summarizer-preview.chenzixin1.workers.dev
CF_PREVIEW_BASE_URL=$PREVIEW_BASE_URL npm run verify:cf-preview:visual
PERF_BASE_URL=$PREVIEW_BASE_URL npm run perf:home
PERF_BASE_URL=$PREVIEW_BASE_URL npm run perf:lab
```

Expected: functional/visual checks pass, five Lighthouse runs meet Task 4 budgets, and no production route or cron changes occur.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml wrangler.preview.jsonc package.json package-lock.json scripts/verify-cloudflare-visual.mjs
git commit -m "ci: gate frontend performance changes"
```

---

### Task 7: Production Rollout, RUM, and Before/After Report

**Files:**
- Modify: `docs/performance/home-baseline.md`
- Modify: `performance-budget.json`
- No source change unless a verified production-only issue appears.

**Interfaces:**
- Consumes: preview artifacts and tightened budgets from Tasks 1-6.
- Produces: production Worker version/build ID and a reproducible before/after report.

- [ ] **Step 1: Run the final local gate on a clean branch**

```bash
git status --short --branch
npm ci
npm run lint
npm test
npm run build
npm run perf:bundle
```

Expected: clean source tree before generated output, zero test/build failures, bundle budgets pass.

- [ ] **Step 2: Re-run preview five times and compare medians**

Require:

- mobile LCP <= 2.5 s or at least 15% better than 2.9 s;
- CLS <= 0.10;
- TBT <= 200 ms;
- header image <= 12 KiB;
- total transfer <= 250 KiB;
- no private rows in HTML;
- no pre-intent Dashboard/YouTube requests.

If LCP improves but TTFB exceeds 500 ms, reject the dynamic server path and keep static public HTML plus parallel client revalidation; do not ship a slower server response just to remove the CSR marker.

- [ ] **Step 3: Deploy production using the existing guarded process**

Load production environment variables without printing them, run `npm run deploy`, and record the returned Worker version ID and online `/BUILD_ID`.

- [ ] **Step 4: Run post-deploy smoke and performance verification**

Verify:

```bash
curl -sSIL https://podsum.cc/
HASHED_ASSET=$(curl -sS https://podsum.cc/ | rg -o '/_next/static/chunks/[^"?]+\.js' -m 1)
curl -sSIL "https://podsum.cc$HASHED_ASSET"
curl -sSIL https://podsum.cc/podcast-summarizer-icon-96-v1.png
PERF_BASE_URL=https://podsum.cc npm run perf:home
PERF_BASE_URL=https://podsum.cc npm run perf:lab
```

Expected: homepage 200, hashed asset and versioned icon use one-year immutable caching, no 4xx resources, and production medians meet preview budgets.

- [ ] **Step 5: Enable real-user Core Web Vitals**

Check Cloudflare Web Analytics first. If it is disabled, request approval for that external account-level change and enable its lightweight beacon. Do not simultaneously add `useReportWebVitals`.

Observe P75 by device and URL with these SLOs:

- LCP <= 2.5 s;
- INP <= 200 ms;
- CLS <= 0.10.

Use a 28-day window when the sample count is below 100; do not declare INP complete from Lighthouse/TBT alone.

- [ ] **Step 6: Complete the before/after report and tighten hard budgets**

Update `docs/performance/home-baseline.md` with:

- old/new commit, Worker version, and build ID;
- five-run median and range for every metric;
- request/transfer breakdown;
- initial HTML evidence;
- screenshots and Lighthouse artifact paths;
- any rejected experiment and why.

Convert the LCP assertion from warning at 2.8 s to error at 2.5 s only after preview and production both pass.

- [ ] **Step 7: Commit documentation and final budgets**

```bash
git add docs/performance/home-baseline.md performance-budget.json lighthouserc.cjs
git commit -m "docs: record frontend performance gains"
```

---

## Explicit Phase-2 Follow-up (Separate Plan)

Create a second plan only after this first cycle lands and traces confirm the remaining bottleneck. That plan may cover:

1. split the 68-410 KiB Dashboard analysis payload into overview, full-text, bilingual, and Mind Map resources;
2. parallelize authorized analysis-route I/O while preserving access control;
3. paginate/lazy-load QA history instead of rendering up to 120 messages immediately;
4. make public snapshot cache hits observable and safely invalidated;
5. progressively render or virtualize very long Markdown only when a long-task trace proves the need;
6. if the Task 6B TTFB/LCP gate fails, provision separate Preview and Production OpenNext incremental-cache R2 resources plus the supported revalidation queue, then verify repeated-request and TTL behavior.

These items are excluded from the first cycle because they change API payloads, snapshot schemas, permission boundaries, or user-visible loading behavior and deserve their own review/rollback boundary.

## Final Acceptance Checklist

- [ ] Initial Explore HTML contains public cards and no CSR bailout fallback.
- [ ] No private data appears in cacheable HTML or performance artifacts.
- [ ] Mobile LCP is <= 2.5 s or improves at least 15% without TTFB regression.
- [ ] Header logo transfer is <= 12 KiB.
- [ ] Hashed static assets and the versioned logo use one-year immutable browser caching.
- [ ] Homepage cold transfer is <= 250 KiB and requests are <= 20.
- [ ] Dashboard Summary load does not fetch an unused SRT.
- [ ] YouTube is not requested before user intent.
- [ ] All Jest tests, type checks, lint, build, bundle budgets, visual checks, and preview Lighthouse runs pass.
- [ ] Production smoke and five-run performance verification match preview.
- [ ] RUM source is exactly one of Cloudflare Web Analytics or Next.js custom reporting, not both.
