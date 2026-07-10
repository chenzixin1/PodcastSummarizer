/**
 * @jest-environment node
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

function readProjectFile(relativePath: string): string {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function parseJsonOrNull(source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const lhciOutputRoot = path.join(repoRoot, 'output', 'performance', 'lhci');

function listPreviewRunDirs(): Set<string> {
  try {
    return new Set(
      fs.readdirSync(lhciOutputRoot)
        .filter((entry) => entry.startsWith('preview-')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

function runPreviewWrapperWithFakeNpm(
  fakeNpmSource: string,
  options: { npmExecPath?: string } = {},
) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-perf-npm-'));
  const beforeRunDirs = listPreviewRunDirs();
  try {
    const fakeNpmPath = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(fakeNpmPath, fakeNpmSource);
    fs.writeFileSync(
      path.join(fakeBin, 'npm'),
      '#!/bin/sh\nexit 91\n',
      { mode: 0o755 },
    );
    return spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/performance/verify-preview.mjs')],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: fakeBin,
          npm_execpath: options.npmExecPath ?? fakeNpmPath,
          PREVIEW_BASE_URL: 'https://preview.example',
          PROD_BASE_URL: 'https://podsum.cc',
        },
      },
    );
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
    for (const runDir of listPreviewRunDirs()) {
      if (!beforeRunDirs.has(runDir)) {
        fs.rmSync(path.join(lhciOutputRoot, runDir), { recursive: true, force: true });
      }
    }
  }
}

function fakeLhciNpmSource({
  finalUrl = 'https://preview.example/',
  finalDisplayedUrl = 'https://preview.example/',
  reportCount = 5,
}: {
  finalUrl?: string;
  finalDisplayedUrl?: string;
  reportCount?: number;
} = {}): string {
  return `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.slice(2).join(' ') !== 'run perf:lab') process.exit(42);
const outputDir = process.env.LHCI_OUTPUT_DIR;
if (!outputDir) process.exit(43);
fs.mkdirSync(outputDir, { recursive: true });
const manifest = [];
for (let index = 0; index < ${reportCount}; index += 1) {
  const jsonPath = path.join(outputDir, 'run-' + index + '.report.json');
  const htmlPath = path.join(outputDir, 'run-' + index + '.report.html');
  fs.writeFileSync(jsonPath, JSON.stringify({
    lighthouseVersion: '12.6.1',
    gatherMode: 'navigation',
    requestedUrl: 'https://preview.example/',
    finalUrl: ${JSON.stringify(finalUrl)},
    finalDisplayedUrl: ${JSON.stringify(finalDisplayedUrl)},
    fetchTime: new Date(Date.now() + index).toISOString(),
    categories: {
      performance: {
        id: 'performance',
        title: 'Performance',
        score: 0.95,
        auditRefs: [{
          id: 'first-contentful-paint',
          weight: 10,
          group: 'metrics',
          acronym: 'FCP',
        }],
      },
    },
    audits: {
      'first-contentful-paint': {
        id: 'first-contentful-paint',
        title: 'First Contentful Paint',
        description: 'Marks when the first text or image is painted.',
        score: 0.98,
        scoreDisplayMode: 'numeric',
        numericValue: 812.4,
        numericUnit: 'millisecond',
      },
    },
  }));
  fs.writeFileSync(htmlPath, '<!doctype html><title>Lighthouse</title>');
  manifest.push({
    url: 'https://preview.example/',
    jsonPath,
    htmlPath,
    isRepresentativeRun: index === ${reportCount} - 1,
    summary: { performance: 0.95 },
  });
}
fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
console.log('FAKE_LHCI_OUTPUT_DIR=' + outputDir);
console.log('FAKE_NODE_EXEC_PATH=' + process.execPath);
`;
}

describe('preview deployment safety', () => {
  test('CI validates Node 22 builds and performance budgets without deploying', () => {
    const workflow = readProjectFile('.github/workflows/ci.yml');

    expect(workflow).toMatch(/uses:\s*actions\/checkout@v\d+/);
    expect(workflow).toMatch(/uses:\s*actions\/setup-node@v\d+/);
    expect(workflow).toMatch(/node-version:\s*['"]?22['"]?/);
    expect(workflow).toMatch(/cache:\s*['"]?npm['"]?/);
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toMatch(/run:\s*npm ci\s*$/m);
    expect(workflow).toMatch(/run:\s*npm run lint:ci\s*$/m);
    expect(workflow).not.toMatch(/run:\s*npm run lint\s*$/m);
    expect(workflow).toContain('github.event.pull_request.base.sha');
    expect(workflow).toContain('github.event.before');
    expect(workflow).toContain('LINT_BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}');
    expect(workflow).toContain('LINT_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}');
    expect(workflow).toMatch(/run:\s*npm test\s*$/m);
    expect(workflow).toMatch(/run:\s*npm run build\s*$/m);
    expect(workflow).toMatch(/run:\s*npm run perf:bundle\s*$/m);
    expect(workflow).toContain('NEXTAUTH_SECRET: ci-build-placeholder');
    expect(workflow).toMatch(/uses:\s*actions\/upload-artifact@v\d+/);
    expect(workflow).toMatch(/if:\s*\$\{\{\s*hashFiles\(['"]output\/performance\/\*\*['"]\)\s*!=\s*['"]{2}\s*\}\}/);
    expect(workflow).toMatch(/path:\s*output\/performance\//);

    expect(workflow).not.toMatch(/\bwrangler\s+deploy\b/i);
    expect(workflow).not.toMatch(/\bnpm\s+run\s+deploy(?:\s|:|$)/im);
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./i);
    expect(workflow).not.toMatch(/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/i);
    expect(workflow).not.toMatch(/podsum\.cc/i);
    expect(workflow).not.toMatch(/(?:wrangler\s+)?d1(?:\s+|:)migrations/i);
    expect(workflow).not.toMatch(/(?:wrangler\s+)?r2(?:\s+|:)(?:object|bucket|apply|rollback)/i);
  });

  test('preview Wrangler config is isolated from production routes, cron, and cache resources', () => {
    const source = readProjectFile('wrangler.preview.jsonc');
    const config = parseJsonOrNull(source);

    expect(config).toMatchObject({
      name: 'podcast-summarizer-preview',
      workers_dev: true,
      routes: [],
      vars: {
        DEPLOYMENT_STAGE: 'preview',
        ENABLE_CRON: 'false',
        NEXTAUTH_URL: 'https://podcast-summarizer-preview.chenzixin1.workers.dev',
        NEXT_PUBLIC_APP_URL: 'https://podcast-summarizer-preview.chenzixin1.workers.dev',
      },
    });

    expect(config?.d1_databases).toEqual([
      {
        binding: 'PODSUM_DB',
        database_name: 'podsum-d1-preview',
        database_id: 'adbd887b-dd92-4180-bdee-0b185c61fefe',
        migrations_dir: 'migrations/d1',
      },
    ]);
    expect(config).not.toHaveProperty('triggers');
    expect(config?.r2_buckets).toEqual([
      {
        binding: 'NEXT_INC_CACHE_R2_BUCKET',
        bucket_name: 'podsum-next-cache-preview',
      },
    ]);
    expect(config?.services).toEqual([
      {
        binding: 'WORKER_SELF_REFERENCE',
        service: 'podcast-summarizer-preview',
      },
    ]);
    expect(config?.durable_objects).toEqual({
      bindings: [
        {
          name: 'NEXT_CACHE_DO_QUEUE',
          class_name: 'DOQueueHandler',
        },
      ],
    });
    expect(config?.migrations).toEqual([
      {
        tag: 'cache-v1',
        new_sqlite_classes: ['DOQueueHandler'],
      },
    ]);
    expect(source).not.toContain('podsum-uploads');
    expect(source).not.toContain('podsum-next-cache-production');
    expect(source).not.toContain('5d0b65e0-d556-4aa4-953f-4d680d11c34a');
    expect(source).not.toMatch(/podsum\.cc|custom_domain/i);
  });

  test('production and Preview use separate OpenNext cache resources', () => {
    const production = parseJsonOrNull(readProjectFile('wrangler.jsonc'));
    const openNextConfig = readProjectFile('open-next.config.ts');
    const worker = readProjectFile('worker.ts');

    expect(production?.r2_buckets).toEqual(expect.arrayContaining([
      {
        binding: 'PODSUM_BUCKET',
        bucket_name: 'podsum-uploads',
      },
      {
        binding: 'NEXT_INC_CACHE_R2_BUCKET',
        bucket_name: 'podsum-next-cache-production',
      },
    ]));
    expect(production?.services).toEqual([
      {
        binding: 'WORKER_SELF_REFERENCE',
        service: 'podcast-summarizer',
      },
    ]);
    expect(production?.durable_objects).toEqual({
      bindings: [
        {
          name: 'NEXT_CACHE_DO_QUEUE',
          class_name: 'DOQueueHandler',
        },
      ],
    });
    expect(production?.migrations).toEqual([
      {
        tag: 'cache-v1',
        new_sqlite_classes: ['DOQueueHandler'],
      },
    ]);

    expect(openNextConfig).toContain('r2-incremental-cache');
    expect(openNextConfig).toContain('regional-cache');
    expect(openNextConfig).toContain('mode: \'long-lived\'');
    expect(openNextConfig).toContain('do-queue');
    expect(openNextConfig).toContain('queue: doQueue');
    expect(worker).toContain("export { DOQueueHandler } from './.open-next/worker.js'");
  });

  test('package scripts expose explicit preview deployment and performance commands', () => {
    const packageJson = parseJsonOrNull(readProjectFile('package.json'));

    expect(packageJson?.scripts).toEqual(expect.objectContaining({
      'lint:ci': 'node scripts/ci/lint-changed.mjs',
      'deploy:preview': 'npm run guard:worktree-drift && opennextjs-cloudflare build && wrangler deploy --config wrangler.preview.jsonc',
      'verify:preview:perf': 'node scripts/performance/verify-preview.mjs',
    }));
  });

  test.each([
    ['missing', undefined, undefined, 'PREVIEW_BASE_URL is required'],
    ['empty', '   ', undefined, 'PREVIEW_BASE_URL is required'],
    ['invalid', 'not a URL', undefined, 'PREVIEW_BASE_URL must be a valid URL'],
    ['non-http', 'ftp://preview.example', undefined, 'PREVIEW_BASE_URL must use http: or https:'],
    ['Production', 'https://podsum.cc/', 'https://podsum.cc', 'Preview origin https://podsum.cc must differ from Production origin https://podsum.cc'],
  ])('preview performance verification rejects %s input before LHCI', (
    _caseName,
    previewUrl,
    productionUrl,
    expectedError,
  ) => {
    const scriptPath = path.join(repoRoot, 'scripts/performance/verify-preview.mjs');
    const env = { ...process.env };
    if (previewUrl === undefined) {
      delete env.PREVIEW_BASE_URL;
    } else {
      env.PREVIEW_BASE_URL = previewUrl;
    }
    if (productionUrl === undefined) {
      delete env.PROD_BASE_URL;
    } else {
      env.PROD_BASE_URL = productionUrl;
    }
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
    expect(result.stderr).not.toContain('lhci');
  });

  test('preview performance verification preserves the LHCI child exit status', () => {
    const result = runPreviewWrapperWithFakeNpm('process.exit(23);');

    expect(result.status).toBe(23);
    expect(result.signal).toBeNull();
  });

  test('preview performance verification preserves the LHCI child termination signal', () => {
    const result = runPreviewWrapperWithFakeNpm(
      "process.kill(process.pid, 'SIGTERM');",
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe('SIGTERM');
  });

  test('preview performance verification invokes the validated npm CLI with Node and unique output', () => {
    const first = runPreviewWrapperWithFakeNpm(fakeLhciNpmSource());
    const second = runPreviewWrapperWithFakeNpm(fakeLhciNpmSource());

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toContain(`FAKE_NODE_EXEC_PATH=${process.execPath}`);
    const firstOutput = first.stdout.match(/FAKE_LHCI_OUTPUT_DIR=(.+)/)?.[1]?.trim();
    const secondOutput = second.stdout.match(/FAKE_LHCI_OUTPUT_DIR=(.+)/)?.[1]?.trim();
    const expectedRunPath = path.join('output', 'performance', 'lhci', 'preview-');
    expect(firstOutput).toContain(expectedRunPath);
    expect(secondOutput).toContain(expectedRunPath);
    expect(firstOutput).not.toBe(secondOutput);
  });

  test('preview performance verification rejects an invalid npm_execpath before spawning', () => {
    const result = runPreviewWrapperWithFakeNpm('process.exit(0);', {
      npmExecPath: 'npm-cli.js',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm_execpath must be an absolute path');
  });

  test('preview performance verification rejects a Production final URL from fresh LHRs', () => {
    const result = runPreviewWrapperWithFakeNpm(fakeLhciNpmSource({
      finalUrl: 'https://podsum.cc/',
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Lighthouse report run-0.report.json finalUrl changed origin from https://preview.example to https://podsum.cc',
    );
  });

  test('preview performance verification rejects missing fresh output instead of stale root reports', () => {
    const result = runPreviewWrapperWithFakeNpm('process.exit(0);');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Lighthouse run manifest is missing');
  });

  test('lighthouserc honors the unique LHCI_OUTPUT_DIR', () => {
    const outputDir = path.join(os.tmpdir(), 'lhci-unique-output');
    const result = spawnSync(
      process.execPath,
      ['-e', "console.log(require('./lighthouserc.cjs').ci.upload.outputDir)"],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, LHCI_OUTPUT_DIR: outputDir },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(outputDir);
  });

  test('visual verification fails clearly when CF_PREVIEW_BASE_URL is missing', () => {
    const scriptPath = path.join(repoRoot, 'scripts/verify-cloudflare-visual.mjs');
    const source = readProjectFile('scripts/verify-cloudflare-visual.mjs');
    const envWithoutPreviewUrl = { ...process.env };
    delete envWithoutPreviewUrl.CF_PREVIEW_BASE_URL;
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...envWithoutPreviewUrl,
        PLAYWRIGHT_BROWSERS_PATH: path.join(repoRoot, '.missing-playwright-browsers'),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CF_PREVIEW_BASE_URL is required');
    expect(source).not.toContain('https://cf-preview.podsum.cc');
  });

  test('measurement and visual capture guard every awaited result-producing page operation', () => {
    const measurementSource = readProjectFile('scripts/performance/measure-home.mjs');
    const visualSource = readProjectFile('scripts/verify-cloudflare-visual.mjs');

    expect(measurementSource).toMatch(
      /runOriginGuardedOperation\(\s*originGuard,\s*\(\) => page\.evaluate\(/,
    );
    expect(visualSource).toMatch(
      /runOriginGuardedOperation\(\s*originGuard,\s*\(\) => page\.evaluate\(/,
    );
    expect(visualSource).toMatch(
      /runOriginGuardedOperation\(\s*originGuard,\s*\(\) => page\.screenshot\(/,
    );
  });
});
