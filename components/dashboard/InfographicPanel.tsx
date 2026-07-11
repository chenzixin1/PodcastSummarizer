'use client';

import { Download, Maximize2, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadInfographicAsPng } from '../../lib/infographicDownload';
import type { InfographicStatusResponse } from '../../lib/infographicJobs';

type ApiResponse = { success: boolean; data?: InfographicStatusResponse; error?: string };
const POLLABLE = new Set(['pending', 'processing']);
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

function safeFilename(title: string) {
  return (title || 'podsum').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'podsum';
}

export default function InfographicPanel({ podcastId, canEdit, title }: {
  podcastId: string;
  canEdit: boolean;
  title: string;
}) {
  const [status, setStatus] = useState<InfographicStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestSequence = ++requestSequenceRef.current;
    try {
      const response = await fetch(`/api/infographics/${podcastId}`, { cache: 'no-store', signal });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'Failed to load infographic');
      if (requestSequence !== requestSequenceRef.current) return;
      setStatus(body.data); setError(null);
    } catch (cause) {
      if (signal?.aborted || requestSequence !== requestSequenceRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Failed to load infographic');
    }
  }, [podcastId]);

  useEffect(() => {
    // A panel can stay mounted while a dashboard route changes. Invalidate every
    // prior response before showing any state for the next podcast.
    requestSequenceRef.current += 1;
    setStatus(null);
    setError(null);
    setCommandError(null);
    setBusy(false);
    setZoom(1);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const shouldPoll = Boolean(status && POLLABLE.has(status.status));
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load, shouldPoll]);

  const command = async (endpoint: 'generate' | 'retry') => {
    setBusy(true);
    setCommandError(null);
    try {
      const response = await fetch(`/api/infographics/${podcastId}/${endpoint}`, { method: 'POST' });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'Unable to start infographic generation');
      setStatus(body.data); setError(null);
    } catch (cause) { setCommandError(cause instanceof Error ? cause.message : 'Unable to start infographic generation'); }
    finally { setBusy(false); }
  };

  if (error) return <div className="infographic-message" role="alert">{error}</div>;
  if (!status) return <div className="infographic-message">Loading infographic...</div>;
  if (status.status === 'unavailable') return <div className="infographic-message"><p>Infographic was not generated for this analysis.</p>{commandError && <p className="infographic-command-error" role="alert">{commandError}</p>}{canEdit && <button className="infographic-action" disabled={busy} onClick={() => void command('generate')}>Generate infographic</button>}</div>;
  if (status.status === 'failed') return <div className="infographic-message"><p>Infographic generation failed.</p>{commandError && <p className="infographic-command-error" role="alert">{commandError}</p>}{canEdit && <button className="infographic-action" disabled={busy} onClick={() => void command('retry')}>Retry infographic</button>}</div>;
  if (status.status !== 'completed' || !status.artifactUrl) return <div className="infographic-message" aria-live="polite">{status.status === 'processing' ? 'Generating infographic...' : 'Infographic is queued...'}</div>;

  const fullscreen = () => { void viewportRef.current?.requestFullscreen?.(); };
  return <section className="infographic-panel" data-testid="infographic-panel" data-podcast-id={podcastId}>
    <div className="infographic-toolbar" aria-label="Infographic controls">
      <button title="Zoom out" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(value => Math.max(MIN_ZOOM, value - .25))}><ZoomOut size={17} /></button>
      <button title="Reset zoom" aria-label="Reset zoom" onClick={() => setZoom(1)}><Scan size={17} /></button>
      <button title="Zoom in" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => Math.min(MAX_ZOOM, value + .25))}><ZoomIn size={17} /></button>
      <button title="Enter fullscreen" aria-label="Enter fullscreen" onClick={fullscreen}><Maximize2 size={17} /></button>
      <button title="Download PNG" aria-label="Download PNG" onClick={() => void downloadInfographicAsPng({ artifactUrl: status.artifactUrl as string, filename: `${safeFilename(title)}-infographic` })}><Download size={17} /></button>
    </div>
    <div className="infographic-viewport" ref={viewportRef}>
      {/* SVG artifacts are produced in R2 and must render without Next image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="infographic-image" src={status.artifactUrl} alt={`Infographic for ${title}`} style={{ transform: `scale(${zoom})` }} />
    </div>
  </section>;
}
