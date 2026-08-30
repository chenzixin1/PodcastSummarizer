import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { timingSafeEqual } from 'node:crypto';
import { authOptions } from '../auth';
import { authenticateMcpAccessToken, hasMcpScope, type McpScope } from '../mcpAccess';
import { WatchlessJobError } from './jobs';

export function watchlessErrorResponse(error: unknown): NextResponse {
  if (error instanceof WatchlessJobError) {
    return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.status });
  }
  console.error('[Watchless] Request failed:', error);
  return NextResponse.json({ success: false, code: 'WATCHLESS_ERROR', error: 'Watchless request failed.' }, { status: 500 });
}

function bearerToken(request: NextRequest): string {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

export async function requireWatchlessUser(
  request: NextRequest,
  scope?: McpScope | McpScope[],
): Promise<{ userId: string; source: 'session' | 'mcp' } | NextResponse> {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) return { userId: session.user.id, source: 'session' };

  const token = bearerToken(request);
  if (token) {
    const auth = await authenticateMcpAccessToken({
      token,
      ip: request.headers.get('cf-connecting-ip'),
      userAgent: request.headers.get('user-agent'),
    });
    if (!auth.success || !auth.data) {
      return NextResponse.json({ success: false, error: 'Invalid MCP token' }, { status: 403 });
    }
    const context = auth.data;
    const requestedScopes = scope ? (Array.isArray(scope) ? scope : [scope]) : [];
    const hasRequiredScope = requestedScopes.length === 0 || requestedScopes.some((item) => hasMcpScope(context, item));
    if (hasRequiredScope) {
      return { userId: context.userId, source: 'mcp' };
    }
    return NextResponse.json({
      success: false,
      error: requestedScopes.length ? `Missing one of these scopes: ${requestedScopes.join(', ')}` : 'Invalid MCP token',
    }, { status: 403 });
  }

  return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
}

export function requireInternalWatchless(request: NextRequest): NextResponse | null {
  const configured = process.env.WATCHLESS_INTERNAL_SECRET?.trim();
  const supplied = request.headers.get('x-watchless-internal-secret')?.trim();
  const configuredBytes = Buffer.from(configured || '');
  const suppliedBytes = Buffer.from(supplied || '');
  const matches = configuredBytes.length > 0 && configuredBytes.length === suppliedBytes.length && timingSafeEqual(configuredBytes, suppliedBytes);
  if (!matches) {
    return NextResponse.json({ success: false, error: 'Invalid internal Watchless signature.' }, { status: 403 });
  }
  return null;
}
