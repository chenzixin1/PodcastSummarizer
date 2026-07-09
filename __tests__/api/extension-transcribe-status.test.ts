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
import { GET } from '../../app/api/extension/transcribe-status/[jobId]/route';

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

jest.mock('../../lib/extensionTranscriptionJobs', () => ({
  getExtensionTranscriptionJobForUser: jest.fn(),
  touchExtensionTranscriptionJob: jest.fn(),
  updateExtensionTranscriptionJobCompleted: jest.fn(),
  updateExtensionTranscriptionJobFailed: jest.fn(),
}));

jest.mock('../../lib/extensionMonitor', () => ({
  createExtensionMonitorTask: jest.fn(),
  findMonitorTaskByTranscriptionJobId: jest.fn(),
  recordExtensionMonitorEvent: jest.fn(),
  updateExtensionMonitorTask: jest.fn(),
}));

jest.mock('../../lib/volcanoTranscription', () => ({
  getVolcanoConfig: jest.fn(),
  queryVolcanoTask: jest.fn(),
  srtFromVolcanoResult: jest.fn(),
}));

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

jest.mock('../../lib/objectStorage', () => ({
  deleteObject: jest.fn(),
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
const mockGetExtensionTranscriptionJobForUser = jest.fn();
const mockTouchExtensionTranscriptionJob = jest.fn();
const mockUpdateExtensionTranscriptionJobCompleted = jest.fn();
const mockUpdateExtensionTranscriptionJobFailed = jest.fn();
const mockCreateExtensionMonitorTask = jest.fn();
const mockFindMonitorTaskByTranscriptionJobId = jest.fn();
const mockRecordExtensionMonitorEvent = jest.fn();
const mockUpdateExtensionMonitorTask = jest.fn();
const mockGetVolcanoConfig = jest.fn();
const mockQueryVolcanoTask = jest.fn();
const mockSrtFromVolcanoResult = jest.fn();
const mockTriggerWorkerProcessing = jest.fn();
const mockDeleteObject = jest.fn();
const mockCreatePodcastFromSrt = jest.fn();

const baseJob = {
  id: 'job-123',
  status: 'transcribing',
  title: '  Episode Title  ',
  originalFileName: 'Episode 1.srt',
  sourceReference: 'https://www.youtube.com/watch?v=abc123',
  isPublic: true,
  userId: 'user-123',
  videoId: 'abc123',
  providerTaskId: 'provider-123',
  podcastId: null,
  audioBlobUrl: 'https://storage.example.com/audio-temp.mp3',
  error: null,
};

beforeEach(() => {
  jest.clearAllMocks();

  require('nanoid').nanoid = mockNanoid;
  require('../../lib/extensionAuth').parseBearerToken = mockParseBearerToken;
  require('../../lib/extensionAuth').verifyExtensionAccessToken = mockVerifyExtensionAccessToken;
  require('../../lib/extensionTranscriptionJobs').getExtensionTranscriptionJobForUser =
    mockGetExtensionTranscriptionJobForUser;
  require('../../lib/extensionTranscriptionJobs').touchExtensionTranscriptionJob =
    mockTouchExtensionTranscriptionJob;
  require('../../lib/extensionTranscriptionJobs').updateExtensionTranscriptionJobCompleted =
    mockUpdateExtensionTranscriptionJobCompleted;
  require('../../lib/extensionTranscriptionJobs').updateExtensionTranscriptionJobFailed =
    mockUpdateExtensionTranscriptionJobFailed;
  require('../../lib/extensionMonitor').createExtensionMonitorTask = mockCreateExtensionMonitorTask;
  require('../../lib/extensionMonitor').findMonitorTaskByTranscriptionJobId =
    mockFindMonitorTaskByTranscriptionJobId;
  require('../../lib/extensionMonitor').recordExtensionMonitorEvent = mockRecordExtensionMonitorEvent;
  require('../../lib/extensionMonitor').updateExtensionMonitorTask = mockUpdateExtensionMonitorTask;
  require('../../lib/volcanoTranscription').getVolcanoConfig = mockGetVolcanoConfig;
  require('../../lib/volcanoTranscription').queryVolcanoTask = mockQueryVolcanoTask;
  require('../../lib/volcanoTranscription').srtFromVolcanoResult = mockSrtFromVolcanoResult;
  require('../../lib/workerTrigger').triggerWorkerProcessing = mockTriggerWorkerProcessing;
  require('../../lib/objectStorage').deleteObject = mockDeleteObject;
  require('../../lib/podcastUploadPipeline').createPodcastFromSrt = mockCreatePodcastFromSrt;

  mockNanoid.mockReturnValue('podcast-123');
  mockParseBearerToken.mockReturnValue('token-123');
  mockVerifyExtensionAccessToken.mockReturnValue({
    id: 'user-123',
    email: 'tester@example.com',
  });
  mockGetExtensionTranscriptionJobForUser.mockResolvedValue({
    success: true,
    data: { ...baseJob },
  });
  mockTouchExtensionTranscriptionJob.mockResolvedValue(undefined);
  mockUpdateExtensionTranscriptionJobCompleted.mockResolvedValue(undefined);
  mockUpdateExtensionTranscriptionJobFailed.mockResolvedValue(undefined);
  mockCreateExtensionMonitorTask.mockResolvedValue({ id: 'monitor-123' });
  mockFindMonitorTaskByTranscriptionJobId.mockResolvedValue(null);
  mockRecordExtensionMonitorEvent.mockResolvedValue(undefined);
  mockUpdateExtensionMonitorTask.mockResolvedValue(undefined);
  mockGetVolcanoConfig.mockReturnValue({ endpoint: 'volcano' });
  mockQueryVolcanoTask.mockResolvedValue({
    done: true,
    data: { utterances: [] },
    fatalError: null,
  });
  mockSrtFromVolcanoResult.mockReturnValue('1\n00:00:00,000 --> 00:00:02,000\nhello');
  mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  mockDeleteObject.mockResolvedValue(undefined);
  mockCreatePodcastFromSrt.mockResolvedValue({
    id: 'podcast-123',
    blobUrl: 'https://podsum.cc/api/files/extension-srt/podcast-123-Episode_1.srt',
    objectKey: 'extension-srt/podcast-123-Episode_1.srt',
    originalFileName: 'Episode_1.srt',
    fileSize: '0.04 KB',
    remainingCredits: 9,
    processingQueued: true,
    processingJob: { podcastId: 'podcast-123', status: 'queued' },
    queueError: null,
  });
});

function buildRequest() {
  return new NextRequest('http://localhost:3000/api/extension/transcribe-status/job-123', {
    method: 'GET',
    headers: {
      authorization: 'Bearer token-123',
      origin: 'https://podsum.cc',
    },
  });
}

async function callRoute() {
  return GET(buildRequest(), { params: Promise.resolve({ jobId: 'job-123' }) });
}

describe('GET /api/extension/transcribe-status/[jobId]', () => {
  it('finalizes a completed provider result through createPodcastFromSrt and keeps the response shape unchanged', async () => {
    const response = await callRoute();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        status: 'completed',
        podcastId: 'podcast-123',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
        lastError: null,
        monitorTaskId: 'monitor-123',
      },
    });
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith({
      id: 'podcast-123',
      title: 'Episode Title',
      originalFileName: 'Episode_1.srt',
      srtContent: expect.any(Buffer),
      objectKey: 'extension-srt/podcast-123-Episode_1.srt',
      sourceReference: 'https://www.youtube.com/watch?v=abc123',
      isPublic: true,
      userId: 'user-123',
      contentType: 'application/x-subrip',
    });
    expect(mockCreatePodcastFromSrt.mock.calls[0][0].srtContent.toString('utf8')).toContain('hello');
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('upload', 'podcast-123');
    expect(mockUpdateExtensionTranscriptionJobCompleted).toHaveBeenCalledWith('job-123', 'user-123', 'podcast-123');
    expect(mockDeleteObject).toHaveBeenCalledWith('https://storage.example.com/audio-temp.mp3');
  });

  it('keeps queue failure non-fatal, logs it, and preserves the completed response contract', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreatePodcastFromSrt.mockResolvedValueOnce({
      id: 'podcast-123',
      blobUrl: 'https://podsum.cc/api/files/extension-srt/podcast-123-Episode_1.srt',
      objectKey: 'extension-srt/podcast-123-Episode_1.srt',
      originalFileName: 'Episode_1.srt',
      fileSize: '0.04 KB',
      remainingCredits: 9,
      processingQueued: false,
      processingJob: null,
      queueError: 'queue unavailable',
    });

    const response = await callRoute();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        status: 'completed',
        podcastId: 'podcast-123',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
        lastError: null,
        monitorTaskId: 'monitor-123',
      },
    });
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[EXTENSION_TRANSCRIBE_STATUS] Processing queue failed after Path2 transcription completion:',
      'queue unavailable',
    );
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
          podcastId: 'podcast-123',
          remainingCredits: 9,
        },
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it('preserves response_sent monitor state when a saved podcast was not queued on a later poll', async () => {
    mockGetExtensionTranscriptionJobForUser.mockResolvedValueOnce({
      success: true,
      data: {
        ...baseJob,
        status: 'completed',
        podcastId: 'podcast-123',
      },
    });
    mockFindMonitorTaskByTranscriptionJobId.mockResolvedValueOnce({
      id: 'monitor-123',
      status: 'accepted',
      stage: 'response_sent',
    });

    const response = await callRoute();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        status: 'completed',
        podcastId: 'podcast-123',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
        lastError: null,
        monitorTaskId: 'monitor-123',
      },
    });
    expect(mockUpdateExtensionMonitorTask).toHaveBeenCalledWith(
      'monitor-123',
      expect.objectContaining({
        status: 'accepted',
        stage: 'response_sent',
        transcriptionJobId: 'job-123',
        podcastId: 'podcast-123',
      }),
    );
    expect(mockCreatePodcastFromSrt).not.toHaveBeenCalled();
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
  });

  it('marks the transcription job failed and returns the generic 500 envelope when the shared helper throws', async () => {
    const { PodcastUploadError } = require('../../lib/podcastUploadPipeline');
    mockCreatePodcastFromSrt.mockRejectedValueOnce(
      new PodcastUploadError('SAVE_FAILED', 500, 'Failed to save podcast.', 'db write failed'),
    );

    const response = await callRoute();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      code: 'TRANSCRIBE_STATUS_FAILED',
      error: 'Failed to fetch extension transcription status.',
      details: 'Failed to save podcast.',
    });
    expect(mockUpdateExtensionTranscriptionJobFailed).toHaveBeenCalledWith(
      'job-123',
      'user-123',
      'Failed to save podcast.',
    );
    expect(mockUpdateExtensionTranscriptionJobCompleted).not.toHaveBeenCalled();
    expect(mockUpdateExtensionMonitorTask).toHaveBeenLastCalledWith(
      'monitor-123',
      expect.objectContaining({
        status: 'failed',
        stage: 'failed',
        lastErrorCode: 'TRANSCRIBE_STATUS_FAILED',
        lastErrorMessage: 'Failed to save podcast.',
        lastHttpStatus: 500,
      }),
    );
    expect(mockDeleteObject).toHaveBeenCalledWith('https://storage.example.com/audio-temp.mp3');
  });

  it('keeps the polling path unchanged while the provider is still transcribing', async () => {
    mockQueryVolcanoTask.mockResolvedValueOnce({
      done: false,
      data: null,
      fatalError: null,
    });

    const response = await callRoute();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        status: 'transcribing',
        podcastId: null,
        dashboardUrl: null,
        lastError: null,
        monitorTaskId: 'monitor-123',
      },
    });
    expect(mockTouchExtensionTranscriptionJob).toHaveBeenCalledWith('job-123', 'user-123');
    expect(mockCreatePodcastFromSrt).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});
