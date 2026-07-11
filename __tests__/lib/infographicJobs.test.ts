/**
 * @jest-environment node
 */

jest.mock('../../lib/sql', () => ({
  isD1DatabaseProvider: jest.fn(),
  sql: jest.fn(),
}));

import {
  claimNextInfographicJob,
  completeInfographicJob,
  enqueueInfographicJob,
  heartbeatInfographicJob,
  mapInfographicJobToResponse,
  reconcileInfographicJobs,
  recordInfographicFailure,
  retryInfographicJob,
} from '../../lib/infographicJobs';
import { isD1DatabaseProvider, sql } from '../../lib/sql';

const mockIsD1DatabaseProvider = isD1DatabaseProvider as jest.MockedFunction<typeof isD1DatabaseProvider>;
const mockSql = sql as jest.MockedFunction<typeof sql>;

const pendingJob = {
  podcastId: 'pod-1',
  status: 'pending',
  model: 'google/gemini-3-pro-image',
  promptVersion: 'podsum-infographic-v1',
  artifactUrl: null,
  artifactMediaType: null,
  sourceTitle: 'Episode one',
  sourceUrl: 'https://example.com/episode-one',
  attempts: 0,
  nextAttemptAt: null,
  leaseExpiresAt: null,
  workerId: null,
  costUsd: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-07-11 10:00:00',
  updatedAt: '2026-07-11 10:00:00',
  completedAt: null,
};

function queryFrom(strings: TemplateStringsArray): string {
  return Array.from(strings).join('?');
}

