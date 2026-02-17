import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../lib/adminGuard';

// This endpoint provides debugging information about the application
// Only enable in development or trusted environments

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdminAccess();
  if (!adminCheck.ok) {
    return adminCheck.response;
  }

  const safeHeaders = {
    'user-agent': request.headers.get('user-agent'),
    'x-forwarded-for': request.headers.get('x-forwarded-for'),
    'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
    host: request.headers.get('host'),
  };

  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);

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
    headers: safeHeaders,
    cookieNames,
    url: request.url,
    status: 'ok'
  };

  return NextResponse.json(debug);
}

export async function POST(request: NextRequest) {
  const adminCheck = await requireAdminAccess();
  if (!adminCheck.ok) {
    return adminCheck.response;
  }

  try {
    const body = await request.json();
    
    if (process.env.DEBUG_ENDPOINT_LOGS === 'true') {
      console.log('[CLIENT-DEBUG] Client debug received.');
    }
    
    return NextResponse.json({ 
      received: true, 
      bodyType: typeof body,
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
} 
