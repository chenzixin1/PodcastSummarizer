/**
 * @jest-environment node
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'scripts/ci/lint-changed.mjs');
const tempRoots: string[] = [];

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createFixtureRepo(changedFiles: Record<string, string>): { root: string; baseSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-changed-'));
  tempRoots.push(root);
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);
  writeFile(root, 'eslint.config.mjs', `export default [{
  files: ['**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}'],
  rules: { semi: ['error', 'always'] },
}];
`);
  writeFile(root, 'legacy.js', 'const legacyViolation = true\n');
  runGit(root, ['add', '--', '.']);
  runGit(root, ['commit', '-qm', 'baseline']);
  const baseSha = runGit(root, ['rev-parse', 'HEAD']);

  for (const [relativePath, contents] of Object.entries(changedFiles)) {
    writeFile(root, relativePath, contents);
  }
  runGit(root, ['add', '--', '.']);
  runGit(root, ['commit', '-qm', 'changed files']);
  return { root, baseSha };
}

function createFirstPushFixture(changedFiles: Record<string, string>): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-changed-first-push-'));
  tempRoots.push(root);
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);
  runGit(root, ['branch', '-M', 'main']);
  writeFile(root, 'eslint.config.mjs', `export default [{
  files: ['**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}'],
  rules: { semi: ['error', 'always'] },
}];
`);
  writeFile(root, 'legacy.js', 'const legacyViolation = true\n');
  runGit(root, ['add', '--', '.']);
  runGit(root, ['commit', '-qm', 'default branch baseline']);
  runGit(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  runGit(root, ['checkout', '-qb', 'feature/first-push']);

  for (const [relativePath, contents] of Object.entries(changedFiles)) {
    writeFile(root, relativePath, contents);
  }
  runGit(root, ['add', '--', '.']);
  runGit(root, ['commit', '-qm', 'first branch push']);
  return { root };
}

function runLintChanged(
  root: string,
  options: { argvBase?: string; envBase?: string; defaultBranch?: string } = {},
) {
  const env = { ...process.env };
  delete env.LINT_BASE_SHA;
  delete env.LINT_DEFAULT_BRANCH;
  if (options.envBase !== undefined) {
    env.LINT_BASE_SHA = options.envBase;
  }
  if (options.defaultBranch !== undefined) {
    env.LINT_DEFAULT_BRANCH = options.defaultBranch;
  }
  const args = [scriptPath];
  if (options.argvBase !== undefined) {
    args.push(options.argvBase);
  }
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lints only changed JavaScript and TypeScript files from an argv base SHA', () => {
  const fixture = createFixtureRepo({
    'changed.js': '',
    'changed.cjs': '',
    'changed.mjs': '',
    'changed.jsx': '',
    'changed.ts': '',
    'changed.tsx': '',
    'changed.mts': '',
    'changed.cts': '',
    'notes.md': '# not lintable\n',
  });

  const result = runLintChanged(fixture.root, { argvBase: fixture.baseSha });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Linting 8 changed JavaScript/TypeScript files');
  expect(result.stdout).not.toContain('legacy.js');
  expect(result.stdout).not.toContain('notes.md');
});

test('propagates ESLint failures from a changed file when base comes from the environment', () => {
  const fixture = createFixtureRepo({
    'changed.js': 'const changedViolation = true\n',
  });

  const result = runLintChanged(fixture.root, { envBase: fixture.baseSha });
  const output = `${result.stdout}\n${result.stderr}`;

  expect(result.status).not.toBe(0);
  expect(output).toContain('changed.js');
  expect(output).toContain('semi');
});

test('succeeds without invoking whole-repository ESLint when no lintable files changed', () => {
  const fixture = createFixtureRepo({
    'notes.md': '# documentation only\n',
  });

  const result = runLintChanged(fixture.root, { envBase: fixture.baseSha });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('No changed JavaScript/TypeScript files');
  expect(result.stdout).not.toContain('legacy.js');
});

test('fails clearly when no base SHA is provided', () => {
  const fixture = createFixtureRepo({
    'changed.js': 'const changed = true;\n',
  });

  const result = runLintChanged(fixture.root);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('LINT_BASE_SHA is required');
});

test('fails clearly when the base SHA is unavailable', () => {
  const fixture = createFixtureRepo({
    'changed.js': 'const changed = true;\n',
  });
  const unavailableSha = 'a'.repeat(40);

  const result = runLintChanged(fixture.root, { envBase: unavailableSha });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`Lint base SHA ${unavailableSha} is unavailable`);
  expect(result.stderr).toContain('fetch-depth: 0');
});

test('resolves an all-zero first-push SHA to the default-branch merge base', () => {
  const fixture = createFirstPushFixture({
    'feature.ts': 'const featureChange = true;\n',
    'notes.md': '# first branch push\n',
  });

  const result = runLintChanged(fixture.root, {
    envBase: '0'.repeat(40),
    defaultBranch: 'main',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Resolved all-zero LINT_BASE_SHA');
  expect(result.stdout).toContain('default branch main');
  expect(result.stdout).toContain('Linting 1 changed JavaScript/TypeScript files');
  expect(result.stdout).toContain('feature.ts');
  expect(result.stdout).not.toContain('legacy.js');
  expect(result.stdout).not.toContain('notes.md');
});

test('fails closed when an all-zero first-push SHA has no default branch', () => {
  const fixture = createFirstPushFixture({
    'feature.ts': 'const featureChange = true;\n',
  });

  const result = runLintChanged(fixture.root, { envBase: '0'.repeat(40) });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('LINT_DEFAULT_BRANCH is required for an all-zero LINT_BASE_SHA');
});

test('fails closed when the default branch name is invalid', () => {
  const fixture = createFirstPushFixture({
    'feature.ts': 'const featureChange = true;\n',
  });

  const result = runLintChanged(fixture.root, {
    envBase: '0'.repeat(40),
    defaultBranch: 'main..invalid',
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Invalid lint default branch: main..invalid');
});

test('fails closed when the default branch ref is unavailable', () => {
  const fixture = createFirstPushFixture({
    'feature.ts': 'const featureChange = true;\n',
  });

  const result = runLintChanged(fixture.root, {
    envBase: '0'.repeat(40),
    defaultBranch: 'missing',
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Default branch ref for missing is unavailable');
  expect(result.stderr).toContain('fetch-depth: 0');
});
