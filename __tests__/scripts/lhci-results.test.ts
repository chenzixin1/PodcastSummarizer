/**
 * @jest-environment node
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertLhciRunResults,
  assertLhrStructure,
} from '../../scripts/performance/lhci-results.mjs';

const previewOrigin = 'https://preview.example';
const productionOrigin = 'https://podsum.cc';
const runStartedAtMs = Date.parse('2026-07-09T23:59:00.000Z');
const tempRoots: string[] = [];
const performanceAuditId = 'first-contentful-paint';

function makeAuditResult(overrides: Record<string, unknown> = {}) {
  return {
    id: performanceAuditId,
    title: 'First Contentful Paint',
    description: 'Marks when the first text or image is painted.',
    score: 0.98,
    scoreDisplayMode: 'numeric',
    numericValue: 812.4,
    numericUnit: 'millisecond',
    ...overrides,
  };
}

function makePerformanceCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'performance',
    title: 'Performance',
    score: 0.95,
    auditRefs: [{
      id: performanceAuditId,
      weight: 10,
      group: 'metrics',
      acronym: 'FCP',
    }],
    ...overrides,
  };
}

function makeValidReport(index: number) {
  return {
    lighthouseVersion: '12.6.1',
    gatherMode: 'navigation',
    requestedUrl: `${previewOrigin}/`,
    finalUrl: `${previewOrigin}/`,
    finalDisplayedUrl: `${previewOrigin}/`,
    fetchTime: `2026-07-10T00:00:0${index}.000Z`,
    categories: { performance: makePerformanceCategory() },
    audits: { [performanceAuditId]: makeAuditResult() },
  };
}

type RunFixtureOptions = {
  reportCount?: number;
  reportOverrides?: (index: number) => Record<string, unknown>;
};

function makeRunFixture(options: RunFixtureOptions = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-run-results-'));
  tempRoots.push(outputDir);
  const reportCount = options.reportCount ?? 5;
  const manifest = [];

  for (let index = 0; index < reportCount; index += 1) {
    const jsonPath = path.join(outputDir, `run-${index}.report.json`);
    const htmlPath = path.join(outputDir, `run-${index}.report.html`);
    const report = {
      ...makeValidReport(index),
      ...options.reportOverrides?.(index),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(report));
    fs.writeFileSync(htmlPath, '<!doctype html><title>Lighthouse</title>');
    manifest.push({
      url: `${previewOrigin}/`,
      isRepresentativeRun: index === reportCount - 1,
      jsonPath,
      htmlPath,
      summary: { performance: 0.95 },
    });
  }

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
  return { outputDir, manifest };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts exactly five fresh Preview-origin Lighthouse reports', async () => {
  const fixture = makeRunFixture();

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).resolves.toEqual({ reportCount: 5 });
});

test('rejects a server redirect whose LHR finalUrl is Production', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 2
      ? { finalUrl: `${productionOrigin}/pricing` }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(
    `Lighthouse report run-2.report.json finalUrl changed origin from ${previewOrigin} to ${productionOrigin}`,
  );
});

test('rejects a Production finalDisplayedUrl even when finalUrl is Preview', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 1
      ? { finalDisplayedUrl: `${productionOrigin}/` }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('run-1.report.json finalDisplayedUrl changed origin');
});

test.each([
  ['missing lighthouseVersion', { lighthouseVersion: undefined }, 'lighthouseVersion must be a non-empty string'],
  ['numeric lighthouseVersion', { lighthouseVersion: 12 }, 'lighthouseVersion must be a non-empty string'],
  ['missing gatherMode', { gatherMode: undefined }, 'gatherMode must be one of navigation, timespan, snapshot'],
  ['unknown gatherMode', { gatherMode: 'legacy' }, 'gatherMode must be one of navigation, timespan, snapshot'],
  ['array categories', { categories: [] }, 'categories must be a plain object'],
  ['missing performance category', { categories: {} }, 'categories.performance must be a plain object'],
  ['array performance category', { categories: { performance: [] } }, 'categories.performance must be a plain object'],
  ['string performance score', { categories: { performance: makePerformanceCategory({ score: '0.95' }) } }, 'categories.performance.score must be null or a finite number from 0 to 1'],
  ['array audits', { audits: [] }, 'audits must be a plain object'],
] as const)('rejects an LHR with %s', async (_caseName, overrides, expectedError) => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0 ? overrides : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(`Lighthouse report run-0.report.json ${expectedError}`);
});

const requiredStringFields = [
  ['fetchTime', '2026-07-10T00:00:00.000Z'],
  ['requestedUrl', `${previewOrigin}/`],
  ['finalUrl', `${previewOrigin}/`],
  ['finalDisplayedUrl', `${previewOrigin}/`],
] as const;

test.each(requiredStringFields.flatMap(([field, validValue]) => [
  [`${field} missing`, field, undefined],
  [`${field} empty`, field, '   '],
  [`${field} array`, field, [validValue]],
  [`${field} number`, field, 42],
  [`${field} null`, field, null],
]))('rejects an LHR with %s', async (_caseName, field, invalidValue) => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0 ? { [field]: invalidValue } : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(
    `Lighthouse report run-0.report.json ${field} must be a non-empty string`,
  );
});

test.each(requiredStringFields)(
  'rejects a boxed String object for %s before date or URL coercion',
  (field, validValue) => {
    const report = makeValidReport(0) as Record<string, unknown>;
    report[field] = new String(validValue);

    expect(() => assertLhrStructure(
      report,
      'Lighthouse report boxed.report.json',
    )).toThrow(
      `Lighthouse report boxed.report.json ${field} must be a non-empty string`,
    );
  },
);

test('rejects a boxed String object for the performance category title', () => {
  const report = makeValidReport(0);
  report.categories.performance = makePerformanceCategory({
    title: new String('Performance'),
  });

  expect(() => assertLhrStructure(
    report,
    'Lighthouse report boxed.report.json',
  )).toThrow(
    'Lighthouse report boxed.report.json categories.performance.title must be a non-empty string',
  );
});

test('rejects a non-finite numeric performance score', () => {
  const report = makeValidReport(0);
  report.categories.performance = makePerformanceCategory({ score: Number.NaN });

  expect(() => assertLhrStructure(
    report,
    'Lighthouse report nan.report.json',
  )).toThrow(
    'Lighthouse report nan.report.json categories.performance.score must be null or a finite number from 0 to 1',
  );
});

test.each([
  ['missing category id', makePerformanceCategory({ id: undefined }), 'categories.performance.id must equal performance'],
  ['wrong category id', makePerformanceCategory({ id: 'accessibility' }), 'categories.performance.id must equal performance'],
  ['missing category title', makePerformanceCategory({ title: undefined }), 'categories.performance.title must be a non-empty string'],
  ['empty category title', makePerformanceCategory({ title: '' }), 'categories.performance.title must be a non-empty string'],
  ['non-string category title', makePerformanceCategory({ title: ['Performance'] }), 'categories.performance.title must be a non-empty string'],
  ['missing auditRefs', makePerformanceCategory({ auditRefs: undefined }), 'categories.performance.auditRefs must be a non-empty array'],
  ['wrong auditRefs type', makePerformanceCategory({ auditRefs: {} }), 'categories.performance.auditRefs must be a non-empty array'],
  ['empty auditRefs', makePerformanceCategory({ auditRefs: [] }), 'categories.performance.auditRefs must be a non-empty array'],
  ['score below zero', makePerformanceCategory({ score: -0.01 }), 'categories.performance.score must be null or a finite number from 0 to 1'],
  ['score above one', makePerformanceCategory({ score: 1.01 }), 'categories.performance.score must be null or a finite number from 0 to 1'],
  ['score far above one', makePerformanceCategory({ score: 42 }), 'categories.performance.score must be null or a finite number from 0 to 1'],
  ['NaN-equivalent score string', makePerformanceCategory({ score: 'NaN' }), 'categories.performance.score must be null or a finite number from 0 to 1'],
] as const)('rejects a performance category with %s', async (
  _caseName,
  performance,
  expectedError,
) => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0
      ? { categories: { performance } }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(`Lighthouse report run-0.report.json ${expectedError}`);
});

test.each([
  ['non-object auditRef', [42], 'categories.performance.auditRefs[0] must be a plain object'],
  ['missing auditRef id', [{ weight: 10 }], 'categories.performance.auditRefs[0].id must be a non-empty string'],
  ['empty auditRef id', [{ id: '', weight: 10 }], 'categories.performance.auditRefs[0].id must be a non-empty string'],
  ['missing auditRef weight', [{ id: performanceAuditId }], 'categories.performance.auditRefs[0].weight must be a finite non-negative number'],
  ['negative auditRef weight', [{ id: performanceAuditId, weight: -1 }], 'categories.performance.auditRefs[0].weight must be a finite non-negative number'],
  ['string auditRef weight', [{ id: performanceAuditId, weight: '10' }], 'categories.performance.auditRefs[0].weight must be a finite non-negative number'],
  ['non-string auditRef group', [{ id: performanceAuditId, weight: 10, group: [] }], 'categories.performance.auditRefs[0].group must be a string when present'],
  ['non-string auditRef acronym', [{ id: performanceAuditId, weight: 10, acronym: 42 }], 'categories.performance.auditRefs[0].acronym must be a string when present'],
] as const)('rejects a performance category with %s', async (
  _caseName,
  auditRefs,
  expectedError,
) => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0
      ? { categories: { performance: makePerformanceCategory({ auditRefs }) } }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(`Lighthouse report run-0.report.json ${expectedError}`);
});

test('rejects a performance auditRef whose audit is missing', async () => {
  const missingAuditId = 'missing-performance-audit';
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0 ? {
      categories: {
        performance: makePerformanceCategory({
          auditRefs: [{ id: missingAuditId, weight: 1 }],
        }),
      },
      audits: {},
    } : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(
    `categories.performance.auditRefs[0] must reference an existing plain-object audit: ${missingAuditId}`,
  );
});

test('rejects a performance auditRef whose referenced audit has no id', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0 ? {
      audits: { [performanceAuditId]: {} },
    } : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(
    `audits.${performanceAuditId}.id must match its auditRef id`,
  );
});

test('rejects a performance auditRef whose audit id does not match', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0 ? {
      audits: {
        [performanceAuditId]: makeAuditResult({ id: 'largest-contentful-paint' }),
      },
    } : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow(
    `audits.${performanceAuditId}.id must match its auditRef id`,
  );
});

test('accepts a null performance score permitted by the installed Lighthouse schema', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 0
      ? { categories: { performance: makePerformanceCategory({ score: null }) } }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).resolves.toEqual({ reportCount: 5 });
});

test('rejects a missing run manifest instead of accepting stale output elsewhere', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-empty-run-'));
  tempRoots.push(outputDir);

  await expect(assertLhciRunResults({
    outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse run manifest is missing');
});

test('rejects an empty manifest that does not contain the configured run count', async () => {
  const fixture = makeRunFixture({ reportCount: 0 });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse run manifest contains 0 reports; expected 5');
});

test('rejects malformed report JSON', async () => {
  const fixture = makeRunFixture();
  fs.writeFileSync(fixture.manifest[3].jsonPath, '{ malformed');

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse report run-3.report.json is not valid JSON');
});

test('rejects manifest report paths outside the unique run directory', async () => {
  const fixture = makeRunFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-outside-run-'));
  tempRoots.push(outsideDir);
  const outsidePath = path.join(outsideDir, 'outside.report.json');
  fs.writeFileSync(outsidePath, '{}');
  fixture.manifest[0].jsonPath = outsidePath;
  fs.writeFileSync(
    path.join(fixture.outputDir, 'manifest.json'),
    JSON.stringify(fixture.manifest),
  );

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('manifest jsonPath must stay inside the current Lighthouse run directory');
});

test('rejects an unlisted JSON report in the unique run directory', async () => {
  const fixture = makeRunFixture();
  fs.writeFileSync(path.join(fixture.outputDir, 'stale.report.json'), '{}');

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse run directory contains 6 JSON reports; expected 5');
});

test('rejects a stale LHR whose fetchTime predates the current run', async () => {
  const fixture = makeRunFixture({
    reportOverrides: (index) => index === 4
      ? { fetchTime: '2026-07-09T22:00:00.000Z' }
      : {},
  });

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse report run-4.report.json fetchTime predates the current run');
});

function createSymlinkOrSkip(target: string, linkPath: string, type: 'file' | 'dir'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      return false;
    }
    throw error;
  }
}

test('rejects a symlinked manifest before reading it', async () => {
  const fixture = makeRunFixture();
  const manifestPath = path.join(fixture.outputDir, 'manifest.json');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-manifest-target-'));
  tempRoots.push(outsideDir);
  const targetPath = path.join(outsideDir, 'manifest-target.json');
  fs.copyFileSync(manifestPath, targetPath);
  fs.rmSync(manifestPath);
  if (!createSymlinkOrSkip(targetPath, manifestPath, 'file')) return;

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse run manifest must be a regular non-symlink file');
});

test('rejects a manifest path whose symlinked ancestor escapes the run directory', async () => {
  const fixture = makeRunFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-ancestor-target-'));
  tempRoots.push(outsideDir);
  const escapedJson = path.join(outsideDir, 'escaped.report.json');
  const escapedHtml = path.join(outsideDir, 'escaped.report.html');
  fs.copyFileSync(fixture.manifest[0].jsonPath, escapedJson);
  fs.copyFileSync(fixture.manifest[0].htmlPath, escapedHtml);
  const linkPath = path.join(fixture.outputDir, 'escaped');
  if (!createSymlinkOrSkip(outsideDir, linkPath, 'dir')) return;
  fixture.manifest[0].jsonPath = path.join(linkPath, 'escaped.report.json');
  fixture.manifest[0].htmlPath = path.join(linkPath, 'escaped.report.html');
  fs.writeFileSync(
    path.join(fixture.outputDir, 'manifest.json'),
    JSON.stringify(fixture.manifest),
  );

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('canonical path escapes the current Lighthouse run directory');
});

test('rejects an HTML report with a symlinked ancestor that stays inside the run directory', async () => {
  const fixture = makeRunFixture();
  const realDir = path.join(fixture.outputDir, 'real-html-directory');
  fs.mkdirSync(realDir);
  const realHtml = path.join(realDir, 'aliased.report.html');
  fs.copyFileSync(fixture.manifest[0].htmlPath, realHtml);
  const linkPath = path.join(fixture.outputDir, 'html-alias');
  if (!createSymlinkOrSkip(realDir, linkPath, 'dir')) return;
  fixture.manifest[0].htmlPath = path.join(linkPath, 'aliased.report.html');
  fs.writeFileSync(
    path.join(fixture.outputDir, 'manifest.json'),
    JSON.stringify(fixture.manifest),
  );

  await expect(assertLhciRunResults({
    outputDir: fixture.outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount: 5,
    runStartedAtMs,
  })).rejects.toThrow('Lighthouse HTML report must not have symlink ancestors');
});
