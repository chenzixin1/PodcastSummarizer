import { createHash, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { sql } from './sql';

export const MCP_SCOPES = [
  'podcasts:list',
  'podcasts:read',
  'analysis:read',
  'exports:markdown',
  'account:credits:read',
  'qa:ask',
  'podcasts:upload',
  'podcasts:write_metadata',
  'jobs:enqueue',
] as const;

export const DEFAULT_MCP_SCOPES = [
  'podcasts:list',
  'podcasts:read',
  'analysis:read',
  'exports:markdown',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpAccessTokenRow {
  id: string;
  tokenPrefix: string;
  name: string;
  vaultLabel: string | null;
  scopes: McpScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedMcpAccessToken {
  token: string;
  row: McpAccessTokenRow;
}

export interface McpAccessAuthContext {
  tokenId: string;
  userId: string;
  scopes: McpScope[];
}

let mcpTablesEnsured = false;
let mcpTablesPromise: Promise<void> | null = null;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomTokenPart(bytes: number): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseScopes(value: unknown): McpScope[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseScopes(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeScopes(scopes: unknown): McpScope[] {
  const parsed = parseScopes(scopes);
  const selected = parsed.length > 0 ? parsed : [...DEFAULT_MCP_SCOPES];
  return Array.from(new Set(selected)).filter((scope) => MCP_SCOPES.includes(scope));
}

function normalizeExpiresAt(days: unknown): string {
  const parsed = Number(days);
  const safeDays = Number.isFinite(parsed) ? Math.max(1, Math.min(365, Math.floor(parsed))) : 180;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function toTimestampMs(value: unknown): number | null {
  if (!value) {
    return null;
  }
  const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function mapTokenRow(row: Record<string, unknown>): McpAccessTokenRow {
  return {
    id: String(row.id || ''),
    tokenPrefix: String(row.tokenPrefix || row.token_prefix || ''),
    name: String(row.name || ''),
    vaultLabel: (row.vaultLabel as string | null) || null,
    scopes: parseScopes(row.scopesJson ?? row.scopes_json),
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt as string).toISOString() : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt as string).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt as string).toISOString() : '',
  };
}

export async function ensureMcpAccessTables(): Promise<void> {
  if (mcpTablesEnsured) {
    return;
  }

  if (!mcpTablesPromise) {
    mcpTablesPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS mcp_access_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_prefix TEXT UNIQUE NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          vault_label TEXT,
          scopes_json TEXT NOT NULL,
          expires_at TEXT,
          revoked_at TEXT,
          last_used_at TEXT,
          last_ip TEXT,
          last_user_agent TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_user_created
        ON mcp_access_tokens (user_id, created_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_prefix
        ON mcp_access_tokens (token_prefix)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS mcp_access_logs (
          id TEXT PRIMARY KEY,
          token_id TEXT REFERENCES mcp_access_tokens(id) ON DELETE SET NULL,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          tool TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          ok INTEGER DEFAULT 1,
          error_code TEXT,
          ip TEXT,
          user_agent TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_mcp_access_logs_user_created
        ON mcp_access_logs (user_id, created_at DESC)
      `;

      mcpTablesEnsured = true;
    })().catch((error) => {
      mcpTablesPromise = null;
      throw error;
    });
  }

  await mcpTablesPromise;
}

export async function listMcpAccessTokens(userId: string): Promise<{
  success: boolean;
  error?: string;
  data?: McpAccessTokenRow[];
}> {
  try {
    await ensureMcpAccessTables();
    const result = await sql`
      SELECT
        id,
        token_prefix as "tokenPrefix",
        name,
        vault_label as "vaultLabel",
        scopes_json as "scopesJson",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        last_used_at as "lastUsedAt",
        created_at as "createdAt"
      FROM mcp_access_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;

    return { success: true, data: result.rows.map((row) => mapTokenRow(row)) };
  } catch (error) {
    console.error('listMcpAccessTokens failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createMcpAccessToken(input: {
  userId: string;
  name: string;
  vaultLabel?: string | null;
  scopes?: unknown;
  expiresInDays?: unknown;
}): Promise<{ success: boolean; error?: string; data?: CreatedMcpAccessToken }> {
  try {
    await ensureMcpAccessTables();
    const name = input.name.trim().slice(0, 80) || 'Obsidian';
    const vaultLabel = (input.vaultLabel || '').trim().slice(0, 120) || null;
    const scopes = normalizeScopes(input.scopes);
    const expiresAt = normalizeExpiresAt(input.expiresInDays);
    const prefix = randomTokenPart(6);
    const secret = randomTokenPart(32);
    const token = `psm_${prefix}_${secret}`;
    const tokenHash = hashToken(token);
    const id = nanoid();

    const result = await sql`
      INSERT INTO mcp_access_tokens (
        id,
        user_id,
        token_prefix,
        token_hash,
        name,
        vault_label,
        scopes_json,
        expires_at
      )
      VALUES (
        ${id},
        ${input.userId},
        ${prefix},
        ${tokenHash},
        ${name},
        ${vaultLabel},
        ${JSON.stringify(scopes)},
        ${expiresAt}
      )
      RETURNING
        id,
        token_prefix as "tokenPrefix",
        name,
        vault_label as "vaultLabel",
        scopes_json as "scopesJson",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        last_used_at as "lastUsedAt",
        created_at as "createdAt"
    `;

    return {
      success: true,
      data: {
        token,
        row: mapTokenRow(result.rows[0]),
      },
    };
  } catch (error) {
    console.error('createMcpAccessToken failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function revokeMcpAccessToken(input: {
  userId: string;
  tokenId: string;
}): Promise<{ success: boolean; error?: string; data?: McpAccessTokenRow }> {
  try {
    await ensureMcpAccessTables();
    const result = await sql`
      UPDATE mcp_access_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ${input.tokenId}
        AND user_id = ${input.userId}
        AND revoked_at IS NULL
      RETURNING
        id,
        token_prefix as "tokenPrefix",
        name,
        vault_label as "vaultLabel",
        scopes_json as "scopesJson",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        last_used_at as "lastUsedAt",
        created_at as "createdAt"
    `;

    if (result.rows.length === 0) {
      return { success: false, error: 'MCP token not found or already revoked.' };
    }

    return { success: true, data: mapTokenRow(result.rows[0]) };
  } catch (error) {
    console.error('revokeMcpAccessToken failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function hasMcpScope(context: McpAccessAuthContext, scope: McpScope): boolean {
  return context.scopes.includes(scope);
}

export async function authenticateMcpAccessToken(input: {
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  errorCode?: 'missing_token' | 'invalid_token' | 'expired_token' | 'revoked_token';
  data?: McpAccessAuthContext;
}> {
  const token = input.token.trim();
  if (!token) {
    return { success: false, errorCode: 'missing_token', error: 'Missing MCP access token.' };
  }

  try {
    await ensureMcpAccessTables();
    const tokenHash = hashToken(token);
    const result = await sql`
      SELECT
        id,
        user_id as "userId",
        scopes_json as "scopesJson",
        expires_at as "expiresAt",
        revoked_at as "revokedAt"
      FROM mcp_access_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    const row = result.rows[0];
    if (!row) {
      return { success: false, errorCode: 'invalid_token', error: 'Invalid MCP access token.' };
    }

    if (row.revokedAt) {
      return { success: false, errorCode: 'revoked_token', error: 'MCP access token has been revoked.' };
    }

    const expiresAtMs = toTimestampMs(row.expiresAt);
    if (expiresAtMs && expiresAtMs <= Date.now()) {
      return { success: false, errorCode: 'expired_token', error: 'MCP access token has expired.' };
    }

    await sql`
      UPDATE mcp_access_tokens
      SET
        last_used_at = CURRENT_TIMESTAMP,
        last_ip = ${input.ip || null},
        last_user_agent = ${input.userAgent || null}
      WHERE id = ${String(row.id || '')}
    `;

    return {
      success: true,
      data: {
        tokenId: String(row.id || ''),
        userId: String(row.userId || ''),
        scopes: parseScopes(row.scopesJson),
      },
    };
  } catch (error) {
    console.error('authenticateMcpAccessToken failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordMcpAccessLog(input: {
  context?: McpAccessAuthContext | null;
  tool: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ok?: boolean;
  errorCode?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await ensureMcpAccessTables();
    await sql`
      INSERT INTO mcp_access_logs (
        id,
        token_id,
        user_id,
        tool,
        resource_type,
        resource_id,
        ok,
        error_code,
        ip,
        user_agent
      )
      VALUES (
        ${nanoid()},
        ${input.context?.tokenId || null},
        ${input.context?.userId || null},
        ${input.tool},
        ${input.resourceType || null},
        ${input.resourceId || null},
        ${input.ok === false ? 0 : 1},
        ${input.errorCode || null},
        ${input.ip || null},
        ${input.userAgent || null}
      )
    `;
  } catch (error) {
    console.error('recordMcpAccessLog failed:', error);
  }
}
