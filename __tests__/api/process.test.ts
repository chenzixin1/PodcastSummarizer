/**
 * Process API Route Tests
 */

/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

class ImmediateReadableStream<T = Uint8Array> {
  private chunks: T[] = [];
  private closed = false;
  private readonly ready: Promise<void>;

  constructor(source: {
    start?: (controller: { enqueue: (chunk: T) => void; close: () => void }) => void | Promise<void>;
  }) {
    const controller = {
      enqueue: (chunk: T) => {
        this.chunks.push(chunk);
      },
      close: () => {
        this.closed = true;
      },
    };

    this.ready = Promise.resolve(source.start?.(controller)).then(() => {
      this.closed = true;
    });
  }

  getReader() {
    let index = 0;

    return {
      read: async () => {
        await this.ready;
        if (index < this.chunks.length) {
          const value = this.chunks[index];
          index += 1;
          return { done: false, value };
        }
        return { done: this.closed, value: undefined };
      },
      releaseLock: () => undefined,
    };
  }
}

(globalThis as typeof globalThis & { ReadableStream: typeof ReadableStream }).ReadableStream =
  ImmediateReadableStream as unknown as typeof ReadableStream;

jest.mock('../../lib/prompts', () => ({
  prompts: {
    summarySystem: 'SUMMARY_SYSTEM',
    summaryUserFull: () => 'SUMMARY_USER_FULL',
    summaryUserSegment: () => 'SUMMARY_USER_SEGMENT',
    summaryUserCombine: () => 'SUMMARY_USER_COMBINE',
    translateSystem: 'TRANSLATE_SYSTEM',
    translateUserFull: () => 'TRANSLATE_USER_FULL',
    translateUserSegment: () => 'TRANSLATE_USER_SEGMENT',
    highlightSystem: 'HIGHLIGHT_SYSTEM',
    highlightUserFull: () => 'HIGHLIGHT_USER_FULL',
    highlightUserSegment: () => 'HIGHLIGHT_USER_SEGMENT',
    briefSummarySystem: 'BRIEF_SUMMARY_SYSTEM',
    briefSummaryUser: () => 'BRIEF_SUMMARY_USER',
  },
}));

jest.mock('../../lib/modelConfig', () => ({
  modelConfig: {
    API_VERSION: 'test',
    MODEL: 'test-model',
    MAX_RETRIES: 0,
    RETRY_DELAY: 0,
    API_TIMEOUT_MS: 1000,
    STATUS_HEARTBEAT_MS: 10_000,
    MAX_CONTENT_LENGTH: 10_000,
    SUMMARY_CHUNK_LENGTH: 10_000,
    TRANSLATION_CHUNK_BLOCKS: 50,
    HIGHLIGHTS_CHUNK_BLOCKS: 50,
    MAX_TRANSLATION_CHUNKS: 10,
    MAX_HIGHLIGHTS_CHUNKS: 10,
    TRANSLATION_CHUNK_CONCURRENCY: 1,
    HIGHLIGHTS_CHUNK_CONCURRENCY: 1,
    ENABLE_PARALLEL_TASKS: false,
    MAX_TOKENS: {
      summary: 512,
      translation: 512,
      highlights: 512,
    },
  },
}));

jest.mock('../../lib/db', () => ({
  saveAnalysisResults: jest.fn(),
  saveAnalysisPartialResults: jest.fn(),
  getPodcast: jest.fn(),
}));

jest.mock('../../lib/staticSnapshots', () => ({
  refreshStaticSnapshotsForPodcast: jest.fn(),
}));

jest.mock('../../lib/qaContextChunks', () => ({
  rebuildQaContextChunksForPodcast: jest.fn(() => Promise.resolve({ success: true, chunkCount: 0 })),
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/workerAuth', () => ({
  isWorkerAuthorizedBySecret: jest.fn(() => true),
}));

jest.mock('../../lib/objectStorage', () => ({
  getObjectText: jest.fn(),
}));

jest.mock('../../lib/mindMap', () => ({
  generateMindMapData: jest.fn(),
}));

jest.mock('../../lib/bilingualAlignment', () => ({
  BILINGUAL_ALIGNMENT_VERSION: 2,
  buildFullTextBilingualPayload: jest.fn(() => ({ type: 'full-text-payload' })),
  buildSummaryBilingualPayload: jest.fn(() => ({ type: 'summary-payload' })),
}));

