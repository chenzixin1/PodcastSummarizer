/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/worker/watchless-repair/route';
import { sampleWatchlessArticle } from '../../lib/watchless/sample';
import { canonicalWatchlessSource } from '../../lib/watchless/bundleIntegrity';
import { translateWatchlessBlocks } from '../../lib/watchless/bilingual';
import { getObjectText, uploadObject } from '../../lib/objectStorage';
import { getAnalysisResults } from '../../lib/db';
import { isWorkerAuthorizedBySecret } from '../../lib/workerAuth';
import { createWatchlessD1 } from '../helpers/watchlessD1';
let mockD1: ReturnType<typeof createWatchlessD1>;
let mockArticle = sampleWatchlessArticle;
let mockObjects: Map<string, string>;
jest.mock('../../lib/sql', () => ({ getD1DatabaseBinding: () => mockD1.binding }));
jest.mock('../../lib/db', () => ({ getPodcast: jest.fn(async () => ({ success: true, data: mockD1.run('SELECT * FROM podcasts')[0] })), getAnalysisResults: jest.fn() }));
jest.mock('../../lib/workerAuth', () => ({ isWorkerAuthorizedBySecret: jest.fn(() => true) }));
jest.mock('../../lib/watchless/repository', () => ({
  getStoredWatchlessPublication: jest.fn(async () => {
    const row = mockD1.run('SELECT * FROM watchless_publications')[0];
    return { podcastId: row.podcast_id, videoId: row.video_id, articleKey: row.article_key, status: row.status };
  }),
  loadStoredWatchlessArticle: jest.fn(async () => mockArticle),
}));
jest.mock('../../lib/watchless/bilingual', () => ({ ...jest.requireActual('../../lib/watchless/bilingual'), translateWatchlessBlocks: jest.fn() }));
jest.mock('../../lib/objectStorage', () => ({ getObjectText: jest.fn(), uploadObject: jest.fn() }));
jest.mock('../../lib/processingJobs', () => ({ enqueueProcessingJob: jest.fn(async () => ({ success: true })) }));
jest.mock('../../lib/staticSnapshotHooks', () => ({ refreshSnapshotsForPodcastMutation: jest.fn() }));
const analysis = { version: 1, scenes: [{ id: 'scene-1', titleZh: '观点与依据', titleEn: 'Arguments and evidence',
  points: [{ zh: '保留限定条件和事实依据。', en: 'Preserve qualifications and factual evidence.' }, { zh: '标明尚未证实的结论。', en: 'Identify conclusions that have not been established.' }] }] };
const request = (action = 'project') => new NextRequest('https://podsum.test/api/worker/watchless-repair', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'test-secret' },
  body: JSON.stringify({ id: mockArticle.id, action }),
});
const expectOriginalRows = () => {
  expect(mockD1.run('SELECT article_key FROM watchless_publications')[0].article_key).toBe('old/article.json');
  expect(mockD1.run('SELECT translation FROM analysis_results')[0].translation).toBe('old-en');
  expect(mockD1.run('SELECT blob_url FROM podcasts')[0].blob_url).toBe('old-source');
  expect(mockD1.run('SELECT * FROM qa_context_chunks')).toHaveLength(1);
  expect(mockD1.run('SELECT status FROM processing_jobs')[0].status).toBe('processing');
};

