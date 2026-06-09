import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../lib/auth';
import {
  DEFAULT_MCP_SCOPES,
  MCP_SCOPES,
  createMcpAccessToken,
  listMcpAccessTokens,
} from '../../../../../lib/mcpAccess';

function getMcpEndpointUrl(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
  if (configured) {
    return `${configured}/mcp`;
  }
  const url = new URL(request.url);
  return `${url.origin}/mcp`;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const result = await listMcpAccessTokens(session.user.id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to load MCP tokens' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      endpointUrl: getMcpEndpointUrl(request),
      scopes: MCP_SCOPES,
      defaultScopes: DEFAULT_MCP_SCOPES,
      tokens: result.data || [],
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await createMcpAccessToken({
    userId: session.user.id,
    name: typeof body?.name === 'string' ? body.name : 'Obsidian',
    vaultLabel: typeof body?.vaultLabel === 'string' ? body.vaultLabel : null,
    scopes: body?.scopes,
    expiresInDays: body?.expiresInDays,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to create MCP token' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.data }, { status: 201 });
}
