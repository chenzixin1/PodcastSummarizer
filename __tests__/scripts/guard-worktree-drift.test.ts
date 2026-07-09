/**
 * @jest-environment node
 */

import path from 'node:path';

type GuardModule = {
  parseGitStatus: (output: string) => Array<{ status: string; filePath: string }>;
  isProtectedPath: (filePath: string) => boolean;
  filterProtectedChanges: (changes: Array<{ status: string; filePath: string }>) => Array<{ status: string; filePath: string }>;
  detectPrimaryWorktreeRoot: (repoRoot: string) => string | null;
  assertNoDeployDrift: (options: {
    repoRoot: string;
    primaryRoot?: string | null;
    env?: Record<string, string | undefined>;
    statusForRoot: (root: string) => string;
  }) => { ok: boolean; errors: string[]; warnings: string[] };
};

let guard: GuardModule;

beforeAll(async () => {
  guard = (await import('../../scripts/guard-worktree-drift.mjs')) as GuardModule;
});

describe('guard-worktree-drift', () => {
  test('parses porcelain status lines including untracked files', () => {
    expect(guard.parseGitStatus(' M app/page.tsx\n?? lib/staticSnapshots.ts\n')).toEqual([
      { status: 'M', filePath: 'app/page.tsx' },
      { status: '??', filePath: 'lib/staticSnapshots.ts' },
    ]);
  });

  test('identifies protected source paths', () => {
    expect(guard.isProtectedPath('app/page.tsx')).toBe(true);
    expect(guard.isProtectedPath('components/AppHeader.tsx')).toBe(true);
    expect(guard.isProtectedPath('lib/staticSnapshots.ts')).toBe(true);
    expect(guard.isProtectedPath('wrangler.jsonc')).toBe(true);
    expect(guard.isProtectedPath('worker.ts')).toBe(true);
    expect(guard.isProtectedPath('open-next.config.ts')).toBe(true);
    expect(guard.isProtectedPath('cloudflare-env.d.ts')).toBe(true);
    expect(guard.isProtectedPath('types/next-auth.d.ts')).toBe(true);
    expect(guard.isProtectedPath('output/playwright/report.json')).toBe(false);
    expect(guard.isProtectedPath('public/downloads/podsum-chrome-extension.zip')).toBe(false);
  });

  test('filters protected changes from primary workspace status', () => {
    const changes = guard.parseGitStatus([
      ' M app/page.tsx',
      '?? output/playwright/report.json',
      '?? lib/staticSnapshots.ts',
    ].join('\n'));

    expect(guard.filterProtectedChanges(changes)).toEqual([
      { status: 'M', filePath: 'app/page.tsx' },
      { status: '??', filePath: 'lib/staticSnapshots.ts' },
    ]);
  });

  test('detects the primary workspace from a dot-worktrees path', () => {
    const repoRoot = path.join('/Volumes/1TB/1Tprojects/PodcastSummarizer', '.worktrees', 'podsum-core-ingest-refactor');

    expect(guard.detectPrimaryWorktreeRoot(repoRoot)).toBe('/Volumes/1TB/1Tprojects/PodcastSummarizer');
  });

  test('blocks deploy when current worktree is dirty', () => {
    const result = guard.assertNoDeployDrift({
      repoRoot: '/repo/.worktrees/branch',
      primaryRoot: '/repo',
      statusForRoot: (root) => (root === '/repo/.worktrees/branch' ? ' M app/page.tsx\n' : ''),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Current deploy worktree has uncommitted changes');
  });

  test('blocks deploy when primary workspace has protected dirty changes', () => {
    const result = guard.assertNoDeployDrift({
      repoRoot: '/repo/.worktrees/branch',
      primaryRoot: '/repo',
      statusForRoot: (root) => (root === '/repo' ? '?? app/api/snapshots/lists/public/route.ts\n' : ''),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Primary workspace has protected uncommitted changes');
  });

  test('blocks deploy when primary workspace has deploy-relevant config drift', () => {
    const result = guard.assertNoDeployDrift({
      repoRoot: '/repo/.worktrees/branch',
      primaryRoot: '/repo',
      statusForRoot: (root) => (root === '/repo' ? ' M open-next.config.ts\n' : ''),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Primary workspace has protected uncommitted changes');
    expect(result.errors.join('\n')).toContain('M open-next.config.ts');
  });

  test.each([
    ['worker.ts'],
    ['cloudflare-env.d.ts'],
    ['types/next-auth.d.ts'],
  ])('blocks deploy when primary workspace has protected drift in %s', (filePath) => {
    const result = guard.assertNoDeployDrift({
      repoRoot: '/repo/.worktrees/branch',
      primaryRoot: '/repo',
      statusForRoot: (root) => (root === '/repo' ? ` M ${filePath}\n` : ''),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Primary workspace has protected uncommitted changes');
    expect(result.errors.join('\n')).toContain(filePath);
  });

  test('allows explicit emergency bypass', () => {
    const result = guard.assertNoDeployDrift({
      repoRoot: '/repo/.worktrees/branch',
      primaryRoot: '/repo',
      statusForRoot: () => ' M app/page.tsx\n',
      env: { ALLOW_DIRTY_DEPLOY: '1' },
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toContain('ALLOW_DIRTY_DEPLOY=1');
  });
});
