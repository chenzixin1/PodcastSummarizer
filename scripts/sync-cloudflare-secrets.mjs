import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

const inputPaths = process.argv.slice(2);
if (inputPaths.length === 0) {
  inputPaths.push('.env.vercel.production');
}

const secretKeys = [
  'ACCESS_KEY',
  'APIFY_API_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'EXTENSION_MONITOR_CAPTURE_RAW',
  'EXTENSION_MONITOR_ENABLED',
  'EXTENSION_MONITOR_RETENTION_DAYS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NEXTAUTH_SECRET',
  'OPENROUTER_API_KEY',
  'PGDATABASE',
  'PGHOST',
  'PGHOST_UNPOOLED',
  'PGPASSWORD',
  'PGUSER',
  'POSTGRES_DATABASE',
  'POSTGRES_HOST',
  'POSTGRES_PASSWORD',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NO_SSL',
  'POSTGRES_USER',
  'STACK_SECRET_SERVER_KEY',
  'VOLCANO_ACCESS_KEY',
  'VOLCANO_ASR_LANG',
  'VOLCANO_QUERY_URL',
  'VOLCANO_RESOURCE_ID',
  'VOLCANO_SUBMIT_URL',
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

const parsed = {};
for (const inputPath of inputPaths) {
  const envFile = await fs.readFile(inputPath, 'utf8');
  Object.assign(parsed, dotenv.parse(envFile));
}

function buildPostgresUrl(hostKey) {
  const host = parsed[hostKey];
  const user = parsed.POSTGRES_USER || parsed.PGUSER;
  const password = parsed.POSTGRES_PASSWORD || parsed.PGPASSWORD;
  const database = parsed.POSTGRES_DATABASE || parsed.PGDATABASE;
  if (!host || !user || !password || !database) {
    return null;
  }
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(database)}?sslmode=require`;
}

const pooledPostgresUrl = buildPostgresUrl('POSTGRES_HOST') || buildPostgresUrl('PGHOST');
const unpooledPostgresUrl = buildPostgresUrl('PGHOST_UNPOOLED') || pooledPostgresUrl;

if (pooledPostgresUrl) {
  parsed.POSTGRES_URL ||= pooledPostgresUrl;
  parsed.POSTGRES_PRISMA_URL ||= pooledPostgresUrl;
  parsed.DATABASE_URL ||= pooledPostgresUrl;
}

if (unpooledPostgresUrl) {
  parsed.POSTGRES_URL_NON_POOLING ||= unpooledPostgresUrl;
  parsed.DATABASE_URL_UNPOOLED ||= unpooledPostgresUrl;
}
const secrets = {};

for (const key of secretKeys) {
  if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
    secrets[key] = parsed[key];
  }
}

if (Object.keys(secrets).length === 0) {
  throw new Error(`No matching secrets found in ${inputPaths.join(', ')}`);
}

const tempPath = path.join(os.tmpdir(), `podsum-cloudflare-secrets-${process.pid}.json`);

try {
  await fs.writeFile(tempPath, JSON.stringify(secrets), { mode: 0o600 });
  console.log(`Syncing ${Object.keys(secrets).length} Cloudflare secrets: ${Object.keys(secrets).join(', ')}`);
  await run('npx', ['wrangler', 'secret', 'bulk', tempPath]);
} finally {
  await fs.rm(tempPath, { force: true });
}
