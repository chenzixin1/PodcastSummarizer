#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(scriptDir, '..');
const manifestPath = resolve(extensionDir, 'manifest.json');

function getGitShortHash() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: extensionDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
      .trim()
      .slice(0, 12);
  } catch {
    return 'unknown';
  }
}

const manifestRaw = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestRaw);
const hash = getGitShortHash();
manifest.version_name = `git-${hash}`;

writeFileSync(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write(`Stamped extension version_name=${manifest.version_name}\n`);
