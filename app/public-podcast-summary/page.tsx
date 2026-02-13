"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface FileRecord {
  id: string;
  name: string;
  size: string;
  url: string;
  uploadDate: string;
  processed: boolean;
  processedAt?: string;
  isPublic: boolean;
}

export default function PublicPodcastSummaryPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const dbRecords: FileRecord[] = result.data.map((item: any) => ({
          id: item.id,
          name: item.originalFileName,
          size: item.fileSize,
          url: item.blobUrl,
          uploadDate: item.createdAt,
          processed: item.isProcessed,
          processedAt: item.processedAt,
          isPublic: item.isPublic || false,
        }));
        setFiles(dbRecords);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        setIsLoading(false);
      }
    }
    fetchPublicFiles();
  }, []);

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center space-x-2 text-lg sm:text-xl min-w-0">
            <Link href="/" className="inline-flex items-center gap-2 text-[var(--heading)] hover:text-[var(--text-main)] transition-colors font-semibold shrink-0">
              <Image src="/podcast-summarizer-icon.svg" alt="PodSum logo" width={22} height={22} />
              <span>PodSum.cc</span>
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-main)] font-medium truncate">Public Podcast Summary</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Link href="/my" className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              My Summaries
            </Link>
            <Link href="/upload" className="bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              + Upload SRT
            </Link>
          </div>
        </div>
      </header>
      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow">
        <div className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8">
          <h2 className="text-2xl font-bold mb-6 text-[var(--heading)]">All Public Podcast Summaries</h2>
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
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {files.map((file) => (
              <div key={file.id} className="bg-[var(--paper-base)] border border-[var(--border-soft)] rounded-xl p-4 hover:bg-[var(--paper-muted)] transition-colors">
                <Link href={`/dashboard/${file.id}`} className="block">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-[var(--heading)] mb-1 truncate" title={file.name}>
                        {file.name}
                      </h3>
                      <div className="flex gap-4 text-xs text-[var(--text-muted)] flex-wrap">
                        <span>{file.size}</span>
                        <span>ID: {file.id.substring(0, 6)}...</span>
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
                      <div className="text-xs text-[var(--text-muted)] mt-1">
                        Uploaded: {new Date(file.uploadDate).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] rounded-md px-3 py-1 text-xs">
                      View
                    </div>
                  </div>
                </Link>
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