jest.mock('../../lib/bilingualAlignmentLlm', () => ({
  applyLlmFallbackToFullTextPayload: jest.fn(async (payload) => ({
    payload,
    llmMatched: 0,
  })),
  applyLlmFallbackToSummaryPayload: jest.fn(async (payload) => ({
    payload,
    llmMatched: 0,
  })),
}));

jest.mock('../../lib/staticSnapshotHooks', () => ({
  refreshSnapshotsForPodcastMutation: jest.fn(),
}));

jest.mock('../../lib/infographicJobs', () => ({
  enqueueInfographicJob: jest.fn(),
}));

jest.mock('../../lib/qaContextChunks', () => ({
  rebuildQaContextChunksForPodcast: jest.fn(),
}));

import { POST } from '../../app/api/process/route';
import { getPodcast, saveAnalysisPartialResults, saveAnalysisResults } from '../../lib/db';
import { enqueueInfographicJob } from '../../lib/infographicJobs';
import { generateMindMapData } from '../../lib/mindMap';
import { getObjectText } from '../../lib/objectStorage';
import { rebuildQaContextChunksForPodcast } from '../../lib/qaContextChunks';
import { refreshSnapshotsForPodcastMutation } from '../../lib/staticSnapshotHooks';

global.fetch = jest.fn();

const mockSaveAnalysisResults = saveAnalysisResults as jest.MockedFunction<typeof saveAnalysisResults>;
const mockSaveAnalysisPartialResults = saveAnalysisPartialResults as jest.MockedFunction<typeof saveAnalysisPartialResults>;
const mockGetPodcast = getPodcast as jest.MockedFunction<typeof getPodcast>;
const mockGetObjectText = getObjectText as jest.MockedFunction<typeof getObjectText>;
const mockGenerateMindMapData = generateMindMapData as jest.MockedFunction<typeof generateMindMapData>;
const mockRefreshSnapshotsForPodcastMutation = refreshSnapshotsForPodcastMutation as jest.MockedFunction<
  typeof refreshSnapshotsForPodcastMutation
>;
const mockRebuildQaContextChunksForPodcast = rebuildQaContextChunksForPodcast as jest.MockedFunction<
  typeof rebuildQaContextChunksForPodcast
>;
const mockEnqueueInfographicJob = enqueueInfographicJob as jest.MockedFunction<typeof enqueueInfographicJob>;

// Helper function to read stream response
async function readStreamResponse(response: Response): Promise<string[]> {
  const events: string[] = [];
  const pushEventsFromText = (text: string) => {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data.trim()) {
          events.push(data);
        }
      }
    }
  };

  if (response.body && typeof (response.body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pushEventsFromText(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    return events;
  }

  if (response.body && Symbol.asyncIterator in Object(response.body)) {
    const decoder = new TextDecoder();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array | string>) {
      if (typeof chunk === 'string') {
        pushEventsFromText(chunk);
      } else {
        pushEventsFromText(decoder.decode(chunk));
      }
    }
    return events;
  }

  const text = await response.text();
  pushEventsFromText(text);
  return events;
}

function createSseResponse(content: string) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}\n\n`)
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body,
    async text() {
      return '';
    },
  };
}

function createJsonResponse(content: string) {
  return {
    ok: true,
    status: 200,
    body: null,
    async json() {
      return {
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      };
    },
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      });
    },
  };
}

function buildProcessRequest() {
  return new NextRequest('http://localhost:3000/api/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-process-worker-secret': 'test-worker-secret',
    },
    body: JSON.stringify({
      id: 'test-id',
      blobUrl: 'https://example.com/test.srt',
      fileName: 'test.srt',
    }),
  });
}

function getEventByType(events: string[], type: string) {
  return events
    .map((event) => JSON.parse(event))
    .find((event) => event.type === type);
}

describe('Process API Tests', () => {
  const previousWorkerSecret = process.env.PROCESS_WORKER_SECRET;
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROCESS_WORKER_SECRET = 'test-worker-secret';
    mockSaveAnalysisPartialResults.mockResolvedValue({ success: true });
    mockSaveAnalysisResults.mockResolvedValue({ success: true });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: {
        id: 'test-id',
        title: 'Test Podcast',
        sourceReference: null,
        userId: 'user-001',
      },
    });
    mockGetObjectText.mockResolvedValue(`1
