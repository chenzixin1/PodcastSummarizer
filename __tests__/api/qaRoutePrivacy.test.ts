/** @jest-environment node */
// Use the actual response implementation to exercise header casing and serialization.
jest.unmock('next/server');
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/qa/[id]/route';
import { getServerSession } from 'next-auth/next';
import { getAnalysisResults, getPodcast, verifyPodcastOwnership } from '../../lib/db';
import { getQaMessages, saveQaMessage } from '../../lib/qaMessages';
import { callQaModel, QaModelError } from '../../lib/qaModel';
import { consumeQaRequestQuota } from '../../lib/qaQuota';
import { rebuildQaContextChunksForPodcast, retrieveHybridQaChunks } from '../../lib/qaContextChunks';
import { getObjectText } from '../../lib/objectStorage';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../lib/auth', () => ({ authOptions: {} }));
jest.mock('../../lib/db', () => ({ getAnalysisResults: jest.fn(), getPodcast: jest.fn(), verifyPodcastOwnership: jest.fn() }));
jest.mock('../../lib/qaMessages', () => ({ getQaMessages: jest.fn(), saveQaMessage: jest.fn() }));
jest.mock('../../lib/qaModel', () => ({
  callQaModel: jest.fn(),
  QaModelError: class extends Error { constructor(message: string, public status = 503) { super(message); } },
}));
jest.mock('../../lib/qaQuota', () => ({ consumeQaRequestQuota: jest.fn(), QA_REQUESTS_PER_HOUR: 30 }));
jest.mock('../../lib/qaContextChunks', () => ({
  rebuildQaContextChunksForPodcast: jest.fn(), retrieveHybridQaChunks: jest.fn(), renderChunkLabel: () => 'Transcript',
}));
jest.mock('../../lib/objectStorage', () => ({ getObjectText: jest.fn() }));

