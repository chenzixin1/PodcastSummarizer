/** @jest-environment node */
import { validateAnalysisBundle, validateGeneratedAnalysis, saveWatchlessFullAnalysis, generateWatchlessAnalysis } from '../../lib/watchless/fullAnalysis';
import { sampleWatchlessArticle } from '../../lib/watchless/sample';
import { getObjectText, uploadObject } from '../../lib/objectStorage';
import { createWatchlessD1 } from '../helpers/watchlessD1';
let mockD1: ReturnType<typeof createWatchlessD1>;
jest.mock('../../lib/objectStorage', () => ({ getObjectText: jest.fn(), uploadObject: jest.fn() }));
jest.mock('../../lib/sql', () => ({ getD1DatabaseBinding: () => mockD1.binding }));
jest.mock('../../lib/staticSnapshotHooks', () => ({ refreshSnapshotsForPodcastMutation: jest.fn() }));
jest.mock('../../lib/watchless/modelProvider', () => ({
  watchlessModelRequest: jest.fn(() => ({ url: 'https://model.test', headers: {}, body: {}, provider: 'cloudflare' })),
  watchlessModelText: (value: unknown) => JSON.stringify(value),
}));
const analysis = { version: 1 as const, scenes: [{ id: 'scene-1', titleZh: '观点与依据', titleEn: 'Arguments and evidence',
  points: [{ zh: '保留限定条件和事实依据。', en: 'Preserve qualifications and factual evidence.' }, { zh: '标明尚未证实的结论。', en: 'Identify conclusions that have not been established.' }] }] };
const partAnalysis = { ...analysis, scenes: [{ ...analysis.scenes[0], id: 'scene-1-part-1' }] };
const lease = { articleKey: 'old/article.json', workerId: 'worker-1', leaseSeconds: 300 };
const shortArticle = { ...sampleWatchlessArticle, scenes: [{ ...sampleWatchlessArticle.scenes[0], id: 'scene-1', transcriptEn: 'Original words', sourceTranscript: 'Original words' }] };

