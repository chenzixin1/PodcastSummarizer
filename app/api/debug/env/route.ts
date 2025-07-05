import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({
    openrouterKey: process.env.OPENROUTER_API_KEY ? 'Set (length: ' + process.env.OPENROUTER_API_KEY.length + ')' : 'Not set',
    openrouterModel: process.env.OPENROUTER_MODEL || 'Not set',
    blobToken: process.env.BLOB_READ_WRITE_TOKEN ? 'Set (length: ' + process.env.BLOB_READ_WRITE_TOKEN.length + ')' : 'Not set',
    postgresUrl: process.env.POSTGRES_URL ? 'Set (length: ' + process.env.POSTGRES_URL.length + ')' : 'Not set',
    nextauthSecret: process.env.NEXTAUTH_SECRET ? 'Set (length: ' + process.env.NEXTAUTH_SECRET.length + ')' : 'Not set',
    nextauthUrl: process.env.NEXTAUTH_URL || 'Not set',
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'Set (length: ' + process.env.GOOGLE_CLIENT_ID.length + ')' : 'Not set',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set (length: ' + process.env.GOOGLE_CLIENT_SECRET.length + ')' : 'Not set',
    nodeEnv: process.env.NODE_ENV || 'Not set'
  });
} 