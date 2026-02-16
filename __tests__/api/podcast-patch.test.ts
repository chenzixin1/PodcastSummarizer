/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { PATCH } from '../../app/api/podcasts/[id]/route';

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
  verifyPodcastOwnership: jest.fn(),
  updatePodcastMetadata: jest.fn(),
}));

const mockGetServerSession = jest.fn();
const mockGetPodcast = jest.fn();
const mockVerifyPodcastOwnership = jest.fn();
const mockUpdatePodcastMetadata = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('next-auth/next').getServerSession = mockGetServerSession;
  require('../../lib/db').getPodcast = mockGetPodcast;
  require('../../lib/db').verifyPodcastOwnership = mockVerifyPodcastOwnership;
  require('../../lib/db').updatePodcastMetadata = mockUpdatePodcastMetadata;

  mockGetServerSession.mockResolvedValue({
    user: {
      id: 'user-1',
    },
  });
  mockGetPodcast.mockResolvedValue({
    success: true,
    data: {
      id: 'pod-1',
      userId: 'user-1',
    },
  });
  mockVerifyPodcastOwnership.mockResolvedValue({ success: true });
  mockUpdatePodcastMetadata.mockResolvedValue({
    success: true,
    data: {
      id: 'pod-1',
      isPublic: true,
      sourceReference: 'https://www.youtube.com/watch?v=abc123xyz00',
    },
  });
});

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/podcasts/pod-1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/podcasts/[id]', () => {
  it('should not clear sourceReference when only updating isPublic', async () => {
    const response = await PATCH(buildRequest({ isPublic: true }), {
      params: Promise.resolve({ id: 'pod-1' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdatePodcastMetadata).toHaveBeenCalledWith('pod-1', {
      isPublic: true,
    });
  });

  it('should trim and persist sourceReference when provided', async () => {
    const response = await PATCH(
      buildRequest({
        sourceReference: '  https://www.youtube.com/watch?v=abc123xyz00  ',
      }),
      {
        params: Promise.resolve({ id: 'pod-1' }),
      },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdatePodcastMetadata).toHaveBeenCalledWith('pod-1', {
      sourceReference: 'https://www.youtube.com/watch?v=abc123xyz00',
    });
  });
});

