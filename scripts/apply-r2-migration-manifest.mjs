import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env.google.oauth' });

const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');
const finalAppUrl = (process.env.FINAL_APP_URL || process.env.NEXTAUTH_URL || 'https://podsum.cc').replace(/\/+$/, '');
const apply = process.env.R2_MANIFEST_APPLY === 'true';
const force = process.env.R2_MANIFEST_FORCE === 'true';
const skipHostGuard = process.env.R2_MANIFEST_SKIP_HOST_GUARD === 'true';

function buildPostgresUrl(hostKey) {
  const host = process.env[hostKey];
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE;
  if (!host || !user || !password || !database) {
    return null;
  }
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(database)}?sslmode=require`;
}

process.env.POSTGRES_URL ||= buildPostgresUrl('POSTGRES_HOST') || buildPostgresUrl('PGHOST') || '';

function normalizeManifestRow(row) {
  const type = row.type || 'podcast';
  const id = row.id || row.podcastId || row.jobId;
  return {
    ...row,
    type,
    id,
    table: row.table || (type === 'extension-audio' ? 'extension_transcription_jobs' : 'podcasts'),
    column: row.column || (type === 'extension-audio' ? 'audio_blob_url' : 'blob_url'),
  };
}

function manifestIdentity(row) {
  const normalized = normalizeManifestRow(row);
  return `${normalized.type}:${normalized.id}`;
}

function objectUrlForKey(key) {
  return `${finalAppUrl}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function verifyApplyHostGuard() {
  if (!apply) {
    return;
  }

  if (skipHostGuard) {
    console.warn('R2_MANIFEST_SKIP_HOST_GUARD=true is set; skipping final app host guard.');
    return;
  }

  const parsedUrl = new URL(finalAppUrl);
  if (parsedUrl.hostname === 'cf-preview.podsum.cc') {
    throw new Error('Refusing to rewrite database file URLs to the Cloudflare preview domain. Use the final production domain after cutover.');
  }

  const response = await fetch(finalAppUrl, { method: 'HEAD' });
  const openNextHeader = response.headers.get('x-opennext');
  const serverHeader = response.headers.get('server') || '';
  if (response.status !== 200 || openNextHeader !== '1') {
    throw new Error(
      `Refusing to update database file URLs because ${finalAppUrl} is not currently served by Cloudflare OpenNext. ` +
        `status=${response.status} server=${serverHeader || '<missing>'} x-opennext=${openNextHeader || '<missing>'}`,
    );
  }

  console.log(`Final app host guard passed: ${finalAppUrl} is served by Cloudflare OpenNext.`);
}

async function loadManifestRows() {
  const text = await fs.readFile(manifestPath, 'utf8');
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((line) => normalizeManifestRow(JSON.parse(line)));

  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const identity = manifestIdentity(row);
    if (seen.has(identity)) {
      duplicates.add(identity);
    }
    seen.add(identity);
  }
  if (duplicates.size > 0) {
    throw new Error(`Manifest contains duplicate rows: ${Array.from(duplicates).join(', ')}`);
  }
  return rows;
}

async function selectCurrentUrl(row) {
  if (row.type === 'podcast') {
    const result = await sql`
      SELECT id, blob_url
      FROM podcasts
      WHERE id = ${row.id}
    `;
    return result.rows[0]?.blob_url || null;
  }

  if (row.type === 'extension-audio') {
    const result = await sql`
      SELECT id, audio_blob_url
      FROM extension_transcription_jobs
      WHERE id = ${row.id}
    `;
    return result.rows[0]?.audio_blob_url || null;
  }

  throw new Error(`Unsupported manifest entry type: ${row.type}`);
}

async function updateCurrentUrl(row, nextUrl) {
  if (row.type === 'podcast') {
    if (force) {
      return sql`
        UPDATE podcasts
        SET blob_url = ${nextUrl}
        WHERE id = ${row.id}
        RETURNING id
      `;
    }
    return sql`
      UPDATE podcasts
      SET blob_url = ${nextUrl}
      WHERE id = ${row.id} AND blob_url = ${row.oldUrl}
      RETURNING id
    `;
  }

  if (row.type === 'extension-audio') {
    if (force) {
      return sql`
        UPDATE extension_transcription_jobs
        SET audio_blob_url = ${nextUrl}
        WHERE id = ${row.id}
        RETURNING id
      `;
    }
    return sql`
      UPDATE extension_transcription_jobs
      SET audio_blob_url = ${nextUrl}
      WHERE id = ${row.id} AND audio_blob_url = ${row.oldUrl}
      RETURNING id
    `;
  }

  throw new Error(`Unsupported manifest entry type: ${row.type}`);
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is required so blob URL rows can be updated.');
  }

  const rows = await loadManifestRows();
  console.log(`Loaded ${rows.length} R2 manifest rows from ${manifestPath}.`);
  console.log(`Final app URL: ${finalAppUrl}`);
  console.log(`Apply database updates: ${apply}`);
  await verifyApplyHostGuard();

  const summary = {
    wouldUpdate: 0,
    updated: 0,
    alreadyUpdated: 0,
    missing: 0,
    skippedChanged: 0,
  };

  for (const row of rows) {
    const nextUrl = objectUrlForKey(row.r2Key);
    const currentUrl = await selectCurrentUrl(row);

    if (currentUrl === null) {
      summary.missing += 1;
      console.warn(`Missing ${manifestIdentity(row)}; skipping.`);
      continue;
    }

    if (currentUrl === nextUrl) {
      summary.alreadyUpdated += 1;
      continue;
    }

    if (!force && currentUrl !== row.oldUrl) {
      summary.skippedChanged += 1;
      console.warn(`${manifestIdentity(row)} URL changed since manifest copy; skipping.`);
      continue;
    }

    summary.wouldUpdate += 1;
    if (!apply) {
      continue;
    }

    const updateResult = await updateCurrentUrl(row, nextUrl);
    if (updateResult.rowCount === 0) {
      summary.skippedChanged += 1;
      summary.wouldUpdate -= 1;
      console.warn(`${manifestIdentity(row)} changed before update completed; skipping.`);
      continue;
    }
    summary.updated += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log('Dry run only. Set R2_MANIFEST_APPLY=true to update the database.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
