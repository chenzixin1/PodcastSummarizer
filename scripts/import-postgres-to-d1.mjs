import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '29bbd7941ce035396dd966247e42c44f';
const databaseId = process.env.D1_DATABASE_ID || 'adbd887b-dd92-4180-bdee-0b185c61fefe';
const databaseName = process.env.D1_DATABASE_NAME || 'podsum-d1-preview';
const wranglerConfigPath =
  process.env.WRANGLER_OAUTH_CONFIG ||
  '/Users/chenzixin/Library/Preferences/.wrangler/config/default.toml';

function buildPostgresUrl(hostKey) {
  const host = process.env[hostKey];
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE;
  if (!host || !user || !password || !database) {
    return null;
  }
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(database)}?sslmode=require`;
}

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  buildPostgresUrl('POSTGRES_HOST') ||
  buildPostgresUrl('PGHOST');

if (!connectionString) {
  throw new Error('POSTGRES_URL, DATABASE_URL, or PG connection components are required.');
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

const token = readCloudflareToken();

const tables = [
  {
    name: 'users',
    columns: ['id', 'email', 'password_hash', 'name', 'credits', 'created_at'],
  },
  {
    name: 'podcasts',
    columns: [
      'id',
      'title',
      'original_filename',
      'file_size',
      'blob_url',
      'source_reference',
      'source_published_at',
      'tags_json',
      'is_public',
      'user_id',
      'created_at',
    ],
    jsonColumns: new Set(['tags_json']),
    booleanColumns: new Set(['is_public']),
  },
  {
    name: 'analysis_results',
    columns: [
      'podcast_id',
      'summary',
      'summary_zh',
      'summary_en',
      'brief_summary',
      'translation',
      'highlights',
      'mind_map_json',
      'mind_map_json_zh',
      'mind_map_json_en',
      'full_text_bilingual_json',
      'summary_bilingual_json',
      'bilingual_alignment_version',
      'token_count',
      'word_count',
      'character_count',
      'processed_at',
    ],
    jsonColumns: new Set([
      'mind_map_json',
      'mind_map_json_zh',
      'mind_map_json_en',
      'full_text_bilingual_json',
      'summary_bilingual_json',
    ]),
  },
  {
    name: 'processing_jobs',
    columns: [
      'podcast_id',
      'status',
      'current_task',
      'progress_current',
      'progress_total',
      'status_message',
      'attempts',
      'worker_id',
      'last_error',
      'created_at',
      'updated_at',
      'started_at',
      'finished_at',
    ],
  },
  {
    name: 'qa_messages',
    columns: ['id', 'podcast_id', 'user_id', 'question', 'answer', 'suggested_question', 'created_at'],
    booleanColumns: new Set(['suggested_question']),
  },
  {
    name: 'qa_context_chunks',
    columns: [
      'id',
      'podcast_id',
      'chunk_index',
      'source',
      'start_sec',
      'end_sec',
      'content',
      'content_tsv',
      'embedding_json',
      'embedding_model',
      'created_at',
    ],
    jsonColumns: new Set(['embedding_json']),
  },
  {
    name: 'extension_transcription_jobs',
    columns: [
      'id',
      'user_id',
      'status',
      'provider_task_id',
      'podcast_id',
      'audio_blob_url',
      'source_reference',
      'original_file_name',
      'title',
      'video_id',
      'is_public',
      'error',
      'created_at',
      'updated_at',
    ],
    booleanColumns: new Set(['is_public']),
  },
  {
    name: 'extension_monitor_tasks',
    columns: [
      'id',
      'path',
      'status',
      'stage',
      'user_id',
      'user_email',
      'client_task_id',
      'trace_id',
      'source_reference',
      'video_id',
      'title',
      'is_public',
      'transcription_job_id',
      'podcast_id',
      'provider_task_id',
      'last_error_code',
      'last_error_message',
      'last_http_status',
      'created_at',
      'updated_at',
    ],
    booleanColumns: new Set(['is_public']),
  },
  {
    name: 'extension_monitor_events',
    columns: [
      'id',
      'task_id',
      'level',
      'stage',
      'endpoint',
      'http_status',
      'message',
      'request_headers',
      'request_body',
      'response_headers',
      'response_body',
      'error_stack',
      'meta',
      'created_at',
    ],
    jsonColumns: new Set(['request_headers', 'request_body', 'response_headers', 'response_body', 'meta']),
  },
];

function sqlIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeParam(value, column, table) {
  if (value === null || value === undefined) {
    return null;
  }
  if (table.booleanColumns?.has(column)) {
    return value ? 1 : 0;
  }
  if (table.jsonColumns?.has(column)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return formatDateLocal(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad3(value) {
  return String(value).padStart(3, '0');
}

function formatDateLocal(value) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}.${pad3(value.getMilliseconds())}`;
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
  return payload.result?.[0]?.results || [];
}

async function d1Batch(statements) {
  if (statements.length === 0) {
    return [];
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ batch: statements }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = JSON.stringify(payload.errors || payload, null, 2);
    throw new Error(`D1 batch failed for ${databaseName}: ${message}`);
  }
  return payload.result || [];
}

function insertSql(table) {
  const columns = table.columns.map(sqlIdentifier).join(', ');
  const placeholders = table.columns.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO ${sqlIdentifier(table.name)} (${columns}) VALUES (${placeholders})`;
}

const client = new Client({ connectionString });
await client.connect();

const sourceData = {};
try {
  client.on('error', (error) => {
    console.warn(`Postgres client warning after snapshot: ${error.message}`);
  });
  for (const table of tables) {
    const result = await client.query(
      `SELECT ${table.columns.map(sqlIdentifier).join(', ')} FROM ${sqlIdentifier(table.name)} ORDER BY 1`,
    );
    sourceData[table.name] = result.rows;
  }
} finally {
  await client.end().catch(() => {});
}

try {
  console.log(`Importing Postgres data into D1 ${databaseName} (${databaseId})`);
  for (const table of tables.toReversed()) {
    await d1Query(`DELETE FROM ${sqlIdentifier(table.name)}`);
  }

  const counts = {};
  for (const table of tables) {
    const rows = sourceData[table.name] || [];
    counts[table.name] = rows.length;
    const statement = insertSql(table);
    const batchSize = table.name === 'analysis_results' ? 1 : 50;
    let imported = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batchRows = rows.slice(index, index + batchSize);
      await d1Batch(
        batchRows.map((row) => ({
          sql: statement,
          params: table.columns.map((column) => normalizeParam(row[column], column, table)),
        })),
      );
      imported += batchRows.length;
      if (imported % 500 === 0) {
        console.log(`${table.name}: ${imported}/${rows.length}`);
      }
    }
    console.log(`${table.name}: ${imported}/${rows.length}`);
  }

  const d1Counts = {};
  for (const table of tables) {
    const rows = await d1Query(`SELECT COUNT(*) AS count FROM ${sqlIdentifier(table.name)}`);
    d1Counts[table.name] = Number(rows[0]?.count || 0);
  }

  console.log(JSON.stringify({ databaseName, databaseId, sourceCounts: counts, d1Counts }, null, 2));
} catch (error) {
  console.error(error);
  process.exit(1);
}
