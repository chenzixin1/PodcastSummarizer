import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../../lib/auth';
import { revokeMcpAccessToken } from '../../../../../../lib/mcpAccess';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await revokeMcpAccessToken({
    userId: session.user.id,
    tokenId: id,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || 'Failed to revoke MCP token' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
