import fs from 'node:fs/promises';
import path from 'node:path';

const prodBase = (process.env.PROD_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const previewBase = (process.env.CF_PREVIEW_BASE_URL || 'https://cf-preview.podsum.cc').replace(/\/+$/, '');
const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');

const pagePaths = ['/', '/about', '/auth/signin', '/chrome-extension'];
const checks = [];

function record(ok, label, details = '') {
  checks.push({ ok, label, details });
  const marker = ok ? 'PASS' : 'FAIL';
  console.log(`${marker} ${label}${details ? ` - ${details}` : ''}`);
}

function assertEqual(actual, expected, label) {
  record(actual === expected, label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function normalizeManifestRow(row) {
  const type = row.type || 'podcast';
  const id = row.id || row.podcastId || row.jobId;
  return { ...row, type, id };
}

function manifestIdentity(row) {
  const normalized = normalizeManifestRow(row);
  return `${normalized.type}:${normalized.id}`;
}

function normalizeVisibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.VERIFY_TIMEOUT_MS || 30000));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
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

async function comparePages() {
  for (const routePath of pagePaths) {
    const [prodResponse, previewResponse] = await Promise.all([
      fetchWithTimeout(`${prodBase}${routePath}`),
      fetchWithTimeout(`${previewBase}${routePath}`),
    ]);
    assertEqual(prodResponse.status, 200, `prod page ${routePath} is 200`);
    assertEqual(previewResponse.status, 200, `preview page ${routePath} is 200`);

    const [prodText, previewText] = await Promise.all([
      prodResponse.text().then(normalizeVisibleText),
      previewResponse.text().then(normalizeVisibleText),
    ]);
    record(
      prodText === previewText,
      `visible text matches for ${routePath}`,
      `prodChars=${prodText.length} previewChars=${previewText.length}`,
    );
  }
}

async function compareProviders() {
  const [prodProviders, previewProviders] = await Promise.all([
    fetchJson(`${prodBase}/api/auth/providers`),
    fetchJson(`${previewBase}/api/auth/providers`),
  ]);
  assertEqual(Object.keys(previewProviders).sort().join(','), Object.keys(prodProviders).sort().join(','), 'auth provider IDs match');
  record(Boolean(previewProviders.google), 'preview Google provider is present');
  record(
    previewProviders.google?.callbackUrl === `${previewBase}/api/auth/callback/google`,
    'preview Google callback uses Cloudflare preview domain',
    previewProviders.google?.callbackUrl || '',
  );
  record(
    prodProviders.google?.callbackUrl === `${prodBase}/api/auth/callback/google`,
    'prod Google callback remains production domain',
    prodProviders.google?.callbackUrl || '',
  );
}

async function comparePodcastApis() {
  const [prodPages, previewPages] = await Promise.all([
    fetchPublicPodcastPages(prodBase),
    fetchPublicPodcastPages(previewBase),
  ]);
  record(prodPages.length > 0 && previewPages.length > 0, 'podcasts API returns success on both origins');
  assertEqual(previewPages.length, prodPages.length, 'podcast API page count matches');

  const prodItems = prodPages.flatMap((page) => page.payload.data);
  const previewItems = previewPages.flatMap((page) => page.payload.data);
  assertEqual(previewItems.length, prodItems.length, 'full public podcast list length matches');

  const pageMismatches = prodPages
    .map((page, index) => ({
      page: page.page,
      matches: canonicalJson(page.payload) === canonicalJson(previewPages[index]?.payload),
    }))
    .filter((item) => !item.matches);
  record(pageMismatches.length === 0, 'full paginated podcast API payloads match exactly', `pages=${prodPages.length} mismatches=${pageMismatches.length}`);

  const prodIds = prodItems.map((item) => item.id).join(',');
  const previewIds = previewItems.map((item) => item.id).join(',');
  assertEqual(previewIds, prodIds, 'podcast list IDs and order match');

  const firstPodcastId = previewItems[0]?.id;
  record(Boolean(firstPodcastId), 'podcast list has a first item', firstPodcastId || '');
  if (!firstPodcastId) {
    return;
  }

  const analysisComparisons = await mapLimit(prodItems, Number.parseInt(process.env.VERIFY_ANALYSIS_CONCURRENCY || '6', 10), async (item) => {
    const id = item.id;
    const [prodAnalysis, previewAnalysis] = await Promise.all([
      fetchJson(`${prodBase}/api/analysis/${encodeURIComponent(id)}`),
      fetchJson(`${previewBase}/api/analysis/${encodeURIComponent(id)}`),
    ]);
    return {
      id,
      prodSuccess: prodAnalysis.success === true,
      previewSuccess: previewAnalysis.success === true,
      payloadMatches: canonicalJson(prodAnalysis) === canonicalJson(previewAnalysis),
      titleMatches: prodAnalysis.data?.podcast?.title === previewAnalysis.data?.podcast?.title,
      processedMatches: prodAnalysis.data?.isProcessed === previewAnalysis.data?.isProcessed,
    };
  });
  const failedAnalysis = analysisComparisons.filter((row) => !row.prodSuccess || !row.previewSuccess || !row.payloadMatches);
  let finalFailedAnalysis = failedAnalysis;
  if (failedAnalysis.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.VERIFY_ANALYSIS_RETRY_DELAY_MS || '1000', 10)));
    const retried = await mapLimit(failedAnalysis, 2, async (row) => {
      const [prodAnalysis, previewAnalysis] = await Promise.all([
        fetchJson(`${prodBase}/api/analysis/${encodeURIComponent(row.id)}`),
        fetchJson(`${previewBase}/api/analysis/${encodeURIComponent(row.id)}`),
      ]);
      return {
        id: row.id,
        prodSuccess: prodAnalysis.success === true,
        previewSuccess: previewAnalysis.success === true,
        payloadMatches: canonicalJson(prodAnalysis) === canonicalJson(previewAnalysis),
        titleMatches: prodAnalysis.data?.podcast?.title === previewAnalysis.data?.podcast?.title,
        processedMatches: prodAnalysis.data?.isProcessed === previewAnalysis.data?.isProcessed,
      };
    });
    finalFailedAnalysis = retried.filter((row) => !row.prodSuccess || !row.previewSuccess || !row.payloadMatches);
  }
  record(
    finalFailedAnalysis.length === 0,
    'all public analysis API payloads match exactly',
    `checked=${analysisComparisons.length} initialMismatches=${failedAnalysis.length} finalMismatches=${finalFailedAnalysis.length}`,
  );
  for (const row of finalFailedAnalysis.slice(0, 5)) {
    console.log(`  analysis mismatch ${row.id}: prodSuccess=${row.prodSuccess} previewSuccess=${row.previewSuccess} titleMatches=${row.titleMatches} processedMatches=${row.processedMatches}`);
  }
}

