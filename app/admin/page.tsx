'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminChrome from './AdminChrome';

interface OverviewData {
  totals: {
    users: number;
    podcasts: number;
    publicPodcasts: number;
    processedPodcasts: number;
    totalCredits: number;
  };
  jobs: Record<string, number>;
  recentFailedJobs: Array<{
    podcastId: string;
    podcastTitle: string;
    userEmail: string | null;
    lastError: string | null;
    updatedAt: string;
  }>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/admin/overview', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to load admin overview');
        }
        setData(payload.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return (
    <AdminChrome title="Admin Overview">
      <div className="space-y-5">
        {error && (
          <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="dashboard-panel rounded-lg p-10 text-center text-[var(--text-muted)]">Loading...</div>
        ) : data ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Users', data.totals.users],
                ['Podcasts', data.totals.podcasts],
                ['Public', data.totals.publicPodcasts],
                ['Processed', data.totals.processedPodcasts],
                ['Credits', data.totals.totalCredits],
              ].map(([label, value]) => (
                <div key={label} className="dashboard-panel rounded-lg p-4">
                  <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--heading)]">{value}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
              <div className="dashboard-panel rounded-lg p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[var(--heading)]">Job Queue</h2>
                  <Link href="/admin/jobs" className="text-sm font-medium text-[var(--link)] hover:text-[var(--link-hover)]">
                    Open jobs
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {['queued', 'processing', 'completed', 'failed', 'cancelled'].map((status) => (
                    <div key={status} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-3">
                      <div className="text-xs uppercase text-[var(--text-muted)]">{status}</div>
                      <div className="mt-1 text-xl font-semibold text-[var(--text-main)]">{data.jobs[status] || 0}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-panel rounded-lg p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[var(--heading)]">Recent Failures</h2>
                  <Link href="/admin/jobs?status=failed" className="text-sm font-medium text-[var(--link)] hover:text-[var(--link-hover)]">
                    Review
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.recentFailedJobs.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No failed jobs.</p>
                  ) : (
                    data.recentFailedJobs.map((job) => (
                      <div key={job.podcastId} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <Link href={`/dashboard/${job.podcastId}`} className="font-semibold text-[var(--heading)] hover:text-[var(--link-hover)]">
                            {job.podcastTitle}
                          </Link>
                          <span className="text-xs text-[var(--text-muted)]">{formatDate(job.updatedAt)}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{job.userEmail || 'No owner'}</div>
                        {job.lastError && <div className="mt-2 line-clamp-2 text-sm text-[var(--danger)]">{job.lastError}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AdminChrome>
  );
}
