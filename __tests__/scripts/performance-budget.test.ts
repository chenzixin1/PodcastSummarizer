import {
  assertWithinBudget,
  rootRouteFiles,
} from '../../scripts/performance/check-next-bundles.mjs';
import {
  assertHomepageWithinBudget,
  summarizeColdRuns,
} from '../../scripts/performance/measure-home.mjs';
import performanceBudget from '../../performance-budget.json';
import lighthouseConfig from '../../lighthouserc.cjs';

const previewOrigin = 'https://preview.example';

function makeColdRun(
  status: number,
  metrics: Record<string, number>,
  label = 'cold-1',
) {
  return {
    label,
    status,
    finalUrl: `${previewOrigin}/`,
    metrics: {
      cls: 0,
      totalBlockingTimeMs: 50,
      ...metrics,
    },
    resources: {
      requestCount: 1,
      transferBytes: 1_024,
      byType: {},
      failedRequests: [],
      cacheHeaders: [],
    },
  };
}

function makeHomepageSummary(overrides: Record<string, unknown> = {}) {
  const defaultByType = {
    script: { requests: 2, transferBytes: 100_000 },
    stylesheet: { requests: 1, transferBytes: 8_000 },
    style: { requests: 1, transferBytes: 4_000 },
    font: { requests: 1, transferBytes: 20_000 },
    image: { requests: 1, transferBytes: 10_000 },
  };
  const overrideByType = (overrides.byType || {}) as Record<string, unknown>;
  return {
    requests: 20,
    transferBytes: 200_000,
    fcpMs: 1_000,
    lcpMs: 2_000,
    tbtMs: 100,
    cls: 0.05,
    ...overrides,
    byType: {
      ...defaultByType,
      ...overrideByType,
    },
  };
}

test('accepts a route below its Brotli budgets', () => {
  expect(() => assertWithinBudget(
    { javascriptBrotliBytes: 110_000, cssBrotliBytes: 12_000 },
    { javascriptBrotliBytes: 122_880, cssBrotliBytes: 20_480 },
  )).not.toThrow();
});

test('reports the exact metric that exceeds budget', () => {
  expect(() => assertWithinBudget(
    { javascriptBrotliBytes: 123_000, cssBrotliBytes: 12_000 },
    { javascriptBrotliBytes: 122_880, cssBrotliBytes: 20_480 },
  )).toThrow('javascriptBrotliBytes: 123000 > 122880');
});

test('rejects a non-successful cold navigation before aggregation', () => {
  expect(() => summarizeColdRuns([
    makeColdRun(503, { fcpMs: 100, lcpMs: 200 }),
  ])).toThrow('cold-1: navigation status 503 is not successful');
});

test.each([
  ['fcpMs', 0],
  ['fcpMs', undefined],
  ['lcpMs', 0],
  ['lcpMs', undefined],
] as const)('rejects %s=%s before aggregation', (metric, value) => {
  const metrics: Record<string, number> = { fcpMs: 100, lcpMs: 200 };
  if (value === undefined) {
    delete metrics[metric];
  } else {
    metrics[metric] = value;
  }

  expect(() => summarizeColdRuns([
    makeColdRun(200, metrics),
  ])).toThrow(`cold-1: ${metric} must be a positive number`);
});

test.each([
  ['totalBlockingTimeMs', -1],
  ['totalBlockingTimeMs', undefined],
  ['cls', -0.001],
  ['cls', undefined],
] as const)('rejects %s=%s before aggregation', (metric, value) => {
  const run = makeColdRun(200, { fcpMs: 100, lcpMs: 200 });
  if (value === undefined) {
    delete run.metrics[metric];
  } else {
    run.metrics[metric] = value;
  }

  expect(() => summarizeColdRuns([run])).toThrow(
    `cold-1: ${metric} must be a non-negative number`,
  );
});

test('aggregates successful cold navigations with positive paint metrics', () => {
  expect(summarizeColdRuns([
    makeColdRun(200, { fcpMs: 100, lcpMs: 200 }),
  ])).toMatchObject({ fcpMs: 100, lcpMs: 200 });
});

test('includes median total blocking time in cold-run aggregation', () => {
  expect(summarizeColdRuns([
    makeColdRun(200, { fcpMs: 100, lcpMs: 200, totalBlockingTimeMs: 80 }, 'cold-1'),
    makeColdRun(200, { fcpMs: 120, lcpMs: 220, totalBlockingTimeMs: 120 }, 'cold-2'),
  ])).toMatchObject({ tbtMs: 100 });
});

