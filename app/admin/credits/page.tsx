'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminChrome from '../AdminChrome';

interface CreditTransaction {
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
  note: string | null;
  createdAt: string;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function AdminCreditsPage() {
  const [rows, setRows] = useState<CreditTransaction[]>([]);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('admin_adjustment');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) {
        params.set('q', query.trim());
      }
      const response = await fetch(`/api/admin/credits?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load credit transactions');
      }
      setRows(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  async function submitAdjustment() {
    const numericDelta = Number(delta);
    if (!userId.trim()) {
      setError('User ID is required.');
      return;
    }
    if (!Number.isFinite(numericDelta) || Math.trunc(numericDelta) === 0) {
      setError('Enter a non-zero credit delta.');
      return;
    }

    setError(null);
    setNotice(null);
    const response = await fetch('/api/admin/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId.trim(),
        delta: Math.trunc(numericDelta),
        reason,
        note: note.trim() || null,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setError(payload.error || 'Failed to adjust credits');
      return;
    }
    setDelta('');
    setNote('');
    setNotice('Credit adjustment recorded.');
    await loadRows();
  }

  return (
    <AdminChrome title="Admin Credits">
      <div className="space-y-4">
        <section className="dashboard-panel rounded-lg p-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto] lg:items-end">
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">User ID</span>
              <input value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Delta</span>
              <input value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="+10 / -1" className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Reason</span>
              <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]">
                <option value="admin_adjustment">admin_adjustment</option>
                <option value="support_credit">support_credit</option>
                <option value="promo_credit">promo_credit</option>
                <option value="manual_correction">manual_correction</option>
              </select>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Note</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <button onClick={submitAdjustment} className="rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
              Record
            </button>
          </div>
        </section>

        <section className="dashboard-panel rounded-lg p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <label className="block w-full md:max-w-md">
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Search ledger</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, reason, note, ref" className="mt-1 w-full border-0 border-b border-[var(--border-soft)] bg-transparent px-0 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <button onClick={loadRows} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]">
              Refresh
            </button>
          </div>
        </section>

        {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}
        {notice && <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--heading)]">{notice}</div>}

        <div className="dashboard-panel overflow-x-auto rounded-lg">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--table-head-bg)] text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Delta</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">No transactions found.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border-soft)] align-top">
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--heading)]">{row.userEmail || row.userId}</div>
                      <div className="text-xs text-[var(--text-muted)]">{row.userName || row.userId}</div>
                    </td>
                    <td className={`px-4 py-3 font-semibold ${row.delta >= 0 ? 'text-emerald-700' : 'text-[var(--danger)]'}`}>{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                    <td className="px-4 py-3">{row.balanceAfter}</td>
                    <td className="px-4 py-3">
                      <div>{row.reason}</div>
                      {row.note && <div className="mt-1 max-w-md text-xs text-[var(--text-muted)]">{row.note}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{row.refType || '-'} {row.refId || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminChrome>
  );
}
