/**
 * @jest-environment node
 */

jest.mock('../../lib/sql', () => ({
  isD1DatabaseProvider: jest.fn(),
  sql: jest.fn(),
}));

import {
  claimNextProcessingJob,
  completeProcessingJob,
  failProcessingJob,
  getProcessingJobLeaseSeconds,
  getProcessingWorkerConcurrency,
  updateProcessingJobProgress,
} from '../../lib/processingJobs';
import { isD1DatabaseProvider, sql } from '../../lib/sql';

const mockIsD1DatabaseProvider = isD1DatabaseProvider as jest.MockedFunction<typeof isD1DatabaseProvider>;
const mockSql = sql as jest.MockedFunction<typeof sql>;

describe('processingJobs worker lease controls', () => {
  const previousConcurrency = process.env.PROCESS_WORKER_CONCURRENCY;
  const previousLeaseSeconds = process.env.PROCESSING_JOB_LEASE_SECONDS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PROCESS_WORKER_CONCURRENCY;
    delete process.env.PROCESSING_JOB_LEASE_SECONDS;
    mockIsD1DatabaseProvider.mockReturnValue(true);
    mockSql.mockResolvedValue({ rows: [] });
  });

  afterAll(() => {
    if (previousConcurrency === undefined) {
      delete process.env.PROCESS_WORKER_CONCURRENCY;
    } else {
      process.env.PROCESS_WORKER_CONCURRENCY = previousConcurrency;
    }
    if (previousLeaseSeconds === undefined) {
      delete process.env.PROCESSING_JOB_LEASE_SECONDS;
    } else {
      process.env.PROCESSING_JOB_LEASE_SECONDS = previousLeaseSeconds;
    }
  });

  it('defaults to single-worker processing with a five minute lease', () => {
    expect(getProcessingWorkerConcurrency()).toBe(1);
    expect(getProcessingJobLeaseSeconds()).toBe(300);
  });

  it('reads positive worker controls from env', () => {
    process.env.PROCESS_WORKER_CONCURRENCY = '3';
    process.env.PROCESSING_JOB_LEASE_SECONDS = '900';

    expect(getProcessingWorkerConcurrency()).toBe(3);
    expect(getProcessingJobLeaseSeconds()).toBe(900);
  });

  it('guards D1 job claims with active worker concurrency and lease checks', async () => {
    await claimNextProcessingJob('worker-test', {
      leaseSeconds: 420,
      maxActiveWorkers: 2,
    });

    const [strings, ...values] = mockSql.mock.calls[0];
    const query = Array.from(strings as TemplateStringsArray).join('?');

    expect(query).toContain("datetime('now', '-' || ? || ' seconds')");
    expect(query).toContain('SELECT COUNT(*)');
    expect(query).toContain('< ?');
    expect(values).toEqual(['worker-test', 420, 420, 2]);
  });

  it('scopes progress and terminal updates to the worker that owns the lease', async () => {
    mockSql.mockResolvedValue({ rows: [] });

    await updateProcessingJobProgress('podcast-1', { statusMessage: 'heartbeat' }, 'worker-owner');
    await completeProcessingJob('podcast-1', 'worker-owner');
    await failProcessingJob('podcast-1', 'failed', 'worker-owner');

    for (const call of mockSql.mock.calls) {
      const [strings, ...values] = call;
      const query = Array.from(strings as TemplateStringsArray).join('?');
      expect(query).toContain("OR worker_id = ?");
      expect(values).toContain('worker-owner');
    }
  });
});
