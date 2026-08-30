jest.mock('../../lib/objectStorage', () => ({
  getObject: jest.fn(async () => new Response('ok')),
}));

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/[...key]/route';
import { getObject } from '../../lib/objectStorage';

const mockGetObject = getObject as jest.Mock;

describe('public object route', () => {
  beforeEach(() => jest.clearAllMocks());

  test('never exposes Watchless staging assets', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ key: ['watchless-staging', 'wl_secret', 'article.html'] }),
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
