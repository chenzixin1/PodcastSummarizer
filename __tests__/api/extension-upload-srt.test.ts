/**
 * @jest-environment node
 */

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return {
    ...actual,
    after: jest.fn((callback: () => unknown) => {
      void callback();
    }),
  };
});

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/extension/upload-srt/route';

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
const mockRecordExtensionMonitorEvent = jest.fn();
const mockUpdateExtensionMonitorTask = jest.fn();
const mockTriggerWorkerProcessing = jest.fn();
const mockCreatePodcastFromSrt = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('nanoid').nanoid = mockNanoid;
  require('../../lib/extensionAuth').parseBearerToken = mockParseBearerToken;
  require('../../lib/extensionAuth').verifyExtensionAccessToken = mockVerifyExtensionAccessToken;
  require('../../lib/extensionMonitor').createExtensionMonitorTask = mockCreateExtensionMonitorTask;
  require('../../lib/extensionMonitor').recordExtensionMonitorEvent = mockRecordExtensionMonitorEvent;
  require('../../lib/extensionMonitor').updateExtensionMonitorTask = mockUpdateExtensionMonitorTask;
  require('../../lib/workerTrigger').triggerWorkerProcessing = mockTriggerWorkerProcessing;
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
  mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  mockCreatePodcastFromSrt.mockResolvedValue({
    id: 'podcast-123',
    blobUrl: 'https://podsum.cc/api/files/podcast-123-transcript.srt',
    objectKey: 'podcast-123-transcript.srt',
    originalFileName: 'transcript.srt',
    fileSize: '0.04 KB',
    remainingCredits: 9,
    processingQueued: true,
    processingJob: { podcastId: 'podcast-123', status: 'queued' },
    queueError: null,
  });
});

function buildRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {
    authorization: 'Bearer token-123',
    'content-type': 'application/json',
  },
) {
  return new NextRequest('http://localhost:3000/api/extension/upload-srt', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/extension/upload-srt', () => {
  it('calls createPodcastFromSrt and returns the shared success envelope', async () => {
    mockCreateExtensionMonitorTask.mockResolvedValueOnce({ id: 'monitor-123' });

    const response = await POST(
      buildRequest({
        fileName: ' Earnings Call.srt ',
        srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
        sourceReference: 'https://example.com/episode',
        isPublic: true,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        podcastId: 'podcast-123',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
        processingQueued: true,
        queueError: null,
        monitorTaskId: 'monitor-123',
        remainingCredits: 9,
      },
    });
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith({
      id: 'podcast-123',
      title: 'Transcript Analysis: Earnings_Call',
      originalFileName: 'Earnings_Call.srt',
      srtContent: expect.any(Buffer),
      sourceReference: 'https://example.com/episode',
      isPublic: true,
      userId: 'user-123',
      contentType: 'application/x-subrip',
    });
    expect(mockCreatePodcastFromSrt.mock.calls[0][0].srtContent.toString('utf8')).toContain('hello');
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('upload', 'podcast-123');
  });

  it('returns queue failure metadata without failing the request and records a warn monitor event', async () => {
    mockCreateExtensionMonitorTask.mockResolvedValueOnce({ id: 'monitor-123' });
    mockCreatePodcastFromSrt.mockResolvedValueOnce({
      id: 'podcast-123',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-transcript.srt',
      objectKey: 'podcast-123-transcript.srt',
      originalFileName: 'transcript.srt',
      fileSize: '0.04 KB',
      remainingCredits: 9,
      processingQueued: false,
      processingJob: null,
      queueError: 'queue unavailable',
    });

    const response = await POST(
      buildRequest({
        fileName: 'transcript.srt',
        srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
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
        remainingCredits: 9,
      },
    });
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
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

  it('maps PodcastUploadError directly into the API response and monitor failure metadata', async () => {
    const { PodcastUploadError } = require('../../lib/podcastUploadPipeline');
    mockCreateExtensionMonitorTask.mockResolvedValueOnce({ id: 'monitor-123' });
    mockCreatePodcastFromSrt.mockRejectedValueOnce(
      new PodcastUploadError(
        'INSUFFICIENT_CREDITS',
        402,
        '积分不足，无法继续转换 SRT。',
        'Insufficient credits.',
      ),
    );

    const response = await POST(
      buildRequest({
        fileName: 'transcript.srt',
        srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data).toEqual({
      success: false,
      code: 'INSUFFICIENT_CREDITS',
      error: '积分不足，无法继续转换 SRT。',
      details: 'Insufficient credits.',
    });
    expect(mockUpdateExtensionMonitorTask).toHaveBeenLastCalledWith(
      'monitor-123',
      expect.objectContaining({
        status: 'failed',
        stage: 'failed',
        lastErrorCode: 'INSUFFICIENT_CREDITS',
        lastErrorMessage: '积分不足，无法继续转换 SRT。',
        lastHttpStatus: 402,
      }),
    );
    expect(mockRecordExtensionMonitorEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: 'monitor-123',
        level: 'error',
        stage: 'failed',
        httpStatus: 402,
        message: '积分不足，无法继续转换 SRT。',
        responseBody: {
          success: false,
          code: 'INSUFFICIENT_CREDITS',
          error: '积分不足，无法继续转换 SRT。',
          details: 'Insufficient credits.',
        },
      }),
    );
  });

  it('returns 400 when srtContent is missing or blank', async () => {
    mockCreateExtensionMonitorTask.mockResolvedValueOnce({ id: 'monitor-123' });

    const response = await POST(
      buildRequest({
        fileName: 'transcript.srt',
        srtContent: '   ',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      code: 'INVALID_SRT',
      error: 'srtContent is required.',
    });
    expect(mockCreatePodcastFromSrt).not.toHaveBeenCalled();
  });

  it('returns 401 on auth failure and does not call the shared helper', async () => {
    mockParseBearerToken.mockReturnValueOnce(null);

    const response = await POST(
      buildRequest(
        {
          fileName: 'transcript.srt',
          srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
        },
        {
          'content-type': 'application/json',
        },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      code: 'AUTH_REQUIRED',
      error: 'Missing Bearer token.',
    });
    expect(mockCreatePodcastFromSrt).not.toHaveBeenCalled();
    expect(mockCreateExtensionMonitorTask).not.toHaveBeenCalled();
  });
});
