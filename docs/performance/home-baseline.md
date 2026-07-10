# PodSum Homepage Performance Baseline

## Measurement record

- Measurement date: 2026-07-10
- Production URL: <https://podsum.cc/>
- Production Worker version: `75e53f8f-412e-436b-9e15-6ac88f0b4708`
- Production build ID: `Y6ntilBTo4j2MxYgngQRk`
- Device profile: PageSpeed Insights/Lighthouse mobile emulation for the confirmed baseline; `Pixel 5` for `perf:home`
- Repeat rule: run five cold mobile measurements in fresh browser contexts and compare the median; the warm measurement is diagnostic only
- PageSpeed report: [PodSum mobile report](https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fpodsum.cc%2F&form_factor=mobile)

## Confirmed baseline and first-cycle target

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
| Homepage JavaScript, Brotli | 112.2-112.6 KiB | <= 110 KiB and never >5% over baseline |
| Homepage CSS, Brotli | about 11 KiB | <= 16 KiB |
| Homepage fonts | about 51-56 KiB | <= 36 KiB |
| Header logo transfer | about 134.6-138 KiB | <= 12 KiB |
| Public homepage TTFB | 189 ms median, 126-296 ms range | <= 500 ms median after SSR change |

## Task 6B isolated Preview verification

The final Preview-only deployment was measured from commit `c698377c3eb0d9d45f9c4c63bc0e4819be8641e7` at <https://podcast-summarizer-preview.chenzixin1.workers.dev/>. Deployment `179a4973-c638-4d14-946b-81bcb3d977bc` serves Worker version `00dd8ea2-04b1-4802-81c3-33257c585716` and build `UJXyk7pMd7dp4q-2nwmLw`. The production deployment remained `60e4ef7c-b199-4f11-b0d7-d30282e083db`, Worker version `ce5a53b2-ecb0-4db8-937c-e014785c864a`, build `iOx-Zzm1IIsSrblLN2Ywn` throughout this work.

Five fresh PageSpeed/Lighthouse mobile executions used unique query-only cache busters and produced five distinct `fetchTime` values. The query parameter did not alter the page mode; every run rendered Explore. Values below are the five-run median and full range:

| Metric | Preview median | Range | Result |
|---|---:|---:|---|
| Lighthouse mobile Performance | 99 | 95-100 | Pass |
| Mobile FCP | 0.975 s | 0.284-1.250 s | Pass |
| Mobile LCP | 1.652 s | 0.407-1.952 s | Pass |
| Mobile TBT | 53 ms | 0-226 ms | Pass by the configured median rule |
| Mobile CLS | 0.00076 | 0.00013-0.00076 | Pass |
| Speed Index | 1.944 s | 0.974-3.330 s | Pass |
| External server response | 7 ms | 3-10 ms | Pass |
| Homepage requests | 14 | 14-14 | Pass |
| Homepage transfer | 210,073 B | 210,005-210,109 B | Pass |
| Versioned header icon transfer | 8,711 B | 8,703-8,711 B | Pass |

A representative resource breakdown was 140,964 B JavaScript, 29,953 B font, 15,450 B document, 13,920 B CSS, 8,711 B image, and 1,030 B other, with no media or third-party transfer. The icon's encoded body is 8,042 B. Live hashed font, CSS, JavaScript, and the versioned icon all returned `Cache-Control: public, max-age=31536000, immutable`.

Cloudflare Browser Rendering independently confirmed 12 public cards in the rendered homepage and 14 initial requests. The initial network had zero Upload/sign-in, Dashboard, About, or hydration page-one prefetches. Hover then focus on one card produced exactly one matching Dashboard RSC request. Scrolling added zero CLS. The Dashboard loaded Summary, Full Text, Mind Map, language, vocabulary, and QA controls with no `/api/files/` or YouTube request before intent; clicking Play created exactly one `youtube-nocookie` iframe.

The Preview database needed the existing additive `0002_add_source_published_at.sql` migration before it could render its existing public records. This migration was approved and applied only to D1 database `podsum-d1-preview`; counts stayed at 58 podcasts, 53 public podcasts, 55 analyses, and 50 public podcasts with analyses. No R2 binding, production route, cron, production D1 migration, or production Worker mutation occurred.