00:00:00,000 --> 00:00:02,000
Hello world`);
    mockGenerateMindMapData.mockResolvedValue({
      success: true,
      data: { root: { label: 'mind-map' } },
    });
    mockRefreshSnapshotsForPodcastMutation.mockResolvedValue({
      success: true,
      published: true,
    });
    mockEnqueueInfographicJob.mockResolvedValue({ success: true, data: null });
    mockRebuildQaContextChunksForPodcast.mockResolvedValue({
      success: true,
      chunkCount: 1,
    });
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const systemPrompt = body.messages?.[0]?.content;

      if (body.stream) {
        if (systemPrompt === 'SUMMARY_SYSTEM') {
          return createSseResponse('<<<SUMMARY_EN>>>English summary<<<SUMMARY_ZH>>>中文总结');
        }
        if (systemPrompt === 'TRANSLATE_SYSTEM') {
          return createSseResponse('Translated transcript');
        }
        if (systemPrompt === 'HIGHLIGHT_SYSTEM') {
          return createSseResponse('Highlight notes');
        }
      }

      if (systemPrompt === 'BRIEF_SUMMARY_SYSTEM') {
        return createJsonResponse(
          'This is a sufficiently long brief summary for the podcast listing surface and tests.'
        );
      }

      throw new Error(`Unexpected fetch call: ${JSON.stringify(body)}`);
    });
  });

  afterAll(() => {
    process.env.PROCESS_WORKER_SECRET = previousWorkerSecret;
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should return error for missing required fields', async () => {
    const requestData = {
      id: 'test-id'
      // Missing blobUrl
    };

    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-process-worker-secret': 'test-worker-secret',
      },
      body: JSON.stringify(requestData)
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });

  it('should return error for empty request body', async () => {
    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });

  it('should return stream response with correct headers for valid request', async () => {
    const response = await POST(buildProcessRequest());

    if (response.headers.get('Content-Type') === 'application/json') {
      const payload = await response.json();
      throw new Error(`Expected stream response but got JSON: ${JSON.stringify(payload)}`);
    }

    // Check response headers for streaming
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    
    // Check that response body exists (is a stream)
    expect(response.body).toBeDefined();
  });

  it('should handle missing id field', async () => {
    const requestData = {
      blobUrl: 'https://example.com/test.srt'
      // Missing id
    };

    const request = new NextRequest('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data. Missing required fields.');
  });

  it('refreshes snapshots after analysis save succeeds when the stream completes', async () => {
    const response = await POST(buildProcessRequest());
    const events = await readStreamResponse(response);
    const allDoneEvent = getEventByType(events, 'all_done');

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(allDoneEvent).toBeDefined();
    expect(mockSaveAnalysisResults).toHaveBeenCalledWith(
      expect.objectContaining({
        podcastId: 'test-id',
        summaryZh: '中文总结',
        summaryEn: 'English summary',
        translation: 'Translated transcript',
        highlights: 'Highlight notes',
      })
    );
    expect(mockRefreshSnapshotsForPodcastMutation).toHaveBeenCalledWith(
      'test-id',
      'process analysis completion'
    );
    expect(mockEnqueueInfographicJob).toHaveBeenCalledWith('test-id');
    expect(mockRebuildQaContextChunksForPodcast).toHaveBeenCalledWith(
      expect.objectContaining({ podcastId: 'test-id' })
    );
  });

  it('does not refresh snapshots when analysis save returns a db failure', async () => {
    mockSaveAnalysisResults.mockResolvedValue({ success: false, error: 'db down' });

    const response = await POST(buildProcessRequest());
    const events = await readStreamResponse(response);
    const allDoneEvent = getEventByType(events, 'all_done');

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(allDoneEvent).toBeDefined();
    expect(mockSaveAnalysisResults).toHaveBeenCalledWith(
      expect.objectContaining({ podcastId: 'test-id' })
    );
    expect(mockRefreshSnapshotsForPodcastMutation).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('保存分析结果到数据库失败:', 'db down');
    expect(mockRebuildQaContextChunksForPodcast).toHaveBeenCalledWith(
      expect.objectContaining({ podcastId: 'test-id' })
    );
  });
});
