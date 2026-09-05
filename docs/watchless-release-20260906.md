# Watchless review and release — 2026-09-06

## Implemented

- Treat Watchless as a normal podcast with a separate, faithful illustrated reader. Overview no longer counts as complete analysis.
- Both MCP bundles and URL output queue detailed bilingual Summary, aligned Full Text and bilingual mind maps; supplied MCP analysis can avoid that model call.
- Original source text is preserved, checksummed and separately stored. Keyframes follow exact scene references, not filename sorting.
- File and snapshot access follows current podcast visibility/ownership. Processing uses the persisted canonical source, bounded reads and signed temporary ASR URLs.
- Credit reservations/refunds are atomic and idempotent. Retries count toward the daily limit; cancellation cannot race publication for a refund.
- Historical repair stages and validates candidates before an atomic switch, retains private backups, invalidates stale QA and analysis leases, and reuses paid checkpoints.
- Watchless and transcript QA use Cloudflare GLM-5.3 Flash explicitly, with no cross-provider billing fallback. Other ordinary analysis models and the 1000-credit URL-conversion gate are unchanged.
- The analysis queue is bounded at three concurrent leases for historical backfill; video conversion remains one active job per user and one Container instance. This changes throughput, not the credit or source limits.
- Existing paper/green UI retained; source section is compact, analysis and original reading are distinguished, QA loads on demand, and collapsed content is keyboard-inert.
- QA history is private to the signed-in user, responses are no-store, and inference is limited to 30 attempts/hour/user. History must finish loading before sending. Provider reasoning is excluded from both new answers and historical readback.
- Detailed analysis reserves each paid attempt durably before inference (maximum two format attempts per source part). Validated checkpoints are reused. A provider-only bare-scene envelope compatibility fix recovers already-paid output without another call; MCP validation remains strict.
- Translations are bounded to 12 utterances/about 4000 characters per request and matched by stable IDs, never by response ordering alone.
- Mind-map nodes no longer depend on a destroyed graph during React teardown; repeated tab switching is covered by live browser tests.

## Verification before release

