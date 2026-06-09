import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env.google.oauth' });

const execFile = promisify(execFileCallback);

const bucketName = process.env.R2_BUCKET_NAME || 'podsum-uploads';
const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'https://podsum.cc').replace(/\/+$/, '');
const prefix = (process.env.R2_MIGRATION_PREFIX || 'migrated').replace(/^\/+|\/+$/g, '');
const limit = Number.parseInt(process.env.R2_MIGRATION_LIMIT || '0', 10);
const dryRun = process.env.R2_MIGRATION_DRY_RUN === 'true';
const updateDb = process.env.R2_MIGRATION_UPDATE_DB === 'true';
const copyOnly = !updateDb;
const skipFailed = process.env.R2_MIGRATION_SKIP_FAILED !== 'false';
const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');

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

function isVercelBlobUrl(url) {
  return /(^https:\/\/|\.)(public\.)?blob\.vercel-storage\.com\//.test(url);
}

function isMigratedUrl(url) {
  return url.includes('/api/files/') || (process.env.R2_PUBLIC_BASE_URL && url.startsWith(process.env.R2_PUBLIC_BASE_URL));
}

function cleanFileName(value, fallback) {
  return (String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180) || fallback);
}

function keyForEntry(entry) {
  const fileName = cleanFileName(entry.originalFileName, `${entry.id}${entry.type === 'extension-audio' ? '.audio' : '.srt'}`);
  const folder = entry.type === 'extension-audio' ? 'extension-audio' : 'podcasts';
  return `${prefix}/${folder}/${entry.id}-${fileName}`;
}

function objectUrl(key) {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  if (process.env.R2_PUBLIC_BASE_URL) {
    return `${publicBase}/${encoded}`;
  }
  return `${publicBase}/api/files/${encoded}`;
}

async function putR2Object(key, filePath, contentType) {
  const args = ['wrangler', 'r2', 'object', 'put', `${bucketName}/${key}`, '--file', filePath, '--remote'];
  if (contentType) {
    args.push('--content-type', contentType);
  }
  await execFile('npx', args, { stdio: 'inherit' });
}

async function appendManifest(entry, key, oldUrl, nextUrl) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const row = {
    type: entry.type,
    id: entry.id,
    table: entry.table,
    column: entry.column,
    podcastId: entry.type === 'podcast' ? entry.id : entry.podcastId || null,
    jobId: entry.type === 'extension-audio' ? entry.id : null,
    originalFileName: entry.originalFileName,
    oldUrl,
    r2Bucket: bucketName,
    r2Key: key,
    nextUrl,
    copiedAt: new Date().toISOString(),
  };
  await fs.appendFile(manifestPath, `${JSON.stringify(row)}\n`);
}

async function loadCopiedItemIds() {
  try {
    const text = await fs.readFile(manifestPath, 'utf8');
    return new Set(
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => manifestIdentity(JSON.parse(line)))
        .filter(Boolean),
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

async function readSourceEntries() {
  const podcastResult = await sql`
    SELECT id, original_filename, blob_url, created_at
    FROM podcasts
    WHERE COALESCE(blob_url, '') <> ''
    ORDER BY created_at ASC
  `;

  const extensionAudioResult = await sql`
    SELECT id, podcast_id, original_file_name, audio_blob_url, created_at
    FROM extension_transcription_jobs
    WHERE COALESCE(audio_blob_url, '') <> ''
    ORDER BY created_at ASC
  `;

  return [
    ...podcastResult.rows.map((row) => ({
      type: 'podcast',
      id: row.id,
      podcastId: row.id,
      table: 'podcasts',
      column: 'blob_url',
      originalFileName: row.original_filename,
      oldUrl: String(row.blob_url || ''),
    })),
    ...extensionAudioResult.rows.map((row) => ({
      type: 'extension-audio',
      id: row.id,
      jobId: row.id,
      podcastId: row.podcast_id || null,
      table: 'extension_transcription_jobs',
      column: 'audio_blob_url',
      originalFileName: row.original_file_name,
      oldUrl: String(row.audio_blob_url || ''),
    })),
  ];
}

async function updateDatabaseEntry(entry, nextUrl) {
  if (entry.type === 'podcast') {
    await sql`
      UPDATE podcasts
      SET blob_url = ${nextUrl}
      WHERE id = ${entry.id}
    `;
    return;
  }

  if (entry.type === 'extension-audio') {
    await sql`
      UPDATE extension_transcription_jobs
      SET audio_blob_url = ${nextUrl}
      WHERE id = ${entry.id}
    `;
    return;
  }

  throw new Error(`Unsupported manifest entry type: ${entry.type}`);
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is required so blob URL rows can be read.');
  }

  const sourceEntries = await readSourceEntries();
  const unsupportedRows = sourceEntries.filter((entry) => !isMigratedUrl(entry.oldUrl) && !isVercelBlobUrl(entry.oldUrl));
  const rows = sourceEntries.filter((entry) => !isMigratedUrl(entry.oldUrl) && isVercelBlobUrl(entry.oldUrl));
  const selectedRows = limit > 0 ? rows.slice(0, limit) : rows;
  const copiedItemIds = await loadCopiedItemIds();

  console.log(`Found ${rows.length} Vercel Blob URLs needing R2 copy. Processing ${selectedRows.length}. Dry run: ${dryRun}. Update DB: ${updateDb}. Copy only: ${copyOnly}`);
  if (unsupportedRows.length > 0) {
    console.warn(`Skipping ${unsupportedRows.length} non-Vercel or test URLs.`);
  }
  if (copiedItemIds.size > 0) {
    console.log(`Skipping items already recorded in ${manifestPath}: ${copiedItemIds.size}.`);
  }

  for (const entry of selectedRows) {
    if (copiedItemIds.has(manifestIdentity(entry))) {
      continue;
    }

    const key = keyForEntry(entry);
    const nextUrl = objectUrl(key);
    console.log(`\n${entry.type}:${entry.id}: ${entry.oldUrl} -> ${nextUrl}`);

    if (dryRun) {
      continue;
    }

    const response = await fetch(entry.oldUrl);
    if (!response.ok) {
      if (skipFailed) {
        console.warn(`Skipping ${entry.oldUrl}: ${response.status} ${response.statusText}`);
        continue;
      }
      throw new Error(`Failed to fetch ${entry.oldUrl}: ${response.status} ${response.statusText}`);
    }

    const tmpPath = path.join(os.tmpdir(), `podsum-r2-${randomUUID()}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await fs.writeFile(tmpPath, bytes);
    try {
      await putR2Object(key, tmpPath, response.headers.get('content-type') || 'application/octet-stream');
      await appendManifest(entry, key, entry.oldUrl, nextUrl);
      if (copyOnly) {
        continue;
      }
      await updateDatabaseEntry(entry, nextUrl);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
