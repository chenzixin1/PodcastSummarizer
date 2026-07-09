import fs from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '29bbd7941ce035396dd966247e42c44f';
const databaseId = process.env.PRODUCTION_D1_DATABASE_ID || process.env.D1_DATABASE_ID || '5d0b65e0-d556-4aa4-953f-4d680d11c34a';
const baseUrl = (process.env.PRODUCTION_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const limit = positiveInt(process.env.PODSUM_INGEST_AUDIT_LIMIT, 100, 1000);
const concurrency = positiveInt(process.env.PODSUM_INGEST_AUDIT_CONCURRENCY, 8, 32);
const requestTimeoutMs = positiveInt(process.env.PODSUM_INGEST_AUDIT_TIMEOUT_MS, 15_000, 60_000);
const wranglerConfigPath =
  process.env.WRANGLER_OAUTH_CONFIG || '/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml';

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function readCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }
  const text = fs.readFileSync(wranglerConfigPath, 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) {
    throw new Error(`Unable to read Wrangler OAuth token from ${wranglerConfigPath}`);
  }
  return token;
}

const cloudflareToken = readCloudflareToken();

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cloudflareToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(payload.errors || payload)}`);
  }
  return payload.result?.[0]?.results || [];
}

async function headOk(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  if (url.startsWith('/api/files/')) {
    return `${baseUrl}${url}`;
  }
  return url;
}

async function mapLimit(items, limitValue, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limitValue, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function summarizeRow(row) {
  return {
    id: row.id,
    title: row.title,
    sourceReference: row.sourceReference,
    createdAt: row.createdAt,
  };
}

async function main() {
  const rows = await d1Query(
    `
    SELECT
      p.id,
      p.title,
      p.blob_url AS blobUrl,
      p.source_reference AS sourceReference,
      p.created_at AS createdAt,
      j.status AS jobStatus,
      a.podcast_id AS analysisPodcastId
    FROM podcasts p
    LEFT JOIN processing_jobs j ON j.podcast_id = p.id
    LEFT JOIN analysis_results a ON a.podcast_id = p.id
    ORDER BY p.created_at DESC
    LIMIT ?
    `,
    [limit],
  );

  const objectResults = await mapLimit(rows, concurrency, async (row) => {
    const blobUrl = normalizeUrl(row.blobUrl || '');
    const objectResult = blobUrl ? await headOk(blobUrl) : { ok: false, status: 0 };
    return {
      row,
      blobUrl,
      objectResult,
    };
  });

  const missingObjects = [];
  const missingJobs = [];
  const unprocessedWithoutJob = [];

  for (const { row, blobUrl, objectResult } of objectResults) {
    if (!objectResult.ok) {
      missingObjects.push({
        ...summarizeRow(row),
        status: objectResult.status,
        blobUrl,
        ...(objectResult.error ? { error: objectResult.error } : {}),
      });
    }

    if (!row.jobStatus) {
      missingJobs.push(summarizeRow(row));
    }

    if (!row.analysisPodcastId && !row.jobStatus) {
      unprocessedWithoutJob.push(summarizeRow(row));
    }
  }

  const report = {
    checked: rows.length,
    missingObjects,
    missingJobs,
    unprocessedWithoutJob,
  };

  console.log(JSON.stringify(report, null, 2));

  if (missingObjects.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
