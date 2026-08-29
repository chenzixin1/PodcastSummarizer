/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { GET } from '../../app/api/watchless/[id]/route';
import { getPodcast, verifyPodcastOwnership } from '../../lib/db';
import {
  getStoredWatchlessPublication,
  loadStoredWatchlessArticle,
} from '../../lib/watchless/repository';
import sampleFixture from '../../lib/watchless/sampleArticle.json';

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
  verifyPodcastOwnership: jest.fn(),
}));

jest.mock('../../lib/watchless/repository', () => ({
  getStoredWatchlessPublication: jest.fn(),
  loadStoredWatchlessArticle: jest.fn(),
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockGetPodcast = getPodcast as jest.MockedFunction<typeof getPodcast>;
const mockVerifyPodcastOwnership = verifyPodcastOwnership as jest.MockedFunction<typeof verifyPodcastOwnership>;
const mockGetStoredWatchlessPublication = getStoredWatchlessPublication as jest.MockedFunction<typeof getStoredWatchlessPublication>;
const mockLoadStoredWatchlessArticle = loadStoredWatchlessArticle as jest.MockedFunction<typeof loadStoredWatchlessArticle>;

const publication = {
  podcastId: 'watchless-test-video',
  videoId: 'testVideo01',
  articleKey: 'watchless/testVideo01/article.json',
  sceneCount: 12,
  durationLabel: '53 分钟',
  hasEnglishTranscript: false,
};

describe('/api/watchless/[id] API route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockVerifyPodcastOwnership.mockResolvedValue({ success: false });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: { id: publication.podcastId, isPublic: true, userId: 'owner-1' },
    });
    mockGetStoredWatchlessPublication.mockResolvedValue(publication);
    mockLoadStoredWatchlessArticle.mockResolvedValue({
      ...sampleFixture,
      id: publication.podcastId,
      videoId: publication.videoId,
    });
  });

  it('returns lightweight metadata without loading the article', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/watchless/${publication.podcastId}?meta=1`),
      { params: Promise.resolve({ id: publication.podcastId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('public');
    expect(body.data.articleMeta).toEqual({
      sceneCount: 12,
      durationLabel: '53 分钟',
      hasEnglishTranscript: false,
    });
    expect(mockLoadStoredWatchlessArticle).not.toHaveBeenCalled();
  });

  it('loads the article only for the full request', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/watchless/${publication.podcastId}`),
      { params: Promise.resolve({ id: publication.podcastId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.article.videoId).toBe(publication.videoId);
    expect(mockLoadStoredWatchlessArticle).toHaveBeenCalledWith(publication);
  });

  it('does not expose a private article to an anonymous visitor', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: { id: publication.podcastId, isPublic: false, userId: 'owner-1' },
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/watchless/${publication.podcastId}`),
      { params: Promise.resolve({ id: publication.podcastId }) },
    );

    expect(response.status).toBe(401);
    expect(mockGetStoredWatchlessPublication).not.toHaveBeenCalled();
  });

  it('allows the owner to load a private article without public caching', async () => {
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: { id: publication.podcastId, isPublic: false, userId: 'owner-1' },
    });
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    mockVerifyPodcastOwnership.mockResolvedValue({ success: true });

    const response = await GET(
      new NextRequest(`http://localhost/api/watchless/${publication.podcastId}?meta=1`),
      { params: Promise.resolve({ id: publication.podcastId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns 404 when the podcast has no publication', async () => {
    mockGetStoredWatchlessPublication.mockResolvedValue(null);
    const response = await GET(
      new NextRequest('http://localhost/api/watchless/ordinary-podcast'),
      { params: Promise.resolve({ id: 'ordinary-podcast' }) },
    );
    expect(response.status).toBe(404);
  });
});
