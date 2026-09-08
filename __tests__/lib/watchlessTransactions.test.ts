/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { DatabaseSync } = jest.requireActual('node:sqlite');
let mockDb: InstanceType<typeof DatabaseSync>;
let mockRace = false;
let mockId = 0;
jest.mock('nanoid', () => ({ nanoid: () => String(++mockId).padStart(18, '0') }));
const mockRun = (query: string, values: unknown[] = []) => mockDb.prepare(query).all(...values.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const mockD1 = {
  prepare(query: string) {
    let values: unknown[] = [];
    return { bind(...args: unknown[]) { values = args; return this; }, async all() { return { results: mockRun(query, values) }; } };
  },
  async batch(statements: Array<{ all(): Promise<unknown> }>) {
    mockDb.exec('BEGIN');
    try { const rows = []; for (const statement of statements) rows.push(await statement.all()); mockDb.exec('COMMIT'); return rows; }
    catch (error) { mockDb.exec('ROLLBACK'); throw error; }
  },
};
jest.mock('../../lib/sql', () => ({
  getD1DatabaseBinding: () => mockD1,
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?');
    if (mockRace && values[0] === 'cancelled') { mockRace = false; mockDb.exec("UPDATE watchless_jobs SET status='publishing'"); }
    return { rows: mockRun(query, values) };
  },
}));
jest.mock('../../lib/objectStorage', () => ({ deleteObject: jest.fn(), getObject: jest.fn(), getObjectText: jest.fn(), uploadObject: jest.fn() }));
jest.mock('../../lib/staticSnapshotHooks', () => ({ refreshSnapshotsForPodcastMutation: jest.fn() }));
jest.mock('../../lib/watchless/fullAnalysis', () => ({ validateAnalysisBundle: jest.fn() }));
import { createWatchlessUrlJob, failWatchlessJob, retryWatchlessUrlJob, refundWatchlessJobCredits,
  createWatchlessBundleJob, updateWatchlessJobStatus, cancelWatchlessJob } from '../../lib/watchless/jobs';

describe('Watchless actual SQLite credit and state transactions', () => {
  beforeEach(() => {
    mockDb = new DatabaseSync(':memory:');
    for (const file of ['0001_initial_schema.sql', '0005_add_watchless_publications.sql', '0006_add_watchless_jobs.sql', '0007_add_watchless_job_events.sql', '0008_watchless_analysis_origin.sql']) {
      mockDb.exec(readFileSync(join(process.cwd(), 'migrations/d1', file), 'utf8'));
    }
    mockDb.exec("INSERT INTO users(id,email,password_hash,name,credits) VALUES('u','test@example.invalid','x','Test',1000)");
    process.env.WATCHLESS_MODEL = '@cf/zai-org/glm-5.3-flash';
  });
  afterEach(() => { mockDb.close(); mockRace = false; });
  const submit = () => createWatchlessUrlJob({ userId: 'u', sourceUrl: 'https://youtu.be/abc12345678', rightsConfirmed: true, idempotencyKey: 'once' });
  const balance = () => mockRun("SELECT credits FROM users WHERE id='u'")[0].credits;
  test('999 cannot start; 1000 reserves once and failure refunds once', async () => {
    mockDb.exec("UPDATE users SET credits=999");
    await expect(submit()).rejects.toThrow();
    expect(balance()).toBe(999);
    mockDb.exec("UPDATE users SET credits=1000");
    const job = await submit();
    expect(balance()).toBe(0);
    expect((await submit()).id).toBe(job.id);
    expect(balance()).toBe(0);
    await failWatchlessJob(job.id, 'TEST_FAILURE', 'fixture');
    expect(balance()).toBe(1000);
    expect(await refundWatchlessJobCredits(job.id, 'duplicate')).toBe(false);
    expect(balance()).toBe(1000);
    expect(mockRun('SELECT SUM(delta) as delta FROM credit_transactions')[0].delta).toBe(0);
  });
  test('refunded retries count toward the three-attempt daily budget', async () => {
    const job = await submit();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await failWatchlessJob(job.id, 'TEST_FAILURE', 'fixture');
      if (attempt < 3) await retryWatchlessUrlJob(job.id, 'u');
    }
    await expect(retryWatchlessUrlJob(job.id, 'u')).rejects.toThrow();
    expect(balance()).toBe(1000);
  });
  test('queued bundles still consume the active upload quota', async () => {
    for (let i = 1; i <= 3; i++) {
      const job = await createWatchlessBundleJob({ userId: 'u', videoId: `mcp0000000${i}`, rightsConfirmed: true });
      await updateWatchlessJobStatus({ jobId: job.id, status: 'queued', expectedStatus: 'awaiting_upload' });
    }
    await expect(createWatchlessBundleJob({ userId: 'u', videoId: 'mcp00000004', rightsConfirmed: true })).rejects.toThrow('active Watchless upload');
  });
  test('cancel racing with publishing cannot refund or reverse the publication claim', async () => {
    const job = await submit();
    await updateWatchlessJobStatus({ jobId: job.id, status: 'rendering' });
    mockRace = true;
    await expect(cancelWatchlessJob(job.id, 'u')).rejects.toThrow();
    expect(mockRun('SELECT status FROM watchless_jobs')[0].status).toBe('publishing');
    expect(balance()).toBe(0);
  });
});