describe('full Watchless analysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockD1 = createWatchlessD1(sampleWatchlessArticle.id, sampleWatchlessArticle.videoId);
    (getObjectText as jest.Mock).mockReset().mockRejectedValue(new Error('File not found in object storage.'));
    global.fetch = jest.fn(async () => Response.json(partAnalysis));
  });
  afterEach(() => mockD1.close());
  test('MCP must cover every section with bilingual points', () => {
    expect(validateAnalysisBundle(analysis, ['scene-1'])).toEqual(analysis);
    expect(() => validateAnalysisBundle(analysis, ['scene-1', 'scene-2'])).toThrow();
    expect(() => validateAnalysisBundle({ ...analysis, scenes: [{ ...analysis.scenes[0], points: [] }] }, ['scene-1'])).toThrow();
    expect(() => validateAnalysisBundle({ ...analysis, scenes: [{ ...analysis.scenes[0], points: analysis.scenes[0].points.map(point => ({ ...point, zh: point.en })) }] }, ['scene-1'])).toThrow();
  });
  test('only generated single scenes may omit the envelope', () => {
    expect(validateGeneratedAnalysis(partAnalysis.scenes[0], 'scene-1-part-1')).toEqual(partAnalysis);
    expect(validateGeneratedAnalysis(partAnalysis, 'scene-1-part-1')).toEqual(partAnalysis);
    expect(() => validateAnalysisBundle(partAnalysis.scenes[0], ['scene-1-part-1'])).toThrow();
  });
  test.each([
    { ...partAnalysis.scenes[0], id: 'wrong' },
    { ...partAnalysis.scenes[0], points: [] },
    { ...partAnalysis.scenes[0], points: partAnalysis.scenes[0].points.map(point => ({ zh: point.en, en: point.en })) },
    { ...partAnalysis.scenes[0], version: '1' },
  ])('envelope recovery never fills or overlooks invalid content', value => {
    expect(() => validateGeneratedAnalysis(value, 'scene-1-part-1')).toThrow();
  });
  test('recovers paid rejected bare-scene output without another model request', async () => {
    (getObjectText as jest.Mock).mockImplementation(async (key: string) => {
      if (key.includes('.rejected-0.')) return JSON.stringify({ reason: 'version missing', raw: JSON.stringify(partAnalysis.scenes[0]) });
      throw new Error('File not found in object storage.');
    });
    expect(await generateWatchlessAnalysis(shortArticle, jest.fn(), lease)).toEqual(partAnalysis);
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadObject).toHaveBeenCalledTimes(1);
    expect((uploadObject as jest.Mock).mock.calls[0][0]).not.toMatch(/\.(attempt|rejected)-/);
    expect(JSON.parse((uploadObject as jest.Mock).mock.calls[0][1])).toEqual(partAnalysis);
  });
  test('mind map retains every section of a long episode', async () => {
    await saveWatchlessFullAnalysis(sampleWatchlessArticle, { version: 1, scenes: Array.from({ length: 30 }, (_, index) => ({ ...analysis.scenes[0], id: `section-${index}` })) }, 'mcp-supplied', lease);
    const input = mockD1.run('SELECT mind_map_json_en FROM analysis_results')[0];
    const branches = JSON.parse(input.mind_map_json_en as string).root.children;
    expect(branches).toHaveLength(3);
    expect(branches.flatMap((branch: { children: unknown[] }) => branch.children)).toHaveLength(30);
  });
  test('atomically saves all analysis fields and invalidates QA without rewriting the source', async () => {
    const before = JSON.stringify(sampleWatchlessArticle);
    await saveWatchlessFullAnalysis(sampleWatchlessArticle, analysis, 'mcp-supplied', lease);
    const input = mockD1.run('SELECT * FROM analysis_results')[0];
    expect(input.summary_zh).toContain('- 保留限定条件');
    expect(JSON.parse(input.summary_bilingual_json as string).sections[0].pairs).toHaveLength(2);
    expect(JSON.parse(input.mind_map_json_en as string).root.children[0].children).toHaveLength(2);
    expect(input.translation).toBe(sampleWatchlessArticle.scenes.map(scene => scene.transcriptEn).join('\n\n'));
    expect(input.analysis_kind).toBe('full');
    expect(mockD1.run('SELECT * FROM qa_context_chunks')).toHaveLength(0);
    expect(JSON.stringify(sampleWatchlessArticle)).toBe(before);
  });
  test.each([
    "UPDATE watchless_publications SET article_key = 'new/article.json'",
    "UPDATE processing_jobs SET worker_id = 'worker-2'",
    "UPDATE processing_jobs SET status = 'cancelled'",
    "UPDATE processing_jobs SET updated_at = datetime('now', '-301 seconds')",
  ])('lost commit guard leaves analysis and QA intact: %s', async query => {
    mockD1.hooks.beforeBatch = () => { mockD1.run(query); };
    await expect(saveWatchlessFullAnalysis(sampleWatchlessArticle, analysis, 'model', lease)).rejects.toThrow('SUPERSEDED');
    expect(mockD1.run('SELECT translation FROM analysis_results')[0].translation).toBe('old-en');
    expect(mockD1.run('SELECT * FROM qa_context_chunks')).toHaveLength(1);
  });
  test('failed QA invalidation rolls back the analysis update', async () => {
    mockD1.hooks.failStatementIndex = 1;
    await expect(saveWatchlessFullAnalysis(sampleWatchlessArticle, analysis, 'model', lease)).rejects.toThrow('simulated');
    expect(mockD1.run('SELECT analysis_kind FROM analysis_results')[0].analysis_kind).toBe('overview');
  });
  test('reuses validated checkpoints without calling the model', async () => {
    (getObjectText as jest.Mock).mockResolvedValue(JSON.stringify(partAnalysis));
    const progress = jest.fn();
    expect((await generateWatchlessAnalysis(shortArticle, progress, lease)).scenes).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(['R2 HTTP 503', 'Object storage is not configured'])('storage errors do not trigger paid regeneration: %s', async message => {
    (getObjectText as jest.Mock).mockRejectedValue(new Error(message));
    await expect(generateWatchlessAnalysis(shortArticle, jest.fn(), lease)).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('corrupt checkpoints do not trigger paid regeneration', async () => {
    (getObjectText as jest.Mock).mockResolvedValue('{bad JSON');
    await expect(generateWatchlessAnalysis(shortArticle, jest.fn(), lease)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  test('lease is checked before each paid section', async () => {
    const article = { ...shortArticle, scenes: [...shortArticle.scenes, { ...shortArticle.scenes[0], id: 'scene-2' }] };
    await expect(generateWatchlessAnalysis(article, async () => { mockD1.run("UPDATE processing_jobs SET worker_id = 'worker-2'"); }, lease)).rejects.toThrow('SUPERSEDED');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(uploadObject).toHaveBeenCalledTimes(2);
  });
  test('malformed analysis gets one bounded correction and a private diagnostic checkpoint', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(Response.json({version:1,scenes:[]})).mockResolvedValueOnce(Response.json(partAnalysis));
    expect((await generateWatchlessAnalysis(shortArticle,jest.fn(),lease)).scenes).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((uploadObject as jest.Mock).mock.calls[0][0]).toMatch(/\.attempt-0\.json$/);
    expect((uploadObject as jest.Mock).mock.calls[1][0]).toMatch(/\.rejected-0\.json$/);
    expect(JSON.parse((uploadObject as jest.Mock).mock.calls[1][1]).reason).toContain('expected 1 scene');
  });
  test('persisted invalid attempts fail closed on restart without another model bill',async()=>{
    (getObjectText as jest.Mock).mockImplementation(async(key:string)=>{
      if(key.includes('.rejected-')) return JSON.stringify({reason:'WATCHLESS_ANALYSIS_INVALID: section 1 id must exactly match the source id',raw:'private output'});
      throw new Error('File not found in object storage.');
    });
    await expect(generateWatchlessAnalysis(shortArticle,jest.fn(),lease)).rejects.toThrow('paid attempt limit reached');
    expect(fetch).not.toHaveBeenCalled();
  });
  test('lease lost during model call cannot publish a checkpoint', async () => {
    (fetch as jest.Mock).mockImplementation(async () => {
      mockD1.run("UPDATE processing_jobs SET status = 'cancelled'");
      return Response.json(partAnalysis);
    });
    await expect(generateWatchlessAnalysis(shortArticle, jest.fn(), lease)).rejects.toThrow('SUPERSEDED');
    expect(uploadObject).toHaveBeenCalledTimes(1);
    expect((uploadObject as jest.Mock).mock.calls[0][0]).toMatch(/\.attempt-0\.json$/);
  });
  test('unknown paid outcome on restart never incurs another charge',async()=>{
    (getObjectText as jest.Mock).mockImplementation(async(key:string)=>{
      if(key.includes('.attempt-0.')) return JSON.stringify({attempt:0});
      throw new Error('File not found in object storage.');
    });
    await expect(generateWatchlessAnalysis(shortArticle,jest.fn(),lease)).rejects.toThrow('ATTEMPT_UNCERTAIN');
    expect(fetch).not.toHaveBeenCalled();
  });
  test('cannot bill when durable attempt reservation fails',async()=>{
    (uploadObject as jest.Mock).mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(generateWatchlessAnalysis(shortArticle,jest.fn(),lease)).rejects.toThrow('R2 unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
