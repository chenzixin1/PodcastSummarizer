import { pageOwnedWatchlessJobs } from '../../lib/watchless/jobs';
import { sql } from '../../lib/sql';
jest.mock('../../lib/sql', () => ({ sql: jest.fn(), getD1DatabaseBinding: jest.fn() }));
const { DatabaseSync } = jest.requireActual('node:sqlite');

describe('owned job pagination', () => {
  let db: InstanceType<typeof DatabaseSync>;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE watchless_jobs (id TEXT, user_id TEXT, status TEXT, source_kind TEXT, created_at TEXT)');
    for (let i = 0; i < 45; i++) db.prepare('INSERT INTO watchless_jobs VALUES(?,?,?,?,?)').run(`job-${String(i).padStart(3, '0')}`, 'owner', i % 2 ? 'failed' : 'completed', i % 2 ? 'url' : 'mcp_bundle', '2026-09-08 01:00:00');
    db.prepare('INSERT INTO watchless_jobs VALUES(?,?,?,?,?)').run('private-other', 'other', 'failed', 'url', '2026-09-09 01:00:00');
    (sql as unknown as jest.Mock).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => ({ rows: db.prepare(strings.join('?')).all(...values) }));
  });
  afterEach(() => db.close());
  test('all pages include both sources, deterministic order, no other user', async () => {
    const pages = await Promise.all([1, 2, 3].map(page => pageOwnedWatchlessJobs('owner', page, 'all')));
    expect(pages[0].pagination).toMatchObject({ total: 45, totalPages: 3, pageSize: 20 });
    const jobs = pages.flatMap(page => page.jobs);
    expect(new Set(jobs.map(job => job.id)).size).toBe(45);
    expect(jobs.some(job => job.id === 'private-other')).toBe(false);
    expect(new Set(jobs.map(job => job.sourceKind))).toEqual(new Set(['url', 'mcp_bundle']));
  });
  test('filters both count and rows by owner and status', async () => {
    const result = await pageOwnedWatchlessJobs('owner', 1, 'failed');
    expect(result.pagination.total).toBe(22);
    expect(result.jobs.every(job => job.status === 'failed')).toBe(true);
    expect((await pageOwnedWatchlessJobs('nobody', 1, 'all')).jobs).toEqual([]);
  });
  test('clamps past last page and rejects malformed pagination', async () => {
    expect((await pageOwnedWatchlessJobs('owner', 99, 'all')).pagination.page).toBe(3);
    for (const page of [0, -1, .5, Infinity, NaN, 100001]) await expect(pageOwnedWatchlessJobs('owner', page, 'all')).rejects.toThrow();
    await expect(pageOwnedWatchlessJobs('owner', 1, "' OR 1=1")).rejects.toThrow();
  });
});
