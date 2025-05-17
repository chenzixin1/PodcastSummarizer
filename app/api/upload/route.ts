import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (request.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.type !== 'application/x-subrip' && !file.name.endsWith('.srt')) {
    return NextResponse.json({ error: 'Invalid file type. Only .srt files are allowed.' }, { status: 400 });
  }

  try {
    const id = nanoid();
    const filename = `${id}-${file.name}`;

    console.log('Attempting to upload file:', filename);
    console.log('File type:', file.type);
    console.log('File size:', file.size);

    // Check if BLOB_READ_WRITE_TOKEN is configured
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn('BLOB_READ_WRITE_TOKEN not configured, using mock storage');
      
      // For testing purposes - store in localStorage via client-side
      return NextResponse.json({ 
        id, 
        blobUrl: '#mock-blob-url', 
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(2)} KB`
      }, { status: 200 });
    }

    // Upload to Vercel Blob
    const blob = await put(filename, file, {
      access: 'public',
      // Add any other options like contentType if needed
      // contentType: file.type, 
    });

    console.log('File uploaded successfully, URL:', blob.url);

    // In a real scenario, you'd save the id and blob.url to a database (KV, Redis, etc.)
    // For now, we just return them.

    return NextResponse.json({ 
      id, 
      blobUrl: blob.url,
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(2)} KB`
    }, { status: 200 });
  } catch (error) {
    console.error('Error uploading file:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: 'Failed to upload file.', details: errorMessage }, { status: 500 });
  }
} 