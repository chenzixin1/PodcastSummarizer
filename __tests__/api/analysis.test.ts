/**
 * @jest-environment node
 */

import { GET } from '../../app/api/analysis/[id]/route';
import { NextRequest } from 'next/server';

jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
  getAnalysisResults: jest.fn(),
  verifyPodcastOwnership: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  getProcessingJob: jest.fn(),
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

const { getPodcast, getAnalysisResults, verifyPodcastOwnership } = require('../../lib/db');
const { getProcessingJob } = require('../../lib/processingJobs');
const { getServerSession } = require('next-auth/next');
const { triggerWorkerProcessing } = require('../../lib/workerTrigger');

describe('/api/analysis/[id] API Route', () => {
  const mockId = 'test-podcast-123';

  beforeEach(() => {
    jest.clearAllMocks();
    getProcessingJob.mockResolvedValue({ success: false, data: null });
    getServerSession.mockResolvedValue(null);
    verifyPodcastOwnership.mockResolvedValue({ success: true });
    triggerWorkerProcessing.mockResolvedValue({ success: true });
  });

  it('returns podcast and analysis data when both exist', async () => {
    getPodcast.mockResolvedValue({
      success: true,
      data: {
        id: mockId,
        originalFileName: 'test.srt',
        fileSize: '1.2 KB',
        blobUrl: 'blob:test-url',
        isPublic: true,
        userId: 'owner',
      },
    });

    getAnalysisResults.mockResolvedValue({
      success: true,
      data: {
        podcastId: mockId,
        summary: 'Test summary',
        summaryZh: '测试总结',
        summaryEn: 'Test summary in English',
        translation: 'Test translation',
        highlights: 'Test highlights',
        fullTextBilingualJson: { version: 1, pairs: [] },
        summaryBilingualJson: { version: 1, sections: [] },
        bilingualAlignmentVersion: 1,
        processedAt: '2024-01-01T00:00:00Z',
      },
    });

    const request = new NextRequest('http://localhost/api/analysis/test-podcast-123');
    const context = { params: Promise.resolve({ id: mockId }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.isProcessed).toBe(true);
    expect(data.data.podcast.id).toBe(mockId);
    expect(data.data.analysis.summary).toBe('Test summary');
    expect(data.data.analysis.fullTextBilingualJson).toEqual({ version: 1, pairs: [] });
    expect(data.data.analysis.summaryBilingualJson).toEqual({ version: 1, sections: [] });
    expect(data.data.analysis.bilingualAlignmentVersion).toBe(1);
  });

  it('returns podcast data without analysis when analysis does not exist', async () => {
    getPodcast.mockResolvedValue({
      success: true,
      data: {
        id: mockId,
        originalFileName: 'test.srt',
        fileSize: '1.2 KB',
        blobUrl: 'blob:test-url',
        isPublic: true,
      },
    });

    getAnalysisResults.mockResolvedValue({
      success: false,
      error: 'Analysis results not found',
    });

    const request = new NextRequest('http://localhost/api/analysis/test-podcast-123');
    const context = { params: Promise.resolve({ id: mockId }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.isProcessed).toBe(false);
    expect(data.data.podcast.id).toBe(mockId);
    expect(data.data.analysis).toBe(null);
  });

  it('returns 404 when podcast does not exist', async () => {
    getPodcast.mockResolvedValue({
      success: false,
      error: 'Podcast not found',
    });

    const request = new NextRequest('http://localhost/api/analysis/test-podcast-123');
    const context = { params: Promise.resolve({ id: mockId }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Podcast not found');
  });

  it('returns 400 when ID is missing', async () => {
    const request = new NextRequest('http://localhost/api/analysis/');
    const context = { params: Promise.resolve({ id: '' }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing ID parameter');
  });

  it('handles database errors gracefully', async () => {
    getPodcast.mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost/api/analysis/test-podcast-123');
    const context = { params: Promise.resolve({ id: mockId }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Database connection failed');
  });
});
