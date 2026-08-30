'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppFrame from '../../../../components/AppFrame';

type WatchlessJob = {
  id: string;
  sourceUrl: string | null;
  status: string;
  stage: string | null;
  progressCurrent: number;
  progressTotal: number;
  creditStatus: 'reserved' | 'charged' | 'refunded' | 'none';
  creditsReserved: number;
  outputPodcastId: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rolled_back']);

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  created: { label: 'Preparing job', detail: 'Creating a secure processing job.' },
  queued: { label: 'Waiting to start', detail: 'Your video is queued for processing.' },
  preparing: { label: 'Preparing source', detail: 'Checking the source and preparing audio.' },
  transcribing: { label: 'Transcribing', detail: 'Recognizing speech and separating speaker turns.' },
  segmenting: { label: 'Structuring article', detail: 'Luna is organizing the transcript into scenes and editorial copy.' },
  rendering: { label: 'Rendering assets', detail: 'Generating keyframes and the complete PDF.' },
  validating: { label: 'Checking output', detail: 'Validating the timeline, checksums and required assets.' },
  publishing: { label: 'Publishing to PodSum', detail: 'Writing the completed podcast and article atomically.' },
  completed: { label: 'Complete', detail: 'The full Watchless article is ready.' },
  failed: { label: 'Processing failed', detail: 'The reserved credits have been refunded automatically.' },
  cancelled: { label: 'Cancelled', detail: 'The job was cancelled and reserved credits were refunded.' },
  rolled_back: { label: 'Publication removed', detail: 'The generated publication has been rolled back.' },
};

export default function WatchlessJobPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<WatchlessJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const loadJob = useCallback(async (): Promise<WatchlessJob> => {
    const response = await fetch(`/api/watchless/jobs/${encodeURIComponent(params.id)}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load this Watchless job.');
    const nextJob = result.data as WatchlessJob;
    setJob(nextJob);
    setError(null);
    return nextJob;
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const nextJob = await loadJob();
        if (TERMINAL_STATUSES.has(nextJob.status)) return;
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this Watchless job.');
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (!cancelled) timer = setTimeout(poll, 3000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadJob]);

  useEffect(() => {
    if (job?.status === 'completed' && job.outputPodcastId) {
      const timer = setTimeout(() => router.replace(`/dashboard/${job.outputPodcastId}`), 1200);
      return () => clearTimeout(timer);
    }
  }, [job?.outputPodcastId, job?.status, router]);

  const progress = useMemo(() => {
    if (!job) return 0;
    if (job.status === 'completed') return 100;
    const total = Math.max(1, job.progressTotal || 100);
    return Math.max(2, Math.min(99, Math.round((job.progressCurrent / total) * 100)));
  }, [job]);

  const copy = STATUS_COPY[job?.status || 'created'] || {
    label: job?.stage || 'Processing',
    detail: 'The Watchless workflow is running.',
  };
  const canCancel = Boolean(job && ['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering'].includes(job.status));

  const cancelJob = async () => {
    if (!job || !canCancel) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchless/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not cancel this job.');
      setJob(result.data as WatchlessJob);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel this job.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AppFrame currentLabel="Watchless" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1400px] flex-grow p-4 sm:p-6 lg:p-8">
      <section className="dashboard-panel mx-auto w-full max-w-3xl rounded-2xl p-5 sm:p-7 lg:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Watchless processing</p>
        <h1 className="mt-3 text-2xl font-bold text-[var(--heading)] sm:text-3xl">{copy.label}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{copy.detail}</p>

        <div className="mt-7" aria-label={`Processing progress: ${progress}%`}>
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>{job?.stage || job?.status || (loading ? 'Loading…' : 'Waiting')}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-subtle)]">
            <div
              className="h-full rounded-full bg-[var(--btn-primary)] transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <dl className="mt-7 divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)] text-sm">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-[var(--text-muted)]">Credits</dt>
            <dd className="font-medium text-[var(--heading)]">
              {job ? `${job.creditsReserved} · ${job.creditStatus}` : '—'}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-[var(--text-muted)]">Source</dt>
            <dd className="max-w-[70%] truncate text-right text-[var(--text-secondary)]">
              {job?.sourceUrl ? <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--heading)]">YouTube ↗</a> : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-[var(--text-muted)]">Last updated</dt>
            <dd className="text-[var(--text-secondary)]">{job?.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>

        {job?.errorMessage ? (
          <div className="mt-5 rounded-xl border border-[#d8b7b7] bg-[#fff5f5] px-4 py-3 text-sm text-[var(--danger)]" role="alert">
            {job.errorMessage}
          </div>
        ) : null}
        {error ? <p className="mt-5 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}

        <div className="mt-7 flex flex-wrap gap-3">
          {job?.status === 'completed' && job.outputPodcastId ? (
            <Link href={`/dashboard/${job.outputPodcastId}`} className="rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
              Open completed podcast
            </Link>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              onClick={cancelJob}
              disabled={cancelling}
              className="rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--paper-subtle)] disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel and refund'}
            </button>
          ) : null}
          {job && TERMINAL_STATUSES.has(job.status) && job.status !== 'completed' ? (
            <Link href="/upload" className="rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--paper-subtle)]">
              Back to upload
            </Link>
          ) : null}
        </div>
      </section>
    </AppFrame>
  );
}
