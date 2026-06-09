'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminChrome from '../AdminChrome';

interface AdminPodcast {
  id: string;
  title: string;
  originalFileName: string;
  fileSize: string;
  sourceReference: string | null;
  isPublic: boolean;
  userEmail: string | null;
  isProcessed: boolean;
  jobStatus: string | null;
  wordCount: number | null;
  createdAt: string;
  processedAt: string | null;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function AdminPodcastsPage() {
  const [podcasts, setPodcasts] = useState<AdminPodcast[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [visibility, setVisibility] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadPodcasts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (visibility) params.set('visibility', visibility);
      const response = await fetch(`/api/admin/podcasts?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load podcasts');
      }
      setPodcasts(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, status, visibility]);

  useEffect(() => {
    loadPodcasts();
  }, [loadPodcasts]);

  async function toggleVisibility(podcast: AdminPodcast) {
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/admin/podcasts/${encodeURIComponent(podcast.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: !podcast.isPublic }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setError(payload.error || 'Failed to update podcast');
      return;
    }
    setNotice(`${podcast.title} visibility updated.`);
    await loadPodcasts();
  }

  async function deleteOne(podcast: AdminPodcast) {
    if (!window.confirm(`Delete "${podcast.title}"?`)) {
      return;
    }
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/admin/podcasts/${encodeURIComponent(podcast.id)}`, {
      method: 'DELETE',
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setError(payload.error || 'Failed to delete podcast');
      return;
    }
    setNotice(`${podcast.title} deleted.`);
    await loadPodcasts();
  }

  return (
    <AdminChrome title="Admin Podcasts">
      <div className="space-y-4">
        <section className="dashboard-panel rounded-lg p-4">
          <div className="grid gap-3 md:grid-cols-[1.5fr_0.8fr_0.8fr_auto] md:items-end">
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, source, email, id" className="mt-1 w-full border-0 border-b border-[var(--border-soft)] bg-transparent px-0 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Job</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]">
                <option value="">All</option>
                <option value="queued">queued</option>
                <option value="processing">processing</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
                <option value="missing">missing</option>
              </select>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Visibility</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]">
                <option value="">All</option>
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </label>
            <button onClick={loadPodcasts} className="rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
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
                <th className="px-4 py-3">Podcast</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
              ) : podcasts.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No podcasts found.</td></tr>
              ) : (
                podcasts.map((podcast) => (
                  <tr key={podcast.id} className="border-b border-[var(--border-soft)] align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/${podcast.id}`} className="font-semibold text-[var(--heading)] hover:text-[var(--link-hover)]">
                        {podcast.title || podcast.originalFileName}
                      </Link>
                      <div className="text-xs text-[var(--text-muted)]">{podcast.originalFileName} · {podcast.fileSize}</div>
                      {podcast.sourceReference && <div className="mt-1 max-w-xl break-words text-xs text-[var(--text-muted)]">{podcast.sourceReference}</div>}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{podcast.userEmail || 'No owner'}</td>
                    <td className="px-4 py-3">
                      <div className={podcast.isPublic ? 'font-semibold text-emerald-700' : 'font-semibold text-[var(--text-muted)]'}>{podcast.isPublic ? 'public' : 'private'}</div>
                      <div className="text-xs text-[var(--text-muted)]">{podcast.isProcessed ? 'processed' : 'not processed'} · {podcast.jobStatus || 'missing'}</div>
                      {typeof podcast.wordCount === 'number' && <div className="text-xs text-[var(--text-muted)]">{podcast.wordCount} words</div>}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      <div>{formatDate(podcast.createdAt)}</div>
                      <div className="text-xs text-[var(--text-muted)]">processed {formatDate(podcast.processedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[220px] flex-wrap gap-2">
                        <button onClick={() => toggleVisibility(podcast)} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--paper-muted)]">
                          {podcast.isPublic ? 'Make private' : 'Make public'}
                        </button>
                        <button onClick={() => deleteOne(podcast)} className="rounded-lg border border-[#d8b7b7] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[#fff5f5]">
                          Delete
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
