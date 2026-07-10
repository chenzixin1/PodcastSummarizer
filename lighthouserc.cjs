// LHCI loads this file as CommonJS, so its synchronous JSON source uses require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homepage } = require('./performance-budget.json');

function enforcedBudget(maxNumericValue) {
  return ['error', { maxNumericValue, aggregationMethod: 'median' }];
}

module.exports = {
  ci: {
    collect: {
      url: [process.env.PERF_BASE_URL || 'https://podsum.cc/'],
      numberOfRuns: 5,
      settings: { formFactor: 'mobile' },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.9, aggregationMethod: 'median' }],
        'first-contentful-paint': enforcedBudget(homepage.fcpMs),
        'largest-contentful-paint': enforcedBudget(homepage.lcpMs),
        'total-blocking-time': enforcedBudget(homepage.tbtMs),
        'cumulative-layout-shift': enforcedBudget(homepage.cls),
        'resource-summary:total:count': enforcedBudget(homepage.requests),
        'resource-summary:total:size': enforcedBudget(homepage.transferBytes),
        'resource-summary:script:size': enforcedBudget(homepage.scriptBytes),
        'resource-summary:stylesheet:size': enforcedBudget(homepage.styleBytes),
        'resource-summary:font:size': enforcedBudget(homepage.fontBytes),
        'resource-summary:image:size': enforcedBudget(homepage.imageBytes),
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: process.env.LHCI_OUTPUT_DIR || 'output/performance/lhci',
    },
  },
};
