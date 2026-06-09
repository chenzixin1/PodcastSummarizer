'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminChrome from '../AdminChrome';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  credits: number;
  createdAt: string;
  podcastCount: number;
  publicPodcastCount: number;
  lastPodcastAt: string | null;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) {
        params.set('q', query.trim());
      }
      const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load users');
      }
      setUsers(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function adjustCredits(user: AdminUser) {
    const delta = Number(adjustments[user.id]);
    if (!Number.isFinite(delta) || Math.trunc(delta) === 0) {
      setError('Enter a non-zero credit delta.');
      return;
    }

    setNotice(null);
    setError(null);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delta: Math.trunc(delta),
        reason: 'admin_adjustment',
        note: `Admin adjustment for ${user.email}`,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setError(payload.error || 'Failed to adjust credits');
      return;
    }
    setAdjustments((prev) => ({ ...prev, [user.id]: '' }));
    setNotice(`Credits updated for ${user.email}.`);
    await loadUsers();
  }

  return (
    <AdminChrome title="Admin Users">
      <div className="space-y-4">
        <div className="dashboard-panel rounded-lg p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <label className="block w-full md:max-w-md">
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    loadUsers();
                  }
                }}
                placeholder="Email or name"
                className="mt-1 w-full border-0 border-b border-[var(--border-soft)] bg-transparent px-0 py-2 text-sm text-[var(--text-main)] outline-none focus:border-[var(--border-medium)]"
              />
            </label>
            <button
              onClick={loadUsers}
              className="rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}
        {notice && <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--heading)]">{notice}</div>}

        <div className="dashboard-panel overflow-x-auto rounded-lg">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--table-head-bg)] text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Podcasts</th>
                <th className="px-4 py-3">Last Upload</th>
                <th className="px-4 py-3">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No users found.</td></tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b border-[var(--border-soft)] align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--heading)]">{user.email}</div>
                      <div className="text-xs text-[var(--text-muted)]">{user.name || user.id}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold">{user.credits}</td>
                    <td className="px-4 py-3">
                      <div>{user.podcastCount} total</div>
                      <div className="text-xs text-[var(--text-muted)]">{user.publicPodcastCount} public</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(user.lastPodcastAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[210px] gap-2">
                        <input
                          value={adjustments[user.id] || ''}
                          onChange={(event) => setAdjustments((prev) => ({ ...prev, [user.id]: event.target.value }))}
                          placeholder="+10 / -1"
                          className="w-24 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]"
                        />
                        <button
                          onClick={() => adjustCredits(user)}
                          className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]"
                        >
                          Apply
                        </button>
                      </div>
                    </td>
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
