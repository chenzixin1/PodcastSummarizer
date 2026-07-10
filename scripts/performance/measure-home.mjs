import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, devices } from 'playwright';
import { createNetworkCaptureState } from './network-capture.mjs';
import {
  assertFinalUrlOrigin,
  createStickyMainFrameOriginGuard,
  resolveConfiguredHttpOrigin,
  runOriginGuardedOperation,
} from './url-safety.mjs';

const baseUrl = resolveConfiguredHttpOrigin(
  process.env.PERF_BASE_URL,
  'https://podsum.cc',
  'PERF_BASE_URL',
);
const homepageUrl = `${baseUrl}/`;
const coldRunCount = 5;
const settleMs = Number.parseInt(process.env.PERF_SETTLE_MS || '3000', 10);
const navigationTimeoutMs = Number.parseInt(process.env.PERF_TIMEOUT_MS || '60000', 10);
const deviceProfile = 'Pixel 5';

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function assertSuccessfulColdRun(run) {
  const label = run?.label || 'cold run';
  if (!Number.isInteger(run?.status) || run.status < 200 || run.status >= 300) {
    throw new Error(`${label}: navigation status ${run?.status ?? 'missing'} is not successful`);
  }
  for (const metric of ['fcpMs', 'lcpMs']) {
    if (!Number.isFinite(run?.metrics?.[metric]) || run.metrics[metric] <= 0) {
      throw new Error(`${label}: ${metric} must be a positive number`);
    }
  }
  for (const metric of ['totalBlockingTimeMs', 'cls']) {
    if (!Number.isFinite(run?.metrics?.[metric]) || run.metrics[metric] < 0) {
      throw new Error(`${label}: ${metric} must be a non-negative number`);
    }
  }
}

export function assertColdRunIntegrity(run, expectedOrigin) {
  const label = run?.label || 'cold run';
  const failedRequest = run?.resources?.failedRequests?.[0];
  if (failedRequest) {
    throw new Error(
      `${label}: failed request ${failedRequest.url}: ${failedRequest.errorText || 'unknown'}`,
    );
  }

  const normalizedExpectedOrigin = new URL(expectedOrigin).origin;
  for (const resource of run?.resources?.cacheHeaders || []) {
    let resourceOrigin;
    try {
      resourceOrigin = new URL(resource.url).origin;
    } catch {
      throw new Error(`${label}: resource has an invalid URL: ${resource.url}`);
    }
    if (
      resourceOrigin === normalizedExpectedOrigin &&
      (!Number.isFinite(resource.status) || resource.status < 200 || resource.status >= 300)
    ) {
      throw new Error(
        `${label}: same-origin resource ${resource.url} returned ${resource.status ?? 'missing status'}`,
      );
    }
  }
}

function resourceTransferBytes(summary, ...types) {
  return types.reduce(
    (total, type) => total + (summary?.byType?.[type]?.transferBytes || 0),
    0,
  );
}

export function assertHomepageWithinBudget(summary, budget) {
  const actual = {
    requests: summary?.requests,
    transferBytes: summary?.transferBytes,
    scriptBytes: resourceTransferBytes(summary, 'script'),
    styleBytes: resourceTransferBytes(summary, 'style', 'stylesheet'),
    fontBytes: resourceTransferBytes(summary, 'font'),
    imageBytes: resourceTransferBytes(summary, 'image'),
    fcpMs: summary?.fcpMs,
    lcpMs: summary?.lcpMs,
    tbtMs: summary?.tbtMs,
    cls: summary?.cls,
  };

  for (const metric of Object.keys(actual)) {
    if (!Number.isFinite(budget?.[metric]) || budget[metric] < 0) {
      throw new Error(`homepage budget ${metric} must be a non-negative number`);
    }
    if (!Number.isFinite(actual[metric]) || actual[metric] < 0) {
      throw new Error(`homepage measurement ${metric} must be a non-negative number`);
    }
    if (actual[metric] > budget[metric]) {
      throw new Error(`${metric}: ${actual[metric]} > ${budget[metric]}`);
    }
  }
}

export function summarizeColdRuns(coldRuns, expectedOrigin) {
  coldRuns.forEach((run) => {
    assertSuccessfulColdRun(run);
    if (expectedOrigin) {
      assertColdRunIntegrity(run, expectedOrigin);
    }
  });
  const resourceTypes = new Set(
    coldRuns.flatMap((run) => Object.keys(run.resources.byType)),
  );
  const byType = {};
  for (const type of [...resourceTypes].sort()) {
    byType[type] = {
      requests: median(coldRuns.map((run) => run.resources.byType[type]?.requests || 0)),
      transferBytes: median(coldRuns.map((run) => run.resources.byType[type]?.transferBytes || 0)),
    };
  }

  return {
    fcpMs: median(coldRuns.map((run) => run.metrics.fcpMs)),
    lcpMs: median(coldRuns.map((run) => run.metrics.lcpMs)),
    tbtMs: median(coldRuns.map((run) => run.metrics.totalBlockingTimeMs)),
    cls: median(coldRuns.map((run) => run.metrics.cls)),
    requests: median(coldRuns.map((run) => run.resources.requestCount)),
    transferBytes: median(coldRuns.map((run) => run.resources.transferBytes)),
    byType,
  };
}

