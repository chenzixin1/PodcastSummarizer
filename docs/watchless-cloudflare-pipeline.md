# Watchless on PodSum: Cloudflare pipeline

This implementation keeps the original Watchless repository and Codex skill unchanged. PodSum owns a thin, production-specific execution and publishing layer.

## Two ingestion paths

### URL conversion

The PodSum Upload page, `podsum_submit_watchless_url`, or `POST /api/watchless/jobs` accepts an authorized YouTube URL. The web page switches only its YouTube branch to this pipeline; the existing one-credit SRT branch remains unchanged. Creating the job atomically:

1. verifies the source host and 11-character video id;
2. verifies explicit rights confirmation;
3. rejects users with fewer than 1,000 credits, another active URL job, or three URL jobs already created in the last 24 hours;
4. reserves 1,000 credits in the D1 ledger; and
5. starts one durable Cloudflare Workflow.

The Workflow starts a job-named Container. The Container downloads at most one public YouTube video, enforces a two-hour and 1 GiB limit, extracts audio, calls Volcengine ASR, calls `openai/gpt-5.6-luna` through OpenRouter for structured scene/article output, extracts keyframes, creates a PDF, and uploads checksummed assets through the internal callback API.

The reservation becomes a charge only when D1 atomically commits the podcast, analysis, Watchless publication, asset records, and completed job state. Workflow/platform failure or a safe pre-commit cancellation refunds it exactly once.

### Codex bundle publishing

An agent with `watchless:publish` can call:

1. `podsum_begin_watchless_publish`
2. `podsum_upload_watchless_asset` for small base64 files, or the returned authenticated HTTP PUT endpoint for larger files
3. `podsum_commit_watchless_publish`
4. `podsum_get_watchless_publish_status`
5. `podsum_rollback_watchless_publication`

This path does not download or convert video and therefore does not reserve the 1,000-credit compute charge. It requires an `article` JSON asset, a PDF, enough keyframes for all scenes, SHA-256 checksums, source authorization, and the same article schema used by the PodSum reader.

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

- `OPENROUTER_API_KEY`
- `VOLCENGINE_API_KEY`, or the existing compatible `VOLCANO_ACCESS_KEY` binding
- `VOLCENGINE_APP_KEY` when the Volcengine account requires an app key
- `WATCHLESS_INTERNAL_SECRET`, a random high-entropy value used only between the Workflow, Container, and internal routes

## Deployment order

1. Run tests, OpenNext build, and a real `wrangler deploy --dry-run` that builds the amd64 image.
2. Verify the required secret names exist.
3. Apply `0006_add_watchless_jobs.sql` to the remote D1 database.
4. Deploy the Worker, Workflow, Durable Object migration, and Container image together.
5. Submit a short authorized test video from an account with at least 1,000 credits.
6. Read back the Workflow state, credit ledger, normal podcast list entry, reader page, R2 objects, and generated PDF.

Do not expose the internal callback routes, secret values, R2 staging keys, or direct Container endpoint to clients.
