/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { GET } from '../../app/api/watchless/jobs/[id]/assets/[assetId]/route';
import { getObject } from '../../lib/objectStorage';
import { getOwnedWatchlessJob, listWatchlessJobAssets } from '../../lib/watchless/jobs';

jest.mock('../../lib/objectStorage', () => ({ getObject: jest.fn() }));
jest.mock('../../lib/watchless/jobs', () => ({
  getOwnedWatchlessJob: jest.fn(),
  listWatchlessJobAssets: jest.fn(),
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../lib/auth', () => ({ authOptions: {} }));
jest.mock('../../lib/mcpAccess', () => ({
  authenticateMcpAccessToken: jest.fn(),
  hasMcpScope: jest.fn(),
}));

const mockGetObject = getObject as jest.MockedFunction<typeof getObject>;
const mockGetOwnedWatchlessJob = getOwnedWatchlessJob as jest.MockedFunction<typeof getOwnedWatchlessJob>;
const mockListWatchlessJobAssets = listWatchlessJobAssets as jest.MockedFunction<typeof listWatchlessJobAssets>;
const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

const asset = {
  id: 'wla_asset1', jobId: 'wl_job1', assetPath: 'intermediate/asr-raw.json', role: 'manifest' as const,
  objectKey: 'watchless-runs/wl_job1/intermediate/asr-raw.json', contentType: 'application/json',
  sizeBytes: 12, sha256: 'a'.repeat(64), status: 'uploaded' as const,
  createdAt: '2026-09-03T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z',
};

describe('owned Watchless run artifact download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockGetOwnedWatchlessJob.mockResolvedValue({ id: 'wl_job1', userId: 'user-1' } as never);
    mockListWatchlessJobAssets.mockResolvedValue([asset]);
    mockGetObject.mockResolvedValue(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  });

  test('streams a retained artifact only through the authenticated job route', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/watchless/jobs/wl_job1/assets/wla_asset1'),
      { params: Promise.resolve({ id: 'wl_job1', assetId: 'wla_asset1' }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('asr-raw.json');
    expect(mockGetObject).toHaveBeenCalledWith(asset.objectKey);
  });

  test('returns 404 when the task is not owned by the caller', async () => {
    mockGetOwnedWatchlessJob.mockResolvedValue(null);
    const response = await GET(
      new NextRequest('http://localhost/api/watchless/jobs/wl_job1/assets/wla_asset1'),
      { params: Promise.resolve({ id: 'wl_job1', assetId: 'wla_asset1' }) },
    );
    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});