async function readBuildId() {
  const response = await fetch(`${baseUrl}/BUILD_ID`, { redirect: 'follow' });
  assertFinalUrlOrigin(response.url, baseUrl, '/BUILD_ID response');
  if (!response.ok) {
    throw new Error(`/BUILD_ID returned ${response.status} from ${baseUrl}`);
  }
  const buildId = (await response.text()).trim();
  if (!buildId) {
    throw new Error(`/BUILD_ID returned an empty response from ${baseUrl}`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(buildId)) {
    throw new Error(`/BUILD_ID returned an unsafe value from ${baseUrl}`);
  }
  return buildId;
}

async function addPerformanceObservers(context) {
  await context.addInitScript(() => {
    window.__podsumPerf = { lcp: 0, cls: 0, longTasks: [] };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__podsumPerf.lcp = entries.at(-1)?.startTime || 0;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__podsumPerf.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      window.__podsumPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
}

async function measureNavigation(context, label) {
  const page = await context.newPage();
  const navigationLabel = `${label} homepage navigation`;
  const originGuard = createStickyMainFrameOriginGuard(page, baseUrl, navigationLabel);
  const requests = [];
  const failedRequests = [];
  const networkCapture = createNetworkCaptureState();
  let client;

  const onRequest = (request) => {
    requests.push({ url: request.url(), resourceType: request.resourceType() });
  };
  const onRequestFailed = (request) => {
    failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText || 'unknown',
    });
  };
  page.on('request', onRequest);
  page.on('requestfailed', onRequestFailed);

  try {
    client = await context.newCDPSession(page);

    client.on('Network.requestServedFromCache', (event) => {
      networkCapture.onRequestServedFromCache(event);
    });
    client.on('Network.requestWillBeSent', (event) => {
      networkCapture.onRequestWillBeSent(event);
    });
    client.on('Network.responseReceived', (event) => {
      networkCapture.onResponseReceived(event);
    });
    client.on('Network.responseReceivedExtraInfo', (event) => {
      networkCapture.onResponseReceivedExtraInfo(event);
    });
    client.on('Network.loadingFinished', (event) => {
      networkCapture.onLoadingFinished(event);
    });

    await client.send('Network.enable');
    const startedAt = new Date().toISOString();
    const response = await page.goto(homepageUrl, {
      waitUntil: 'load',
      timeout: navigationTimeoutMs,
    });
    originGuard.assertSafe();
    await page.waitForTimeout(settleMs);

    originGuard.assertSafe();
    const browserMetrics = await runOriginGuardedOperation(
      originGuard,
      () => page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        const observed = window.__podsumPerf || { lcp: 0, cls: 0, longTasks: [] };
        return {
          navigation: navigation ? navigation.toJSON() : null,
          fcpMs: fcp?.startTime || 0,
          lcpMs: observed.lcp,
          cls: observed.cls,
          longTasksMs: observed.longTasks,
        };
      }),
      `${label} homepage metric evaluation`,
    );

    const networkSnapshot = networkCapture.snapshot();
    const totalBlockingTimeMs = browserMetrics.longTasksMs.reduce(
      (total, duration) => total + Math.max(0, duration - 50),
      0,
    );
    const finalUrl = originGuard.assertSafe();

    return {
      label,
      startedAt,
      finalUrl,
      status: response?.status() || null,
      navigation: browserMetrics.navigation,
      metrics: {
        fcpMs: browserMetrics.fcpMs,
        lcpMs: browserMetrics.lcpMs,
        cls: browserMetrics.cls,
        longTasksMs: browserMetrics.longTasksMs,
        totalBlockingTimeMs,
      },
      resources: {
        requestCount: requests.length,
        responseCount: networkSnapshot.resources.length,
        transferBytes: networkSnapshot.transferBytes,
        byType: networkSnapshot.byType,
        failedRequests,
        cacheHeaders: networkSnapshot.cacheHeaders,
      },
    };
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onRequestFailed);
    originGuard.cleanup();
    if (client) await client.detach().catch(() => {});
    await page.close();
  }
}

async function main() {
  const budgetDocument = JSON.parse(
    await fs.readFile(new URL('../../performance-budget.json', import.meta.url), 'utf8'),
  );
  if (!budgetDocument?.homepage || typeof budgetDocument.homepage !== 'object') {
    throw new Error('performance-budget.json must define a homepage budget');
  }
  const buildId = await readBuildId();
  const browser = await chromium.launch({ headless: true });
  const coldRuns = [];
  let warmRun;

  try {
    for (let runNumber = 1; runNumber <= coldRunCount; runNumber += 1) {
      const context = await browser.newContext({ ...devices[deviceProfile] });
      try {
        await addPerformanceObservers(context);
        coldRuns.push(await measureNavigation(context, `cold-${runNumber}`));
        if (runNumber === coldRunCount) {
          warmRun = await measureNavigation(context, 'warm-1');
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const coldMedian = summarizeColdRuns(coldRuns, new URL(baseUrl).origin);
  assertHomepageWithinBudget(coldMedian, budgetDocument.homepage);
  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    buildId,
    deviceProfile,
    protocol: {
      coldRuns: coldRunCount,
      warmRuns: 1,
      freshContextPerColdRun: true,
      warmRunReusesFinalColdContext: true,
      settleMs,
    },
    summary: {
      coldMedian,
      warmResources: {
        requests: warmRun.resources.requestCount,
        transferBytes: warmRun.resources.transferBytes,
        byType: warmRun.resources.byType,
      },
    },
    coldRuns,
    warmRun,
  };

  const outputDir = path.join(process.cwd(), 'output', 'performance');
  const outputPath = path.join(outputDir, `home-${buildId}.json`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);

  console.log(JSON.stringify({ outputPath, buildId, coldMedian, warmResources: result.summary.warmResources }, null, 2));
}

const isEntryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
