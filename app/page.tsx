'use client';

import { useState, ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from "next/image";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.details || 'Upload failed');
      }

      // Assuming the API returns { id: string, blobUrl: string }
      if (result.id) {
        router.push(`/dashboard/${result.id}`);
      } else {
        throw new Error('Upload succeeded but no ID was returned.');
      }

    } catch (err) {
      console.error('Upload error:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred during upload.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="bg-slate-800/50 backdrop-blur-md p-8 rounded-xl shadow-2xl w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-sky-400">Upload SRT File</h1>
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
              disabled={uploading}
            />
             {file && (
              <p className="mt-2 text-xs text-slate-400">
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-md">Error: {error}</p>
          )}

          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-slate-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-75 transition duration-150 ease-in-out disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Upload & Process'}
          </button>
        </form>
      </div>
      <footer className="mt-12 text-center text-slate-500 text-sm">
        <p>Powered by Vercel Edge Functions & OpenRouter</p>
      </footer>
    </main>
  );
}
