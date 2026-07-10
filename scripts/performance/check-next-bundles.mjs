import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const NEXT_DIR = '.next';
const ROUTE = '/';

export function assertWithinBudget(actual, budget) {
  for (const key of ['javascriptBrotliBytes', 'cssBrotliBytes']) {
    if (actual[key] > budget[key]) {
      throw new Error(`${key}: ${actual[key]} > ${budget[key]}`);
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export function rootRouteFiles(appBuildManifest, buildManifest) {
  const appPages = appBuildManifest.pages || {};
  const sharedFiles = buildManifest.rootMainFiles || [];
  const routeKey = ['/page', ROUTE].find((key) => Object.hasOwn(appPages, key));
  if (!routeKey) {
    throw new Error('Root route entry not found in app-build-manifest.json');
  }
  const routeFiles = Array.isArray(appPages[routeKey]) ? appPages[routeKey] : [];
  if (!routeFiles.some((file) => typeof file === 'string' && file.endsWith('.js'))) {
    throw new Error('Root route entry must include at least one JavaScript file');
  }
  const layoutFiles = appPages['/layout'] || [];

  return [...new Set([...sharedFiles, ...layoutFiles, ...routeFiles])]
    .map((file) => file.replace(/^\/+/, ''))
    .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
    .sort();
}

async function measureFile(nextDir, relativePath) {
  const contents = await fs.readFile(path.join(nextDir, relativePath));
  return {
    path: relativePath,
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
    brotliBytes: brotliCompressSync(contents).byteLength,
  };
}

function sum(files, key) {
  return files.reduce((total, file) => total + file[key], 0);
}

function totalsFor(files, prefix) {
  return {
    [`${prefix}RawBytes`]: sum(files, 'rawBytes'),
    [`${prefix}GzipBytes`]: sum(files, 'gzipBytes'),
    [`${prefix}BrotliBytes`]: sum(files, 'brotliBytes'),
  };
}

async function main() {
  const projectDir = process.cwd();
  const nextDir = path.join(projectDir, NEXT_DIR);
  const [appBuildManifest, buildManifest, performanceBudget] = await Promise.all([
    readJson(path.join(nextDir, 'app-build-manifest.json')),
    readJson(path.join(nextDir, 'build-manifest.json')),
    readJson(path.join(projectDir, 'performance-budget.json')),
  ]);

  const measuredFiles = await Promise.all(
    rootRouteFiles(appBuildManifest, buildManifest).map((file) => measureFile(nextDir, file)),
  );
  const javascript = measuredFiles.filter((file) => file.path.endsWith('.js'));
  const css = measuredFiles.filter((file) => file.path.endsWith('.css'));
  const totals = {
    ...totalsFor(javascript, 'javascript'),
    ...totalsFor(css, 'css'),
  };
  const budget = performanceBudget.routes[ROUTE];
  const result = {
    route: ROUTE,
    files: { javascript, css },
    totals,
    budget,
  };

  console.log(JSON.stringify(result, null, 2));
  assertWithinBudget(totals, budget);
}

const isEntryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
