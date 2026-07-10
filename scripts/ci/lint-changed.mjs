#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lintableExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const requestedBaseSha = (process.env.LINT_BASE_SHA || process.argv[2] || '').trim();
if (!requestedBaseSha) {
  fail('LINT_BASE_SHA is required (or pass the base SHA as the first argument).');
}
if (!/^[0-9a-f]{7,64}$/i.test(requestedBaseSha)) {
  fail(`Invalid lint base SHA: ${requestedBaseSha}`);
}

const gitRootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
if (gitRootResult.status !== 0) {
  fail(`Unable to resolve Git repository root: ${gitRootResult.stderr.trim()}`);
}
const gitRoot = gitRootResult.stdout.trim();

let baseSha = requestedBaseSha;
if (/^0{40}$/.test(requestedBaseSha)) {
  const defaultBranch = (process.env.LINT_DEFAULT_BRANCH || '').trim();
  if (!defaultBranch) {
    fail('LINT_DEFAULT_BRANCH is required for an all-zero LINT_BASE_SHA.');
  }
  const defaultBranchCheck = spawnSync(
    'git',
    ['check-ref-format', '--branch', defaultBranch],
    { cwd: gitRoot, encoding: 'utf8' },
  );
  if (defaultBranch.startsWith('refs/') || defaultBranchCheck.status !== 0) {
    fail(`Invalid lint default branch: ${defaultBranch}`);
  }

  const candidateRefs = [
    `refs/remotes/origin/${defaultBranch}`,
    `refs/heads/${defaultBranch}`,
  ];
  const defaultBranchRef = candidateRefs.find((ref) => {
    const result = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
      cwd: gitRoot,
      encoding: 'utf8',
    });
    return result.status === 0;
  });
  if (!defaultBranchRef) {
    fail(
      `Default branch ref for ${defaultBranch} is unavailable. Ensure checkout uses fetch-depth: 0.`,
    );
  }

  const mergeBaseResult = spawnSync('git', ['merge-base', 'HEAD', defaultBranchRef], {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  const mergeBase = mergeBaseResult.stdout.trim();
  if (mergeBaseResult.status !== 0 || !/^[0-9a-f]{7,64}$/i.test(mergeBase)) {
    fail(
      `Unable to resolve merge base with default branch ${defaultBranch}: ${mergeBaseResult.stderr.trim() || 'no merge base found'}`,
    );
  }
  baseSha = mergeBase;
  console.log(
    `Resolved all-zero LINT_BASE_SHA to ${baseSha} using default branch ${defaultBranch} (${defaultBranchRef}).`,
  );
}

const baseResult = spawnSync('git', ['cat-file', '-e', `${baseSha}^{commit}`], {
  cwd: gitRoot,
  encoding: 'utf8',
});
if (baseResult.status !== 0) {
  fail(`Lint base SHA ${baseSha} is unavailable. Ensure checkout uses fetch-depth: 0.`);
}

const diffResult = spawnSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', `${baseSha}...HEAD`],
  {
    cwd: gitRoot,
    encoding: 'utf8',
  },
);
if (diffResult.status !== 0) {
  fail(`Unable to diff lint base SHA ${baseSha}: ${diffResult.stderr.trim()}`);
}

const lintableFiles = diffResult.stdout
  .split('\n')
  .map((filePath) => filePath.trim())
  .filter(Boolean)
  .filter((filePath) => lintableExtensions.has(path.extname(filePath).toLowerCase()))
  .sort();

if (lintableFiles.length === 0) {
  console.log(`No changed JavaScript/TypeScript files since ${baseSha}; lint passed.`);
  process.exit(0);
}

console.log(`Linting ${lintableFiles.length} changed JavaScript/TypeScript files:`);
for (const filePath of lintableFiles) {
  console.log(`- ${filePath}`);
}

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '../..');
const eslintExecutable = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'eslint.cmd' : 'eslint',
);
if (!fs.existsSync(eslintExecutable)) {
  fail(`Repository ESLint executable not found: ${eslintExecutable}. Run npm ci first.`);
}

const eslintResult = spawnSync(eslintExecutable, ['--', ...lintableFiles], {
  cwd: gitRoot,
  stdio: 'inherit',
});
if (eslintResult.error) {
  fail(`Unable to run repository ESLint: ${eslintResult.error.message}`);
}
if (eslintResult.status !== 0) {
  process.exit(eslintResult.status ?? 1);
}
