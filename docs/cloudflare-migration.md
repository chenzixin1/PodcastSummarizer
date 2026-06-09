# Cloudflare Migration Checklist

## Current Production Baseline

- Production URL: https://podsum.cc/
- Current host: Vercel
- Current database client: `@vercel/postgres`
- Current object storage: Vercel Blob URLs stored in `podcasts.blob_url`; historical extension temp audio references may also appear in `extension_transcription_jobs.audio_blob_url`

Do not move `podsum.cc` or `www.podsum.cc` DNS/routes until the Cloudflare Worker URL has been verified against production behavior.

## Runtime Platform

1. Build with `NEXTAUTH_SECRET` and `NEXTAUTH_URL` set.
2. Run `npm run build`.
3. Run `npx opennextjs-cloudflare build`.
4. Deploy first without production routes. Keep `workers_dev` enabled for preview verification only.
5. Use `cf-preview.podsum.cc` for Cloudflare preview verification.
6. Only after validation, deploy a generated production config for `podsum.cc` and `www.podsum.cc`. The generated production config defaults to `workers_dev: false` and does not include `cf-preview.podsum.cc` unless `CUTOVER_KEEP_PREVIEW=true` is explicitly set.

## Cron Jobs

`worker.ts` includes a Cloudflare `scheduled()` handler for the current background jobs. To avoid the Cloudflare preview Worker racing the current Vercel production cron against the shared database, the preview `wrangler.jsonc` sets `DEPLOYMENT_STAGE=preview`, `ENABLE_CRON=false`, and does not declare cron triggers.

The generated production cutover config re-enables the two cron triggers with `DEPLOYMENT_STAGE=production` and `ENABLE_CRON=true`:

```jsonc
"triggers": {
  "crons": ["0 3 * * *", "0 4 * * *"]
}
```

The preview Worker was redeployed after this split, and the deploy output no longer listed `schedule:` entries for `cf-preview.podsum.cc`.

## Database Migration

The app uses Postgres features broadly, including JSONB columns and many tagged-template SQL calls. D1 would require a larger SQL rewrite, so the safer migration path is Postgres-to-Postgres plus Cloudflare runtime access.

Current Cloudflare preview uses the existing Postgres connection from the synced environment variables. That means application data is available to Cloudflare now, but the database has not been physically copied to a new target Postgres database yet. A physical database move still needs a target Postgres connection string.

Cloudflare Hyperdrive is available on the account but no Hyperdrive config is currently present. Hyperdrive can connect Workers to an existing PostgreSQL database through a binding, but this codebase still uses `@vercel/postgres` directly across the app. Wiring Hyperdrive should be handled as a separate database-client change, likely by moving shared DB access to `pg`/node-postgres and using `env.HYPERDRIVE.connectionString` in the Worker runtime.

Use `scripts/migrate-postgres-to-cloudflare.sh` when moving from the current Vercel/Neon Postgres database to a target Postgres database:

```bash
SOURCE_POSTGRES_URL="postgres://..." \
TARGET_POSTGRES_URL="postgres://..." \
scripts/migrate-postgres-to-cloudflare.sh
```

For Cloudflare runtime, configure `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` for the target Postgres database. If using Hyperdrive, create it with the target connection string and add the binding ID to `wrangler.jsonc` before deployment.

## File Migration

New uploads use `lib/objectStorage.ts`, which writes to the `PODSUM_BUCKET` R2 binding on Cloudflare and falls back to Vercel Blob locally when `BLOB_READ_WRITE_TOKEN` is present.

Historical Vercel Blob files must be copied to R2. The migration script reads both `podcasts.blob_url` and `extension_transcription_jobs.audio_blob_url`; it defaults to copy-only mode and only writes database URLs if `R2_MIGRATION_UPDATE_DB=true` is explicitly set.

```bash
POSTGRES_URL="postgres://..." \
NEXTAUTH_URL="https://<cloudflare-preview-or-final-domain>" \
R2_BUCKET_NAME="podsum-uploads" \
R2_MIGRATION_DRY_RUN="true" \
node scripts/migrate-vercel-blob-to-r2.mjs
```

After reviewing the dry run, remove `R2_MIGRATION_DRY_RUN` to copy files into R2. Do not set `R2_MIGRATION_UPDATE_DB=true` during the copy phase; use `npm run r2:apply-manifest` at final cutover instead.

If R2 has a public bucket/custom domain, set `R2_PUBLIC_BASE_URL`. Otherwise migrated URLs use the app route `/api/files/<key>`.

The historical file copy was run in copy-only mode against `cf-preview.podsum.cc`: 56 real, still-readable Vercel Blob objects were copied into the `podsum-uploads` R2 bucket and recorded in `tmp/r2-migration-manifest.jsonl`. Two seeded `https://example.com/test-podcast.srt` rows were skipped because they are test rows. Four `extension_transcription_jobs.audio_blob_url` rows point to old extension temp audio files that now return 404, and Vercel Blob listing shows no `extension-audio/` objects left; the audit reports these as `staleSourceRows` rather than R2 copy gaps. Keep the database URL rewrite for final cutover so current Vercel production does not start pointing at Cloudflare preview file URLs.

Before final domain cutover, dry-run the database URL rewrite from the manifest:

```bash
FINAL_APP_URL="https://podsum.cc" npm run r2:apply-manifest
```

After confirming the dry run, apply it:

```bash
FINAL_APP_URL="https://podsum.cc" R2_MANIFEST_APPLY="true" npm run r2:apply-manifest
```

If a post-cutover rollback is needed after the manifest was applied, restore old Vercel Blob URLs first:

