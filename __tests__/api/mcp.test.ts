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

jest.mock('nanoid', () => ({
  nanoid: jest.fn(),
}));

jest.mock('../../lib/mcpAccess', () => ({
  authenticateMcpAccessToken: jest.fn(),
  hasMcpScope: jest.fn((context, scope) => context.scopes.includes(scope)),
  recordMcpAccessLog: jest.fn(),
}));

jest.mock('../../lib/db', () => ({
  getAnalysisResults: jest.fn(),
  getPodcast: jest.fn(),
  getUserPodcasts: jest.fn(),
  verifyPodcastOwnership: jest.fn(),
}));

jest.mock('../../lib/credits', () => ({
  getAccountCreditOverview: jest.fn(),
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

jest.mock('../../lib/workerTrigger', () => ({
  triggerWorkerProcessing: jest.fn(),
}));

import { POST } from '../../app/mcp/route';
import { fetchYoutubeSrtViaApify } from '../../lib/apifyTranscript';
import { authenticateMcpAccessToken, recordMcpAccessLog } from '../../lib/mcpAccess';
import { createPodcastFromSrt } from '../../lib/podcastUploadPipeline';
import { triggerWorkerProcessing } from '../../lib/workerTrigger';
import { nanoid } from 'nanoid';

const mockNanoid = nanoid as jest.Mock;
const mockAuthenticateMcpAccessToken = authenticateMcpAccessToken as jest.Mock;
const mockRecordMcpAccessLog = recordMcpAccessLog as jest.Mock;
const mockFetchYoutubeSrtViaApify = fetchYoutubeSrtViaApify as jest.Mock;
const mockCreatePodcastFromSrt = createPodcastFromSrt as jest.Mock;
const mockTriggerWorkerProcessing = triggerWorkerProcessing as jest.Mock;

function buildMcpRequest(message: Record<string, unknown>, bodyOverride?: string) {
  return new NextRequest('https://podsum.cc/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer psm_test_token',
      'content-type': 'application/json',
    },
    body: bodyOverride ?? JSON.stringify(message),
  });
}

function submitMessage(argumentsOverride: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'podsum_submit_youtube_url',
      arguments: {
        url: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        preferredLanguage: 'en',
        channelName: 'Lex Fridman',
        sourcePublishedAt: '2026-06-08',
        isPublic: false,
        ...argumentsOverride,
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockNanoid.mockReturnValue('podcast-123');
  mockAuthenticateMcpAccessToken.mockResolvedValue({
    success: true,
    data: {
      tokenId: 'token-123',
      userId: 'user-123',
      scopes: ['podcasts:list', 'podcasts:read', 'analysis:read', 'exports:markdown', 'podcasts:upload'],
    },
  });
  mockRecordMcpAccessLog.mockResolvedValue(undefined);
  mockFetchYoutubeSrtViaApify.mockResolvedValue({
    videoId: 'I9aGC6Ui3eE',
    title: '  20x Companies with Claude  ',
    source: 'apify_text_with_timestamps',
    srtContent: '1\n00:00:00,000 --> 00:00:02,000\nhello',
    fullText: 'hello',
    entries: 1,
  });
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
  mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
});

describe('PodSum MCP API', () => {
  it('lists the youtube URL submission tool for upload-scoped tokens with write annotations', async () => {
    const response = await POST(
      buildMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'podsum_submit_youtube_url',
          inputSchema: expect.objectContaining({
            required: ['url'],
          }),
          annotations: expect.objectContaining({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          }),
        }),
      ]),
    );
  });

  it('hides the youtube submission tool when the token lacks podcasts:upload', async () => {
    mockAuthenticateMcpAccessToken.mockResolvedValueOnce({
      success: true,
      data: {
        tokenId: 'token-123',
        userId: 'user-123',
        scopes: ['podcasts:list'],
      },
    });

    const response = await POST(
      buildMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result.tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'podsum_submit_youtube_url',
        }),
      ]),
    );
  });

  it('submits a youtube URL through the shared upload pipeline and queues processing', async () => {
    const response = await POST(buildMcpRequest(submitMessage()));
    const data = await response.json();
    const payload = JSON.parse(data.result.content[0].text);

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      podcast: {
        id: 'podcast-123',
        title: '20x Companies with Claude',
        originalFileName: 'I9aGC6Ui3eE.srt',
        fileSize: '0.04 KB',
        sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        sourcePublishedAt: '2026-06-08T00:00:00.000Z',
        tags: ['Lex Fridman'],
        isPublic: false,
        blobUrl: 'https://podsum.cc/api/files/podcast-123-I9aGC6Ui3eE.srt',
        dashboardUrl: 'https://podsum.cc/dashboard/podcast-123',
      },
      remainingCredits: 9,
      processingQueued: true,
      processingJob: { podcastId: 'podcast-123', status: 'queued' },
      queueError: null,
      youtubeIngest: {
        source: 'apify_text_with_timestamps',
        videoId: 'I9aGC6Ui3eE',
        entries: 1,
        preferredLanguage: 'en',
      },
    });
    expect(mockFetchYoutubeSrtViaApify).toHaveBeenCalledWith('https://www.youtube.com/watch?v=I9aGC6Ui3eE', 'en');
    expect(mockCreatePodcastFromSrt).toHaveBeenCalledWith({
      id: 'podcast-123',
      title: '20x Companies with Claude',
      originalFileName: 'I9aGC6Ui3eE.srt',
      srtContent: expect.any(Buffer),
      sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
      sourcePublishedAt: '2026-06-08T00:00:00.000Z',
      tags: ['Lex Fridman'],
      isPublic: false,
      userId: 'user-123',
      contentType: 'application/x-subrip',
    });
    expect(mockCreatePodcastFromSrt.mock.calls[0][0].srtContent.toString('utf8')).toContain('hello');
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('upload', 'podcast-123');
    expect(mockRecordMcpAccessLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tool: 'podsum_submit_youtube_url',
        resourceType: 'podcast',
        resourceId: 'podcast-123',
        ok: true,
        errorCode: null,
      }),
    );
  });

  it('keeps a queue failure non-fatal and does not trigger the worker', async () => {
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
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(buildMcpRequest(submitMessage()));
    const data = await response.json();
    const payload = JSON.parse(data.result.content[0].text);

    expect(response.status).toBe(200);
    expect(payload.processingQueued).toBe(false);
    expect(payload.processingJob).toBeNull();
    expect(payload.queueError).toBe('queue unavailable');
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[MCP] enqueueProcessingJob failed:', 'queue unavailable');

    consoleErrorSpy.mockRestore();
  });

  it('returns a tool error when podcasts:upload is missing from a direct call', async () => {
    mockAuthenticateMcpAccessToken.mockResolvedValueOnce({
      success: true,
      data: {
        tokenId: 'token-123',
        userId: 'user-123',
        scopes: ['podcasts:list'],
      },
    });

    const response = await POST(buildMcpRequest(submitMessage()));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Missing scope: podcasts:upload',
        },
      ],
    });
    expect(mockFetchYoutubeSrtViaApify).not.toHaveBeenCalled();
    expect(mockCreatePodcastFromSrt).not.toHaveBeenCalled();
    expect(mockRecordMcpAccessLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tool: 'podsum_submit_youtube_url',
        resourceType: 'podcast',
        resourceId: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        ok: false,
        errorCode: 'tool_forbidden',
      }),
    );
  });

  it('maps PodcastUploadError to a structured MCP tool error', async () => {
    const { PodcastUploadError } = require('../../lib/podcastUploadPipeline');
    mockCreatePodcastFromSrt.mockRejectedValueOnce(
      new PodcastUploadError('INSUFFICIENT_CREDITS', 402, '积分不足，无法继续转换 SRT。', 'Insufficient credits.'),
    );

    const response = await POST(buildMcpRequest(submitMessage()));
    const data = await response.json();
    const payload = JSON.parse(data.result.content[0].text);

    expect(response.status).toBe(200);
    expect(data.result.isError).toBe(true);
    expect(payload).toEqual({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
      error: '积分不足，无法继续转换 SRT。',
      details: 'Insufficient credits.',
    });
    expect(mockTriggerWorkerProcessing).not.toHaveBeenCalled();
    expect(mockRecordMcpAccessLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tool: 'podsum_submit_youtube_url',
        resourceType: 'podcast',
        resourceId: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
        ok: false,
        errorCode: 'INSUFFICIENT_CREDITS',
      }),
    );
  });

  it('returns a JSON-RPC auth error envelope when authentication fails', async () => {
    mockAuthenticateMcpAccessToken.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
      errorCode: 'unauthorized',
    });

    const response = await POST(buildMcpRequest(submitMessage()));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32001,
        message: 'Authentication required',
        data: { code: 'unauthorized' },
      },
    });
  });

  it('returns a JSON-RPC parse error envelope for invalid JSON', async () => {
    const response = await POST(buildMcpRequest({}, '{not-json'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    });
  });
});
