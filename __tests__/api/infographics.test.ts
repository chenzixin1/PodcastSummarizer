/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { GET } from '../../app/api/infographics/[id]/route';
import { POST as generate } from '../../app/api/infographics/[id]/generate/route';
import { POST as retry } from '../../app/api/infographics/[id]/retry/route';
import { getAnalysisResults, getPodcast } from '../../lib/db';
import {
  enqueueInfographicJob,
  getInfographicJob,
  retryInfographicJob,
  type InfographicJob,
  type InfographicJobStatus,
} from '../../lib/infographicJobs';
import { triggerWorkerProcessing } from '../../lib/workerTrigger';

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: jest.fn((callback: () => unknown) => void callback()) };
});
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../lib/auth', () => ({ authOptions: {} }));
jest.mock('../../lib/db', () => ({ getPodcast: jest.fn(), getAnalysisResults: jest.fn() }));
jest.mock('../../lib/infographicJobs', () => ({
  getInfographicJob: jest.fn(),
  enqueueInfographicJob: jest.fn(),
  retryInfographicJob: jest.fn(),
  mapInfographicJobToResponse: jest.requireActual('../../lib/infographicJobs').mapInfographicJobToResponse,
}));
jest.mock('../../lib/workerTrigger', () => ({ triggerWorkerProcessing: jest.fn() }));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockGetPodcast = getPodcast as jest.MockedFunction<typeof getPodcast>;
const mockGetAnalysisResults = getAnalysisResults as jest.MockedFunction<typeof getAnalysisResults>;
const mockGetInfographicJob = getInfographicJob as jest.MockedFunction<typeof getInfographicJob>;
const mockEnqueueInfographicJob = enqueueInfographicJob as jest.MockedFunction<typeof enqueueInfographicJob>;
const mockRetryInfographicJob = retryInfographicJob as jest.MockedFunction<typeof retryInfographicJob>;
const mockTriggerWorkerProcessing = triggerWorkerProcessing as jest.MockedFunction<typeof triggerWorkerProcessing>;

const id = 'pod-1';
const context = { params: Promise.resolve({ id }) };
const request = () => new NextRequest(`http://localhost/api/infographics/${id}`, { method: 'POST' });
const job = (status: InfographicJobStatus = 'pending'): InfographicJob => ({
  podcastId: id,
  status,
  model: 'google/gemini-3-pro-image',
  promptVersion: 'podsum-infographic-v1',
  artifactUrl: status === 'completed' ? 'https://example.test/infographic.svg' : null,
  artifactMediaType: status === 'completed' ? 'image/svg+xml' : null,
  sourceTitle: 'A title',
  sourceUrl: 'https://youtu.be/video',
  attempts: 1,
  nextAttemptAt: null,
  leaseExpiresAt: null,
  workerId: null,
  costUsd: 0.88,
  errorCode: 'provider_error',
  errorMessage: 'private provider details',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  completedAt: null,
});

describe('infographic API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockGetPodcast.mockResolvedValue({ success: true, data: { id, isPublic: true, userId: 'owner-1' } });
    mockGetAnalysisResults.mockResolvedValue({ success: true, data: { summaryZh: '完整总结' } });
    mockGetInfographicJob.mockResolvedValue({ success: true, data: job('completed') });
    mockEnqueueInfographicJob.mockResolvedValue({ success: true, data: job('pending') });
    mockRetryInfographicJob.mockResolvedValue({ success: true, data: job('pending') });
    mockTriggerWorkerProcessing.mockResolvedValue({ success: true });
  });

  it('lets anonymous users read a public status without exposing internal fields', async () => {
    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: expect.objectContaining({ status: 'completed', canRetry: false }) });
    expect(body.data.costUsd).toBeUndefined();
    expect(body.data.errorMessage).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('provider_error');
    expect(body.data.prompt).toBeUndefined();
  });

  it('maps a missing job to unavailable', async () => {
    mockGetInfographicJob.mockResolvedValue({ success: false, data: null, error: 'Infographic job not found' });
    const body = await (await GET(request(), context)).json();
    expect(body.data).toEqual(expect.objectContaining({ status: 'unavailable', canRetry: false }));
  });

  it('does not turn a job lookup failure into an unavailable status', async () => {
    mockGetInfographicJob.mockResolvedValue({ success: false, data: null, error: 'Database unavailable' });
    const response = await GET(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to get infographic status' });
  });

  it('requires authentication for a private podcast and denies a non-owner', async () => {
    mockGetPodcast.mockResolvedValue({ success: true, data: { id, isPublic: false, userId: 'owner-1' } });
    let response = await GET(request(), context);
    expect(response.status).toBe(401);

    mockGetServerSession.mockResolvedValue({ user: { id: 'other-user' } });
    response = await GET(request(), context);
    expect(response.status).toBe(403);
  });

  it('returns canRetry only to the exact owner', async () => {
    mockGetInfographicJob.mockResolvedValue({ success: true, data: job('failed') });
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    const ownerBody = await (await GET(request(), context)).json();
    expect(ownerBody.data.canRetry).toBe(true);

    mockGetServerSession.mockResolvedValue({ user: { id: 'other-user' } });
    const otherBody = await (await GET(request(), context)).json();
    expect(otherBody.data.canRetry).toBe(false);
  });

  it('allows the editor to generate a historical completed analysis and triggers the worker', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    const response = await generate(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: expect.objectContaining({ status: 'pending', canRetry: false }) });
    expect(mockEnqueueInfographicJob).toHaveBeenCalledWith(id);
    expect(mockTriggerWorkerProcessing).toHaveBeenCalledWith('infographic_command', id);
  });

  it('refuses generate for a public anonymous viewer, public non-owner, and incomplete analysis', async () => {
    let response = await generate(request(), context);
    expect(response.status).toBe(401);

    mockGetServerSession.mockResolvedValue({ user: { id: 'other-user' } });
    response = await generate(request(), context);
    expect(response.status).toBe(403);

    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    mockGetAnalysisResults.mockResolvedValue({ success: false, data: null });
    response = await generate(request(), context);
    expect(response.status).toBe(409);
    expect(mockEnqueueInfographicJob).not.toHaveBeenCalled();
  });

  it('does not expose queue errors from generate or retry commands', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    mockEnqueueInfographicJob.mockResolvedValue({ success: false, error: 'OPENROUTER_API_KEY=secret' });
    let response = await generate(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to enqueue infographic' });

    mockRetryInfographicJob.mockResolvedValue({ success: false, error: 'postgres://admin:secret@db' });
    response = await retry(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'Infographic cannot be retried' });
  });

  it('keeps repeated generate idempotent by returning the existing job', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    mockEnqueueInfographicJob.mockResolvedValue({ success: true, data: job('processing') });
    const body = await (await generate(request(), context)).json();
    expect(body.data).toEqual(expect.objectContaining({ status: 'processing' }));
    expect(mockEnqueueInfographicJob).toHaveBeenCalledTimes(1);
  });

  it('retries only a failed job through the editor command', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1' } });
    const response = await retry(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: expect.objectContaining({ status: 'pending', canRetry: false }) });
    expect(mockRetryInfographicJob).toHaveBeenCalledWith(id);

    mockRetryInfographicJob.mockResolvedValue({ success: false, error: 'Infographic job not found or cannot be retried' });
    const cannotRetry = await retry(request(), context);
    expect(cannotRetry.status).toBe(409);
  });
});
