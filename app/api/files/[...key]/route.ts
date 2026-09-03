import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '../../../../lib/objectStorage';

export async function GET(_request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (key[0] === 'watchless-staging' || key[0] === 'watchless-runs') {
    return NextResponse.json({ error: 'Not found' }, {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return getObject(key.join('/'));
}