describe('Watchless repair atomicity and paid checkpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArticle = { ...sampleWatchlessArticle, bilingualVersion: 1,
      availableLanguageModes: ['zh', 'en', 'bilingual', 'hint'],
      scenes: [{ ...sampleWatchlessArticle.scenes[0], id: 'scene-1', transcriptEn: 'Speaker: These are the original words and their qualifications.',
        sourceTranscript: 'Speaker: These are the original words and their qualifications.', articleZh: '说话人：这是原始发言和其中的限定条件，必须完整保留。' }] };
    mockD1 = createWatchlessD1(mockArticle.id, mockArticle.videoId);
    mockObjects = new Map();
    (isWorkerAuthorizedBySecret as jest.Mock).mockReturnValue(true);
    (getAnalysisResults as jest.Mock).mockReset().mockImplementation(async () => ({ success: true, data: mockD1.run('SELECT * FROM analysis_results')[0] }));
    (getObjectText as jest.Mock).mockReset().mockImplementation(async (key: string) => {
      if (!mockObjects.has(key)) throw new Error('File not found in object storage.');
      return mockObjects.get(key);
    });
    (uploadObject as jest.Mock).mockReset().mockImplementation(async (key: string, text: string) => {
      mockObjects.set(key, text); return { key, url: `https://podsum.test/api/files/${key}`, provider: 'r2' };
    });
    (translateWatchlessBlocks as jest.Mock).mockReset().mockImplementation(async (blocks: string[]) => blocks.map(() => '这是逐段翻译后的完整中文内容，保留所有原始发言中的限定条件。'));
  });
  afterEach(() => mockD1.close());
  test('requires operator authentication', async () => {
    (isWorkerAuthorizedBySecret as jest.Mock).mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(uploadObject).not.toHaveBeenCalled();
    expect(translateWatchlessBlocks).not.toHaveBeenCalled();
  });
  test('switches article, canonical source and full text together, with backup and QA invalidation', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    const data = await result.json();
    const key = mockD1.run('SELECT article_key FROM watchless_publications')[0].article_key as string;
    expect(JSON.parse(mockObjects.get(`${data.data.backupPrefix}/before.json`)!).podcast.blob_url).toBe('old-source');
    expect(JSON.parse(mockObjects.get(key)!)).toEqual(mockArticle);
    expect(mockObjects.get(key.replace(/[^/]+$/, 'transcript.txt'))).toBe(canonicalWatchlessSource(mockArticle));
    expect(mockD1.run('SELECT translation FROM analysis_results')[0].translation).toBe(mockArticle.scenes[0].transcriptEn);
    expect(mockD1.run('SELECT blob_url FROM podcasts')[0].blob_url).toContain(key.replace(/[^/]+$/, 'transcript.txt'));
    expect(mockD1.run('SELECT * FROM qa_context_chunks')).toHaveLength(0);
    expect(mockD1.run('SELECT status,worker_id FROM processing_jobs')[0]).toEqual({ status: 'cancelled', worker_id: null });
  });
  test('failed analysis backup read cannot modify anything', async () => {
    (getAnalysisResults as jest.Mock).mockResolvedValue({ success: false, error: 'Database unavailable' });
    expect((await POST(request())).status).toBe(422);
    expect(uploadObject).not.toHaveBeenCalled();
    expectOriginalRows();
  });
  test('oversized candidate projection cannot replace the source', async () => {
    mockArticle = { ...mockArticle, scenes: [{ ...mockArticle.scenes[0], articleZh: '完整中文原文内容。'.repeat(100000) }] };
    expect((await POST(request())).status).toBe(422);
    expectOriginalRows();
  });
  test('failed candidate transcript upload leaves all rows unchanged', async () => {
    (uploadObject as jest.Mock).mockImplementation(async (key: string, text: string) => {
      if (key.endsWith('/transcript.txt')) throw new Error('R2 HTTP 503');
      mockObjects.set(key, text); return { key, url: key };
    });
    expect((await POST(request())).status).toBe(422);
    expectOriginalRows();
  });
  test.each([1, 2, 3, 4])('D1 failure in statement %i rolls back every preceding write', async index => {
    mockD1.hooks.failStatementIndex = index;
    expect((await POST(request())).status).toBe(422);
    expectOriginalRows();
  });
  test('article replacement race does not overwrite source, full text, QA or worker state', async () => {
    mockD1.hooks.beforeBatch = () => { mockD1.run("UPDATE watchless_publications SET article_key = 'other/article.json'"); };
    expect((await POST(request())).status).toBe(422);
    expect(mockD1.run('SELECT article_key FROM watchless_publications')[0].article_key).toBe('other/article.json');
    mockD1.run("UPDATE watchless_publications SET article_key = 'old/article.json'");
    expectOriginalRows();
  });
  test.each(['old/article.json', 'old/article.bilingual-v1-20260905.json'])('preserves supplied MCP analysis beside historical key %s', async oldKey => {
    mockD1.run('UPDATE watchless_publications SET article_key = ?', [oldKey]);
    mockObjects.set('old/analysis.json', JSON.stringify(analysis));
    expect((await POST(request())).status).toBe(200);
    const nextKey = mockD1.run('SELECT article_key FROM watchless_publications')[0].article_key as string;
    expect(JSON.parse(mockObjects.get(nextKey.replace(/[^/]+$/, 'analysis.json'))!)).toEqual(analysis);
    expect(getObjectText).toHaveBeenCalledWith('old/analysis.json');
    expect(translateWatchlessBlocks).not.toHaveBeenCalled();
  });
  test('malformed supplied analysis blocks the switch without data loss', async () => {
    mockObjects.set('old/analysis.json', JSON.stringify({ version: 1, scenes: [] }));
    expect((await POST(request())).status).toBe(422);
    expectOriginalRows();
  });
  test('unavailable translation cache does not trigger paid calls', async () => {
    mockArticle = { ...mockArticle, bilingualVersion: undefined };
    (getObjectText as jest.Mock).mockRejectedValue(new Error('R2 HTTP 503'));
    expect((await POST(request('bilingual'))).status).toBe(422);
    expect(translateWatchlessBlocks).not.toHaveBeenCalled();
    expectOriginalRows();
  });
  test('retry reuses completed scene translation and preserves original words', async () => {
    mockArticle = { ...mockArticle, bilingualVersion: undefined, scenes: [...mockArticle.scenes,
      { ...mockArticle.scenes[0], id: 'scene-2', sourceTranscript: 'Speaker: Different original words in the second scene.' }] };
    const original = canonicalWatchlessSource(mockArticle);
    (translateWatchlessBlocks as jest.Mock).mockImplementationOnce(async () => ['这是第一段完整的中文翻译，原话的所有限定条件都得以保留。'])
      .mockRejectedValueOnce(new Error('provider temporary failure'));
    expect((await POST(request('bilingual'))).status).toBe(422);
    expectOriginalRows();
    expect((await POST(request('bilingual'))).status).toBe(200);
    expect(translateWatchlessBlocks).toHaveBeenCalledTimes(3);
    const key = mockD1.run('SELECT article_key FROM watchless_publications')[0].article_key as string;
    expect(canonicalWatchlessSource(JSON.parse(mockObjects.get(key)!))).toBe(original);
  });
});
