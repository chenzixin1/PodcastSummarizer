"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const router = useRouter();

  // 如果用户未登录，显示登录提示
  if (status === 'loading') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-24 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading...</p>
        </div>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-24 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="bg-slate-800/50 backdrop-blur-md p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
          <h1 className="text-3xl font-bold text-sky-400 mb-4">Login Required</h1>
          <p className="text-slate-300 mb-6">
            You need to sign in to upload and process SRT files.
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
      </main>
    );
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null); // Clear previous errors
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a .srt file to upload.');
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
    formData.append('file', file);
    formData.append('isPublic', isPublic.toString());
    formData.append('userId', session.user.id); // 添加用户ID

    try {
      // 第一步：上传文件
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.details || 'Upload failed');
      }

      setUploading(false);
      setUploadProgress(100);
      
      // Extract data from the nested response structure
      const { id } = result.data;
      
      console.log('File upload successful, redirecting to dashboard');
      
      // 上传成功后直接跳转到dashboard页面
      router.push(`/dashboard/${id}`);
    } catch (err) {
      console.error('Upload error:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred during upload.');
      }
      setUploading(false);
      setProcessing(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-24 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="bg-slate-800/50 backdrop-blur-md p-8 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-sky-400">Upload SRT File</h1>
          <Link href="/my" className="text-xs bg-slate-700 hover:bg-slate-600 py-1.5 px-3 rounded-md text-slate-300">
            Back to History
          </Link>
        </div>
        
        {/* 显示当前登录用户 */}
        <div className="mb-4 p-3 bg-slate-700/50 rounded-lg">
          <p className="text-sm text-slate-300">
            Signed in as: <span className="text-sky-400 font-medium">{session?.user?.email}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="srtFile" className="block text-sm font-medium text-slate-300 mb-1">
              SRT File Input
            </label>
            <input
              id="srtFile"
              name="srtFile"
              type="file"
              accept=".srt,application/x-subrip"
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-400 
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0
                         file:text-sm file:font-semibold
                         file:bg-sky-600 file:text-sky-50
                         hover:file:bg-sky-700
                         disabled:opacity-50 disabled:pointer-events-none"
              disabled={uploading || processing}
            />
             {file && (
              <p className="mt-2 text-xs text-slate-400">
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>
          
          <div className="flex items-center">
            <label className="flex items-center cursor-pointer">
              <div className="relative mr-2">
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={isPublic} 
                  onChange={() => setIsPublic(!isPublic)} 
                />
                <div className={`block w-10 h-6 rounded-full ${isPublic ? 'bg-sky-500' : 'bg-slate-600'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isPublic ? 'transform translate-x-full' : ''}`}></div>
              </div>
              <span className="text-sm text-slate-300">Make this analysis public</span>
            </label>
          </div>
          
          <p className="text-xs text-slate-400 italic">
            Public analyses can be viewed by anyone with the link.
          </p>

          {(uploading || processing) && (
            <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
              <div 
                className="bg-sky-500 h-2 rounded-full transition-all duration-500 ease-out" 
                style={{ width: `${processing ? 100 : uploadProgress}%` }}>
              </div>
              <p className="text-xs text-slate-400 mt-1 text-center">
                {uploading 
                  ? 'Uploading file...' 
                  : processing 
                  ? 'Processing with AI (this may take a moment)...' 
                  : ''}
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-md">Error: {error}</p>
          )}

          <button
            type="submit"
            disabled={uploading || processing || !file}
            className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-slate-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-75 transition duration-150 ease-in-out disabled:cursor-not-allowed"
          >
            {uploading 
              ? 'Uploading...' 
              : processing 
              ? 'Processing...' 
              : 'Upload & Process'}
          </button>
        </form>
      </div>
      <footer className="mt-12 text-center text-slate-500 text-sm">
        <p>Powered by Vercel Edge Functions & OpenRouter</p>
      </footer>
    </main>
  );
} 