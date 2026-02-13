/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/upload/route';

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn(),
}));

jest.mock('../../lib/db', () => ({
  savePodcast: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  enqueueProcessingJob: jest.fn(),
}));

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/youtubeIngest', () => {
  class MockYoutubeIngestError extends Error {
    code: string;
    details?: string;

    constructor(code: string, message: string, details?: string) {
      super(message);
      this.name = 'YoutubeIngestError';
      this.code = code;
      this.details = details;
    }
  }

  return {
    generateSrtFromYoutubeUrl: jest.fn(),
    YoutubeIngestError: MockYoutubeIngestError,
  };
});

const mockPut = jest.fn();
const mockNanoid = jest.fn();
const mockSavePodcast = jest.fn();
const mockEnqueueProcessingJob = jest.fn();
const mockTriggerWorkerProcessing = jest.fn();
const mockGetServerSession = jest.fn();
const mockGenerateSrtFromYoutubeUrl = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('@vercel/blob').put = mockPut;
  require('nanoid').nanoid = mockNanoid;
  require('../../lib/db').savePodcast = mockSavePodcast;
  require('../../lib/processingJobs').enqueueProcessingJob = mockEnqueueProcessingJob;
  require('../../lib/workerTrigger').triggerWorkerProcessing = mockTriggerWorkerProcessing;
  require('next-auth/next').getServerSession = mockGetServerSession;
  require('../../lib/youtubeIngest').generateSrtFromYoutubeUrl = mockGenerateSrtFromYoutubeUrl;

  mockNanoid.mockReturnValue('mock-id-12345');
  mockPut.mockResolvedValue({ url: 'https://blob.example.com/mock-id-12345-test.srt' });
  mockSavePodcast.mockResolvedValue({ success: true });
  mockEnqueueProcessingJob.mockResolvedValue({ success: true, data: { status: 'queued' } });
  mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  mockGetServerSession.mockResolvedValue({
    user: {
      id: 'user-001',
      email: 'tester@example.com',
    },
  });

  delete process.env.BLOB_READ_WRITE_TOKEN;
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
    expect(mockGenerateSrtFromYoutubeUrl).not.toHaveBeenCalled();
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

  it('should process youtube captions when available', async () => {
    mockGenerateSrtFromYoutubeUrl.mockResolvedValue({
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      source: 'youtube_caption',
      videoId: 'I9aGC6Ui3eE',
      selectedLanguage: 'en',
      availableLanguages: ['en'],
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
    expect(mockGenerateSrtFromYoutubeUrl).toHaveBeenCalledWith('https://www.youtube.com/watch?v=I9aGC6Ui3eE');
    expect(data.data.youtubeIngest).toEqual(
      expect.objectContaining({
        source: 'youtube_caption',
        videoId: 'I9aGC6Ui3eE',
        selectedLanguage: 'en',
      }),
    );
    expect(mockSavePodcast).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      }),
    );
  });

  it('should process youtube with volcano fallback metadata when captions unavailable', async () => {
    mockGenerateSrtFromYoutubeUrl.mockResolvedValue({
      srtContent: '1\n00:00:00,000 --> 00:00:03,000\nvolcano transcript',
      source: 'volcano_asr',
      videoId: 'I9aGC6Ui3eE',
      availableLanguages: [],
      audioBlobUrl: 'https://blob.vercel-storage.com/I9aGC6Ui3eE-12345.m4a',
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
    expect(data.data.youtubeIngest).toEqual(
      expect.objectContaining({
        source: 'volcano_asr',
        videoId: 'I9aGC6Ui3eE',
        audioBlobUrl: 'https://blob.vercel-storage.com/I9aGC6Ui3eE-12345.m4a',
      }),
    );
  });

  it('should process youtube with gladia fallback metadata when captions unavailable', async () => {
    mockGenerateSrtFromYoutubeUrl.mockResolvedValue({
      srtContent: '1\n00:00:00,000 --> 00:00:03,000\ngladia transcript',
      source: 'gladia_asr',
      videoId: 'I9aGC6Ui3eE',
      availableLanguages: [],
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
    expect(data.data.youtubeIngest).toEqual(
      expect.objectContaining({
        source: 'gladia_asr',
        videoId: 'I9aGC6Ui3eE',
      }),
    );
  });

  it('should return classified youtube ingest error', async () => {
    const { YoutubeIngestError } = require('../../lib/youtubeIngest');
    mockGenerateSrtFromYoutubeUrl.mockRejectedValue(
      new YoutubeIngestError(
        'YOUTUBE_LOGIN_REQUIRED',
        'YouTube requires login verification for this video before subtitles can be fetched.',
        'playability=LOGIN_REQUIRED',
      ),
    );

    const formData = new FormData();
    formData.append('youtubeUrl', 'https://www.youtube.com/watch?v=I9aGC6Ui3eE');

    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.code).toBe('YOUTUBE_LOGIN_REQUIRED');
    expect(data.error).toContain('login verification');
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
});
