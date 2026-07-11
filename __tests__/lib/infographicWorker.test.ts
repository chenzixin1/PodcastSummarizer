jest.mock('../../lib/infographicJobs', () => ({
  claimNextInfographicJob: jest.fn(),
  completeInfographicJob: jest.fn(),
  getInfographicJobLeaseSeconds: jest.fn(),
  getInfographicWorkerConcurrency: jest.fn(),
  heartbeatInfographicJob: jest.fn(),
  recordInfographicFailure: jest.fn(),
}));

jest.mock('../../lib/db', () => ({
  getAnalysisResults: jest.fn(),
  getPodcast: jest.fn(),
}));

jest.mock('../../lib/infographicPrompt', () => ({
  buildInfographicPrompt: jest.fn(),
}));

jest.mock('../../lib/infographicImage', () => {
  const actual = jest.requireActual('../../lib/infographicImage');
  return {
    ...actual,
    composeInfographicSvg: jest.fn(),
    generateInfographicRaster: jest.fn(),
  };
});

jest.mock('../../lib/objectStorage', () => ({
  deleteObject: jest.fn(),
  uploadObject: jest.fn(),
}));

import { getAnalysisResults, getPodcast } from '../../lib/db';
import {
  claimNextInfographicJob,
  completeInfographicJob,
  getInfographicJobLeaseSeconds,
  getInfographicWorkerConcurrency,
  heartbeatInfographicJob,
  recordInfographicFailure,
  type InfographicJob,
} from '../../lib/infographicJobs';
import {
  composeInfographicSvg,
  generateInfographicRaster,
  InfographicGenerationError,
} from '../../lib/infographicImage';
import { buildInfographicPrompt } from '../../lib/infographicPrompt';
import { deleteObject, uploadObject } from '../../lib/objectStorage';
import { processNextInfographicJob } from '../../lib/infographicWorker';

const mockClaim = claimNextInfographicJob as jest.MockedFunction<typeof claimNextInfographicJob>;
const mockComplete = completeInfographicJob as jest.MockedFunction<typeof completeInfographicJob>;
const mockGetLeaseSeconds = getInfographicJobLeaseSeconds as jest.MockedFunction<typeof getInfographicJobLeaseSeconds>;
const mockGetConcurrency = getInfographicWorkerConcurrency as jest.MockedFunction<typeof getInfographicWorkerConcurrency>;
const mockHeartbeat = heartbeatInfographicJob as jest.MockedFunction<typeof heartbeatInfographicJob>;
const mockRecordFailure = recordInfographicFailure as jest.MockedFunction<typeof recordInfographicFailure>;
const mockGetPodcast = getPodcast as jest.MockedFunction<typeof getPodcast>;
const mockGetAnalysis = getAnalysisResults as jest.MockedFunction<typeof getAnalysisResults>;
const mockBuildPrompt = buildInfographicPrompt as jest.MockedFunction<typeof buildInfographicPrompt>;
const mockGenerate = generateInfographicRaster as jest.MockedFunction<typeof generateInfographicRaster>;
const mockCompose = composeInfographicSvg as jest.MockedFunction<typeof composeInfographicSvg>;
const mockUploadObject = uploadObject as jest.MockedFunction<typeof uploadObject>;
const mockDeleteObject = deleteObject as jest.MockedFunction<typeof deleteObject>;

const claimedJob: InfographicJob = {
  podcastId: 'pod-1',
  status: 'processing',
  model: 'google/gemini-3-pro-image',
  promptVersion: 'podsum-infographic-v1',
  artifactUrl: null,
  artifactMediaType: null,
  sourceTitle: 'Video title',
  sourceUrl: 'https://www.youtube.com/watch?v=abc123',
  attempts: 1,
  nextAttemptAt: null,
  leaseExpiresAt: '2026-07-11T12:10:00.000Z',
  workerId: 'worker-info',
  costUsd: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-07-11T12:00:00.000Z',
  updatedAt: '2026-07-11T12:00:00.000Z',
  completedAt: null,
};

const raster = {
  base64: 'aW1hZ2U=',
  mediaType: 'image/png' as const,
  bytes: new Uint8Array([1, 2, 3]),
  width: 1200,
  height: 1600,
  costUsd: 0.14,
};

