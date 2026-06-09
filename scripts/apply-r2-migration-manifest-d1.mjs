import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '29bbd7941ce035396dd966247e42c44f';
const databaseId = process.env.D1_DATABASE_ID || '5d0b65e0-d556-4aa4-953f-4d680d11c34a';
const databaseName = process.env.D1_DATABASE_NAME || 'podsum-d1-production';
const manifestPath = process.env.R2_MIGRATION_MANIFEST || path.join(process.cwd(), 'tmp', 'r2-migration-manifest.jsonl');
const finalAppUrl = (process.env.FINAL_APP_URL || process.env.NEXTAUTH_URL || 'https://podsum.cc').replace(/\/+$/, '');
const apply = process.env.D1_R2_MANIFEST_APPLY === 'true';
const force = process.env.D1_R2_MANIFEST_FORCE === 'true';
const wranglerConfigPath =
  process.env.WRANGLER_OAUTH_CONFIG ||
  '/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml';

function readCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }
  const text = fsSync.readFileSync(wranglerConfigPath, 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) {
    throw new Error(`Unable to read Wrangler OAuth token from ${wranglerConfigPath}`);
  }
  return token;
}

const token = readCloudflareToken();

function normalizeManifestRow(row) {
  const type = row.type || 'podcast';
  const id = row.id || row.podcastId || row.jobId;
  return {
    ...row,
    type,
    id,
    table: row.table || (type === 'extension-audio' ? 'extension_transcription_jobs' : 'podcasts'),
    column: row.column || (type === 'extension-audio' ? 'audio_blob_url' : 'blob_url'),
  };
}

function manifestIdentity(row) {
  const normalized = normalizeManifestRow(row);
  return `${normalized.type}:${normalized.id}`;
}

function objectUrlForKey(key) {
  return `${finalAppUrl}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function loadManifestRows() {
  const text = await fs.readFile(manifestPath, 'utf8');
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((line) => normalizeManifestRow(JSON.parse(line)));

  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const identity = manifestIdentity(row);
    if (seen.has(identity)) {
      duplicates.add(identity);
    }
    seen.add(identity);
  }
  if (duplicates.size > 0) {
    throw new Error(`Manifest contains duplicate rows: ${Array.from(duplicates).join(', ')}`);
  }
  return rows;
}

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = JSON.stringify(payload.errors || payload, null, 2);
    throw new Error(`D1 query failed for ${databaseName}: ${message}`);
  }
  return payload.result?.[0] || {};
}

async function selectCurrentUrl(row) {
  if (row.type === 'podcast') {
    const result = await d1Query('SELECT blob_url AS url FROM podcasts WHERE id = ?', [row.id]);
    return result.results?.[0]?.url || null;
  }

  if (row.type === 'extension-audio') {
    const result = await d1Query('SELECT audio_blob_url AS url FROM extension_transcription_jobs WHERE id = ?', [row.id]);
    return result.results?.[0]?.url || null;
  }

  throw new Error(`Unsupported manifest entry type: ${row.type}`);
}

async function updateCurrentUrl(row, nextUrl) {
  if (row.type === 'podcast') {
    if (force) {
      return d1Query('UPDATE podcasts SET blob_url = ? WHERE id = ?', [nextUrl, row.id]);
    }
    return d1Query('UPDATE podcasts SET blob_url = ? WHERE id = ? AND blob_url = ?', [nextUrl, row.id, row.oldUrl]);
  }

  if (row.type === 'extension-audio') {
    if (force) {
      return d1Query('UPDATE extension_transcription_jobs SET audio_blob_url = ? WHERE id = ?', [nextUrl, row.id]);
    }
    return d1Query('UPDATE extension_transcription_jobs SET audio_blob_url = ? WHERE id = ? AND audio_blob_url = ?', [
      nextUrl,
      row.id,
      row.oldUrl,
    ]);
  }

  throw new Error(`Unsupported manifest entry type: ${row.type}`);
}

async function main() {
  const rows = await loadManifestRows();
  console.log(`Loaded ${rows.length} R2 manifest rows from ${manifestPath}.`);
  console.log(`D1 database: ${databaseName} (${databaseId})`);
  console.log(`Final app URL: ${finalAppUrl}`);
  console.log(`Apply D1 updates: ${apply}`);

  const summary = {
    wouldUpdate: 0,
    updated: 0,
    alreadyUpdated: 0,
    missing: 0,
    skippedChanged: 0,
  };

  for (const row of rows) {
    const nextUrl = objectUrlForKey(row.r2Key);
    const currentUrl = await selectCurrentUrl(row);

    if (currentUrl === null) {
      summary.missing += 1;
      console.warn(`Missing ${manifestIdentity(row)}; skipping.`);
      continue;
    }

    if (currentUrl === nextUrl) {
      summary.alreadyUpdated += 1;
      continue;
    }

    if (!force && currentUrl !== row.oldUrl) {
      summary.skippedChanged += 1;
      console.warn(`${manifestIdentity(row)} URL changed since manifest copy; skipping.`);
      continue;
    }

    summary.wouldUpdate += 1;
    if (!apply) {
      continue;
    }

    const updateResult = await updateCurrentUrl(row, nextUrl);
    const changes = Number(updateResult.meta?.changes || 0);
    if (changes === 0) {
      summary.skippedChanged += 1;
      summary.wouldUpdate -= 1;
      console.warn(`${manifestIdentity(row)} changed before update completed; skipping.`);
      continue;
    }
    summary.updated += changes;
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log('Dry run only. Set D1_R2_MANIFEST_APPLY=true to update the D1 database.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
