import { nanoid } from 'nanoid';
import { sql } from './sql';

export interface CreditTransaction {
  id: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  delta: number;
  balanceAfter: number;
  reason: string;
  source: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreditAdjustmentResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    user: {
      id: string;
      email: string;
      name: string;
      credits: number;
    };
    transaction: CreditTransaction;
    alreadyRefunded?: boolean;
  };
}

let creditTablesEnsured = false;
let creditTablesPromise: Promise<void> | null = null;

function normalizeLimit(value: number | undefined, fallback = 50, max = 200): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(Number(value))));
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function normalizeDelta(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

function mapCreditTransactionRow(row: Record<string, unknown>): CreditTransaction {
  return {
    id: String(row.id || ''),
    userId: String(row.userId || row.user_id || ''),
    userEmail: (row.userEmail as string | null) || null,
    userName: (row.userName as string | null) || null,
    delta: Number(row.delta || 0),
    balanceAfter: Number(row.balanceAfter ?? row.balance_after ?? 0),
    reason: String(row.reason || ''),
    source: (row.source as string | null) || null,
    refType: (row.refType as string | null) || null,
    refId: (row.refId as string | null) || null,
    createdBy: (row.createdBy as string | null) || null,
    note: (row.note as string | null) || null,
    createdAt: String(row.createdAt || row.created_at || ''),
  };
}

export async function ensureCreditLedgerTables(): Promise<void> {
  if (creditTablesEnsured) {
    return;
  }

  if (!creditTablesPromise) {
    creditTablesPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS credit_transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          delta INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          reason TEXT NOT NULL,
          source TEXT,
          ref_type TEXT,
          ref_id TEXT,
          created_by TEXT,
          note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
        ON credit_transactions (user_id, created_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_ref
        ON credit_transactions (ref_type, ref_id)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id TEXT PRIMARY KEY,
          admin_user_id TEXT,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created
        ON admin_audit_logs (created_at DESC)
      `;

      creditTablesEnsured = true;
    })().catch((error) => {
      creditTablesPromise = null;
      throw error;
    });
  }

  await creditTablesPromise;
}

export async function recordAdminAuditLog(input: {
  adminUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await ensureCreditLedgerTables();
  await sql`
    INSERT INTO admin_audit_logs (
      id, admin_user_id, action, target_type, target_id, metadata
    )
    VALUES (
      ${nanoid()},
      ${input.adminUserId || null},
      ${input.action},
      ${input.targetType || null},
      ${input.targetId || null},
      ${input.metadata ? JSON.stringify(input.metadata) : null}
    )
  `;
}

export async function recordCreditTransaction(input: {
  userId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  source?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdBy?: string | null;
  note?: string | null;
}): Promise<CreditTransaction> {
  await ensureCreditLedgerTables();
  const id = nanoid();
  const delta = normalizeDelta(input.delta);
  const balanceAfter = Math.max(0, Math.trunc(Number(input.balanceAfter)));

  const result = await sql`
    INSERT INTO credit_transactions (
      id,
      user_id,
      delta,
      balance_after,
      reason,
      source,
      ref_type,
      ref_id,
      created_by,
      note
    )
    VALUES (
      ${id},
      ${input.userId},
      ${delta},
      ${balanceAfter},
      ${input.reason},
      ${input.source || null},
      ${input.refType || null},
      ${input.refId || null},
      ${input.createdBy || null},
      ${input.note || null}
    )
    RETURNING
      id,
      user_id as "userId",
      delta,
      balance_after as "balanceAfter",
      reason,
      source,
      ref_type as "refType",
      ref_id as "refId",
      created_by as "createdBy",
      note,
      created_at as "createdAt"
  `;

  return mapCreditTransactionRow(result.rows[0] || { id, userId: input.userId, delta, balanceAfter });
}

export async function recordUploadCreditDebit(input: {
  userId: string;
  podcastId: string;
  balanceAfter: number | null;
}): Promise<void> {
  if (typeof input.balanceAfter !== 'number' || !Number.isFinite(input.balanceAfter)) {
    return;
  }

  await recordCreditTransaction({
    userId: input.userId,
    delta: -1,
    balanceAfter: input.balanceAfter,
    reason: 'upload_conversion',
    source: 'upload',
    refType: 'podcast',
    refId: input.podcastId,
  });
}

export async function adjustUserCredits(input: {
  userId: string;
  delta: number;
  reason: string;
  source?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdBy?: string | null;
  note?: string | null;
}): Promise<CreditAdjustmentResult> {
  try {
    await ensureCreditLedgerTables();
    const delta = normalizeDelta(input.delta);
    if (!input.userId) {
      return { success: false, errorCode: 'USER_REQUIRED', error: 'Missing user id.' };
    }
    if (delta === 0) {
      return { success: false, errorCode: 'NO_DELTA', error: 'Credit delta must not be zero.' };
    }

    const updateResult = await sql<{
      id: string;
      email: string;
      name: string;
      credits: number;
    }>`
      UPDATE users
      SET credits = credits + ${delta}
      WHERE id = ${input.userId}
        AND credits + ${delta} >= 0
      RETURNING id, email, name, credits
    `;

    if (updateResult.rows.length === 0) {
      const userCheck = await sql`
        SELECT id FROM users WHERE id = ${input.userId} LIMIT 1
      `;
      if (userCheck.rows.length === 0) {
        return { success: false, errorCode: 'USER_NOT_FOUND', error: 'User not found.' };
      }
      return {
        success: false,
        errorCode: 'INSUFFICIENT_CREDITS',
        error: 'The adjustment would make the balance negative.',
      };
    }

    const user = updateResult.rows[0];
    const transaction = await recordCreditTransaction({
      userId: user.id,
      delta,
      balanceAfter: Number(user.credits),
      reason: input.reason,
      source: input.source || 'admin',
      refType: input.refType || null,
      refId: input.refId || null,
      createdBy: input.createdBy || null,
      note: input.note || null,
    });

    await recordAdminAuditLog({
      adminUserId: input.createdBy || null,
      action: 'credits.adjust',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        delta,
        reason: input.reason,
        refType: input.refType || null,
        refId: input.refId || null,
      },
    }).catch((error) => {
      console.warn('[credits] audit log skipped:', error);
    });

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          credits: Number(user.credits),
        },
        transaction,
      },
    };
  } catch (error) {
    console.error('adjustUserCredits failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listCreditTransactions(options: {
  userId?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ success: boolean; error?: string; data?: CreditTransaction[] }> {
  try {
    await ensureCreditLedgerTables();
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const userId = (options.userId || '').trim();
    const query = (options.query || '').trim().toLowerCase();
    const pattern = `%${query}%`;

    const result = await sql`
      SELECT
        t.id,
        t.user_id as "userId",
        u.email as "userEmail",
        u.name as "userName",
        t.delta,
        t.balance_after as "balanceAfter",
        t.reason,
        t.source,
        t.ref_type as "refType",
        t.ref_id as "refId",
        t.created_by as "createdBy",
        t.note,
        t.created_at as "createdAt"
      FROM credit_transactions t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE (${userId} = '' OR t.user_id = ${userId})
        AND (
          ${query} = ''
          OR LOWER(COALESCE(u.email, '')) LIKE ${pattern}
          OR LOWER(COALESCE(u.name, '')) LIKE ${pattern}
          OR LOWER(COALESCE(t.reason, '')) LIKE ${pattern}
          OR LOWER(COALESCE(t.note, '')) LIKE ${pattern}
          OR LOWER(COALESCE(t.ref_id, '')) LIKE ${pattern}
        )
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return { success: true, data: result.rows.map((row) => mapCreditTransactionRow(row)) };
  } catch (error) {
    console.error('listCreditTransactions failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getAccountCreditOverview(userId: string): Promise<{
  success: boolean;
  error?: string;
  data?: {
    user: { id: string; email: string; name: string; credits: number; createdAt: string };
    transactions: CreditTransaction[];
  };
}> {
  try {
    await ensureCreditLedgerTables();
    const userResult = await sql<{
      id: string;
      email: string;
      name: string;
      credits: number;
      createdAt: string;
    }>`
      SELECT id, email, name, credits, created_at as "createdAt"
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (userResult.rows.length === 0) {
      return { success: false, error: 'User not found.' };
    }

    const transactionsResult = await listCreditTransactions({ userId, limit: 20, offset: 0 });
    return {
      success: true,
      data: {
        user: {
          ...userResult.rows[0],
          credits: Number(userResult.rows[0].credits || 0),
        },
        transactions: transactionsResult.data || [],
      },
    };
  } catch (error) {
    console.error('getAccountCreditOverview failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function refundFailedJobCredit(input: {
  podcastId: string;
  createdBy?: string | null;
  note?: string | null;
}): Promise<CreditAdjustmentResult> {
  try {
    await ensureCreditLedgerTables();
    const rowResult = await sql<{
      podcastId: string;
      title: string;
      userId: string | null;
      userEmail: string | null;
      jobStatus: string | null;
    }>`
      SELECT
        p.id as "podcastId",
        p.title,
        p.user_id as "userId",
        u.email as "userEmail",
        j.status as "jobStatus"
      FROM podcasts p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN processing_jobs j ON j.podcast_id = p.id
      WHERE p.id = ${input.podcastId}
      LIMIT 1
    `;

    const row = rowResult.rows[0];
    if (!row) {
      return { success: false, errorCode: 'PODCAST_NOT_FOUND', error: 'Podcast not found.' };
    }
    if (!row.userId) {
      return { success: false, errorCode: 'USER_NOT_FOUND', error: 'Podcast has no owner.' };
    }
    if (row.jobStatus !== 'failed') {
      return { success: false, errorCode: 'JOB_NOT_FAILED', error: 'Only failed jobs can be refunded.' };
    }

    const existing = await sql`
      SELECT id
      FROM credit_transactions
      WHERE user_id = ${row.userId}
        AND reason = 'failed_job_refund'
        AND ref_type = 'processing_job'
        AND ref_id = ${input.podcastId}
      LIMIT 1
    `;

    if (existing.rows.length > 0) {
      const userResult = await sql<{
        id: string;
        email: string;
        name: string;
        credits: number;
      }>`
        SELECT id, email, name, credits
        FROM users
        WHERE id = ${row.userId}
        LIMIT 1
      `;
      return {
        success: true,
        data: {
          user: {
            id: userResult.rows[0]?.id || row.userId,
            email: userResult.rows[0]?.email || row.userEmail || '',
            name: userResult.rows[0]?.name || '',
            credits: Number(userResult.rows[0]?.credits || 0),
          },
          transaction: mapCreditTransactionRow({}),
          alreadyRefunded: true,
        },
      };
    }

    return await adjustUserCredits({
      userId: row.userId,
      delta: 1,
      reason: 'failed_job_refund',
      source: 'admin_jobs',
      refType: 'processing_job',
      refId: input.podcastId,
      createdBy: input.createdBy || null,
      note: input.note || `Refund for failed processing job: ${row.title}`,
    });
  } catch (error) {
    console.error('refundFailedJobCredit failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
