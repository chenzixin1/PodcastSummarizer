/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/worker/alignment-backfill/route';

jest.mock('../../lib/db', () => ({
  listPendingBilingualAlignmentRows: jest.fn(),
  saveBilingualAlignmentPayload: jest.fn(),
}));

jest.mock('../../lib/bilingualAlignment', () => ({
  BILINGUAL_ALIGNMENT_VERSION: 1,
  buildFullTextBilingualPayload: jest.fn(),
  buildSummaryBilingualPayload: jest.fn(),
}));

jest.mock('../../lib/bilingualAlignmentLlm', () => ({
  applyLlmFallbackToFullTextPayload: jest.fn(),
  applyLlmFallbackToSummaryPayload: jest.fn(),
}));

const { listPendingBilingualAlignmentRows, saveBilingualAlignmentPayload } = require('../../lib/db');
const { buildFullTextBilingualPayload, buildSummaryBilingualPayload } = require('../../lib/bilingualAlignment');
const { applyLlmFallbackToFullTextPayload, applyLlmFallbackToSummaryPayload } = require('../../lib/bilingualAlignmentLlm');

describe('/api/worker/alignment-backfill', () => {
  const previousCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';

    buildFullTextBilingualPayload.mockReturnValue({
      version: 1,
      pairs: [],
      stats: { total: 2, matched: 2, llmMatched: 1, unmatched: 0, methods: {} },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    buildSummaryBilingualPayload.mockReturnValue({
      version: 1,
      sections: [],
      stats: { total: 1, matched: 1, llmMatched: 0, unmatched: 0, methods: {} },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    applyLlmFallbackToFullTextPayload.mockResolvedValue({
      payload: {
        version: 1,
        pairs: [],
        stats: { total: 2, matched: 2, llmMatched: 1, unmatched: 0, methods: {} },
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      attempted: 1,
      llmMatched: 1,
    });
    applyLlmFallbackToSummaryPayload.mockResolvedValue({
      payload: {
        version: 1,
        sections: [],
        stats: { total: 1, matched: 1, llmMatched: 0, unmatched: 0, methods: {} },
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      attempted: 0,
      llmMatched: 0,
    });

    saveBilingualAlignmentPayload.mockResolvedValue({ success: true, data: { podcastId: 'pod-1' } });
  });

  afterAll(() => {
    process.env.CRON_SECRET = previousCronSecret;
  });

  test('rejects unauthorized request', async () => {
    const request = new NextRequest('http://localhost/api/worker/alignment-backfill', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });

  test('returns empty metrics when there are no pending rows', async () => {
    listPendingBilingualAlignmentRows.mockResolvedValue({ success: true, data: [] });

    const request = new NextRequest('http://localhost/api/worker/alignment-backfill', {
      method: 'POST',
      headers: {
        authorization: 'Bearer cron-secret',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.processed).toBe(0);
    expect(data.data.failed).toBe(0);
  });

  test('supports cron GET invocation', async () => {
    listPendingBilingualAlignmentRows.mockResolvedValue({ success: true, data: [] });

    const request = new NextRequest('http://localhost/api/worker/alignment-backfill', {
      method: 'GET',
      headers: {
        authorization: 'Bearer cron-secret',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.processed).toBe(0);
  });

  test('processes pending rows and saves alignment payload', async () => {
    listPendingBilingualAlignmentRows.mockResolvedValue({
      success: true,
      data: [
        {
          podcastId: 'pod-1',
          summaryEn: 'EN summary',
          summaryZh: 'ZH summary',
          translation: 'EN full text',
          highlights: 'ZH full text',
          fullTextBilingualJson: null,
          summaryBilingualJson: null,
          bilingualAlignmentVersion: 0,
        },
      ],
    });

    const request = new NextRequest('http://localhost/api/worker/alignment-backfill?limit=3', {
      method: 'POST',
      headers: {
        authorization: 'Bearer cron-secret',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.processed).toBe(1);
    expect(data.data.matched).toBe(3);
    expect(data.data.llmMatched).toBe(1);
    expect(data.data.unmatched).toBe(0);
    expect(data.data.failed).toBe(0);

    expect(saveBilingualAlignmentPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        podcastId: 'pod-1',
        bilingualAlignmentVersion: 1,
      })
    );
  });
});
