import { NextRequest } from 'next/server';
import { getObject } from '../../../../lib/objectStorage';

export async function GET(_request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  return getObject(key.join('/'));
}
