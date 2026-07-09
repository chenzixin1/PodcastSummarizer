import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outputPath = process.env.CUTOVER_PREFLIGHT_OUTPUT || path.join(process.cwd(), 'output', 'cutover', 'preflight-report.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  {
    name: 'guard worktree drift',
    command: npmCommand,
    args: ['run', 'guard:worktree-drift'],
  },
  {
    name: 'type-check',
    command: npmCommand,
    args: ['run', 'type-check'],
  },
  {
    name: 'verify Cloudflare preview against production baseline',
    command: npmCommand,
    args: ['run', 'verify:cf-preview'],
  },
  {
    name: 'audit data and R2 migration coverage',
    command: npmCommand,
    args: ['run', 'audit:data-migration'],
  },
  {
    name: 'dry-run historical file URL database rewrite',
    command: npmCommand,
    args: ['run', 'r2:apply-manifest'],
    env: {
      FINAL_APP_URL: 'https://podsum.cc',
    },
  },
  {
    name: 'generate production cutover config and command list',
    command: npmCommand,
    args: ['run', 'cutover:prepare'],
  },
  {
    name: 'dry-run generated production Wrangler config',
    command: npmCommand,
    args: ['run', 'cutover:dry-run'],
  },
];

async function main() {
  const startedAt = new Date();
  const results = [];

  for (const step of steps) {
    console.log(`\n==> ${step.name}`);
    const started = Date.now();
    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...step.env,
      },
      stdio: 'inherit',
    });
    const durationMs = Date.now() - started;
    const ok = result.status === 0;
    results.push({
      name: step.name,
      command: [step.command, ...step.args].join(' '),
      ok,
      status: result.status,
      durationMs,
    });

    if (!ok) {
      break;
    }
  }

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ok: results.every((step) => step.ok) && results.length === steps.length,
    results,
    nextStep: 'Ask the user for explicit approval before deploying production routes for podsum.cc.',
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nPreflight report: ${outputPath}`);

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
