import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '../../../../lib/objectStorage';
import { resolveObjectOwner } from '../../../../lib/objectAccess';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { verifyAudioObjectSignature } from '../../../../lib/objectSigning';

export async function GET(_request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (key[0] === 'watchless-staging' || key[0] === 'watchless-runs') {
    return NextResponse.json({ error: 'Not found' }, {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  try {
    if (_request.nextUrl && verifyAudioObjectSignature(key.join('/'), _request.nextUrl.searchParams)) {
      const audio = await getObject(key.join('/'));
      audio.headers.set('Cache-Control', 'private, no-store');
      audio.headers.set('X-Content-Type-Options', 'nosniff');
      audio.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
      audio.headers.set('Content-Disposition', 'attachment');
      return audio;
    }
    const owner = await resolveObjectOwner(key.join('/'));
    const session = owner && !owner.isPublic ? await getServerSession(authOptions) : null;
    if (!owner || (!owner.isPublic && (!session?.user?.id || session.user.id !== owner.userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const response = await getObject(key.join('/'));
    // Visibility can change: never let a shared cache outlive the authorization check.
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    return response;
  } catch {
    return NextResponse.json({ error: 'File temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