describe('infographicJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsD1DatabaseProvider.mockReturnValue(true);
    mockSql.mockResolvedValue({ rows: [] });
  });

  it('idempotently enqueues an analyzed podcast and leaves an existing completed job unchanged', async () => {
    let selectedJob: Record<string, unknown> = pendingJob;
    mockSql.mockImplementation(async (strings) => {
      const query = queryFrom(strings);
      if (query.includes('SELECT') && query.includes('FROM infographic_jobs')) {
        return { rows: [selectedJob] } as any;
      }
      return { rows: [] } as any;
    });

    expect(await enqueueInfographicJob('pod-1')).toMatchObject({
      success: true,
      data: { podcastId: 'pod-1', status: 'pending', promptVersion: 'podsum-infographic-v1' },
    });
    expect(await enqueueInfographicJob('pod-1')).toMatchObject({
      success: true,
      data: { podcastId: 'pod-1', status: 'pending' },
    });

    selectedJob = { ...pendingJob, status: 'completed', artifactUrl: 'https://cdn.example.com/pod-1.svg' };
    expect(await enqueueInfographicJob('pod-1')).toMatchObject({
      success: true,
      data: { status: 'completed', artifactUrl: 'https://cdn.example.com/pod-1.svg' },
    });

    const insertCalls = mockSql.mock.calls.filter(([strings]) => queryFrom(strings as TemplateStringsArray).includes('INSERT INTO infographic_jobs'));
    expect(insertCalls).toHaveLength(3);
    const query = queryFrom(insertCalls[0][0] as TemplateStringsArray);
    expect(query).toContain('FROM podcasts p');
    expect(query).toContain('JOIN analysis_results ar');
    expect(query).toContain('ON CONFLICT (podcast_id) DO NOTHING');
    expect(query).not.toContain('DO UPDATE');
  });

  it('atomically claims due work, preserves live leases, and reclaims stale leases', async () => {
    mockSql.mockResolvedValue({
      rows: [{ ...pendingJob, status: 'processing', attempts: 1, workerId: 'worker-1', leaseExpiresAt: '2026-07-11 10:10:00' }],
    } as any);

    expect(await claimNextInfographicJob('worker-1', { leaseSeconds: 600 })).toMatchObject({
      success: true,
      data: { status: 'processing', attempts: 1, workerId: 'worker-1' },
    });

    const [strings, ...values] = mockSql.mock.calls[0];
    const query = queryFrom(strings as TemplateStringsArray);
    expect(query).toContain("status = 'pending'");
    expect(query).toContain('next_attempt_at <= CURRENT_TIMESTAMP');
    expect(query).toContain("status = 'processing'");
    expect(query).toContain('lease_expires_at < CURRENT_TIMESTAMP');
    expect(query).toContain("datetime('now', '+' || ? || ' seconds')");
    expect(query).toContain('UPDATE infographic_jobs');
    expect(values).toEqual(['worker-1', 600]);
  });

  it('fences heartbeats and completion to the worker that owns the lease', async () => {
    mockSql.mockResolvedValue({ rows: [{ ...pendingJob, status: 'processing', workerId: 'worker-owner' }] } as any);

    await heartbeatInfographicJob('pod-1', 'worker-owner', { leaseSeconds: 300 });
    await completeInfographicJob('pod-1', 'worker-owner', {
      artifactUrl: 'https://cdn.example.com/pod-1.svg',
      artifactMediaType: 'image/svg+xml',
      costUsd: 0.14,
    });

    for (const [strings, ...values] of mockSql.mock.calls) {
      const query = queryFrom(strings as TemplateStringsArray);
      expect(query).toContain('worker_id = ?');
      expect(values).toContain('worker-owner');
    }
  });

  it('schedules transient failures after attempts one and two, then terminally fails at three', async () => {
    const outcomes = [
      { ...pendingJob, status: 'pending', attempts: 1, nextAttemptAt: '2026-07-11 10:01:00' },
      { ...pendingJob, status: 'pending', attempts: 2, nextAttemptAt: '2026-07-11 10:05:00' },
      { ...pendingJob, status: 'failed', attempts: 3, errorCode: 'upstream_timeout' },
    ];
    mockSql.mockImplementation(async () => ({ rows: [outcomes.shift()] } as any));

    expect(await recordInfographicFailure('pod-1', 'worker-1', {
      transient: true,
      errorCode: 'upstream_timeout',
      message: 'OpenRouter timed out',
    })).toMatchObject({ success: true, data: { status: 'pending', attempts: 1 } });
    expect(await recordInfographicFailure('pod-1', 'worker-1', {
      transient: true,
      errorCode: 'upstream_timeout',
      message: 'OpenRouter timed out',
    })).toMatchObject({ success: true, data: { status: 'pending', attempts: 2 } });
    expect(await recordInfographicFailure('pod-1', 'worker-1', {
      transient: true,
      errorCode: 'upstream_timeout',
      message: 'OpenRouter timed out',
    })).toMatchObject({ success: true, data: { status: 'failed', attempts: 3 } });

    const [strings, ...values] = mockSql.mock.calls[0];
    const query = queryFrom(strings as TemplateStringsArray);
    expect(query).toContain('attempts < 3');
    expect(query).toContain("datetime('now', '+1 minute')");
    expect(query).toContain("datetime('now', '+5 minutes')");
    expect(query).toContain('worker_id = ?');
    expect(values).toContain('worker-1');
  });

  it('uses PostgreSQL interval syntax for failure retries outside D1', async () => {
    mockIsD1DatabaseProvider.mockReturnValue(false);
    mockSql.mockResolvedValue({ rows: [{ ...pendingJob, status: 'pending', attempts: 1 }] } as any);

    await recordInfographicFailure('pod-1', 'worker-1', {
      transient: true,
      errorCode: 'upstream_timeout',
      message: 'OpenRouter timed out',
    });

    const failureCall = mockSql.mock.calls.find(([strings]) => queryFrom(strings as TemplateStringsArray).includes('UPDATE infographic_jobs'));
    expect(failureCall).toBeDefined();
    const query = queryFrom(failureCall![0] as TemplateStringsArray);
    expect(query).toContain("CURRENT_TIMESTAMP + INTERVAL '1 minute'");
    expect(query).toContain("CURRENT_TIMESTAMP + INTERVAL '5 minutes'");
    expect(query).not.toContain("datetime('now'");
  });

  it('redacts, normalizes, and bounds persisted failure diagnostics', async () => {
    mockSql.mockResolvedValue({ rows: [{ ...pendingJob, status: 'failed', attempts: 3 }] } as any);
    const base64Payload = 'a'.repeat(64);
    const rawMessage = `Authorization: Bearer sk-live-super-secret-token provider body: {"prompt":"private prompt","key":"abc"} ${base64Payload} ${'timeout '.repeat(100)}`;

    await recordInfographicFailure('pod-1', 'worker-1', {
      transient: false,
      errorCode: 'OpenRouter / 500',
      message: rawMessage,
    });

    const [, ...values] = mockSql.mock.calls[0];
    const persistedCode = values.find((value) => value === 'provider_error');
    const persistedMessage = values.find((value) => typeof value === 'string' && String(value).includes('[REDACTED')) as string;
    expect(persistedCode).toBe('provider_error');
    expect(persistedMessage).toContain('[REDACTED]');
    expect(persistedMessage).toContain('[REDACTED_PROVIDER_BODY]');
    expect(persistedMessage).not.toContain('sk-live-super-secret-token');
    expect(persistedMessage).not.toContain('private prompt');
    expect(persistedMessage).not.toContain(base64Payload);
    expect(persistedMessage).toContain('[REDACTED_BASE64]');
    expect(persistedMessage.length).toBeLessThanOrEqual(512);
  });

  it('allows editor retries only for failed rows', async () => {
    mockSql.mockResolvedValue({ rows: [{ ...pendingJob, attempts: 0, errorCode: null, errorMessage: null }] } as any);

    expect(await retryInfographicJob('pod-1')).toMatchObject({ success: true, data: { status: 'pending' } });

    const [strings] = mockSql.mock.calls[0];
    const query = queryFrom(strings as TemplateStringsArray);
    expect(query).toContain("WHERE podcast_id = ?\n        AND status = 'failed'");
  });

  it('maps only public status fields and exposes retry eligibility to editors', () => {
    expect(mapInfographicJobToResponse(null, false)).toEqual({
      status: 'unavailable', artifactUrl: null, mediaType: null, model: null,
      promptVersion: null, updatedAt: null, canRetry: false,
    });
    expect(mapInfographicJobToResponse({ ...pendingJob, status: 'failed', costUsd: 0.14, errorMessage: 'private details' }, true)).toEqual({
      status: 'failed',
      artifactUrl: null,
      mediaType: null,
      model: 'google/gemini-3-pro-image',
      promptVersion: 'podsum-infographic-v1',
      updatedAt: '2026-07-11 10:00:00',
      canRetry: true,
    });
  });

  it('reconciles only analyzed podcasts after activation with a D1-compatible timestamp and bounded limit', async () => {
    mockSql.mockResolvedValue({ rows: [], rowCount: 2 } as any);

    await reconcileInfographicJobs({ activationTime: '2026-07-11T12:34:56.789Z', limit: 20 });

    const [strings, ...values] = mockSql.mock.calls[0];
    const query = queryFrom(strings as TemplateStringsArray);
    expect(query).toContain('JOIN analysis_results ar');
    expect(query).toContain('ar.processed_at >= ?');
    expect(query).toContain('LIMIT ?');
    expect(query).toContain('ON CONFLICT (podcast_id) DO NOTHING');
    expect(values).toContain('2026-07-11 12:34:56');
    expect(values).toContain(20);
  });
});
