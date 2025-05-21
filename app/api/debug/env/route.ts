import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({
    openrouterKey: process.env.OPENROUTER_API_KEY ? 'Set (length: ' + process.env.OPENROUTER_API_KEY.length + ')' : 'Not set',
    openrouterModel: process.env.OPENROUTER_MODEL || 'Not set',
    blobToken: process.env.BLOB_READ_WRITE_TOKEN ? 'Set (length: ' + process.env.BLOB_READ_WRITE_TOKEN.length + ')' : 'Not set',
    postgresUrl: process.env.POSTGRES_URL ? 'Set (length: ' + process.env.POSTGRES_URL.length + ')' : 'Not set',
    nodeEnv: process.env.NODE_ENV || 'Not set'
  });
} 