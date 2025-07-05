'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
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

export default function MyPage() {
  const { data: session, status } = useSession();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 如果用户未登录，显示登录提示
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="bg-slate-800/50 backdrop-blur-md p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
          <h1 className="text-3xl font-bold text-sky-400 mb-4">Login Required</h1>
          <p className="text-slate-300 mb-6">
            You need to sign in to view your podcast summaries.
          </p>
          <div className="space-y-3">
            <Link 
              href="/auth/signin"
              className="block w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Sign In
            </Link>
            <Link 
              href="/auth/signup"
              className="block w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Create Account
            </Link>
            <Link 
              href="/"
              className="block text-sm text-slate-400 hover:text-sky-400"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 从数据库加载用户的文件
  const loadFiles = useCallback(async () => {
    if (!session?.user?.id) return;
    
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
      const dbRecords: FileRecord[] = result.data.map((item: { id: string; originalFileName: string; fileSize: string; blobUrl: string; isProcessed: boolean; createdAt: string; processedAt?: string; isPublic?: boolean; }) => ({
        id: item.id,
        name: item.originalFileName,
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
  }, [page, session?.user?.id]);

  useEffect(() => {
    if (session?.user?.id) {
      loadFiles();
    }
  }, [loadFiles, session?.user?.id]);

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
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto">
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center space-x-2 text-xl mb-4">
            <Link href="/" className="text-sky-400 hover:underline font-semibold">PodSum.cc</Link>
            <span className="text-slate-400">/</span>
            <span className="text-white font-medium">My Podcast Summaries</span>
          </nav>
          
          {/* User Info and Actions */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-slate-300">
              Signed in as: <span className="text-sky-400 font-medium">{session?.user?.email}</span>
            </div>
            <div className="flex items-center gap-3">
              <Link 
                href="/upload" 
                className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
              >
                + Upload New File
              </Link>
              <button
                onClick={handleSignOut}
                className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2 px-4 rounded-md transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">My Podcast Summaries</h2>
        </div>

        {/* 搜索和排序控件 */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="date">Sort by Date</option>
              <option value="name">Sort by Name</option>
              <option value="size">Sort by Size</option>
            </select>
            <button
              onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* 错误显示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-md text-red-200">
            {error}
          </div>
        )}

        {/* 文件列表 */}
        {isLoading && files.length === 0 ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
            <p className="text-slate-400">Loading your files...</p>
          </div>
        ) : filteredAndSortedFiles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-4">
              {searchQuery ? 'No files match your search.' : 'No files uploaded yet.'}
            </p>
            {!searchQuery && (
              <Link 
                href="/upload" 
                className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-6 rounded-md transition-colors"
              >
                Upload Your First File
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAndSortedFiles.map((file) => (
              <div key={file.id} className="bg-slate-800/50 backdrop-blur-md p-6 rounded-lg shadow-xl border border-slate-700">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">{file.name}</h3>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-400">
                      <span>Size: {file.size}</span>
                      <span>Uploaded: {new Date(file.uploadDate).toLocaleDateString()}</span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        file.processed 
                          ? 'bg-green-900/50 text-green-400' 
                          : 'bg-yellow-900/50 text-yellow-400'
                      }`}>
                        {file.processed ? 'Processed' : 'Pending'}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        file.isPublic 
                          ? 'bg-blue-900/50 text-blue-400' 
                          : 'bg-slate-700 text-slate-300'
                      }`}>
                        {file.isPublic ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link 
                      href={`/dashboard/${file.id}`}
                      className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            
            {/* 加载更多按钮 */}
            {hasMore && (
              <div className="text-center pt-6">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
} 