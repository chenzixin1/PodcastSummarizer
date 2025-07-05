"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

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
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center space-x-2 text-lg">
            <Link href="/" className="text-sky-400 hover:underline font-semibold">PodSum.cc</Link>
            <span className="text-slate-400">/</span>
            <span className="text-white font-medium">Public Podcast Summary</span>
          </nav>
          <Link href="/upload" className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-6 rounded-md ml-4">
            + Upload SRT
          </Link>
        </div>
      </header>
      <main className="container mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">All Public Podcast Summaries</h2>
        {error && (
          <div className="bg-red-800/30 text-red-400 p-4 rounded-lg mb-6">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
          </div>
        ) : files.length === 0 ? (
          <div className="bg-slate-800/50 rounded-lg p-8 text-center">
            <p className="text-slate-400 mb-4">No public podcast summaries available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {files.map((file) => (
              <div key={file.id} className="bg-slate-800/50 rounded-lg p-4 hover:bg-slate-800 transition-colors">
                <Link href={`/dashboard/${file.id}`} className="block">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-sky-400 mb-1 truncate" title={file.name}>
                        {file.name}
                      </h3>
                      <div className="flex gap-4 text-xs text-slate-400 flex-wrap">
                        <span>{file.size}</span>
                        <span>ID: {file.id.substring(0, 6)}...</span>
                        {file.isPublic && (
                          <span className="text-green-400">Public</span>
                        )}
                        {file.processed && (
                          <span className="text-emerald-400">✓ Processed</span>
                        )}
                        {!file.processed && (
                          <span className="text-amber-400">⟳ Processing</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Uploaded: {new Date(file.uploadDate).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-slate-700 rounded-md px-3 py-1 text-xs">
                      View
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="p-4 text-center text-xs text-slate-600">
        PodSum.cc - Powered by Vercel
      </footer>
    </div>
  );
} 