import { NextRequest, NextResponse } from 'next/server';

// This endpoint provides debugging information about the application
// Only enable in development or trusted environments

export async function GET(request: NextRequest) {
  const debug = {
    version: '1.0.1',
    environment: process.env.VERCEL_ENV || 'local',
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage ? process.memoryUsage() : 'Not available',
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    headers: Object.fromEntries(request.headers.entries()),
    cookies: request.cookies.getAll(),
    url: request.url,
    status: 'ok'
  };

  return NextResponse.json(debug);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Log client-side errors/debug info
    console.log(`[CLIENT-DEBUG] Client debug received:`, body);
    
    return NextResponse.json({ 
      received: true, 
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
} 