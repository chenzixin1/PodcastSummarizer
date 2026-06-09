/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/process/enqueue/route';

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return {
    ...actual,
    after: jest.fn((callback: () => unknown) => {
      void callback();
    }),
  };
});

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/db', () => ({
  getAnalysisResults: jest.fn(),
  getPodcast: jest.fn(),
  verifyPodcastOwnership: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  enqueueProcessingJob: jest.fn(),
}));

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

const mockGetServerSession = jest.fn();
const mockGetPodcast = jest.fn();
const mockVerifyPodcastOwnership = jest.fn();
const mockGetAnalysisResults = jest.fn();
const mockEnqueueProcessingJob = jest.fn();
const mockTriggerWorkerProcessing = jest.fn();

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/process/enqueue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/process/enqueue', () => {
  const previousAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_EMAILS = 'chenzixin1@gmail.com';

    require('next-auth/next').getServerSession = mockGetServerSession;
    require('../../lib/db').getPodcast = mockGetPodcast;
    require('../../lib/db').verifyPodcastOwnership = mockVerifyPodcastOwnership;
    require('../../lib/db').getAnalysisResults = mockGetAnalysisResults;
    require('../../lib/processingJobs').enqueueProcessingJob = mockEnqueueProcessingJob;
    require('../../lib/workerTrigger').triggerWorkerProcessing = mockTriggerWorkerProcessing;

    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'admin-user-id',
        email: 'chenzixin1@gmail.com',
      },
    });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'pod-1',
        userId: 'owner-user-id',
      },
    });
    mockVerifyPodcastOwnership.mockResolvedValue({ success: false });
    mockGetAnalysisResults.mockResolvedValue({ success: false });
    mockEnqueueProcessingJob.mockResolvedValue({
      success: true,
      data: {
        podcastId: 'pod-1',
        status: 'queued',
      },
    });
    mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  });

  afterAll(() => {
    process.env.ADMIN_EMAILS = previousAdminEmails;
  });

  it('allows an admin to enqueue processing for a podcast they do not own', async () => {
    const response = await POST(buildRequest({ id: 'pod-1', force: true }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockVerifyPodcastOwnership).toHaveBeenCalledWith('pod-1', 'admin-user-id');
    expect(mockEnqueueProcessingJob).toHaveBeenCalledWith('pod-1');
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('manual_enqueue', 'pod-1');
  });

  it('still denies a non-owner who is not in the admin allowlist', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'other-user-id',
        email: 'other@example.com',
      },
    });

    const response = await POST(buildRequest({ id: 'pod-1', force: true }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Access denied');
    expect(mockEnqueueProcessingJob).not.toHaveBeenCalled();
  });
});
