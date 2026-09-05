# Watchless review and release — 2026-09-06

## Implemented

- Treat Watchless as a normal podcast with a separate, faithful illustrated reader. Overview no longer counts as complete analysis.
- Both MCP bundles and URL output queue detailed bilingual Summary, aligned Full Text and bilingual mind maps; supplied MCP analysis can avoid that model call.
- Original source text is preserved, checksummed and separately stored. Keyframes follow exact scene references, not filename sorting.
- File and snapshot access follows current podcast visibility/ownership. Processing uses the persisted canonical source, bounded reads and signed temporary ASR URLs.
- Credit reservations/refunds are atomic and idempotent. Retries count toward the daily limit; cancellation cannot race publication for a refund.
- Historical repair stages and validates candidates before an atomic switch, retains private backups, invalidates stale QA and analysis leases, and reuses paid checkpoints.
- Watchless uses Cloudflare GLM-5.3 Flash. Other PodSum models and the 1000-credit URL-conversion gate are unchanged.
- Existing paper/green UI retained; source section is compact, analysis and original reading are distinguished, QA loads on demand, and collapsed content is keyboard-inert.

## Verification before release

- Jest: 78 suites, 620 tests, one snapshot passed.
- Python: six unit tests and five HTTP tests passed inside the Linux amd64 image. Full resolved dependency audit is clean after upgrading FastAPI/Starlette; the image runs as non-root.
- TypeScript and changed-file ESLint: passed; nine pre-existing dashboard warnings remain (no errors).
- Production npm dependency audit: zero vulnerabilities. Ten affected development dependency entries in LHCI are tracked in [issue 16](https://github.com/chenzixin1/PodcastSummarizer/issues/16); no unsafe force-downgrade was applied.
- Real in-memory SQLite tests cover batch rollback, insufficient credits, repeated reservation/refund, daily retry limits, cancelled/reassigned leases and concurrent repair/publication.
- Read-only browser preview at 1440×960 and 390×844: four reading modes, keyboard QA toggle, reduced-motion collapse/focus return, and no horizontal overflow. Screenshots are local `output/playwright/release-*.png`. These previews do not prove historical production rows have been repaired.
- R2 `r2.dev` is disabled; no bucket custom domain; no current podcast source points at public Vercel Blob URLs.

## Backup and rollout

- D1 Time Travel bookmark before changes: `00000230-00002468-000050dd-b5931250e41d8ed5fa607ad92db8ca1e`.
- Full SQL export download is in progress; it is not yet a verified complete local backup.
- Migration `0008_watchless_analysis_origin.sql` applied successfully. Existing Watchless overview rows are explicitly marked as such.
- Each operator repair additionally creates a private immutable R2 backup before writing; original article, PDF, keyframes and source objects are not overwritten.
- Worker/Container rollout and live historical readback are pending below. Do not interpret local tests as deployed verification.
- Release builds use a real dependency installation, not a cross-worktree `node_modules` symlink (which breaks OpenNext's native-module exclusion). `dev.enable_containers=false` avoids Wrangler's local platform-proxy assertion during cache population; production Container bindings and deployment remain enabled. Runtime tests use the real Docker image separately.

## Boundaries

Hash validation proves consistency with submitted transcripts, not the accuracy of ASR against the audio. Existing recognised-word uncertainties are retained, not silently rewritten. Previously downloaded or browser-cached private content cannot be recalled by a server patch; future requests must enforce the current access rules.
