import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env.google.oauth' });

const productionBase = (process.env.PRODUCTION_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');
const r2Concurrency = Number.parseInt(process.env.R2_AUDIT_CONCURRENCY || '8', 10);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '29bbd7941ce035396dd966247e42c44f';
const productionD1DatabaseId = process.env.PRODUCTION_D1_DATABASE_ID || process.env.D1_DATABASE_ID || '5d0b65e0-d556-4aa4-953f-4d680d11c34a';
const wranglerConfigPath =
  process.env.WRANGLER_OAUTH_CONFIG ||
  '/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml';
const checks = [];

function record(ok, label, details = '') {
  checks.push({ ok, label, details });
  const marker = ok ? 'PASS' : 'FAIL';
  console.log(`${marker} ${label}${details ? ` - ${details}` : ''}`);
}

function readCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }
  const text = fsSync.readFileSync(wranglerConfigPath, 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) {
    throw new Error(`Unable to read Wrangler OAuth token from ${wranglerConfigPath}`);
  }
  return token;
}

const cloudflareToken = readCloudflareToken();

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${productionD1DatabaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cloudflareToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = JSON.stringify(payload.errors || payload, null, 2);
    throw new Error(`D1 query failed: ${message}`);
  }
  return payload.result?.[0]?.results || [];
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

function objectUrlForKey(key) {
  return `${productionBase}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
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

async function fetchPublicPodcastPages(baseUrl) {
  const pages = [];
  for (let page = 1; page <= 1000; page += 1) {
    const payload = await fetchJson(`${baseUrl}/api/podcasts?page=${page}&pageSize=50`);
    if (!payload.success) {
      throw new Error(`${baseUrl}/api/podcasts page ${page} did not return success.`);
    }
    pages.push({ page, payload });
    if (payload.data.length < 50) {
      break;
    }
  }
  return pages;
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

async function verifyHostingShape() {
  const response = await fetch(productionBase, { method: 'HEAD' });
  record(response.status === 200, 'production homepage returns 200', `status=${response.status}`);
  record(response.headers.get('x-opennext') === '1', 'production is served by OpenNext on Cloudflare', response.headers.get('x-opennext') || '');
}

async function verifyAuthProviders() {
  const providers = await fetchJson(`${productionBase}/api/auth/providers`);
  record(Boolean(providers.google), 'Google provider is present');
  record(
    providers.google?.callbackUrl === `${productionBase}/api/auth/callback/google`,
    'Google callback uses production domain',
    providers.google?.callbackUrl || '',
  );
}

async function verifyApiData() {
  const pages = await fetchPublicPodcastPages(productionBase);
  const items = pages.flatMap((page) => page.payload.data);
  record(items.length > 0, 'production public podcast API returns rows', `count=${items.length} pages=${pages.length}`);

  const analysisResults = await mapLimit(items, Number.parseInt(process.env.VERIFY_ANALYSIS_CONCURRENCY || '6', 10), async (item) => {
    const id = item.id;
    const analysis = await fetchJson(`${productionBase}/api/analysis/${encodeURIComponent(id)}`);
    return {
      id,
      success: analysis.success === true,
      podcastIdMatches: analysis.data?.podcast?.id === id,
      processedStatePresent: typeof analysis.data?.isProcessed === 'boolean',
    };
  });
  const failed = analysisResults.filter((row) => !row.success || !row.podcastIdMatches || !row.processedStatePresent);
  record(failed.length === 0, 'all public analysis APIs succeed on production', `checked=${analysisResults.length} failed=${failed.length}`);
  for (const row of failed.slice(0, 5)) {
    console.log(`  failed analysis ${row.id}: success=${row.success} podcastIdMatches=${row.podcastIdMatches} processedStatePresent=${row.processedStatePresent}`);
  }
}

async function verifyR2Objects(manifestRows) {
  const results = await mapLimit(manifestRows, r2Concurrency, async (row) => {
    const url = objectUrlForKey(row.r2Key);
    const response = await fetch(url, { method: 'HEAD' });
    return {
      identity: manifestIdentity(row),
      url,
      status: response.status,
      ok: response.ok,
    };
  });
  const failed = results.filter((row) => !row.ok);
  record(failed.length === 0, 'all migrated R2 file URLs are readable on production domain', `checked=${results.length} failed=${failed.length}`);
  for (const row of failed.slice(0, 5)) {
    console.log(`  failed ${row.identity}: ${row.status} ${row.url}`);
  }
}

async function selectCurrentUrl(row) {
  if (row.type === 'podcast') {
    const result = await d1Query('SELECT blob_url FROM podcasts WHERE id = ?', [row.id]);
    return result[0]?.blob_url || null;
  }

  if (row.type === 'extension-audio') {
    const result = await d1Query('SELECT audio_blob_url FROM extension_transcription_jobs WHERE id = ?', [row.id]);
    return result[0]?.audio_blob_url || null;
  }

  throw new Error(`Unsupported manifest entry type: ${row.type}`);
}

async function verifyDatabaseBlobUrls(manifestRows) {
  const mismatches = [];
  for (const row of manifestRows) {
    const expectedUrl = objectUrlForKey(row.r2Key);
    const actualUrl = await selectCurrentUrl(row);
    if (actualUrl !== expectedUrl) {
      mismatches.push({
        identity: manifestIdentity(row),
        actualUrl,
        expectedUrl,
      });
    }
  }
  record(
    mismatches.length === 0,
    'production D1 file URL rows point at production R2 file route',
    `checked=${manifestRows.length} mismatches=${mismatches.length}`,
  );
  for (const row of mismatches.slice(0, 5)) {
    console.log(`  mismatch ${row.identity}: ${row.actualUrl}`);
  }
}

async function main() {
  const manifestRows = await loadManifestRows();
  console.log(`Verifying Cloudflare production cutover at ${productionBase}`);
  await verifyHostingShape();
  await verifyAuthProviders();
  await verifyApiData();
  await verifyR2Objects(manifestRows);
  await verifyDatabaseBlobUrls(manifestRows);

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
