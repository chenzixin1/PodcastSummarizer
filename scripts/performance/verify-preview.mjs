#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertLhciRunResults } from './lhci-results.mjs';
import { resolveDistinctHttpOrigins } from './url-safety.mjs';

const require = createRequire(import.meta.url);
const lighthouseConfig = require('../../lighthouserc.cjs');

async function resolveNpmCliPath(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) {
    throw new Error('npm_execpath is required; run this command through npm');
  }
  if (!path.isAbsolute(input)) {
    throw new Error('npm_execpath must be an absolute path');
  }

  let resolved;
  try {
    resolved = await fs.realpath(input);
  } catch {
    throw new Error(`npm_execpath does not exist: ${input}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || path.basename(resolved) !== 'npm-cli.js') {
    throw new Error(`npm_execpath must point to npm-cli.js: ${input}`);
  }
  return resolved;
}

async function createRunOutputDir() {
  const outputRoot = path.resolve(process.cwd(), 'output', 'performance', 'lhci');
  await fs.mkdir(outputRoot, { recursive: true });
  const outputDir = path.join(
    outputRoot,
    `preview-${Date.now()}-${randomUUID()}`,
  );
  await fs.mkdir(outputDir);
  return outputDir;
}

function runLhci(npmCliPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCliPath, 'run', 'perf:lab'], {
      env,
      stdio: 'inherit',
    });
    const signalForwarders = new Map();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const forwardSignal = () => {
        child.kill(signal);
      };
      signalForwarders.set(signal, forwardSignal);
      process.once(signal, forwardSignal);
    }

    const removeSignalForwarders = () => {
      for (const [signal, forwardSignal] of signalForwarders) {
        process.removeListener(signal, forwardSignal);
      }
    };

    child.once('error', (error) => {
      removeSignalForwarders();
      reject(new Error(`Unable to start preview performance verification: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      removeSignalForwarders();
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const { previewOrigin } = resolveDistinctHttpOrigins({
    productionUrl: process.env.PROD_BASE_URL || 'https://podsum.cc',
    previewUrl: process.env.PREVIEW_BASE_URL,
  });
  const npmCliPath = await resolveNpmCliPath(process.env.npm_execpath);
  const expectedReportCount = lighthouseConfig?.ci?.collect?.numberOfRuns;
  if (!Number.isInteger(expectedReportCount) || expectedReportCount <= 0) {
    throw new Error('lighthouserc.cjs must configure a positive numberOfRuns');
  }
  const runStartedAtMs = Date.now();
  const outputDir = await createRunOutputDir();
  const exitCode = await runLhci(npmCliPath, {
    ...process.env,
    PERF_BASE_URL: previewOrigin,
    LHCI_OUTPUT_DIR: outputDir,
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  const result = await assertLhciRunResults({
    outputDir,
    expectedOrigin: previewOrigin,
    expectedReportCount,
    runStartedAtMs,
  });
  console.log(
    `Validated ${result.reportCount} Preview-origin Lighthouse reports in ${outputDir}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
