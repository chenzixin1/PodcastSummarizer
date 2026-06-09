import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const outputPath = process.env.D1_EXPORT_SQL_PATH || path.join(process.cwd(), 'output', 'd1', 'postgres-to-d1.sql');

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

function sqlLiteral(value, column, table) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (table.booleanColumns?.has(column)) {
    return value ? '1' : '0';
  }
  if (table.jsonColumns?.has(column)) {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  }
  if (value instanceof Date) {
    return `'${formatDateLocal(value)}'`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return `'${String(value).replaceAll("'", "''")}'`;
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

function insertStatement(table, row) {
  const columns = table.columns.map(sqlIdentifier).join(', ');
  const values = table.columns.map((column) => sqlLiteral(row[column], column, table)).join(', ');
  return `INSERT INTO ${sqlIdentifier(table.name)} (${columns}) VALUES (${values});`;
}

const client = new Client({ connectionString });
await client.connect();

try {
  const lines = [
    'PRAGMA foreign_keys = OFF;',
    ...tables.toReversed().map((table) => `DELETE FROM ${sqlIdentifier(table.name)};`),
  ];
  const counts = {};

  for (const table of tables) {
    const result = await client.query(
      `SELECT ${table.columns.map(sqlIdentifier).join(', ')} FROM ${sqlIdentifier(table.name)} ORDER BY 1`,
    );
    counts[table.name] = result.rows.length;
    for (const row of result.rows) {
      lines.push(insertStatement(table, row));
    }
  }

  lines.push('PRAGMA foreign_keys = ON;', '');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'));
  console.log(JSON.stringify({ outputPath, counts }, null, 2));
} finally {
  await client.end();
}
