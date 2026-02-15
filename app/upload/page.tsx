"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';

type ThemeMode = 'light' | 'dark';

export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem('podsum-dashboard-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setThemeMode(storedTheme);
      return;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setThemeMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('podsum-dashboard-theme', themeMode);
  }, [themeMode]);

  if (status === 'loading') {
    return (
      <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex items-center justify-center" data-theme={themeMode}>
        <div className="text-center rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-8 py-8 shadow-[0_18px_40px_-28px_rgba(80,67,44,0.45)]">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      router.replace(`/auth/signin?callbackUrl=/upload`);
      return null;
    }
    return null;
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    if (nextFile) {
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

    if (!session?.user?.id) {
      setError('User session not found. Please sign in again.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    if (normalizedYoutubeUrl) {
      formData.append('youtubeUrl', normalizedYoutubeUrl);
      formData.append('sourceReference', normalizedYoutubeUrl);
    }
    formData.append('isPublic', isPublic.toString());
    formData.append('userId', session.user.id);

    try {
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

  const isSubmitDisabled = uploading || (!file && !youtubeUrl.trim());

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col" data-theme={themeMode}>
      <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <nav className="app-breadcrumb-nav">
            <Link href="/" className="app-breadcrumb-link">
              <Image src="/podcast-summarizer-icon.png" alt="PodSum logo" width={28} height={28} className="app-breadcrumb-logo" />
              <span>PodSum.cc</span>
            </Link>
            <span className="app-breadcrumb-divider">/</span>
            <span className="app-breadcrumb-current">Upload</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="inline-flex items-center rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-0.5">
              <button
                onClick={() => setThemeMode('light')}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  themeMode === 'light'
                    ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                }`}
              >
                Light Mode
              </button>
              <button
                onClick={() => setThemeMode('dark')}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  themeMode === 'dark'
                    ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                }`}
              >
                Dark Mode
              </button>
            </div>
            <Link href="/my" className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              Back to History
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow">
        <section className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8 w-full max-w-3xl mx-auto">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--heading)]">Upload SRT or YouTube</h1>
            <p className="text-sm text-[var(--text-muted)]">Signed in as <span className="font-semibold text-[var(--heading)]">{session?.user?.email}</span></p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="srtFile" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                SRT File Input
              </label>
              <input
                id="srtFile"
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
                onChange={(event) => setYoutubeUrl(event.target.value)}
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-medium)]"
                disabled={uploading}
              />
            </div>

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
                <p className="text-xs text-[var(--text-muted)] text-center">Uploading and queueing analysis...</p>
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
              {uploading ? 'Uploading...' : 'Upload & Process'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
