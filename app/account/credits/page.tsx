'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AppFrame from '../../../components/AppFrame';

interface CreditTransaction {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  source: string | null;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function AccountCreditsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<CreditTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/account/credits?limit=100', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load credit ledger');
      }
      setRows(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin?callbackUrl=/account/credits');
    }
  }, [router, status]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadRows();
    }
  }, [loadRows, status]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <AppFrame currentLabel="Credits" showViewTabs={false} mainClassName="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center text-[var(--text-muted)]">Loading...</div>
      </AppFrame>
    );
  }

  return (
    <AppFrame currentLabel="Credits" showViewTabs={false}>
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={loadRows} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]">Refresh</button>
          </div>
          {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}
          <div className="dashboard-panel overflow-x-auto rounded-lg">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border-soft)] bg-[var(--table-head-bg)] text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Delta</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Reference</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No credit activity yet.</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border-soft)] align-top">
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(row.createdAt)}</td>
                      <td className={`px-4 py-3 font-semibold ${row.delta >= 0 ? 'text-emerald-700' : 'text-[var(--danger)]'}`}>{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                      <td className="px-4 py-3">{row.balanceAfter}</td>
                      <td className="px-4 py-3">
                        <div>{row.reason}</div>
                        {row.note && <div className="mt-1 max-w-md text-xs text-[var(--text-muted)]">{row.note}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{row.refType || row.source || '-'} {row.refId || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
    </AppFrame>
  );
}
