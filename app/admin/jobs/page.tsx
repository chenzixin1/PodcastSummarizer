'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminChrome from '../AdminChrome';

interface AdminJob {
  podcastId: string;
  podcastTitle: string;
  userEmail: string | null;
  status: string;
  currentTask: string | null;
  progressCurrent: number;
  progressTotal: number;
  statusMessage: string | null;
  attempts: number;
  workerId: string | null;
  lastError: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

interface QueueHealth {
  counts: Record<string, number>;
  queuedOldestAt: string | null;
  staleProcessingCount: number;
  activeWorkers: number;
  checkedAt: string;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function statusClass(status: string): string {
  if (status === 'completed') return 'text-emerald-700';
  if (status === 'failed') return 'text-[var(--danger)]';
  if (status === 'processing') return 'text-[var(--heading)]';
  if (status === 'cancelled') return 'text-[var(--text-muted)]';
  return 'text-amber-700';
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [health, setHealth] = useState<QueueHealth | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status) params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/admin/jobs?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load jobs');
      }
      setJobs(Array.isArray(payload.data?.jobs) ? payload.data.jobs : []);
      setHealth(payload.data?.health || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function runAction(job: AdminJob, action: 'retry' | 'cancel' | 'refund') {
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/admin/jobs/${encodeURIComponent(job.podcastId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setError(payload.error || `Failed to ${action} job`);
      return;
    }
    setNotice(`${action} completed for ${job.podcastTitle}.`);
    await loadJobs();
  }

  return (
    <AdminChrome title="Admin Jobs">
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {['queued', 'processing', 'completed', 'failed', 'cancelled'].map((key) => (
            <div key={key} className="dashboard-panel rounded-lg p-4">
              <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{key}</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--heading)]">{health?.counts?.[key] || 0}</div>
            </div>
          ))}
        </section>

        <section className="dashboard-panel rounded-lg p-4">
          <div className="grid gap-3 md:grid-cols-[0.8fr_1.5fr_auto] md:items-end">
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]">
                <option value="">All</option>
                <option value="queued">queued</option>
                <option value="processing">processing</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, email, podcast id" className="mt-1 w-full border-0 border-b border-[var(--border-soft)] bg-transparent px-0 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
            </label>
            <button onClick={loadJobs} className="rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
              Refresh
            </button>
          </div>
          {health && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
              <span>Active workers: {health.activeWorkers}</span>
              <span>Stale processing: {health.staleProcessingCount}</span>
              <span>Oldest queued: {formatDate(health.queuedOldestAt)}</span>
              <span>Checked: {formatDate(health.checkedAt)}</span>
            </div>
          )}
        </section>

        {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}
        {notice && <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--heading)]">{notice}</div>}

        <div className="dashboard-panel overflow-x-auto rounded-lg">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--table-head-bg)] text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Podcast</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No jobs found.</td></tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.podcastId} className="border-b border-[var(--border-soft)] align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/${job.podcastId}`} className="font-semibold text-[var(--heading)] hover:text-[var(--link-hover)]">
                        {job.podcastTitle}
                      </Link>
                      <div className="text-xs text-[var(--text-muted)]">{job.userEmail || 'No owner'} · {job.podcastId}</div>
                      {job.lastError && <div className="mt-2 max-w-xl break-words text-xs text-[var(--danger)]">{job.lastError}</div>}
                    </td>
                    <td className={`px-4 py-3 font-semibold ${statusClass(job.status)}`}>
                      <div>{job.status}</div>
                      <div className="text-xs font-normal text-[var(--text-muted)]">{job.statusMessage || job.currentTask || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{job.progressCurrent}/{job.progressTotal}</div>
                      <div className="text-xs text-[var(--text-muted)]">attempts {job.attempts}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(job.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[240px] flex-wrap gap-2">
                        <button onClick={() => runAction(job, 'retry')} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--paper-muted)]">
                          Retry
                        </button>
                        <button onClick={() => runAction(job, 'cancel')} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--paper-muted)]">
                          Cancel
                        </button>
                        <button
                          onClick={() => runAction(job, 'refund')}
                          disabled={job.status !== 'failed'}
                          className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--paper-muted)] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Refund
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
