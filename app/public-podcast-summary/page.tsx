"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveFilePodcastTitle } from '../../lib/podcastTitle';
import { extractPodcastTags, normalizeDbTags } from '../../lib/podcastTags';

interface FileRecord {
  id: string;
  name: string;
  briefSummary: string | null;
  uploadDate: string;
  processed: boolean;
  processedAt?: string;
  isPublic: boolean;
  sourceReference?: string | null;
  wordCount?: number | null;
  durationSec?: number | null;
  tags: string[];
}

interface ApiPodcastRecord {
  id: string;
  title?: string | null;
  originalFileName?: string | null;
  briefSummary?: unknown;
  createdAt: string;
  isProcessed?: boolean;
  processedAt?: string | null;
  isPublic?: boolean;
  sourceReference?: string | null;
  wordCount?: number | null;
  durationSec?: number | null;
  tags?: unknown;
}

type ThemeMode = 'light' | 'dark';

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return 'Unknown';
  }
  const safe = Math.max(1, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${Math.max(1, minutes)}m`;
}

function inferDurationSec(wordCount: number | null | undefined): number | null {
  if (typeof wordCount !== 'number' || !Number.isFinite(wordCount) || wordCount <= 0) {
    return null;
  }
  return Math.max(60, Math.round((wordCount / 155) * 60));
}

function normalizeBriefSummary(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .replace(/#\s*English Summary/gi, ' ')
    .replace(/#\s*中文总结/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized : null;
}

export default function PublicPodcastSummaryPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => {
    async function fetchPublicFiles() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/podcasts?page=1&pageSize=50');
        if (!response.ok) {
          throw new Error('Failed to fetch public podcast list');
        }
        const result = await response.json();
        const dbRecords: FileRecord[] = (result.data as ApiPodcastRecord[]).map((item) => {
          const resolvedName =
            (typeof item.title === 'string' ? item.title.trim() : '') ||
            resolveFilePodcastTitle(String(item.originalFileName || ''));
          const dbTags = normalizeDbTags(item.tags);
          const fallbackTags = extractPodcastTags({
            title: resolvedName,
            sourceReference: item.sourceReference || null,
            fallbackName: item.originalFileName || null,
          });

          return {
            id: item.id,
            name: resolvedName,
            briefSummary: normalizeBriefSummary(item.briefSummary),
            uploadDate: item.createdAt,
            processed: item.isProcessed ?? false,
            processedAt: item.processedAt ?? undefined,
            isPublic: item.isPublic || false,
            sourceReference: item.sourceReference || null,
            wordCount: typeof item.wordCount === 'number' ? item.wordCount : null,
            durationSec:
              typeof item.durationSec === 'number'
                ? item.durationSec
                : inferDurationSec(typeof item.wordCount === 'number' ? item.wordCount : null),
            tags: dbTags.length > 0 ? dbTags : fallbackTags,
          };
        });
        setFiles(dbRecords);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setIsLoading(false);
      }
    }
    fetchPublicFiles();
  }, []);

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

  const normalizedQuery = useMemo(
    () => searchQuery.trim().replace(/^#/, '').toLowerCase(),
    [searchQuery]
  );

  const filteredFiles = useMemo(() => {
    if (!normalizedQuery) {
      return files;
    }
    return files.filter((item) => {
      const titleMatched = item.name.toLowerCase().includes(normalizedQuery);
      const tagMatched = item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      return titleMatched || tagMatched;
    });
  }, [files, normalizedQuery]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of files) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).slice(0, 18);
  }, [files]);

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col" data-theme={themeMode}>
      <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          {/* Breadcrumb Navigation */}
          <nav className="app-breadcrumb-nav w-full md:w-auto">
            <Link href="/" className="app-breadcrumb-link">
              <Image src="/podcast-summarizer-icon.png" alt="PodSum logo" width={28} height={28} className="app-breadcrumb-logo" />
              <span>PodSum.cc</span>
            </Link>
            <span className="app-breadcrumb-divider">/</span>
            <span className="app-breadcrumb-current max-w-[60vw] sm:max-w-[68vw] md:max-w-xl lg:max-w-2xl">Public Podcast Summary</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end w-full md:w-auto">
            <Link href="/my" className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              My Summaries
            </Link>
            <Link href="/upload" className="bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              + Upload SRT
            </Link>
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
          </div>
        </div>
      </header>
      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow">
        <div className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8">
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search keyword or #tag"
                className="w-full bg-transparent border-0 border-b border-[var(--border-soft)] px-0 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-medium)]"
              />
              {!isLoading && (
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {filteredFiles.length}/{files.length}
                </span>
              )}
            </div>
            {allTags.length > 0 && (
              <div className="overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-xs text-[var(--text-muted)]">
                {allTags.slice(0, 14).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSearchQuery(`#${tag}`)}
                    className={`mr-3 inline-flex hover:text-[var(--heading)] transition-colors ${
                      normalizedQuery && tag.toLowerCase().includes(normalizedQuery)
                        ? 'text-[var(--heading)] underline underline-offset-2'
                        : ''
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="border border-[#d8b7b7] bg-[#fff5f5] text-[var(--danger)] p-4 rounded-xl mb-6">
              <p className="font-medium">Error loading data</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)]"></div>
            </div>
          ) : files.length === 0 ? (
            <div className="bg-[var(--paper-subtle)] border border-[var(--border-soft)] rounded-xl p-8 text-center">
              <p className="text-[var(--text-muted)] mb-4">No public podcast summaries available.</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="bg-[var(--paper-subtle)] border border-[var(--border-soft)] rounded-xl p-8 text-center">
              <p className="text-[var(--text-muted)]">No results for &quot;{searchQuery.trim()}&quot;.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredFiles.map((file) => (
                <div key={file.id} className="bg-[var(--paper-base)] border border-[var(--border-soft)] rounded-xl p-4 hover:bg-[var(--paper-muted)] transition-colors">
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/${file.id}`} className="block">
                        <h3 className="font-semibold text-[var(--heading)] mb-2 whitespace-normal break-words leading-8" title={file.name}>
                          {file.name}
                        </h3>
                      </Link>
                      <p className="mb-2.5 text-sm leading-6 text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                        {file.briefSummary || (file.processed ? '暂无摘要。' : '摘要生成中...')}
                      </p>
                      <div className="flex gap-3 text-xs text-[var(--text-muted)] flex-wrap">
                        <span>Duration: {formatDuration(file.durationSec)}</span>
                        {file.isPublic && (
                          <span className="text-emerald-600">Public</span>
                        )}
                        {file.processed && (
                          <span className="text-emerald-600">✓ Processed</span>
                        )}
                        {!file.processed && (
                          <span className="text-amber-600">⟳ Processing</span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1.5">
                        Uploaded: {new Date(file.uploadDate).toLocaleString()}
                      </div>
                      {file.tags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {file.tags.map((tag) => (
                            <span
                              key={`${file.id}-${tag}`}
                              className="rounded-full border border-[var(--border-soft)] bg-[var(--paper-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Link
                      href={`/dashboard/${file.id}`}
                      className="shrink-0 bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] rounded-md px-3 py-1 text-xs hover:bg-[var(--paper-muted)] transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <footer className="p-4 text-center text-xs text-[var(--text-muted)]">
        PodSum.cc - Powered by Vercel
      </footer>
    </div>
  );
} 