The local network intercepted `*.workers.dev` TLS with a mismatched certificate, so local `curl`, `perf:home`, `perf:lab`, and the local visual verifier could not produce valid live Preview results. The five external Lighthouse runs and Cloudflare's independent remote browser are the acceptance evidence; the failed curl traces are retained under `output/performance/task-6b/ttfb/`. At this stage the direct public snapshot-to-D1 loader was retained. The production follow-up below supersedes that decision after the first production Lighthouse batch exposed slower uncached server response times.

Evidence is under `output/performance/task-6b/postfix-psi/` and `output/performance/task-6b/browser-rendering/`; the full execution ledger is `.superpowers/sdd/task-6b-report.md`. Based on this Preview evidence, `performance-budget.json` now caps homepage requests at 24, transfer at 256,000 B, LCP at 2,500 ms, and TBT at 200 ms. The root JavaScript Brotli ceiling remains 122,880 B because the verified build is 115,130 B and would not fit the originally proposed 112,640 B ceiling.

## Production release and cache follow-up

PRs [#11](https://github.com/chenzixin1/PodcastSummarizer/pull/11) and [#12](https://github.com/chenzixin1/PodcastSummarizer/pull/12) were merged to `main`. The final production deployment is commit `570fba1abb03b6b5067d48e8712a5a75258d677c`, deployment `31831c35-7a21-49b6-aa8f-7d72d5ccd11a`, Worker version `75e53f8f-412e-436b-9e15-6ac88f0b4708`, and build `Y6ntilBTo4j2MxYgngQRk`.

The first production Lighthouse batch after PR #11 had a median LCP of 2,628 ms, above the 2,500 ms hard gate. PR #12 therefore added a 60-second `unstable_cache` around public homepage data, an R2 incremental cache, OpenNext regional cache, and a Durable Object revalidation queue. Authenticated/private homepage data remains outside the shared cache. Preview and Production use separate R2 buckets.

The final five-run production Lighthouse CI batch passed all assertions:

| Metric | Final production median | Five-run range | Result |
|---|---:|---:|---|
| Lighthouse mobile Performance | 98 | 83-99 | Pass |
| Mobile FCP | 1.218 s | 1.179-2.546 s | Pass |
| Mobile LCP | 2.169 s | 1.441-2.777 s | Pass |
| Mobile TBT | 5 ms | 4-14 ms | Pass |
| Mobile CLS | 0.00067 | 0-0.01182 | Pass |
| Server response | 545 ms | 326-2,577 ms | Diagnostic; one cold/revalidation outlier |

Compared with the failed pre-cache production batch, median LCP improved from 2,628 ms to 2,169 ms (17.5%). `perf:home` independently measured median cold FCP/LCP at 1,048 ms with 14 requests and 210,400 B transferred. Cloudflare Browser Run used five fresh contexts from an external network and measured median TTFB at 86 ms and median FCP/LCP at 639 ms. Its first request was cold at 1,523 ms TTFB; the four cache-hit requests were 70-110 ms. Every run rendered 12 unique waterfall cards and returned HTTP 200.

Live smoke checks confirmed `/BUILD_ID` exactly matches `Y6ntilBTo4j2MxYgngQRk` and the public snapshot endpoint returns 12 records. The final deployment preserves the production D1 and upload R2 bindings and adds only the isolated `podsum-next-cache-production` cache bucket, Worker self-reference, and `NEXT_CACHE_DO_QUEUE` binding.

## Reproduce the baseline

Clean worktrees must provide a non-production `NEXTAUTH_SECRET` placeholder while Next.js collects route data. Task 6 CI will use the same `ci-build-placeholder` value; it is not a production credential.

```bash
NEXTAUTH_SECRET=ci-build-placeholder npm run build
npm run perf:bundle
npm run perf:home
PERF_BASE_URL=https://podsum.cc npm run perf:lab
```

`perf:bundle` reads the generated Next.js manifests and enforces the defensive limits in `performance-budget.json`. `perf:home` writes five cold runs and one warm run to `output/performance/home-<build-id>.json`. Lighthouse CI writes its five-run mobile reports to `output/performance/lhci/` and evaluates median assertions; LCP and the overall score begin in warning-only mode.