async function verifyR2Manifest() {
  let text;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    record(false, 'R2 migration manifest exists', error.message);
    return;
  }

  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((line) => normalizeManifestRow(JSON.parse(line)));
  const uniqueIds = new Set(rows.map((row) => manifestIdentity(row)));
  record(rows.length > 0, 'R2 migration manifest has copied files', `count=${rows.length}`);
  assertEqual(uniqueIds.size, rows.length, 'R2 migration manifest has unique file identities');

  const sampleRows = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].filter(Boolean);
  for (const row of sampleRows) {
    const response = await fetchWithTimeout(row.nextUrl, { method: 'HEAD' });
    record(response.status === 200, `R2 object is readable for ${manifestIdentity(row)}`, `status=${response.status} contentType=${response.headers.get('content-type')}`);
  }
}

async function verifyDeploymentShape() {
  const [prodHead, previewHead] = await Promise.all([
    fetchWithTimeout(prodBase, { method: 'HEAD' }),
    fetchWithTimeout(previewBase, { method: 'HEAD' }),
  ]);
  record(prodHead.headers.get('server') === 'Vercel', 'production baseline is still served by Vercel', prodHead.headers.get('server') || '');
  record(previewHead.headers.get('x-opennext') === '1', 'preview is served by OpenNext on Cloudflare', previewHead.headers.get('x-opennext') || '');
}

async function main() {
  console.log(`Comparing production baseline ${prodBase} with Cloudflare preview ${previewBase}`);
  await verifyDeploymentShape();
  await comparePages();
  await compareProviders();
  await comparePodcastApis();
  await verifyR2Manifest();

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
