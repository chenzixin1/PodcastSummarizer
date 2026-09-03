/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { POST } from '../../app/api/watchless/jobs/[id]/retry/route';
import { failWatchlessJob, retryWatchlessUrlJob } from '../../lib/watchless/jobs';
import { startWatchlessWorkflow } from '../../lib/watchless/workflow';

jest.mock('next/server', () => jest.requireActual('next/server'));
jest.mock('../../lib/watchless/jobs', () => ({
  WatchlessJobError: class WatchlessJobError extends Error {
    constructor(public code: string, message: string, public status = 400) { super(message); }
  },
  retryWatchlessUrlJob: jest.fn(),
  failWatchlessJob: jest.fn(),
}));
jest.mock('../../lib/watchless/workflow', () => ({ startWatchlessWorkflow: jest.fn() }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../lib/auth', () => ({ authOptions: {} }));
jest.mock('../../lib/mcpAccess', () => ({
  authenticateMcpAccessToken: jest.fn(),
  hasMcpScope: jest.fn(),
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockRetry = retryWatchlessUrlJob as jest.MockedFunction<typeof retryWatchlessUrlJob>;
const mockFail = failWatchlessJob as jest.MockedFunction<typeof failWatchlessJob>;
const mockStart = startWatchlessWorkflow as jest.MockedFunction<typeof startWatchlessWorkflow>;

describe('Watchless failed-job retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockRetry.mockResolvedValue({ id: 'wl_job1', status: 'queued' } as never);
    mockStart.mockResolvedValue('watchless-wl_job1-attempt');
  });

  test('reserves the same job and starts a uniquely identified workflow attempt', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/watchless/jobs/wl_job1/retry', { method: 'POST' }),
      { params: Promise.resolve({ id: 'wl_job1' }) },
    );
    expect(response.status).toBe(202);
    expect(mockRetry).toHaveBeenCalledWith('wl_job1', 'user-1');
    expect(mockStart).toHaveBeenCalledWith('wl_job1', 'url', { uniqueAttempt: true });
    expect(await response.json()).toMatchObject({ success: true, data: { workflowInstanceId: 'watchless-wl_job1-attempt' } });
  });

  test('fails and refunds the re-reserved job when Workflow cannot restart', async () => {
    mockStart.mockRejectedValue(new Error('workflow unavailable'));
    mockFail.mockResolvedValue({ id: 'wl_job1', status: 'failed', creditStatus: 'refunded' } as never);
    const response = await POST(
      new NextRequest('http://localhost/api/watchless/jobs/wl_job1/retry', { method: 'POST' }),
      { params: Promise.resolve({ id: 'wl_job1' }) },
    );
    expect(response.status).toBe(500);
    expect(mockFail).toHaveBeenCalledWith('wl_job1', 'WORKFLOW_RETRY_START_FAILED', 'workflow unavailable');
  });
});
