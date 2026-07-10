import { getCloudflareContext } from '@opennextjs/cloudflare';

type SqlValue = unknown;

export interface SqlResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

type D1PreparedStatementLike = {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[]; meta?: { changes?: number } }>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: <T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ) => Promise<Array<{ results?: T[]; meta?: { changes?: number } }>>;
};

const JSON_RESULT_KEYS = new Set([
  'tags',
  'tagsJson',
  'tags_json',
  'mindMapJson',
  'mindMapJsonZh',
  'mindMapJsonEn',
  'fullTextBilingualJson',
  'summaryBilingualJson',
  'embeddingJson',
  'embedding_json',
  'requestHeaders',
  'requestBody',
  'responseHeaders',
  'responseBody',
  'meta',
]);

const BOOLEAN_RESULT_KEYS = new Set([
  'isPublic',
  'isProcessed',
  'suggestedQuestion',
  'ok',
]);

const DATE_RESULT_KEY_PATTERN = /(?:At|_at)$/;

export function isD1DatabaseProvider(): boolean {
  return process.env.DATABASE_PROVIDER === 'd1';
}

export function getD1DatabaseBinding(): D1DatabaseLike | null {
  if (!isD1DatabaseProvider()) {
    return null;
  }
  try {
    return (getCloudflareContext().env as Record<string, unknown> & { PODSUM_DB?: D1DatabaseLike }).PODSUM_DB || null;
  } catch {
    return null;
  }
}

async function postgresSql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  values: SqlValue[],
): Promise<SqlResult<T>> {
  const mod = await import('@vercel/postgres');
  return mod.sql(strings, ...(values as Parameters<typeof mod.sql> extends [TemplateStringsArray, ...infer Rest] ? Rest : never)) as unknown as Promise<SqlResult<T>>;
}

function normalizeParam(value: SqlValue): unknown {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').replace('Z', '');
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

function buildParameterizedSql(strings: TemplateStringsArray, values: SqlValue[]) {
  let text = '';
  const params: unknown[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];
    if (index < values.length) {
      text += '?';
      params.push(normalizeParam(values[index]));
    }
  }
  return {
    text: translatePostgresToSqlite(text),
    params,
  };
}

function translatePostgresToSqlite(input: string): string {
  return input
    .replace(/\?::jsonb/g, '?')
    .replace(/\?::timestamptz/g, '?')
    .replace(/::jsonb/g, '')
    .replace(/::timestamptz/g, '')
    .replace(/([A-Za-z_][\w.]*)::numeric/g, '($1 * 1.0)')
    .replace(/::int/g, '')
    .replace(/COUNT\(\*\)::INT/gi, 'CAST(COUNT(*) AS INTEGER)')
    .replace(/\bGREATEST\s*\(/gi, 'MAX(')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/NOW\(\)\s*-\s*INTERVAL\s*'2 minutes'/gi, "datetime('now', '-2 minutes')")
    .replace(/NOW\(\)\s*-\s*\(\?\s*\*\s*INTERVAL\s*'1 second'\)/gi, "datetime('now', '-' || ? || ' seconds')")
    .replace(/NOW\(\)\s*-\s*\(\?\s*\*\s*INTERVAL\s*'1 day'\)/gi, "datetime('now', '-' || ? || ' days')")
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_RESULT_KEYS.has(key)) {
      normalized[key] = parseJsonValue(value);
    } else if (BOOLEAN_RESULT_KEYS.has(key)) {
      normalized[key] = Boolean(value);
    } else if (DATE_RESULT_KEY_PATTERN.test(key) && typeof value === 'string' && value) {
      normalized[key] = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function d1Sql<T = Record<string, unknown>>(
  db: D1DatabaseLike,
  strings: TemplateStringsArray,
  values: SqlValue[],
): Promise<SqlResult<T>> {
  const { text, params } = buildParameterizedSql(strings, values);
  const result = await db.prepare(text).bind(...params).all<Record<string, unknown>>();
  const rows = (result.results || []).map((row: Record<string, unknown>) => normalizeRow(row)) as T[];
  return {
    rows,
    rowCount: typeof result.meta?.changes === 'number' ? result.meta.changes : rows.length,
  };
}

export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
): Promise<SqlResult<T>> {
  const db = getD1DatabaseBinding();
  if (db) {
    return d1Sql<T>(db, strings, values);
  }
  return postgresSql<T>(strings, values);
}
