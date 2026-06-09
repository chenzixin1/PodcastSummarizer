import path from 'node:path';
import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const productionConfigPath = process.env.CUTOVER_PRODUCTION_CONFIG ||
  path.join(process.cwd(), 'output', 'cutover', 'wrangler.production.jsonc');

function run(command, args, options = {}) {
  console.log(`\n==> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(npmCommand, ['run', 'cutover:prepare']);
run(npxCommand, ['wrangler', 'deploy', '--dry-run', '-c', productionConfigPath]);

console.log('\nProduction cutover config dry-run passed. No production routes were deployed.');
