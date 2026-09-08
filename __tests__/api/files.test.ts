/** @jest-environment node */
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn(async () => null) }));
jest.mock('../../lib/auth', () => ({ authOptions: {} }));
jest.mock('../../lib/objectAccess', () => ({ resolveObjectOwner: jest.fn(async () => ({ userId: 'owner', isPublic: true })) }));
jest.mock('../../lib/objectStorage', () => ({
  getObject: jest.fn(async () => new Response('ok')),
}));

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/[...key]/route';
import { getObject } from '../../lib/objectStorage';
import { resolveObjectOwner } from '../../lib/objectAccess';
import { getServerSession } from 'next-auth/next';

const mockGetObject = getObject as jest.Mock;

describe('public object route', () => {
  beforeEach(() => { jest.clearAllMocks();
    (resolveObjectOwner as jest.Mock).mockResolvedValue({ userId: 'owner', isPublic: true });
    (getServerSession as jest.Mock).mockResolvedValue(null);
  });

  test.each([null, { user: { id: 'stranger' } }])('denies private objects to %s', async session => {
    (resolveObjectOwner as jest.Mock).mockResolvedValue({ userId: 'owner', isPublic: false });
    (getServerSession as jest.Mock).mockResolvedValue(session);
    const response = await GET({} as NextRequest, { params: Promise.resolve({ key: ['private.txt'] }) });
    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });
  test('owner can read private objects without caching or active content', async () => {
    (resolveObjectOwner as jest.Mock).mockResolvedValue({ userId: 'owner', isPublic: false });
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'owner' } });
    const response = await GET({} as NextRequest, { params: Promise.resolve({ key: ['private.txt'] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
  });
  test('unknown files are not served', async () => {
    (resolveObjectOwner as jest.Mock).mockResolvedValue(null);
    expect((await GET({} as NextRequest, { params: Promise.resolve({ key: ['unknown.txt'] }) })).status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  test('never exposes Watchless staging assets', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ key: ['watchless-staging', 'wl_secret', 'article.html'] }),
    });
    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  test('never exposes retained Watchless run artifacts without owner authentication', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ key: ['watchless-runs', 'wl_secret', 'intermediate', 'asr-raw.json'] }),
    });
    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  test('continues serving published object paths', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ key: ['watchless', 'video123456', 'article.json'] }),
    });
    expect(response.status).toBe(200);
    expect(mockGetObject).toHaveBeenCalledWith('watchless/video123456/article.json');
  });
});
