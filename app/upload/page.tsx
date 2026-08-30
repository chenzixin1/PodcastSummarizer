"use client";

import { useState, ChangeEvent, FormEvent, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppFrame from '../../components/AppFrame';

function parseCredits(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed)) {
    return Math.max(0, parsed);
  }
  return null;
}

export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }

    let cancelled = false;
    const loadCredits = async () => {
      setCreditsLoading(true);
      try {
        const response = await fetch('/api/auth-status', {
          method: 'GET',
          cache: 'no-store',
        });
        const result = await response.json();
        if (cancelled) {
          return;
        }
        const parsedCredits = parseCredits(result?.database?.user?.credits);
        setRemainingCredits(parsedCredits);
      } catch (creditsError) {
        console.error('Failed to load credits:', creditsError);
      } finally {
        if (!cancelled) {
          setCreditsLoading(false);
        }
      }
    };

    loadCredits();

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'loading') {
    return (
      <AppFrame currentLabel="Upload" showViewTabs={false} mainClassName="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-8 py-8 shadow-[0_18px_40px_-28px_rgba(80,67,44,0.45)]">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </AppFrame>
    );
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      const callbackUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return null;
    }
    return null;
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    if (nextFile) {
      setYoutubeUrl('');
      setRightsConfirmed(false);
      setError(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedYoutubeUrl = youtubeUrl.trim();

    if (!file && !normalizedYoutubeUrl) {
      setError('Please select a .srt file or enter a YouTube URL.');
      return;
    }

    if (file && normalizedYoutubeUrl) {
      setError('Please submit either an SRT file or a YouTube URL, not both.');
      return;
    }

    if (normalizedYoutubeUrl && !rightsConfirmed) {
      setError('Please confirm that you are authorized to process this video.');
      return;
    }

    if (normalizedYoutubeUrl && remainingCredits !== null && remainingCredits < 1000) {
      setError('Watchless video conversion requires at least 1000 credits.');
      return;
    }

    if (!session?.user?.id) {
      setError('User session not found. Please sign in again.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      if (normalizedYoutubeUrl) {
        const response = await fetch('/api/watchless/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: normalizedYoutubeUrl,
            isPublic,
            rightsConfirmed,
            preferredLanguage: 'en-US',
            idempotencyKey: crypto.randomUUID(),
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Watchless conversion could not be started.');
        }

        const jobId = result?.data?.id as string | undefined;
        if (!jobId) {
          throw new Error('Watchless conversion started but the job id is missing.');
        }

        setUploadProgress(100);
        router.push(`/watchless/jobs/${jobId}`);
        return;
      }

      const formData = new FormData();
      if (file) {
        formData.append('file', file);
      }
      formData.append('isPublic', isPublic.toString());
      formData.append('userId', session.user.id);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || result.details || 'Upload failed');
      }

      const id = result?.data?.id as string | undefined;
      if (!id) {
        throw new Error('Upload succeeded but podcast id is missing.');
      }

      const updatedCredits = parseCredits(result?.data?.remainingCredits);
      if (updatedCredits !== null) {
        setRemainingCredits(updatedCredits);
      }

      setUploadProgress(100);
      router.push(`/dashboard/${id}`);
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : 'An unknown error occurred during upload.');
      setUploading(false);
      return;
    }

    setUploading(false);
  };

  const hasYoutubeUrl = Boolean(youtubeUrl.trim());
  const insufficientCredits = remainingCredits !== null && (hasYoutubeUrl ? remainingCredits < 1000 : remainingCredits <= 0);
  const isSubmitDisabled =
    uploading || (!file && !hasYoutubeUrl) || (file !== null && hasYoutubeUrl) || insufficientCredits || (hasYoutubeUrl && !rightsConfirmed);

  return (
    <AppFrame currentLabel="Upload" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1400px] flex-grow p-4 sm:p-6 lg:p-8">
        <section className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8 w-full max-w-3xl mx-auto">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--heading)]">Upload SRT or YouTube</h1>
            <p className="text-sm text-[var(--text-muted)]">Signed in as <span className="font-semibold text-[var(--heading)]">{session?.user?.email}</span></p>
            <p className="text-sm text-[var(--text-secondary)]">
              Remaining credits:{' '}
              <span className="font-semibold text-[var(--heading)]">
                {creditsLoading ? 'Loading...' : remainingCredits ?? '--'}
              </span>
              <span className="ml-2 text-[var(--text-muted)]">(SRT: 1 · Watchless video: 1000)</span>
            </p>
            {!creditsLoading && insufficientCredits && (
              <p className="text-sm text-[var(--danger)]">
                {hasYoutubeUrl ? 'Watchless video conversion requires at least 1000 credits.' : 'No credits left. Please contact support to add credits.'}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="srtFile" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                SRT File Input
              </label>
              <input
                id="srtFile"
                ref={fileInputRef}
                name="srtFile"
                type="file"
                accept=".srt,application/x-subrip"
                onChange={handleFileChange}
                className="block w-full text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--btn-primary)] file:text-[var(--btn-primary-text)] hover:file:bg-[var(--btn-primary-hover)] disabled:opacity-50 disabled:pointer-events-none"
                disabled={uploading}
              />
              {file && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            <div>
              <label htmlFor="youtubeUrl" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Or YouTube URL
              </label>
              <input
                id="youtubeUrl"
                name="youtubeUrl"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(event) => {
                  setYoutubeUrl(event.target.value);
                  if (event.target.value.trim()) {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }
                  setRightsConfirmed(false);
                  setError(null);
                }}
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-medium)]"
                disabled={uploading}
              />
            </div>

            {hasYoutubeUrl && (
              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--paper-subtle)] p-4 space-y-3">
                <p className="text-sm font-semibold text-[var(--heading)]">Full Watchless conversion</p>
                <p className="text-xs leading-5 text-[var(--text-muted)]">
                  This generates the transcript, speaker-separated article, scenes, keyframes and PDF. 1000 credits are reserved now and refunded automatically if processing fails or is cancelled.
                </p>
                <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) => setRightsConfirmed(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-[var(--border-medium)] accent-[var(--btn-primary)]"
                    disabled={uploading}
                  />
                  <span>I confirm that I am authorized to process this video and publish the generated result.</span>
                </label>
              </div>
            )}

            <div className="space-y-2">
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isPublic}
                  onChange={() => setIsPublic((prev) => !prev)}
                />
                <span className={`relative h-6 w-11 rounded-full transition-colors ${isPublic ? 'bg-[var(--btn-primary)]' : 'bg-[var(--border-medium)]'}`}>
                  <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${isPublic ? 'translate-x-5' : ''}`}></span>
                </span>
                <span className="ml-3 text-sm text-[var(--text-secondary)]">Make this analysis public</span>
              </label>
              <p className="text-xs text-[var(--text-muted)]">Public analyses can be viewed by anyone with the link.</p>
            </div>

            {uploading && (
              <div className="space-y-2">
                <div className="w-full h-2 rounded-full bg-[var(--paper-subtle)]">
                  <div
                    className="h-2 rounded-full bg-[var(--btn-primary)] transition-all duration-500 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-[var(--text-muted)] text-center">
                  {hasYoutubeUrl ? 'Starting the Watchless workflow…' : 'Uploading and queueing analysis…'}
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-[#d8b7b7] bg-[#fff5f5] text-[var(--danger)] px-4 py-3 text-sm">
                Error: {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full rounded-lg bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] disabled:bg-[var(--paper-subtle)] disabled:text-[var(--text-muted)] text-[var(--btn-primary-text)] font-semibold py-3 px-4 transition-colors disabled:cursor-not-allowed"
            >
              {uploading ? 'Starting…' : hasYoutubeUrl ? 'Convert with Watchless · 1000 credits' : 'Upload & Process'}
            </button>
          </form>
        </section>
    </AppFrame>
  );
}
