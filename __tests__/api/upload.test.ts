/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/upload/route';

jest.mock('nanoid', () => ({
  nanoid: jest.fn(),
}));

jest.mock('../../lib/podcastUploadPipeline', () => {
  class MockPodcastUploadError extends Error {
    code: string;
    status: number;
    details?: string;

    constructor(code: string, status: number, message: string, details?: string) {
      super(message);
      this.name = 'PodcastUploadError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  return {
    createPodcastFromSrt: jest.fn(),
    PodcastUploadError: MockPodcastUploadError,
  };
});

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/apifyTranscript', () => {
  class MockApifyTranscriptError extends Error {
    code: string;
    status: number;
    details?: string;

    constructor(code: string, status: number, message: string, details?: string) {
      super(message);
      this.name = 'ApifyTranscriptError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  return {
    fetchYoutubeSrtViaApify: jest.fn(),
    ApifyTranscriptError: MockApifyTranscriptError,
  };
});

const mockNanoid = jest.fn();
const mockCreatePodcastFromSrt = jest.fn();
const mockTriggerWorkerProcessing = jest.fn();
const mockGetServerSession = jest.fn();
const mockFetchYoutubeSrtViaApify = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('nanoid').nanoid = mockNanoid;
  require('../../lib/podcastUploadPipeline').createPodcastFromSrt = mockCreatePodcastFromSrt;
  require('../../lib/workerTrigger').triggerWorkerProcessing = mockTriggerWorkerProcessing;
  require('next-auth/next').getServerSession = mockGetServerSession;
  require('../../lib/apifyTranscript').fetchYoutubeSrtViaApify = mockFetchYoutubeSrtViaApify;

  mockNanoid.mockReturnValue('mock-id-12345');
  mockCreatePodcastFromSrt.mockResolvedValue({
    id: 'mock-id-12345',
    blobUrl: 'https://podsum.cc/api/files/mock-id-12345-test.srt',
    objectKey: 'mock-id-12345-test.srt',
    originalFileName: 'test.srt',
    fileSize: '0.01 KB',
    remainingCredits: 9,
    processingQueued: true,
    processingJob: { podcastId: 'mock-id-12345', status: 'queued' },
    queueError: null,
  });
  mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  mockGetServerSession.mockResolvedValue({
    user: {
      id: 'user-001',
      email: 'tester@example.com',
    },
  });
});

describe('Upload API Tests', () => {
  it('should successfully upload valid SRT file', async () => {
    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe('mock-id-12345');
    expect(data.data.youtubeIngest).toBeUndefined();
    expect(mockFetchYoutubeSrtViaApify).not.toHaveBeenCalled();
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-id-12345',
        title: 'test',
        originalFileName: 'test.srt',
        sourcePublishedAt: null,
        tags: undefined,
      }),
    );
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('upload', 'mock-id-12345');
  });

  it('should pass trimmed optional metadata through to the upload pipeline', async () => {
    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourcePublishedAt', ' 2026-07-09T10:30:00.000Z ');
    formData.append('channelName', '  Acquired FM  ');

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePublishedAt: '2026-07-09T10:30:00.000Z',
        tags: ['Acquired FM'],
      }),
    );
  });

  it('should reject invalid file type', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid file type');
  });

  it('should reject request without file or youtube url', async () => {
    const formData = new FormData();

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('No file uploaded');
  });

  it('should process youtube transcript via apify chain', async () => {
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      source: 'apify_text_with_timestamps',
      videoId: 'I9aGC6Ui3eE',
      title: '20x Companies with Claude',
      fullText: 'hello',
      entries: 1,
    });

    const formData = new FormData();
    formData.append('youtubeUrl', 'https://www.youtube.com/watch?v=I9aGC6Ui3eE');
    formData.append('channelName', 'Lex Fridman');
    formData.append('sourcePublishedAt', '2026-06-08');

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFetchYoutubeSrtViaApify).toHaveBeenCalledWith('https://www.youtube.com/watch?v=I9aGC6Ui3eE');
    expect(data.data.youtubeIngest).toEqual(
      expect.objectContaining({
        source: 'apify_text_with_timestamps',
        videoId: 'I9aGC6Ui3eE',
        entries: 1,
      }),
    );
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '20x Companies with Claude',
        sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        sourcePublishedAt: '2026-06-08',
        tags: ['Lex Fridman'],
      }),
    );
  });

  it('should fallback to videoId title when youtube title is unavailable', async () => {
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      source: 'apify_text_with_timestamps',
      videoId: 'I9aGC6Ui3eE',
      title: '   ',
      fullText: 'hello',
      entries: 1,
    });

    const formData = new FormData();
    formData.append('youtubeUrl', 'https://www.youtube.com/watch?v=I9aGC6Ui3eE');

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'I9aGC6Ui3eE',
      }),
    );
  });

  it('should return classified apify ingest error', async () => {
    const { ApifyTranscriptError } = require('../../lib/apifyTranscript');
    mockFetchYoutubeSrtViaApify.mockRejectedValue(
      new ApifyTranscriptError('APIFY_TIMEOUT', 504, 'Timed out while waiting for APIFY transcript result.'),
    );

    const formData = new FormData();
    formData.append('youtubeUrl', 'https://www.youtube.com/watch?v=I9aGC6Ui3eE');

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.success).toBe(false);
    expect(data.code).toBe('APIFY_TIMEOUT');
    expect(data.error).toContain('APIFY');
  });

  it('should reject unauthenticated request', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Authentication required');
  });

  it('should return successful upload with explicit queue failure metadata', async () => {
    mockCreatePodcastFromSrt.mockResolvedValueOnce({
      id: 'mock-id-12345',
      blobUrl: 'https://podsum.cc/api/files/mock-id-12345-test.srt',
      objectKey: 'mock-id-12345-test.srt',
      originalFileName: 'test.srt',
      fileSize: '0.01 KB',
      remainingCredits: 9,
      processingQueued: false,
      processingJob: null,
      queueError: 'D1 insert failed',
    });

    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.processingQueued).toBe(false);
    expect(data.data.queueError).toBe('D1 insert failed');
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
  });

  it('should return typed upload pipeline errors', async () => {
    const { PodcastUploadError } = require('../../lib/podcastUploadPipeline');
    mockCreatePodcastFromSrt.mockRejectedValueOnce(
      new PodcastUploadError('INSUFFICIENT_CREDITS', 402, '积分不足，无法继续转换 SRT。', 'Insufficient credits.'),
    );

    const file = new File(['test content'], 'test.srt', { type: 'application/x-subrip' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.success).toBe(false);
    expect(data.code).toBe('INSUFFICIENT_CREDITS');
    expect(data.error).toBe('积分不足，无法继续转换 SRT。');
    expect(data.details).toBe('Insufficient credits.');
  });
});
