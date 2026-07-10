/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/worker/process/route';

jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  claimNextProcessingJob: jest.fn(),
  completeProcessingJob: jest.fn(),
  failProcessingJob: jest.fn(),
  getProcessingJobLeaseSeconds: jest.fn(),
  getProcessingWorkerConcurrency: jest.fn(),
  updateProcessingJobProgress: jest.fn(),
}));

jest.mock('../../lib/workerAuth', () => ({
  getCronSecret: jest.fn(),
  getPreferredWorkerSecretForInternalCalls: jest.fn(),
  getWorkerSharedSecrets: jest.fn(),
  isWorkerAuthorizedBySecret: jest.fn(),
}));

jest.mock('../../app/api/process/route', () => ({
  POST: jest.fn(),
}));

const processingJobs = require('../../lib/processingJobs');
const workerAuth = require('../../lib/workerAuth');

describe('POST /api/worker/process', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    workerAuth.getCronSecret.mockReturnValue(null);
    workerAuth.getWorkerSharedSecrets.mockReturnValue(['worker-secret']);
    workerAuth.isWorkerAuthorizedBySecret.mockReturnValue(true);
    processingJobs.getProcessingJobLeaseSeconds.mockReturnValue(300);
    processingJobs.getProcessingWorkerConcurrency.mockReturnValue(1);
    processingJobs.claimNextProcessingJob.mockResolvedValue({ success: true, data: null });
  });

  it('claims work with the configured lease and concurrency guard', async () => {
    const request = new NextRequest('http://localhost:3000/api/worker/process', {
      method: 'POST',
      headers: {
        'x-worker-secret': 'worker-secret',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(processingJobs.claimNextProcessingJob).toHaveBeenCalledWith(expect.stringMatching(/^worker-/), {
      leaseSeconds: 300,
      maxActiveWorkers: 1,
    });
  });
});