test('accepts a homepage measurement below every JSON budget', () => {
  expect(() => assertHomepageWithinBudget(
    makeHomepageSummary(),
    performanceBudget.homepage,
  )).not.toThrow();
});

test.each([
  ['requests', { requests: performanceBudget.homepage.requests + 1 }],
  ['transferBytes', { transferBytes: performanceBudget.homepage.transferBytes + 1 }],
  ['scriptBytes', { byType: { script: { requests: 2, transferBytes: performanceBudget.homepage.scriptBytes + 1 } } }],
  ['styleBytes', {
    byType: {
      style: { requests: 1, transferBytes: 1 },
      stylesheet: { requests: 1, transferBytes: performanceBudget.homepage.styleBytes },
    },
  }],
  ['fontBytes', { byType: { font: { requests: 1, transferBytes: performanceBudget.homepage.fontBytes + 1 } } }],
  ['imageBytes', { byType: { image: { requests: 1, transferBytes: performanceBudget.homepage.imageBytes + 1 } } }],
  ['fcpMs', { fcpMs: performanceBudget.homepage.fcpMs + 1 }],
  ['lcpMs', { lcpMs: performanceBudget.homepage.lcpMs + 1 }],
  ['tbtMs', { tbtMs: performanceBudget.homepage.tbtMs + 1 }],
  ['cls', { cls: performanceBudget.homepage.cls + 0.001 }],
] as const)('rejects homepage %s above its JSON budget', (metric, overrides) => {
  expect(() => assertHomepageWithinBudget(
    makeHomepageSummary(overrides),
    performanceBudget.homepage,
  )).toThrow(`${metric}:`);
});

test('rejects a cold run with a recorded failed request', () => {
  const run = makeColdRun(200, { fcpMs: 100, lcpMs: 200 });
  run.resources.failedRequests.push({
    url: `${previewOrigin}/_next/static/chunks/app.js`,
    resourceType: 'script',
    errorText: 'net::ERR_FAILED',
  } as never);

  expect(() => summarizeColdRuns([run], previewOrigin)).toThrow(
    `cold-1: failed request ${previewOrigin}/_next/static/chunks/app.js: net::ERR_FAILED`,
  );
});

test('rejects a cold run with a non-2xx same-origin resource', () => {
  const run = makeColdRun(200, { fcpMs: 100, lcpMs: 200 });
  run.resources.cacheHeaders.push({
    url: `${previewOrigin}/_next/static/chunks/app.js`,
    status: 503,
  } as never);

  expect(() => summarizeColdRuns([run], previewOrigin)).toThrow(
    `cold-1: same-origin resource ${previewOrigin}/_next/static/chunks/app.js returned 503`,
  );
});

test('Lighthouse assertions enforce the applicable homepage JSON budgets', () => {
  const assertions = lighthouseConfig.ci.assert.assertions;
  const expected = {
    'first-contentful-paint': performanceBudget.homepage.fcpMs,
    'largest-contentful-paint': performanceBudget.homepage.lcpMs,
    'total-blocking-time': performanceBudget.homepage.tbtMs,
    'cumulative-layout-shift': performanceBudget.homepage.cls,
    'resource-summary:total:count': performanceBudget.homepage.requests,
    'resource-summary:total:size': performanceBudget.homepage.transferBytes,
    'resource-summary:script:size': performanceBudget.homepage.scriptBytes,
    'resource-summary:stylesheet:size': performanceBudget.homepage.styleBytes,
    'resource-summary:font:size': performanceBudget.homepage.fontBytes,
    'resource-summary:image:size': performanceBudget.homepage.imageBytes,
  };

  for (const audit of Object.keys(expected) as Array<keyof typeof expected>) {
    expect(assertions[audit]).toEqual([
      'error',
      { maxNumericValue: expected[audit], aggregationMethod: 'median' },
    ]);
  }
});

test('rejects an app manifest without a root route entry', () => {
  expect(() => rootRouteFiles(
    { pages: { '/layout': ['static/chunks/app/layout.js'] } },
    { rootMainFiles: ['static/chunks/main-app.js'] },
  )).toThrow('Root route entry not found in app-build-manifest.json');
});

test('rejects a root route entry without route JavaScript', () => {
  expect(() => rootRouteFiles(
    { pages: { '/page': ['static/css/app.css'] } },
    { rootMainFiles: ['static/chunks/main-app.js'] },
  )).toThrow('Root route entry must include at least one JavaScript file');
});