```bash
FINAL_APP_URL="https://podsum.cc" R2_MANIFEST_ROLLBACK="true" npm run r2:rollback-manifest
```

## Preview Verification

Run the production-vs-preview regression check after each Cloudflare deploy:

```bash
npm run verify:cf-preview
```

This compares public page visible text, auth provider configuration, podcast/analysis API data, the production hosting shape, the Cloudflare preview hosting shape, and R2 object readability.

The preview verifier now walks every `/api/podcasts?page=<n>&pageSize=50` page and compares every public `/api/analysis/<id>` payload from production and preview. A first-pass exact mismatch is retried once; persistent mismatches fail the check.

Run the broader data migration audit when checking whether data and files are covered:

```bash
npm run audit:data-migration
```

Capture a cutover baseline snapshot before production changes:

```bash
npm run baseline:capture
```

This writes `output/cutover/baseline-snapshot.json` with page text hashes, auth provider state, paginated public podcast API hashes, and all public analysis API hashes for both current Vercel production and Cloudflare preview.

The June 8 audit result covered:

- database table counts: `podcasts=58`, `analysis_results=55`, `qa_context_chunks=3652`, `qa_messages=35`, `processing_jobs=31`, `users=13`, plus extension monitor/transcription tables
- file rows: 62 total file URL rows, including 58 `podcasts.blob_url` rows and 4 `extension_transcription_jobs.audio_blob_url` rows
- source coverage: 60 Vercel Blob URL references, of which 56 are still readable and 4 old extension temp audio URLs are stale 404s
- R2 coverage: 56 manifest rows, 56 readable copied objects, 0 missing manifest rows for copyable source files, 0 failed R2 HEAD checks
- API parity: production and Cloudflare preview both returned 53 public podcasts in the same order; all 53 public analysis API payloads matched exactly in `npm run verify:cf-preview`

The audit report is written to `output/data-audit/cloudflare-data-audit.json`.

## Functional Smoke Verification

Chrome verification against `https://cf-preview.podsum.cc` was run on June 8:

- Google OAuth button on `/auth/signin` opened Google account chooser with `redirect_uri=https://cf-preview.podsum.cc/api/auth/callback/google`
- choosing the existing Google account returned to `https://cf-preview.podsum.cc/my`
- `/my` showed the signed-in state, `Sign Out`, and the user's summary list
- opening `/dashboard/5OD3iYm0CjyCJajb5EVa_` showed the saved summary and QA panel with no page console errors

This verifies the app-side Google one-click login path on the Cloudflare preview domain. Repeat the same browser flow after final production cutover to verify `https://podsum.cc/api/auth/callback/google`.

## Final Cutover Order

Do not update `podcasts.blob_url` to `https://podsum.cc/api/files/...` while `podsum.cc` is still served by Vercel. The Vercel production app does not have the Cloudflare R2 binding, so those URLs must only become active after `podsum.cc` is routed to the Cloudflare Worker.

Recommended order:

1. Run `npm run cutover:preflight` and confirm all checks pass. This includes a dry-run of the generated production Wrangler config.
2. Run `npm run cutover:prepare` and review `output/cutover/wrangler.production.jsonc` plus `output/cutover/cutover-commands.txt`.
3. Run `npm run cutover:dry-run` to validate the generated production Wrangler config without deploying routes.
4. Build and deploy with `NEXTAUTH_URL=https://podsum.cc` using the generated production Wrangler config.
5. Confirm `https://podsum.cc` is served by OpenNext/Cloudflare and Google OAuth still uses `https://podsum.cc/api/auth/callback/google`.
6. Run `FINAL_APP_URL="https://podsum.cc" R2_MANIFEST_APPLY="true" npm run r2:apply-manifest`.
7. Run `npm run verify:cf-production`.
8. After Cloudflare production is confirmed, disable the old Vercel cron/project path to avoid duplicate scheduled workers.

`npm run verify:cf-production` is intentionally expected to fail before cutover. It checks that production is served by OpenNext/Cloudflare, Google OAuth uses the production callback, all public analysis APIs succeed, every migrated R2 file is readable via `https://podsum.cc/api/files/...`, and every manifest-backed database file URL row points at the production file route.

`npm run cutover:prepare` also writes `output/cutover/rollback-commands.txt` for a reversible rollback path: restore DB file URLs to old Vercel Blob URLs, redeploy the preview-only Worker config, then confirm `podsum.cc` is back on Vercel and `cf-preview.podsum.cc` still passes.

June 8 production-build dry-run evidence:

- production-canonical `NEXTAUTH_URL=https://podsum.cc NEXT_PUBLIC_APP_URL=https://podsum.cc npm run build` passed with only existing lint warnings
- production-canonical `npx opennextjs-cloudflare build` passed
- `npx wrangler deploy --dry-run -c output/cutover/wrangler.production.jsonc` passed without deploying routes
- preview was rebuilt and redeployed with `NEXTAUTH_URL=https://cf-preview.podsum.cc`, current verified Worker version `38c95c86-a7da-40ab-948a-f1c62d827ef0`
- preview cron is disabled to prevent duplicate scheduled processing while Vercel remains the production baseline; production dry-run still shows `DEPLOYMENT_STAGE=production`, `ENABLE_CRON=true`, and both cron schedules
- enhanced `npm run verify:cf-preview` passed `30/30` after the preview redeploy
- `npm run baseline:capture` wrote `output/cutover/baseline-snapshot.json` with `ok=true`, 4 matching page hashes, 53 matching public podcast rows, and 53 matching public analysis hashes
