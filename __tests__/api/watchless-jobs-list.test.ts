/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
jest.mock('next/server', () => jest.requireActual('next/server'));
import { GET } from '../../app/api/watchless/jobs/route';
import { requireWatchlessUser } from '../../lib/watchless/api';
import { listOwnedWatchlessJobs, pageOwnedWatchlessJobs } from '../../lib/watchless/jobs';
jest.mock('../../lib/watchless/api', () => ({ requireWatchlessUser: jest.fn(), watchlessErrorResponse: jest.fn(() => NextResponse.json({ success: false }, { status: 400 })) }));
jest.mock('../../lib/watchless/jobs', () => ({ listOwnedWatchlessJobs: jest.fn(), pageOwnedWatchlessJobs: jest.fn() }));
jest.mock('../../lib/watchless/workflow', () => ({ startWatchlessWorkflow: jest.fn() }));
describe('GET conversion history', () => {
  beforeEach(() => { jest.clearAllMocks(); (requireWatchlessUser as jest.Mock).mockResolvedValue({ userId: 'owner' }); });
  test('rejects anonymous access before querying', async () => {
    (requireWatchlessUser as jest.Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/api/watchless/jobs?page=1'))).status).toBe(401);
    expect(pageOwnedWatchlessJobs).not.toHaveBeenCalled();
  });
  test('uses authenticated owner, ignores supplied user id and disables caching', async () => {
    (pageOwnedWatchlessJobs as jest.Mock).mockResolvedValue({ jobs: [], pagination: { page: 2 } });
    const response = await GET(new NextRequest('http://localhost/api/watchless/jobs?page=2&status=failed&userId=other'));
    expect(pageOwnedWatchlessJobs).toHaveBeenCalledWith('owner', 2, 'failed');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ data: [], pagination: { page: 2 } });
  });
  test('keeps legacy array response for existing clients', async () => {
    (listOwnedWatchlessJobs as jest.Mock).mockResolvedValue([]);
    expect(await (await GET(new NextRequest('http://localhost/api/watchless/jobs'))).json()).toEqual({ success: true, data: [] });
    expect(listOwnedWatchlessJobs).toHaveBeenCalledWith('owner', 30);
  });
});
