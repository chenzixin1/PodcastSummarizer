'use client';

import { useState, useEffect, useCallback } from 'react';
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

export default function HistoryPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 从数据库加载文件，并与localStorage中的缓存合并 (use useCallback to fix hook dependency issues)
  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 从API获取数据库中的数据
      const response = await fetch(`/api/podcasts?page=${page}&pageSize=20&includePrivate=true`);
      if (!response.ok) {
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
      
      // 合并本地缓存的记录（向后兼容）
      const localRecords: FileRecord[] = [];
      
      // 遍历localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        
        // 查找匹配我们SRT文件模式的键
        if (key && key.startsWith('srtfile-') && key.endsWith('-name')) {
          const id = key.replace('srtfile-', '').replace('-name', '');
          
          // 如果数据库中已有此记录，跳过
          if (dbRecords.some(record => record.id === id)) {
            continue;
          }
          
          const name = localStorage.getItem(key) || 'Unknown file';
          const size = localStorage.getItem(`srtfile-${id}-size`) || 'Unknown size';
          const url = localStorage.getItem(`srtfile-${id}-url`) || '';
          const processed = localStorage.getItem(`srtfile-${id}-processed`) === 'true';
          const processedAt = localStorage.getItem(`srtfile-${id}-processedAt`) || undefined;
          const isPublic = localStorage.getItem(`srtfile-${id}-isPublic`) === 'true';
          
          // 尝试查找上传日期（如果有存储），否则使用当前日期
          const uploadDate = localStorage.getItem(`srtfile-${id}-date`) || new Date().toISOString();
          
          localRecords.push({
            id,
            name,
            size,
            url,
            uploadDate,
            processed,
            processedAt,
            isPublic: isPublic || false
          });
        }
      }
      
      // 合并记录并更新状态
      const allRecords = [...dbRecords, ...localRecords];
      setFiles(prevFiles => {
        const newFiles = page === 1 
          ? allRecords 
          : [...prevFiles, ...allRecords.filter(newFile => 
              !prevFiles.some(prevFile => prevFile.id === newFile.id)
            )];
        return newFiles;
      });
    } catch (err) {
      console.error('Error loading files:', err);
      setError(err instanceof Error ? err.message : 'Failed to load files');
      
      // 如果API失败，至少尝试从localStorage加载
      loadLocalFiles();
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // 加载文件
    loadFiles();
  }, [page, loadFiles]);
  
  // 从localStorage加载数据的备用函数
  const loadLocalFiles = () => {
    const records: FileRecord[] = [];
    
    // 循环遍历localStorage键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      
      // 查找匹配我们SRT文件模式的键
      if (key && key.startsWith('srtfile-') && key.endsWith('-name')) {
        const id = key.replace('srtfile-', '').replace('-name', '');
        const name = localStorage.getItem(key) || 'Unknown file';
        const size = localStorage.getItem(`srtfile-${id}-size`) || 'Unknown size';
        const url = localStorage.getItem(`srtfile-${id}-url`) || '';
        const processed = localStorage.getItem(`srtfile-${id}-processed`) === 'true';
        const processedAt = localStorage.getItem(`srtfile-${id}-processedAt`) || undefined;
        const isPublic = localStorage.getItem(`srtfile-${id}-isPublic`) === 'true';
        
        // 尝试查找上传日期（如果有存储），否则使用当前日期
        const uploadDate = localStorage.getItem(`srtfile-${id}-date`) || new Date().toISOString();
        
        records.push({
          id,
          name,
          size,
          url,
          uploadDate,
          processed,
          processedAt,
          isPublic: isPublic || false
        });
      }
    }
    
    setFiles(records);
  };

  // 加载更多
  const loadMore = () => {
    setPage(prevPage => prevPage + 1);
  };

  // 排序和过滤文件
  const filteredAndSortedFiles = files
    .filter(file => {
      if (!searchQuery) return true;
      return file.name.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return sortDirection === 'asc' 
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        case 'size':
          // 解析大小字符串为数字（忽略单位）
          const getSize = (sizeStr: string) => {
            const match = sizeStr.match(/(\d+(\.\d+)?)/);
            return match ? parseFloat(match[1]) : 0;
          };
          return sortDirection === 'asc'
            ? getSize(a.size) - getSize(b.size)
            : getSize(b.size) - getSize(a.size);
        case 'date':
        default:
          return sortDirection === 'asc'
            ? new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime()
            : new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
      }
    });

  const toggleSort = (field: 'date' | 'name' | 'size') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc'); // 默认降序
    }
  };

  // 新增：切换公开状态
  const togglePublic = async (id: string, current: boolean) => {
    try {
      const response = await fetch(`/api/podcasts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !current }),
      });
      const result = await response.json();
      if (result.success) {
        setFiles(files => files.map(f => f.id === id ? { ...f, isPublic: !current } : f));
      } else {
        alert('Failed to update public status: ' + (result.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Network error while updating public status');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto">
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center space-x-2 text-lg">
            <Link href="/" className="text-sky-400 hover:underline font-semibold">PodSum.cc</Link>
            <span className="text-slate-400">/</span>
            <span className="text-white font-medium">History</span>
          </nav>
        </div>
      </header>
      
      <main className="container mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Your Uploaded Files</h2>
          <Link href="/upload" className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-6 rounded-md flex items-center">
            <span className="mr-1">+</span> Upload New File
          </Link>
        </div>
        
        {error && (
          <div className="bg-red-800/30 text-red-400 p-4 rounded-lg mb-6">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}
        
        {isLoading && page === 1 ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
          </div>
        ) : filteredAndSortedFiles.length === 0 ? (
          <div className="bg-slate-800/50 rounded-lg p-8 text-center">
            <p className="text-slate-400 mb-4">
              {searchQuery 
                ? 'No files match your search. Try a different search term.' 
                : 'You haven\'t uploaded any SRT files yet.'}
            </p>
            {!searchQuery && (
              <Link href="/upload" className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-4 rounded-md">
                Upload Your First File
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="relative w-full sm:w-auto flex-grow">
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-4 pr-10 py-2 rounded-md bg-slate-800 border border-slate-700 text-white w-full"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    ×
                  </button>
                )}
              </div>
              
              <div className="flex gap-2 text-xs">
                <button 
                  onClick={() => toggleSort('date')} 
                  className={`px-3 py-1.5 rounded ${sortBy === 'date' ? 'bg-sky-600' : 'bg-slate-800'}`}
                >
                  Date {sortBy === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button 
                  onClick={() => toggleSort('name')} 
                  className={`px-3 py-1.5 rounded ${sortBy === 'name' ? 'bg-sky-600' : 'bg-slate-800'}`}
                >
                  Name {sortBy === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button 
                  onClick={() => toggleSort('size')} 
                  className={`px-3 py-1.5 rounded ${sortBy === 'size' ? 'bg-sky-600' : 'bg-slate-800'}`}
                >
                  Size {sortBy === 'size' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
              </div>
            </div>
          
            <div className="grid grid-cols-1 gap-4">
              {filteredAndSortedFiles.map((file) => (
                <div key={file.id} className="bg-slate-800/50 rounded-lg p-4 hover:bg-slate-800 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-sky-400 mb-1 truncate" title={file.name}>
                        {file.name}
                      </h3>
                      <div className="flex gap-4 text-xs text-slate-400 flex-wrap items-center">
                        <span>{file.size}</span>
                        <span>ID: {file.id.substring(0, 6)}...</span>
                        <button
                          onClick={() => togglePublic(file.id, file.isPublic)}
                          className={`px-2 py-1 rounded text-xs font-medium ${file.isPublic ? 'bg-green-700 text-green-200' : 'bg-slate-700 text-slate-300'} hover:bg-sky-700 transition`}
                        >
                          {file.isPublic ? '公开中' : '设为公开'}
                        </button>
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
                      <Link href={`/dashboard/${file.id}`}>View</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {hasMore && (
              <div className="mt-6 text-center">
                <button 
                  onClick={loadMore}
                  disabled={isLoading}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2 rounded-md disabled:opacity-50"
                >
                  {isLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
      
      <footer className="p-4 text-center text-xs text-slate-600">
        PodSum.cc - Powered by Vercel
      </footer>
    </div>
  );
} 