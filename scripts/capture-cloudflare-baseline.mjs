import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const prodBase = (process.env.PROD_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const previewBase = (process.env.CF_PREVIEW_BASE_URL || 'https://cf-preview.podsum.cc').replace(/\/+$/, '');
const outputPath = process.env.BASELINE_OUTPUT || path.join(process.cwd(), 'output', 'cutover', 'baseline-snapshot.json');
const pagePaths = ['/', '/about', '/auth/signin', '/chrome-extension'];
const analysisConcurrency = Number.parseInt(process.env.BASELINE_ANALYSIS_CONCURRENCY || '6', 10);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.BASELINE_TIMEOUT_MS || 30000));
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

async function captureHead(baseUrl) {
  const response = await fetchWithTimeout(baseUrl, { method: 'HEAD' });
  return {
    status: response.status,
    server: response.headers.get('server'),
    xOpenNext: response.headers.get('x-opennext'),
  };
}

async function capturePages() {
  return Promise.all(pagePaths.map(async (routePath) => {
    const [prodResponse, previewResponse] = await Promise.all([
      fetchWithTimeout(`${prodBase}${routePath}`),
      fetchWithTimeout(`${previewBase}${routePath}`),
    ]);
    const [prodText, previewText] = await Promise.all([
      prodResponse.text().then(normalizeVisibleText),
      previewResponse.text().then(normalizeVisibleText),
    ]);
    const prodHash = sha256(prodText);
    const previewHash = sha256(previewText);
    return {
      path: routePath,
      prodStatus: prodResponse.status,
      previewStatus: previewResponse.status,
      prodChars: prodText.length,
      previewChars: previewText.length,
      prodHash,
      previewHash,
      matches: prodResponse.status === 200 && previewResponse.status === 200 && prodHash === previewHash,
    };
  }));
}

async function captureProviders() {
  const [prodProviders, previewProviders] = await Promise.all([
    fetchJson(`${prodBase}/api/auth/providers`),
    fetchJson(`${previewBase}/api/auth/providers`),
  ]);
  return {
    prodProviderIds: Object.keys(prodProviders).sort(),
    previewProviderIds: Object.keys(previewProviders).sort(),
    prodGoogleCallback: prodProviders.google?.callbackUrl || null,
    previewGoogleCallback: previewProviders.google?.callbackUrl || null,
    providerIdsMatch: Object.keys(prodProviders).sort().join(',') === Object.keys(previewProviders).sort().join(','),
    previewGoogleCallbackOk: previewProviders.google?.callbackUrl === `${previewBase}/api/auth/callback/google`,
  };
}

async function captureApis() {
  const [prodPages, previewPages] = await Promise.all([
    fetchPublicPodcastPages(prodBase),
    fetchPublicPodcastPages(previewBase),
  ]);
  const prodItems = prodPages.flatMap((page) => page.payload.data);
  const previewItems = previewPages.flatMap((page) => page.payload.data);
  const prodIds = prodItems.map((item) => item.id);
  const previewIds = previewItems.map((item) => item.id);
  const podcastPageHashes = prodPages.map((page, index) => {
    const prodHash = sha256(canonicalJson(page.payload));
    const previewHash = sha256(canonicalJson(previewPages[index]?.payload));
    return {
      page: page.page,
      prodHash,
      previewHash,
      matches: prodHash === previewHash,
    };
  });

  const analysisHashes = await mapLimit(prodItems, analysisConcurrency, async (item) => {
    const id = item.id;
    const [prodAnalysis, previewAnalysis] = await Promise.all([
      fetchJson(`${prodBase}/api/analysis/${encodeURIComponent(id)}`),
      fetchJson(`${previewBase}/api/analysis/${encodeURIComponent(id)}`),
    ]);
    const prodHash = sha256(canonicalJson(prodAnalysis));
    const previewHash = sha256(canonicalJson(previewAnalysis));
    return {
      id,
      prodSuccess: prodAnalysis.success === true,
      previewSuccess: previewAnalysis.success === true,
      prodHash,
      previewHash,
      matches: prodHash === previewHash,
    };
  });

  const analysisMismatches = analysisHashes.filter((row) => !row.prodSuccess || !row.previewSuccess || !row.matches);
  return {
    prodPublicCount: prodIds.length,
    previewPublicCount: previewIds.length,
    publicIdsSameOrder: prodIds.join(',') === previewIds.join(','),
    podcastPageHashes,
    analysisCount: analysisHashes.length,
    analysisHashes,
    analysisMismatches,
  };
}

async function main() {
  const [prodHead, previewHead, pages, providers, api] = await Promise.all([
    captureHead(prodBase),
    captureHead(previewBase),
    capturePages(),
    captureProviders(),
    captureApis(),
  ]);

  const status = {
    productionStillVercel: prodHead.server === 'Vercel',
    previewIsCloudflareOpenNext: previewHead.xOpenNext === '1',
    pagesMatch: pages.every((page) => page.matches),
    authProvidersMatch: providers.providerIdsMatch && providers.previewGoogleCallbackOk,
    publicApiMatches:
      api.publicIdsSameOrder &&
      api.podcastPageHashes.every((row) => row.matches) &&
      api.analysisMismatches.length === 0,
  };
  const ok = Object.values(status).every(Boolean);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    prodBase,
    previewBase,
    prodHead,
    previewHead,
    pages,
    providers,
    api,
    status,
    ok,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({
    outputPath,
    ok,
    status,
    prodPublicCount: api.prodPublicCount,
    previewPublicCount: api.previewPublicCount,
    analysisCount: api.analysisCount,
    analysisMismatches: api.analysisMismatches.length,
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
