/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { getAllPodcasts, getUserPodcasts } from '../../lib/db';

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/db', () => ({
  getAllPodcasts: jest.fn(),
  getUserPodcasts: jest.fn(),
}));

import { GET } from '../../app/api/podcasts/route';

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockGetAllPodcasts = getAllPodcasts as jest.MockedFunction<typeof getAllPodcasts>;
const mockGetUserPodcasts = getUserPodcasts as jest.MockedFunction<typeof getUserPodcasts>;

describe('Podcasts API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns public podcasts with default pagination', async () => {
    mockGetAllPodcasts.mockResolvedValueOnce({
      success: true,
      data: [{ id: '1', title: 'Public' }],
    });

    const request = new NextRequest('http://localhost:3000/api/podcasts');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 10, false);
    expect(mockGetServerSession).not.toHaveBeenCalled();
  });

  test('normalizes invalid pagination values', async () => {
    mockGetAllPodcasts.mockResolvedValueOnce({
      success: true,
      data: [],
    });

    const request = new NextRequest('http://localhost:3000/api/podcasts?page=0&pageSize=999');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetAllPodcasts).toHaveBeenCalledWith(1, 50, false);
  });

  test('requires auth for private podcasts', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/podcasts?includePrivate=true');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain('Authentication required');
    expect(mockGetUserPodcasts).not.toHaveBeenCalled();
  });

  test('returns private podcasts for authenticated user', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'u@example.com' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as never);

    mockGetUserPodcasts.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'private-1', title: 'Private' }],
    });

    const request = new NextRequest('http://localhost:3000/api/podcasts?includePrivate=true&page=2&pageSize=5');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetUserPodcasts).toHaveBeenCalledWith('user-1', 2, 5);
    expect(mockGetAllPodcasts).not.toHaveBeenCalled();
  });

  test('returns 500 when db returns failure payload', async () => {
    mockGetAllPodcasts.mockResolvedValueOnce({
      success: false,
      error: 'Database connection failed',
    });

    const request = new NextRequest('http://localhost:3000/api/podcasts');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Database connection failed');
  });

  test('returns 500 when db throws exception', async () => {
    mockGetAllPodcasts.mockRejectedValueOnce(new Error('Connection timeout'));

    const request = new NextRequest('http://localhost:3000/api/podcasts');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
    expect(data.details).toBe('Connection timeout');
  });
});