describe('processNextInfographicJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockGetLeaseSeconds.mockReturnValue(600);
    mockGetConcurrency.mockReturnValue(1);
    mockClaim.mockResolvedValue({ success: true, data: claimedJob });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: { title: 'Video title', sourceReference: claimedJob.sourceUrl },
    });
    mockGetAnalysis.mockResolvedValue({
      success: true,
      data: {
        summaryZh: '# 核心观点\n- 持续学习',
        summary: 'Legacy summary',
        briefSummary: '一句话总结',
      },
    });
    mockBuildPrompt.mockReturnValue('grounded prompt');
    mockGenerate.mockResolvedValue(raster);
    mockCompose.mockReturnValue(new TextEncoder().encode('<svg>ready</svg>'));
    mockUploadObject.mockResolvedValue({
      key: 'infographics/pod-1/podsum-infographic-v1.svg',
      provider: 'r2',
      url: 'https://cdn.example.com/pod-1.svg',
    });
    mockDeleteObject.mockResolvedValue();
    mockComplete.mockResolvedValue({ success: true, data: { ...claimedJob, status: 'completed' } });
    mockHeartbeat.mockResolvedValue({ success: true, data: claimedJob });
    mockRecordFailure.mockImplementation(async (_podcastId, _workerId, failure) => ({
      success: true,
      data: {
        ...claimedJob,
        status: failure.transient && claimedJob.attempts < 3 ? 'pending' : 'failed',
      },
    }));
  });

  it('claims, generates, verifies, and completes one job in order', async () => {
    const result = await processNextInfographicJob('worker-info');

    expect(result).toEqual({ processed: true, podcastId: 'pod-1', status: 'completed' });
    expect(mockClaim).toHaveBeenCalledWith('worker-info', { leaseSeconds: 600, maxActiveWorkers: 1 });
    expect(mockBuildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      originalTitle: 'Video title',
      summaryZh: '# 核心观点\n- 持续学习',
    }));
    expect(mockGenerate).toHaveBeenCalledWith('grounded prompt');
    expect(mockCompose).toHaveBeenCalledWith(expect.objectContaining({
      raster,
      sourceTitle: 'Video title',
      sourceUrl: claimedJob.sourceUrl,
    }));
    expect(mockUploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^infographics\/pod-1\/podsum-infographic-v1\/1-worker-info\.svg$/),
      '<svg>ready</svg>',
      { contentType: 'image/svg+xml' },
    );
    expect(mockComplete).toHaveBeenCalledWith('pod-1', 'worker-info', {
      artifactUrl: 'https://cdn.example.com/pod-1.svg',
      artifactMediaType: 'image/svg+xml',
      costUsd: 0.14,
    });
    expect(mockUploadObject.mock.invocationCallOrder[0]).toBeLessThan(mockComplete.mock.invocationCallOrder[0]);
  });

  it('returns idle when there is no due job', async () => {
    mockClaim.mockResolvedValue({ success: true, data: null });

    await expect(processNextInfographicJob('worker-info')).resolves.toEqual({
      processed: false,
      podcastId: null,
      status: 'idle',
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('fails permanently when analysis is missing', async () => {
    mockGetAnalysis.mockResolvedValue({ success: false, error: 'Analysis results not found' });

    await expect(processNextInfographicJob('worker-info')).resolves.toEqual({
      processed: true,
      podcastId: 'pod-1',
      status: 'failed',
    });
    expect(mockRecordFailure).toHaveBeenCalledWith('pod-1', 'worker-info', {
      transient: false,
      errorCode: 'missing_analysis',
      message: 'Analysis results not found',
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('schedules retries for transient generation failures', async () => {
    mockGenerate.mockRejectedValue(new InfographicGenerationError(
      'upstream_timeout',
      true,
      'Image provider request timed out',
    ));

    await expect(processNextInfographicJob('worker-info')).resolves.toEqual({
      processed: true,
      podcastId: 'pod-1',
      status: 'retry_scheduled',
    });
    expect(mockRecordFailure).toHaveBeenCalledWith('pod-1', 'worker-info', {
      transient: true,
      errorCode: 'upstream_timeout',
      message: 'Image provider request timed out',
    });
  });

  it('records policy failures as permanent', async () => {
    mockGenerate.mockRejectedValue(new InfographicGenerationError(
      'policy_violation',
      false,
      'Image provider rejected the request',
    ));

    await expect(processNextInfographicJob('worker-info')).resolves.toMatchObject({ status: 'failed' });
    expect(mockRecordFailure).toHaveBeenCalledWith('pod-1', 'worker-info', expect.objectContaining({
      transient: false,
      errorCode: 'policy_violation',
    }));
  });

  it('maps read-after-write verification failures to a retry', async () => {
    mockUploadObject.mockRejectedValue(new Error(
      'Object storage write verification failed for key: infographics/pod-1/podsum-infographic-v1.svg',
    ));

    await expect(processNextInfographicJob('worker-info')).resolves.toMatchObject({ status: 'retry_scheduled' });
    expect(mockRecordFailure).toHaveBeenCalledWith('pod-1', 'worker-info', expect.objectContaining({
      transient: true,
      errorCode: 'artifact_verification_failed',
    }));
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('does not delete an uploaded artifact when completion loses the lease', async () => {
    mockComplete.mockResolvedValue({ success: false, error: 'lease is no longer owned' });

    await expect(processNextInfographicJob('worker-info')).resolves.toMatchObject({ status: 'failed' });

    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('rechecks the lease before deleting an artifact after a post-upload failure', async () => {
    mockComplete.mockRejectedValue(new Error('completion write failed'));

    await expect(processNextInfographicJob('worker-info')).resolves.toMatchObject({ status: 'retry_scheduled' });

    expect(mockHeartbeat).toHaveBeenCalledWith('pod-1', 'worker-info', { leaseSeconds: 600 });
    expect(mockDeleteObject).toHaveBeenCalledWith('https://cdn.example.com/pod-1.svg');
  });

  it('heartbeats through generation and artifact persistence, then stops after completion', async () => {
    jest.useFakeTimers();
    let finishGeneration!: (value: typeof raster) => void;
    let finishUpload!: (value: { key: string; provider: 'r2'; url: string }) => void;
    let finishCompletion!: (value: Awaited<ReturnType<typeof completeInfographicJob>>) => void;
    mockGenerate.mockReturnValue(new Promise(resolve => {
      finishGeneration = resolve;
    }));
    mockUploadObject.mockReturnValue(new Promise(resolve => {
      finishUpload = resolve;
    }));
    mockComplete.mockReturnValue(new Promise(resolve => {
      finishCompletion = resolve;
    }));

    const processing = processNextInfographicJob('worker-info');
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockHeartbeat).toHaveBeenCalledWith('pod-1', 'worker-info', { leaseSeconds: 600 });
    finishGeneration(raster);
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
    finishUpload({
      key: 'infographics/pod-1/podsum-infographic-v1.svg',
      provider: 'r2',
      url: 'https://cdn.example.com/pod-1.svg',
    });
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    finishCompletion({ success: true, data: { ...claimedJob, status: 'completed' } });
    await processing;
    const heartbeatCount = mockHeartbeat.mock.calls.length;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockHeartbeat).toHaveBeenCalledTimes(heartbeatCount);
  });

  it('keeps heartbeating until fenced failure recording completes', async () => {
    jest.useFakeTimers();
    let finishFailure!: (value: Awaited<ReturnType<typeof recordInfographicFailure>>) => void;
    mockGenerate.mockRejectedValue(new InfographicGenerationError(
      'upstream_timeout',
      true,
      'Image provider request timed out',
    ));
    mockRecordFailure.mockReturnValue(new Promise(resolve => {
      finishFailure = resolve;
    }));

    const processing = processNextInfographicJob('worker-info');
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockHeartbeat).toHaveBeenCalledWith('pod-1', 'worker-info', { leaseSeconds: 600 });
    finishFailure({ success: true, data: { ...claimedJob, status: 'pending' } });
    await processing;
    const heartbeatCount = mockHeartbeat.mock.calls.length;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockHeartbeat).toHaveBeenCalledTimes(heartbeatCount);
  });

  it('composes a footer without a source URL when none exists', async () => {
    mockClaim.mockResolvedValue({ success: true, data: { ...claimedJob, sourceUrl: null } });
    mockGetPodcast.mockResolvedValue({
      success: true,
      data: { title: 'Video title', sourceReference: null },
    });

    await processNextInfographicJob('worker-info');

    expect(mockCompose).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: null }));
  });

  it('stops before R2 upload when a heartbeat loses the lease during generation', async () => {
    jest.useFakeTimers();
    let finishGeneration!: (value: typeof raster) => void;
    mockGenerate.mockReturnValue(new Promise(resolve => {
      finishGeneration = resolve;
    }));
    mockHeartbeat.mockResolvedValue({ success: false, error: 'lease lost' });

    const processing = processNextInfographicJob('worker-info');
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60_000);
    finishGeneration(raster);

    await expect(processing).resolves.toEqual({ processed: true, podcastId: 'pod-1', status: 'failed' });
    expect(mockUploadObject).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('does not write provider secrets or payloads to logs', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGenerate.mockRejectedValue(new InfographicGenerationError(
      'provider_error',
      false,
      'Authorization: Bearer sk-secret provider payload={"private":"value"}',
    ));

    await processNextInfographicJob('worker-info');

    const logs = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logs).not.toContain('sk-secret');
    expect(logs).not.toContain('private');
    expect(logs).not.toContain('Bearer');
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
