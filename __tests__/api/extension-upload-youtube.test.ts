/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/extension/upload-youtube/route';

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

jest.mock('../../lib/podcastUploadPipeline', () => ({
  createPodcastFromSrt: jest.fn(),
  PodcastUploadError: class PodcastUploadError extends Error {
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
  },
}));

const mockNanoid = jest.fn();
const mockParseBearerToken = jest.fn();
const mockVerifyExtensionAccessToken = jest.fn();
const mockCreateExtensionMonitorTask = jest.fn();
const mockFetchYoutubeSrtViaApify = jest.fn();
const mockCreatePodcastFromSrt = jest.fn();
const mockRecordExtensionMonitorEvent = jest.fn();
const mockUpdateExtensionMonitorTask = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('nanoid').nanoid = mockNanoid;
  require('../../lib/extensionAuth').parseBearerToken = mockParseBearerToken;
  require('../../lib/extensionAuth').verifyExtensionAccessToken = mockVerifyExtensionAccessToken;
  require('../../lib/extensionMonitor').createExtensionMonitorTask = mockCreateExtensionMonitorTask;
  require('../../lib/extensionMonitor').recordExtensionMonitorEvent = mockRecordExtensionMonitorEvent;
  require('../../lib/extensionMonitor').updateExtensionMonitorTask = mockUpdateExtensionMonitorTask;
  require('../../lib/apifyTranscript').fetchYoutubeSrtViaApify = mockFetchYoutubeSrtViaApify;
  require('../../lib/podcastUploadPipeline').createPodcastFromSrt = mockCreatePodcastFromSrt;

  mockNanoid.mockReturnValue('podcast-123');
  mockParseBearerToken.mockReturnValue('token-123');
  mockVerifyExtensionAccessToken.mockReturnValue({
    id: 'user-123',
    email: 'tester@example.com',
  });
  mockCreateExtensionMonitorTask.mockResolvedValue(null);
  mockRecordExtensionMonitorEvent.mockResolvedValue(undefined);
  mockUpdateExtensionMonitorTask.mockResolvedValue(undefined);
  mockCreatePodcastFromSrt.mockResolvedValue({
    id: 'podcast-123',
    blobUrl: 'https://podsum.cc/api/files/podcast-123-I9aGC6Ui3eE.srt',
    objectKey: 'podcast-123-I9aGC6Ui3eE.srt',
    originalFileName: 'I9aGC6Ui3eE.srt',
    fileSize: '0.04 KB',
    remainingCredits: 9,
    processingQueued: true,
    processingJob: { podcastId: 'podcast-123', status: 'queued' },
    queueError: null,
  });
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
  it('calls createPodcastFromSrt with resolved title and transcript buffer', async () => {
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
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'podcast-123',
        title: '20x Companies with Claude',
        originalFileName: 'I9aGC6Ui3eE.srt',
        sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        isPublic: false,
        userId: 'user-123',
        contentType: 'application/x-subrip',
      }),
    );
    expect(mockCreatePodcastFromSrt.mock.calls[0][0].srtContent).toBeInstanceOf(Buffer);
    expect(mockCreatePodcastFromSrt.mock.calls[0][0].srtContent.toString('utf8')).toContain('hello');
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
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'I9aGC6Ui3eE',
      }),
    );
  });

  it('returns queue failure metadata without failing the request', async () => {
    mockCreateExtensionMonitorTask.mockResolvedValueOnce({ id: 'monitor-123' });
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      videoId: 'I9aGC6Ui3eE',
      title: 'Episode title',
      source: 'apify_text_with_timestamps',
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      fullText: 'hello',
      entries: 1,
    });
    mockCreatePodcastFromSrt.mockResolvedValueOnce({
      id: 'podcast-123',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-I9aGC6Ui3eE.srt',
      objectKey: 'podcast-123-I9aGC6Ui3eE.srt',
      originalFileName: 'I9aGC6Ui3eE.srt',
      fileSize: '0.04 KB',
      remainingCredits: 9,
      processingQueued: false,
      processingJob: null,
      queueError: 'queue unavailable',
    });

    const response = await POST(
      buildRequest({
        youtubeUrl: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        podcastId: 'podcast-123',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
        processingQueued: false,
        queueError: 'queue unavailable',
        monitorTaskId: 'monitor-123',
        fileName: 'I9aGC6Ui3eE.srt',
        remainingCredits: 9,
        youtubeIngest: {
          source: 'apify_text_with_timestamps',
          videoId: 'I9aGC6Ui3eE',
          entries: 1,
        },
      },
    });
    expect(mockUpdateExtensionMonitorTask).toHaveBeenLastCalledWith(
      'monitor-123',
      expect.objectContaining({
        status: 'accepted',
        stage: 'response_sent',
        podcastId: 'podcast-123',
      }),
    );
    expect(mockRecordExtensionMonitorEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: 'monitor-123',
        level: 'warn',
        stage: 'response_sent',
        meta: {
          queueSuccess: false,
          queueError: 'queue unavailable',
        },
      }),
    );
  });

  it('maps PodcastUploadError status, code, error, and details', async () => {
    const { PodcastUploadError } = require('../../lib/podcastUploadPipeline');
    mockFetchYoutubeSrtViaApify.mockResolvedValue({
      videoId: 'I9aGC6Ui3eE',
      title: 'Untitled',
      source: 'apify_text_with_timestamps',
      srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      fullText: 'hello',
      entries: 1,
    });
    mockCreatePodcastFromSrt.mockRejectedValueOnce(
      new PodcastUploadError('SAVE_FAILED', 500, 'Failed to save podcast.', 'db timeout'),
    );

    const response = await POST(
      buildRequest({
        youtubeUrl: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      code: 'SAVE_FAILED',
      error: 'Failed to save podcast.',
      details: 'db timeout',
    });
  });
});