- Jest: 85 suites, 712 tests, one snapshot passed (including the pronunciation follow-up).
- Python: six unit tests and five HTTP tests passed inside the Linux amd64 image. Full resolved dependency audit is clean after upgrading FastAPI/Starlette; the image runs as non-root.
- TypeScript and changed-file ESLint: passed; nine pre-existing dashboard warnings remain (no errors).
- Production npm dependency audit: zero vulnerabilities. Ten affected development dependency entries in LHCI are tracked in [issue 16](https://github.com/chenzixin1/PodcastSummarizer/issues/16); no unsafe force-downgrade was applied.
- Real in-memory SQLite tests cover batch rollback, insufficient credits, repeated reservation/refund, daily retry limits, cancelled/reassigned leases and concurrent repair/publication.
- Read-only browser preview at 1440×960 and 390×844: four reading modes, keyboard QA toggle, reduced-motion collapse/focus return, and no horizontal overflow. Screenshots are local `output/playwright/release-*.png`. These previews do not prove historical production rows have been repaired.
- R2 `r2.dev` is disabled; no bucket custom domain; no current podcast source points at public Vercel Blob URLs.

## Live acceptance (in progress, not an all-pass claim)

- The previously failed URL job completed successfully using GLM on the deployed Linux Container: 30 scenes, 38 saved artifacts, 13 minutes 21 seconds, 1000 credits charged once. The published result is `/dashboard/watchless-veizk1m7v7e`.
- Its canonical source is 77011 bytes, SHA-256 `cfc70b33316ebaa491715d11b24939767c3bf4ab615c0691c0c37e416bb1729f`; every scene has both language texts. All four reader modes display all 30 scenes (60 columns in bilingual mode), and desktop/mobile have no horizontal overflow.
- Existing public and owner-private readers were checked in authenticated UI. Anonymous access to all nine private articles, objects and snapshots was denied in the earlier corpus sweep; all 531 then-public PDF/keyframe URLs returned success with no-store. A fresh sweep includes the new article and is still running.
- Real Mind Map → Infographic / Full Text switching, three cycles: zero page errors. Infographic image loaded successfully. Summary, Full Text and Watchless four-mode behavior was checked separately.
- The real QA request returned and persisted a grounded answer; the initial history-loading race and provider draft leakage discovered during that check have regression fixes. Final post-deploy authenticated history readback showed only the final answer.
- All 75 ordinary podcast analysis endpoints passed the access/readback sweep, including the 59 public records and anonymous denial of private records. Three local transport timeouts were rechecked using bounded read-only requests; the final report has zero failed ordinary endpoints.
- Historical language/full-text repair and detailed analysis are bounded background work, not complete corpus acceptance. Original source hashes remain unchanged on successful repairs; immutable backup references are retained. Current outcomes are tracked in issue 18, rather than implying one repaired page proves the whole library.
- MCP positive publish/submit acceptance is blocked by the current Codex token lacking both Watchless scopes. No token was broadened without user approval; negative permission checks and route/transaction tests pass.

## Backup and rollout

- D1 Time Travel bookmark before changes: `00000230-00002468-000050dd-b5931250e41d8ed5fa607ad92db8ca1e`.
- Full SQL export download is in progress; it is not yet a verified complete local backup.
- Migrations `0008_watchless_analysis_origin.sql` and `0009_qa_privacy_and_limits.sql` applied successfully. Existing Watchless overview rows are explicitly marked as such.
- Each operator repair additionally creates a private immutable R2 backup before writing; original article, PDF, keyframes and source objects are not overwritten.
- Final incremental Worker `6cba07bf-c036-4fe1-95c7-392209d2c7eb` is deployed to podsum.cc and www.podsum.cc, release source `b5c5e1a` (clean release-worktree equivalent `511fbf0`). GitHub CI run `33980049560` passed.
- Container app `a030dd25-bfde-4011-b2ee-17ea0e532d6b`, version 10, image digest `sha256:9445ded02ed08ebc8f34d43739ee1dd5520be8036734d3d0467ff27746be2064` is deployed and completed the real URL run. The final Worker patch reuses this unchanged image.
- Release builds use a real dependency installation, not a cross-worktree `node_modules` symlink (which breaks OpenNext's native-module exclusion). `dev.enable_containers=false` avoids Wrangler's local platform-proxy assertion during cache population; production Container bindings and deployment remain enabled. Runtime tests use the real Docker image separately.
- When the OpenNext local cache proxy failed, the release used its exact computed cache keys and uploaded all 26 entries through Cloudflare R2 REST with byte-identical readback. Deployment still ran the clean-worktree guard; no dirty-deploy bypass was used.

## Boundaries

Hash validation proves consistency with submitted transcripts, not the accuracy of ASR against the audio. Existing recognised-word uncertainties are retained, not silently rewritten. Previously downloaded or browser-cached private content cannot be recalled by a server patch; future requests must enforce the current access rules.

The current URL-runtime PDF contains Chinese text and timestamps but not the web reader's keyframe images. Illustrated-PDF parity is tracked in issue 20; successful file responses are not presented as proof of that parity. Seven-criteria review and all tracked follow-ups are in `docs/code-review-20260906.md`.

## Pronunciation follow-up — 2026-09-06

- User reported that Watchless vocabulary cards lacked the standard reader's automatic pronunciation. The cards now reuse the existing recorded-audio/browser-TTS controller and defaults. No paid-model API was added.
- Mouse/pen hover starts playback; leaving stops. Keyboard focus and activation work; touch taps play once rather than starting a hover loop. Language changes, article collapse, window blur and unmount stop playback.
- Real desktop production check on `/dashboard/watchless-veizk1m7v7e`: `foundation` emitted audio play/playing/pause events, and `capability` invoked system speech with `en-US`. The automation browser did not emit a native TTS start event; this verifies the fallback call, not audible output on every OS/voice.
- Real touch-emulated 390×844 local check: one tap emitted one audio play/playing pair, no repeated loop after 1800 ms, and no horizontal overflow. Screenshots: `output/playwright/production-watchless-pronunciation.png` and `output/playwright/watchless-pronunciation-mobile.png`.
- Latest Worker: `9f62dce7-141e-4aa0-9d4a-758d708cc8cc`, source `c6712cf`, clean release-worktree equivalent `42b318f`; Container unchanged. CI runs `33980733941` and `33980731774` passed. PR #21 remains draft pending the wider acceptance in #18.
- Wider backfill remains incomplete: the ULi repair rejected an incomplete 12-turn translation response (10 returned) before committing. Four analysis jobs currently have timeout outcomes requiring checkpoint/operator review. These are not included in a claim of full historical completion.
