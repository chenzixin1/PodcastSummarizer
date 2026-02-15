/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/extension/upload-youtube/route';

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn(),
}));

jest.mock('../../lib/extensionAuth', () => {
  class MockExtensionAuthError extends Error {
    code: string;
    status: number;

    constructor(code: string, status: number, message: string) {
      super(message);
      this.name = 'ExtensionAuthError';
      this.code = code;
      this.status = status;
    }
  }

  return {
    ExtensionAuthError: MockExtensionAuthError,
    parseBearerToken: jest.fn(),
    verifyExtensionAccessToken: jest.fn(),
  };
});

jest.mock('../../lib/extensionMonitor', () => ({
  createExtensionMonitorTask: jest.fn(),
  recordExtensionMonitorEvent: jest.fn(),
  updateExtensionMonitorTask: jest.fn(),
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
    ApifyTranscriptError: MockApifyTranscriptError,
    fetchYoutubeSrtViaApify: jest.fn(),
  };
});

const mockNanoid = jest.fn();
const mockParseBearerToken = jest.fn();
const mockVerifyExtensionAccessToken = jest.fn();
const mockCreateExtensionMonitorTask = jest.fn();
const mockSavePodcast = jest.fn();
const mockEnqueueProcessingJob = jest.fn();
const mockFetchYoutubeSrtViaApify = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('nanoid').nanoid = mockNanoid;
  require('../../lib/extensionAuth').parseBearerToken = mockParseBearerToken;
  require('../../lib/extensionAuth').verifyExtensionAccessToken = mockVerifyExtensionAccessToken;
  require('../../lib/extensionMonitor').createExtensionMonitorTask = mockCreateExtensionMonitorTask;
  require('../../lib/db').savePodcast = mockSavePodcast;
  require('../../lib/processingJobs').enqueueProcessingJob = mockEnqueueProcessingJob;
  require('../../lib/apifyTranscript').fetchYoutubeSrtViaApify = mockFetchYoutubeSrtViaApify;

  mockNanoid.mockReturnValue('podcast-123');
  mockParseBearerToken.mockReturnValue('token-123');
  mockVerifyExtensionAccessToken.mockReturnValue({
    id: 'user-123',
    email: 'tester@example.com',
  });
  mockCreateExtensionMonitorTask.mockResolvedValue(null);
  mockSavePodcast.mockResolvedValue({ success: true });
  mockEnqueueProcessingJob.mockResolvedValue({ success: false, error: 'queue unavailable' });
});

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/extension/upload-youtube', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-123',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('Extension upload-youtube API title handling', () => {
  it('should save trimmed youtube title from APIFY result', async () => {
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      videoId: 'I9aGC6Ui3eE',
      title: '  20x Companies with Claude  ',
      source: 'apify_text_with_timestamps',
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      fullText: 'hello',
      entries: 1,
    });

    const response = await POST(
      buildRequest({
        youtubeUrl: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSavePodcast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'podcast-123',
        title: '20x Companies with Claude',
        originalFileName: 'I9aGC6Ui3eE.srt',
      }),
    );
  });

  it('should fallback to videoId when APIFY title is placeholder', async () => {
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      videoId: 'I9aGC6Ui3eE',
      title: 'Untitled',
      source: 'apify_text_with_timestamps',
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      fullText: 'hello',
      entries: 1,
    });

    const response = await POST(
      buildRequest({
        youtubeUrl: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSavePodcast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'I9aGC6Ui3eE',
      }),
    );
  });
});
