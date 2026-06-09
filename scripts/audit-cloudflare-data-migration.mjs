import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env.google.oauth' });

const { Client } = pg;

const prodBase = (process.env.PROD_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const previewBase = (process.env.CF_PREVIEW_BASE_URL || 'https://cf-preview.podsum.cc').replace(/\/+$/, '');
const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');
const outputPath = process.env.DATA_AUDIT_OUTPUT || path.join(process.cwd(), 'output', 'data-audit', 'cloudflare-data-audit.json');
const r2Concurrency = Number.parseInt(process.env.R2_AUDIT_CONCURRENCY || '8', 10);

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

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

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
  return url.includes('/api/files/');
}

function isTestUrl(url) {
  return url === 'https://example.com/test-podcast.srt';
}

async function loadManifestRows() {
  const text = await fs.readFile(manifestPath, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => normalizeManifestRow(JSON.parse(line)));
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function fetchPublicPodcastIds(baseUrl) {
  const ids = [];
  for (let page = 1; page <= 1000; page += 1) {
    const payload = await fetchJson(`${baseUrl}/api/podcasts?page=${page}&pageSize=50`);
    if (!payload.success) {
      throw new Error(`${baseUrl}/api/podcasts page ${page} did not return success.`);
    }
    const pageIds = payload.data.map((item) => item.id);
    ids.push(...pageIds);
    if (pageIds.length < 50) {
      break;
    }
  }
  return ids;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function headUrl(url) {
  const response = await fetch(url, { method: 'HEAD' });
  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
  };
}

async function readFileRows(client) {
  const podcastResult = await client.query(`
    SELECT id, original_filename, blob_url, created_at
    FROM podcasts
    WHERE COALESCE(blob_url, '') <> ''
    ORDER BY created_at ASC
  `);

  const extensionAudioResult = await client.query(`
    SELECT id, podcast_id, original_file_name, audio_blob_url, created_at
    FROM extension_transcription_jobs
    WHERE COALESCE(audio_blob_url, '') <> ''
    ORDER BY created_at ASC
  `);

  return [
    ...podcastResult.rows.map((row) => ({
      type: 'podcast',
      id: row.id,
      podcastId: row.id,
      table: 'podcasts',
      column: 'blob_url',
      originalFileName: row.original_filename,
      url: row.blob_url,
    })),
    ...extensionAudioResult.rows.map((row) => ({
      type: 'extension-audio',
      id: row.id,
      jobId: row.id,
      podcastId: row.podcast_id,
      table: 'extension_transcription_jobs',
      column: 'audio_blob_url',
      originalFileName: row.original_file_name,
      url: row.audio_blob_url,
    })),
  ];
}

async function main() {
  const postgresUrl = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || buildPostgresUrl('POSTGRES_HOST') || buildPostgresUrl('PGHOST');
  if (!postgresUrl) {
    throw new Error('POSTGRES_URL or PG connection components are required for the data audit.');
  }

  const client = new Client({ connectionString: postgresUrl });
  await client.connect();

  try {
    const manifestRows = await loadManifestRows();
    const manifestByIdentity = new Map(manifestRows.map((row) => [manifestIdentity(row), row]));

    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tableCounts = {};
    for (const { table_name: tableName } of tablesResult.rows) {
      const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(tableName)}`);
      tableCounts[tableName] = countResult.rows[0].count;
    }

    const podcastColumnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'podcasts'
      ORDER BY ordinal_position
    `);
    const podcastColumns = podcastColumnsResult.rows.map((row) => row.column_name);

    const fileRows = await readFileRows(client);
    const realVercelBlobRows = fileRows.filter((row) => isVercelBlobUrl(String(row.url || '')));
    const testBlobRows = fileRows.filter((row) => isTestUrl(String(row.url || '')));
    const migratedUrlRows = fileRows.filter((row) => isMigratedUrl(String(row.url || '')));

    const sourceHeadResults = await mapLimit(realVercelBlobRows, r2Concurrency, async (row) => {
      const result = await headUrl(row.url);
      return {
        identity: manifestIdentity(row),
        type: row.type,
        id: row.id,
        originalFileName: row.originalFileName,
        ...result,
      };
    });
    const sourceMissingRows = sourceHeadResults.filter((row) => !row.ok);
    const sourceMissingIdentities = new Set(sourceMissingRows.map((row) => row.identity));
    const copyableVercelBlobRows = realVercelBlobRows.filter((row) => !sourceMissingIdentities.has(manifestIdentity(row)));
    const migratableFileRows = [
      ...copyableVercelBlobRows,
      ...migratedUrlRows,
    ];

    const missingManifestRows = copyableVercelBlobRows.filter((row) => !manifestByIdentity.has(manifestIdentity(row)));
    const changedSinceCopyRows = manifestRows.filter((row) => {
      const dbRow = fileRows.find((candidate) => manifestIdentity(candidate) === manifestIdentity(row));
      return dbRow && dbRow.url !== row.oldUrl;
    });
    const extraManifestRows = manifestRows.filter((row) => !fileRows.some((candidate) => manifestIdentity(candidate) === manifestIdentity(row)));

    const r2HeadResults = await mapLimit(manifestRows, r2Concurrency, async (row) => {
      const result = await headUrl(row.nextUrl);
      return {
        identity: manifestIdentity(row),
        type: row.type,
        id: row.id,
        r2Key: row.r2Key,
        ...result,
      };
    });
    const failedR2Objects = r2HeadResults.filter((row) => !row.ok);

    const [prodPublicIds, previewPublicIds] = await Promise.all([
      fetchPublicPodcastIds(prodBase),
      fetchPublicPodcastIds(previewBase),
    ]);

    const prodSet = new Set(prodPublicIds);
    const previewSet = new Set(previewPublicIds);
    const missingFromPreview = prodPublicIds.filter((id) => !previewSet.has(id));
    const extraInPreview = previewPublicIds.filter((id) => !prodSet.has(id));

    const sampleAnalysisIds = prodPublicIds.slice(0, 5);
    const analysisComparisons = await Promise.all(sampleAnalysisIds.map(async (id) => {
      const [prodAnalysis, previewAnalysis] = await Promise.all([
        fetchJson(`${prodBase}/api/analysis/${encodeURIComponent(id)}`),
        fetchJson(`${previewBase}/api/analysis/${encodeURIComponent(id)}`),
      ]);
      return {
        id,
        prodSuccess: prodAnalysis.success === true,
        previewSuccess: previewAnalysis.success === true,
        titleMatches: prodAnalysis.data?.podcast?.title === previewAnalysis.data?.podcast?.title,
        processedMatches: prodAnalysis.data?.isProcessed === previewAnalysis.data?.isProcessed,
      };
    }));

    const uniqueManifestIdentities = new Set(manifestRows.map((row) => manifestIdentity(row)));
    const audit = {
      generatedAt: new Date().toISOString(),
      prodBase,
      previewBase,
      database: {
        physicalTarget: 'current Postgres connection from env',
        tableCounts,
        podcastColumns,
        fileUrlRows: fileRows.length,
        blobUrlRows: fileRows.filter((row) => row.type === 'podcast').length,
        extensionAudioUrlRows: fileRows.filter((row) => row.type === 'extension-audio').length,
        realVercelBlobRows: realVercelBlobRows.length,
        copyableVercelBlobRows: copyableVercelBlobRows.length,
        staleSourceRows: sourceMissingRows.length,
        testBlobRows: testBlobRows.length,
        migratedUrlRows: migratedUrlRows.length,
      },
      r2: {
        manifestPath,
        manifestRows: manifestRows.length,
        uniqueManifestIdentities: uniqueManifestIdentities.size,
        missingManifestRows: missingManifestRows.map((row) => ({ identity: manifestIdentity(row), url: row.url })),
        staleSourceRows: sourceMissingRows.map((row) => ({
          identity: row.identity,
          url: row.url,
          status: row.status,
          originalFileName: row.originalFileName,
        })),
        extraManifestRows: extraManifestRows.map((row) => ({ identity: manifestIdentity(row), oldUrl: row.oldUrl })),
        changedSinceCopyRows: changedSinceCopyRows.map((row) => ({ identity: manifestIdentity(row), oldUrl: row.oldUrl })),
        checkedObjects: r2HeadResults.length,
        failedObjects: failedR2Objects,
      },
      apiComparison: {
        prodPublicCount: prodPublicIds.length,
        previewPublicCount: previewPublicIds.length,
        publicIdsSameOrder: prodPublicIds.join(',') === previewPublicIds.join(','),
        missingFromPreview,
        extraInPreview,
        analysisComparisons,
      },
      status: {
        fileCopyComplete: manifestRows.length >= migratableFileRows.length && uniqueManifestIdentities.size === manifestRows.length && failedR2Objects.length === 0 && missingManifestRows.length === 0,
        publicApiMatches: prodPublicIds.join(',') === previewPublicIds.join(',') && analysisComparisons.every((row) => row.prodSuccess && row.previewSuccess && row.titleMatches && row.processedMatches),
        dbBlobUrlRewriteApplied: migratedUrlRows.length >= manifestRows.length,
        dbBlobUrlRewritePending: migratedUrlRows.length < manifestRows.length,
      },
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(audit, null, 2));

    console.log(JSON.stringify({
      tableCounts,
      fileUrlRows: audit.database.fileUrlRows,
      blobUrlRows: audit.database.blobUrlRows,
      extensionAudioUrlRows: audit.database.extensionAudioUrlRows,
      realVercelBlobRows: audit.database.realVercelBlobRows,
      copyableVercelBlobRows: audit.database.copyableVercelBlobRows,
      staleSourceRows: audit.database.staleSourceRows,
      testBlobRows: audit.database.testBlobRows,
      manifestRows: audit.r2.manifestRows,
      failedR2Objects: audit.r2.failedObjects.length,
      prodPublicCount: audit.apiComparison.prodPublicCount,
      previewPublicCount: audit.apiComparison.previewPublicCount,
      publicIdsSameOrder: audit.apiComparison.publicIdsSameOrder,
      fileCopyComplete: audit.status.fileCopyComplete,
      publicApiMatches: audit.status.publicApiMatches,
      dbBlobUrlRewritePending: audit.status.dbBlobUrlRewritePending,
      report: outputPath,
    }, null, 2));

    if (!audit.status.fileCopyComplete || !audit.status.publicApiMatches) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
