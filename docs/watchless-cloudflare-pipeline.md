# Watchless on PodSum: Cloudflare pipeline

This implementation keeps the original Watchless repository and Codex skill unchanged. PodSum owns a thin, production-specific execution and publishing layer.

## Two ingestion paths

### URL conversion

The PodSum Upload page, `podsum_submit_watchless_url`, or `POST /api/watchless/jobs` accepts an authorized YouTube URL. The web page switches only its YouTube branch to this pipeline; the existing one-credit SRT branch remains unchanged. Creating the job atomically:

1. verifies the source host and 11-character video id;
2. verifies explicit rights confirmation;
3. rejects users with fewer than 1,000 credits, another active URL job, or three paid reservation attempts (including refunded retries) in the last 24 hours;
4. reserves 1,000 credits in the D1 ledger; and
5. starts one durable Cloudflare Workflow.

The Workflow starts a job-named Container. The Container downloads at most one public YouTube video, enforces a two-hour and 1 GiB limit, extracts audio, calls Volcengine ASR, calls Cloudflare `@cf/zai-org/glm-5.3-flash` for structured analysis and aligned translations, extracts keyframes, creates a PDF, and uploads checksummed assets through the internal callback API. Provider selection is explicit and never silently switches billing accounts.

English original bodies are copied deterministically from ASR, grouping only adjacent segments attributed to the same displayed speaker and rendering every contiguous turn as its own paragraph. The Chinese body is a separately labelled, aligned translation; it must not replace the original. A scene with no source utterance fails validation instead of receiving placeholder content. ASR errors are not silently corrected or claimed to have been audio-verified.

The reservation becomes a charge only when D1 atomically commits the podcast, analysis, Watchless publication, asset records, and completed job state. Workflow/platform failure or a safe pre-commit cancellation refunds it exactly once.

### Codex bundle publishing

An agent with `watchless:publish` can call:

1. `podsum_begin_watchless_publish`
2. `podsum_upload_watchless_asset` for small base64 files, or the returned authenticated HTTP PUT endpoint for larger files
3. `podsum_commit_watchless_publish`
4. `podsum_get_watchless_publish_status`
5. `podsum_rollback_watchless_publication`

This path does not download or convert video and therefore does not reserve the 1,000-credit compute charge. It requires an `article` JSON asset, a PDF, enough keyframes for all scenes, SHA-256 checksums, source authorization, and the same article schema used by the PodSum reader.

Every frame is matched to its scene by the exact submitted path, not filename sorting. Supply either the original transcript attachment or `sourceTranscript` for every scene. Publication saves a canonical text source and provenance hashes; article JSON is never used as the podcast transcript. The provenance check proves submission consistency, not audio accuracy.

Optionally upload `analysis.json` with role `manifest`:

```json
{"version":1,"scenes":[{"id":"scene-1","titleZh":"观点与依据","titleEn":"Arguments and evidence","points":[{"zh":"完整中文要点及其上下文。","en":"A substantive point and its supporting context."},{"zh":"保留限定条件与不确定性。","en":"Preserve relevant qualifications and uncertainty."}]}]}
```

Cover every article scene in order with 2–12 paired substantive points. Without this file, publishing queues a separate GLM full-analysis task. The overview stays readable but is not marked complete. The full task writes bilingual Summary, aligned Full Text and both mind maps without changing source utterances. Publication status and analysis status are independent, so a failed analysis does not remove the article. Checkpoints, current article version and worker leases protect retries and concurrent repairs.

Each publisher may keep at most three bundle jobs active. Every asset is limited to 50 MiB, every bundle to 100 assets and 350 MiB, and D1 triggers enforce the aggregate limits even when uploads race.

`watchless:submit` and `watchless:publish` are separate MCP scopes. A publisher-only token cannot start the expensive URL pipeline.

## State model

`created -> queued -> preparing -> transcribing -> segmenting -> rendering -> validating -> publishing -> completed`

Bundle jobs start in `awaiting_upload`. Terminal states are `completed`, `failed`, `cancelled`, and `rolled_back`. Terminal jobs cannot be moved to a different state. Cancellation is allowed only before validation/publishing begins; this prevents a refund racing an atomic publication commit.

## Production bindings and secrets

Wrangler bindings:

- `PODSUM_DB` (D1)
- `PODSUM_BUCKET` (R2)
- `WATCHLESS_WORKFLOW` (Workflow)
- `WATCHLESS_CONTAINER` (Container Durable Object)
- `WORKER_SELF_REFERENCE` (internal Worker service binding)

Required Worker secrets (never commit values):

- `WATCHLESS_CF_API_TOKEN` for the Cloudflare provider; `OPENROUTER_API_KEY` is needed only for the explicitly selected OpenRouter provider and other existing PodSum features
- `VOLCENGINE_API_KEY`, or the existing compatible `VOLCANO_ACCESS_KEY` binding
- `VOLCENGINE_APP_KEY` when the Volcengine account requires an app key
- `WATCHLESS_INTERNAL_SECRET`, a random high-entropy value used only between the Workflow, Container, and internal routes

## Deployment order

1. Run tests, OpenNext build, and a real `wrangler deploy --dry-run` that builds the amd64 image.
2. Verify the required secret names exist.
3. Back up D1 (Time Travel bookmark and per-article repair backups), then apply pending migrations including `0008_watchless_analysis_origin.sql`.
4. Deploy the Worker, Workflow, Durable Object migration, and Container image together.
5. Submit a short authorized test video from an account with at least 1,000 credits.
6. Read back the Workflow state, credit ledger, normal podcast list entry, reader page, R2 objects, and generated PDF.

Do not expose the internal callback routes, secret values, R2 staging keys, or direct Container endpoint to clients.

## Historical repair

The operator-only `POST /api/worker/watchless-repair` accepts one `id` and an explicit `inspect`, `project`, `bilingual`, or `enqueue` action. It uses the existing worker shared secret; it is not a public or MCP publishing capability. Every mutation first stores an immutable private backup, validates candidate source and bilingual content, and atomically switches publication, Full Text and canonical source. Old QA chunks and active analysis leases are invalidated. Original assets remain intact. Checkpoint storage failures stop processing rather than triggering duplicate model charges.

Run one article first and verify both Summary and original-word reading before any bounded batch. Full audit's development-only Lighthouse CI advisories are tracked in GitHub issue #16; production npm dependencies currently audit clean.
