'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface FileRecord {
  id: string;
  name: string;
  size: string;
  url: string;
  uploadDate: string;
  processed: boolean;
  processedAt?: string;
}

export default function HistoryPage() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    // Load files from localStorage
    const loadFiles = () => {
      const records: FileRecord[] = [];
      
      // Loop through localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        
        // Look for keys that match our SRT file pattern
        if (key && key.startsWith('srtfile-') && key.endsWith('-name')) {
          const id = key.replace('srtfile-', '').replace('-name', '');
          const name = localStorage.getItem(key) || 'Unknown file';
          const size = localStorage.getItem(`srtfile-${id}-size`) || 'Unknown size';
          const url = localStorage.getItem(`srtfile-${id}-url`) || '';
          const processed = localStorage.getItem(`srtfile-${id}-processed`) === 'true';
          const processedAt = localStorage.getItem(`srtfile-${id}-processedAt`) || undefined;
          
          // Try to find upload date if we stored it, or use "Unknown date"
          const uploadDate = localStorage.getItem(`srtfile-${id}-date`) || new Date().toISOString();
          
          records.push({
            id,
            name,
            size,
            url,
            uploadDate,
            processed,
            processedAt,
          });
        }
      }
      
      setFiles(records);
      setIsLoading(false);
    };
    
    loadFiles();
  }, []);

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

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold text-sky-400">SRT Processor / History</h1>
          <Link href="/" className="text-sm bg-sky-600 hover:bg-sky-700 py-2 px-4 rounded-md">
            Upload New File
          </Link>
        </div>
      </header>
      
      <main className="container mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Your Uploaded Files</h2>
          <Link href="/upload" className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-6 rounded-md flex items-center">
            <span className="mr-1">+</span> Upload New File
          </Link>
        </div>
        
        {isLoading ? (
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
              <Link href="/" className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-4 rounded-md">
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
                  <Link href={`/dashboard/${file.id}`} className="block">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium text-sky-400 mb-1 truncate" title={file.name}>
                          {file.name}
                        </h3>
                        <div className="flex gap-4 text-xs text-slate-400">
                          <span>{file.size}</span>
                          <span>ID: {file.id.substring(0, 8)}...</span>
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
          </>
        )}
      </main>
      
      <footer className="p-4 text-center text-xs text-slate-600">
        SRT Processor Edge Demo
      </footer>
    </div>
  );
} 