import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROTECTED_DIR_PREFIXES = [
  'app/',
  'components/',
  'lib/',
  'migrations/',
  'scripts/',
  'types/',
  '__tests__/',
];

export const PROTECTED_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'wrangler.jsonc',
  'open-next.config.ts',
  'next.config.ts',
  'next.config.js',
  'middleware.ts',
  'worker.ts',
  'cloudflare-env.d.ts',
  'tsconfig.json',
  'jest.config.js',
]);

function normalizeRepoPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^"+|"+$/g, '');
}

export function parseGitStatus(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return {
        status,
        filePath: normalizeRepoPath(renamedPath),
      };
    });
}

export function isProtectedPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return PROTECTED_FILES.has(normalized) || PROTECTED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function filterProtectedChanges(changes) {
  return changes.filter((change) => isProtectedPath(change.filePath));
}

export function detectPrimaryWorktreeRoot(repoRoot) {
  const marker = `${path.sep}.worktrees${path.sep}`;
  const index = repoRoot.indexOf(marker);
  if (index < 0) {
    return null;
  }
  return repoRoot.slice(0, index);
}

function gitStatusForRoot(root) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git status failed in ${root}`);
  }
  return result.stdout;
}

function formatChanges(changes) {
  return changes.map((change) => `${change.status} ${change.filePath}`).join('\n');
}

export function assertNoDeployDrift({
  repoRoot,
  primaryRoot = detectPrimaryWorktreeRoot(repoRoot),
  env = process.env,
  statusForRoot = gitStatusForRoot,
}) {
  const warnings = [];
  const errors = [];

  if (env.ALLOW_DIRTY_DEPLOY === '1') {
    return {
      ok: true,
      errors,
      warnings: ['ALLOW_DIRTY_DEPLOY=1 is set; skipping worktree drift guard.'],
    };
  }

  const currentChanges = parseGitStatus(statusForRoot(repoRoot));
  if (currentChanges.length > 0) {
    errors.push([
      'Current deploy worktree has uncommitted changes:',
      formatChanges(currentChanges),
      'Commit, stash, or explicitly set ALLOW_DIRTY_DEPLOY=1 for an emergency deploy.',
    ].join('\n'));
  }

  if (primaryRoot && primaryRoot !== repoRoot) {
    const primaryProtectedChanges = filterProtectedChanges(parseGitStatus(statusForRoot(primaryRoot)));
    if (primaryProtectedChanges.length > 0) {
      errors.push([
        `Primary workspace has protected uncommitted changes at ${primaryRoot}:`,
        formatChanges(primaryProtectedChanges),
        'Port these changes into the deploy branch or commit/stash them before deploying from an isolated worktree.',
      ].join('\n'));
    }
  } else {
    warnings.push('No primary workspace detected; only current worktree cleanliness was checked.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function currentRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to determine git root.');
  }
  return result.stdout.trim();
}

function main() {
  const repoRoot = currentRepoRoot();
  const result = assertNoDeployDrift({ repoRoot });

  for (const warning of result.warnings) {
    console.log(`[deploy guard] ${warning}`);
  }
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`[deploy guard] ${error}`);
    }
    process.exit(1);
  }
  console.log('[deploy guard] Worktree drift guard passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error('[deploy guard]', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
