'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { resolveFilePodcastTitle } from '../../lib/podcastTitle';

interface FileRecord {
  id: string;
  name: string;
  briefSummary: string | null;
  size: string;
  url: string;
  uploadDate: string;
  processed: boolean;
  processedAt?: string;
  isPublic: boolean;
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

export default function MyPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const userId = session?.user?.id ?? null;
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 从数据库加载用户的文件
  const loadFiles = useCallback(async () => {
    if (!userId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // 从API获取当前用户的数据
      const response = await fetch(`/api/podcasts?page=${page}&pageSize=20&includePrivate=true`);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please sign in again.');
        }
        throw new Error('Failed to fetch podcast list');
      }
      
      const result = await response.json();
      const dbRecords: FileRecord[] = result.data.map((item: { id: string; title?: string | null; briefSummary?: string | null; originalFileName: string; fileSize: string; blobUrl: string; isProcessed: boolean; createdAt: string; processedAt?: string; isPublic?: boolean; }) => ({
        id: item.id,
        name:
          (typeof item.title === 'string' ? item.title.trim() : '') ||
          resolveFilePodcastTitle(String(item.originalFileName || '')),
        briefSummary: normalizeBriefSummary(item.briefSummary),
        size: item.fileSize,
        url: item.blobUrl,
        uploadDate: item.createdAt,
        processed: item.isProcessed,
        processedAt: item.processedAt,
        isPublic: item.isPublic || false
      }));
      
      // 检查是否还有更多数据
      setHasMore(dbRecords.length === 20);
      
      // 更新状态
      setFiles(prevFiles => {
        const newFiles = page === 1 
          ? dbRecords 
          : [...prevFiles, ...dbRecords.filter(newFile => 
              !prevFiles.some(prevFile => prevFile.id === newFile.id)
            )];
        return newFiles;
      });
    } catch (error) {
      console.error('加载文件失败:', error);
      setError(error instanceof Error ? error.message : '加载文件失败');
    } finally {
      setIsLoading(false);
    }
  }, [page, userId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin?callbackUrl=/my');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated' && userId) {
      loadFiles();
    }
  }, [status, loadFiles, userId]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  // 过滤和排序文件
  const filteredAndSortedFiles = files
    .filter(file => 
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          const aSizeKB = parseFloat(a.size.replace(' KB', ''));
          const bSizeKB = parseFloat(b.size.replace(' KB', ''));
          comparison = aSizeKB - bSizeKB;
          break;
        case 'date':
        default:
          comparison = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  const handleLoadMore = () => {
    setPage(prev => prev + 1);
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: '/' });
  };

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <nav className="app-breadcrumb-nav w-full md:w-auto">
            <Link href="/" className="app-breadcrumb-link">
              <Image src="/podcast-summarizer-icon.png" alt="PodSum logo" width={28} height={28} className="app-breadcrumb-logo" />
              <span>PodSum.cc</span>
            </Link>
            <span className="app-breadcrumb-divider">/</span>
            <span className="app-breadcrumb-current">My Podcast Summaries</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end w-full md:w-auto">
            <Link
              href="/upload"
              className="bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors"
            >
              + Upload New File
            </Link>
            <button
              onClick={handleSignOut}
              className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow">
        <div className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8">
          <div className="mb-5 space-y-3">
            <div className="text-sm text-[var(--text-secondary)]">
              Signed in as: <span className="font-semibold text-[var(--heading)]">{session?.user?.email}</span>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 min-w-0 md:w-[320px]">
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-0 border-b border-[var(--border-soft)] px-0 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-medium)]"
                />
                {!isLoading && (
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">
                    {filteredAndSortedFiles.length}/{files.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
                  className="px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] text-sm text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-medium)]"
                >
                  <option value="date">Date</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
                <button
                  onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] text-sm text-[var(--text-secondary)] hover:bg-[var(--paper-muted)] transition-colors"
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-6 border border-[#d8b7b7] bg-[#fff5f5] text-[var(--danger)] p-4 rounded-xl">
              {error}
            </div>
          )}

          {isLoading && files.length === 0 ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
              <p className="text-[var(--text-muted)]">Loading your files...</p>
            </div>
          ) : filteredAndSortedFiles.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--text-muted)] mb-4">
                {searchQuery ? 'No files match your search.' : 'No files uploaded yet.'}
              </p>
              {!searchQuery && (
                <Link
                  href="/upload"
                  className="inline-block bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] font-medium py-2 px-6 rounded-lg transition-colors"
                >
                  Upload Your First File
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAndSortedFiles.map((file) => (
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
                      <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
                        <span>Size: {file.size}</span>
                        {file.processed && (
                          <span className="text-emerald-600">✓ Processed</span>
                        )}
                        {!file.processed && (
                          <span className="text-amber-600">⟳ Processing</span>
                        )}
                        <span className={file.isPublic ? 'text-emerald-600' : 'text-[var(--text-secondary)]'}>
                          {file.isPublic ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1.5">
                        Uploaded: {new Date(file.uploadDate).toLocaleString()}
                      </div>
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

              {hasMore && (
                <div className="text-center pt-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoading}
                    className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 