const context = () => ({ params: Promise.resolve({ id: 'podcast-1' }) });
const request = (method: 'GET' | 'POST', body: unknown = { question: 'What did the speaker say?' }, query = '') =>
  new NextRequest(`https://podsum.test/api/qa/podcast-1${query}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
const invoke = (method: 'GET' | 'POST') => (method === 'GET' ? GET : POST)(request(method), context());
const expectPrivateResponse = (response: Response, status: number) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
};
const expectNoPaidWork = () => {
  expect(consumeQaRequestQuota).not.toHaveBeenCalled();
  expect(retrieveHybridQaChunks).not.toHaveBeenCalled();
  expect(rebuildQaContextChunksForPodcast).not.toHaveBeenCalled();
  expect(callQaModel).not.toHaveBeenCalled();
  expect(getObjectText).not.toHaveBeenCalled();
};
const leakMarker = 'INTERNAL_PRIVATE_QUERY_WITH_CREDENTIAL_SENTINEL';

describe('QA route authentication, history privacy and paid-work gates', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'alice' } });
    (getPodcast as jest.Mock).mockResolvedValue({ success: true, data: { isPublic: true, userId: 'owner', blobUrl: '/api/files/canonical.txt' } });
    (verifyPodcastOwnership as jest.Mock).mockResolvedValue({ success: true });
    (getAnalysisResults as jest.Mock).mockResolvedValue({ success: true, data: { summary: 'Summary', translation: 'Original text', highlights: '中文原话' } });
    (getQaMessages as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 'alice-history', userId: 'alice' }] });
    (consumeQaRequestQuota as jest.Mock).mockResolvedValue(true);
    (retrieveHybridQaChunks as jest.Mock).mockResolvedValue([{ id: 1, source: 'transcript', content: 'The original evidence.', finalScore: 0.8, semanticScore: 0.7, lexicalScore: 0.8 }]);
    (callQaModel as jest.Mock).mockResolvedValue('根据原话给出的回答。');
    (saveQaMessage as jest.Mock).mockResolvedValue({ success: true, data: { id: 'new-history', userId: 'alice', answer: '根据原话给出的回答。' } });
  });

  test.each(['GET', 'POST'] as const)('anonymous %s returns 401 before even loading podcast metadata', async method => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    expectPrivateResponse(await invoke(method), 401);
    expect(getPodcast).not.toHaveBeenCalled();
    expect(getQaMessages).not.toHaveBeenCalled();
    expect(saveQaMessage).not.toHaveBeenCalled();
    expectNoPaidWork();
  });
  test.each([undefined, null, '', '  ', 12])('invalid session user ID %p cannot authorize a public podcast', async id => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id } });
    expectPrivateResponse(await invoke('POST'), 401);
    expectNoPaidWork();
  });
  test.each(['GET', 'POST'] as const)('private non-owner %s returns 403 without history or paid work', async method => {
    (getPodcast as jest.Mock).mockResolvedValue({ success: true, data: { isPublic: false, userId: 'owner' } });
    (verifyPodcastOwnership as jest.Mock).mockResolvedValue({ success: false });
    expectPrivateResponse(await invoke(method), 403);
    expect(verifyPodcastOwnership).toHaveBeenCalledWith('podcast-1', 'alice');
    expect(getQaMessages).not.toHaveBeenCalled();
    expectNoPaidWork();
  });
  test('public podcast history is scoped to the session user, ignoring caller-supplied identity', async () => {
    const response = await GET(request('GET', undefined, '?limit=60&userId=bob'), context());
    expectPrivateResponse(response, 200);
    expect(getQaMessages).toHaveBeenCalledWith('podcast-1', 'alice', 60);
    expect(verifyPodcastOwnership).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ data: { messages: [{ id: 'alice-history', userId: 'alice' }] } });
    expectNoPaidWork();
  });
  test('private owner can read only their own history', async () => {
    (getPodcast as jest.Mock).mockResolvedValue({ success: true, data: { isPublic: false, userId: 'alice' } });
    expectPrivateResponse(await invoke('GET'), 200);
    expect(getQaMessages).toHaveBeenCalledWith('podcast-1', 'alice', 30);
    expect(verifyPodcastOwnership).toHaveBeenCalledWith('podcast-1', 'alice');
  });
  test('POST derives saved identity from the session and consumes quota before retrieval', async () => {
    (retrieveHybridQaChunks as jest.Mock).mockImplementation(async () => {
      expect(consumeQaRequestQuota).toHaveBeenCalledWith('alice');
      return [{ id: 1, source: 'transcript', content: 'Evidence', finalScore: 0.8, semanticScore: 0.7, lexicalScore: 0.8 }];
    });
    const response = await POST(request('POST', { question: 'Question', userId: 'bob', suggested: false }), context());
    expectPrivateResponse(response, 200);
    expect(saveQaMessage).toHaveBeenCalledWith(expect.objectContaining({ podcastId: 'podcast-1', userId: 'alice', question: 'Question' }));
    expect(callQaModel).toHaveBeenCalledTimes(1);
  });
  test('quota exhaustion returns 429 and never touches paid services or source', async () => {
    (consumeQaRequestQuota as jest.Mock).mockResolvedValue(false);
    expectPrivateResponse(await invoke('POST'), 429);
    expect(consumeQaRequestQuota).toHaveBeenCalledWith('alice');
    expect(retrieveHybridQaChunks).not.toHaveBeenCalled();
    expect(rebuildQaContextChunksForPodcast).not.toHaveBeenCalled();
    expect(callQaModel).not.toHaveBeenCalled();
    expect(saveQaMessage).not.toHaveBeenCalled();
    expect(getObjectText).not.toHaveBeenCalled();
  });
  test('lexical-only cold start reads the canonical source without rebuilding paid embeddings', async () => {
    const previous = process.env.QA_EMBEDDINGS_ENABLED;
    process.env.QA_EMBEDDINGS_ENABLED = 'false';
    try {
      (retrieveHybridQaChunks as jest.Mock).mockResolvedValue([]);
      (getObjectText as jest.Mock).mockResolvedValue('Speaker: The unchanged original source words.');
      const response = await POST(request('POST', { question: 'Question', blobUrl: 'https://untrusted.test/other.txt' }), context());
      expectPrivateResponse(response, 200);
      expect(getObjectText).toHaveBeenCalledWith('/api/files/canonical.txt');
      expect(rebuildQaContextChunksForPodcast).not.toHaveBeenCalled();
      expect(callQaModel).toHaveBeenCalledWith('Question', expect.stringContaining('The unchanged original source words.'), 'legacy');
    } finally {
      if (previous === undefined) delete process.env.QA_EMBEDDINGS_ENABLED;
      else process.env.QA_EMBEDDINGS_ENABLED = previous;
    }
  });
  test.each(['', 'x'.repeat(1001), 123])('invalid question is rejected before quota or paid work', async question => {
    expectPrivateResponse(await POST(request('POST', { question }), context()), 400);
    expectNoPaidWork();
  });
  test('malformed JSON returns 400 before quota or paid work', async () => {
    const malformed = new NextRequest('https://podsum.test/api/qa/podcast-1', { method: 'POST', body: '{broken' });
    expectPrivateResponse(await POST(malformed, context()), 400);
    expectNoPaidWork();
  });
  test('analysis not ready returns 409 before quota or paid work', async () => {
    (getAnalysisResults as jest.Mock).mockResolvedValue({ success: false, error: leakMarker });
    const response = await invoke('POST');
    expectPrivateResponse(response, 409);
    expect(await response.text()).not.toContain(leakMarker);
    expectNoPaidWork();
  });
  test.each(['GET', 'POST'] as const)('session backend errors on %s are sanitized and uncacheable', async method => {
    (getServerSession as jest.Mock).mockRejectedValue(new Error(leakMarker));
    const response = await invoke(method);
    expectPrivateResponse(response, 500);
    expect(await response.text()).not.toContain(leakMarker);
    expectNoPaidWork();
  });
  test.each(['result', 'exception'])('history %s failures do not expose underlying database errors', async kind => {
    if (kind === 'result') (getQaMessages as jest.Mock).mockResolvedValue({ success: false, error: leakMarker });
    else (getQaMessages as jest.Mock).mockRejectedValue(new Error(leakMarker));
    const response = await invoke('GET');
    expectPrivateResponse(response, 500);
    expect(await response.text()).not.toContain(leakMarker);
  });
  test('quota storage errors fail closed with sanitized response', async () => {
    (consumeQaRequestQuota as jest.Mock).mockRejectedValue(new Error(leakMarker));
    const response = await invoke('POST');
    expectPrivateResponse(response, 500);
    expect(await response.text()).not.toContain(leakMarker);
    expect(retrieveHybridQaChunks).not.toHaveBeenCalled();
    expect(callQaModel).not.toHaveBeenCalled();
  });
  test('unexpected model errors are sanitized and cannot create history', async () => {
    (callQaModel as jest.Mock).mockRejectedValue(new Error(leakMarker));
    const response = await invoke('POST');
    expectPrivateResponse(response, 500);
    expect(await response.text()).not.toContain(leakMarker);
    expect(saveQaMessage).not.toHaveBeenCalled();
  });
  test('typed safe provider errors retain their user-facing status without caching', async () => {
    (callQaModel as jest.Mock).mockRejectedValue(new QaModelError('服务暂时不可用。', 503));
    const response = await invoke('POST');
    expectPrivateResponse(response, 503);
    expect(await response.json()).toEqual({ success: false, error: '服务暂时不可用。' });
  });
  test('history save errors never return raw database information', async () => {
    (saveQaMessage as jest.Mock).mockResolvedValue({ success: false, error: leakMarker });
    const response = await invoke('POST');
    expectPrivateResponse(response, 500);
    expect(await response.text()).not.toContain(leakMarker);
  });
});
