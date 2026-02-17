import { NextRequest, NextResponse } from 'next/server';
import {
  listPendingBilingualAlignmentRows,
  saveBilingualAlignmentPayload,
  type PendingBilingualAlignmentRow,
} from '../../../../lib/db';
import {
  BILINGUAL_ALIGNMENT_VERSION,
  buildFullTextBilingualPayload,
  buildSummaryBilingualPayload,
} from '../../../../lib/bilingualAlignment';
import {
  applyLlmFallbackToFullTextPayload,
  applyLlmFallbackToSummaryPayload,
} from '../../../../lib/bilingualAlignmentLlm';
import {
  getCronSecret,
  getWorkerSharedSecrets,
  isWorkerAuthorizedBySecret,
} from '../../../../lib/workerAuth';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = getCronSecret();
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const workerSecret = request.headers.get('x-worker-secret');
  if (isWorkerAuthorizedBySecret(workerSecret)) {
    return true;
  }

  if (!cronSecret && getWorkerSharedSecrets().length === 0 && process.env.NODE_ENV !== 'production') {
    return true;
  }

  return false;
}

function normalizeLimit(value: string | null): number {
  if (!value) {
    return 3;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }
  return Math.min(20, parsed);
}

function normalizeMaxMissing(value: string | null): number {
  if (!value) {
    return 20;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(20, parsed);
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = normalizeLimit(url.searchParams.get('limit'));
    const maxMissing = normalizeMaxMissing(url.searchParams.get('maxMissing'));

    const pendingResult = await listPendingBilingualAlignmentRows(limit);
    if (!pendingResult.success) {
      return NextResponse.json(
        { success: false, error: pendingResult.error || 'Failed to query pending rows' },
        { status: 500 }
      );
    }

    const rows = Array.isArray(pendingResult.data)
      ? (pendingResult.data as PendingBilingualAlignmentRow[])
      : [];

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          processed: 0,
          matched: 0,
          llmMatched: 0,
          unmatched: 0,
          failed: 0,
          message: 'No pending bilingual alignment rows',
        },
      });
    }

    let processed = 0;
    let matched = 0;
    let llmMatched = 0;
    let unmatched = 0;
    let failed = 0;

    for (const row of rows) {
      const podcastId = String(row.podcastId || '').trim();
      if (!podcastId) {
        failed += 1;
        continue;
      }

      const summaryEn = String(row.summaryEn || '').trim();
      const summaryZh = String(row.summaryZh || '').trim();
      const translation = String(row.translation || '').trim();
      const highlights = String(row.highlights || '').trim();

      try {
        const deterministicFullText = buildFullTextBilingualPayload(translation, highlights, {
          nearWindowSec: 12,
        });
        const deterministicSummary = buildSummaryBilingualPayload(summaryEn, summaryZh);

        const [fullTextFallbackResult, summaryFallbackResult] = await Promise.all([
          applyLlmFallbackToFullTextPayload(deterministicFullText, {
            fullTextZh: highlights,
            maxMissing,
          }),
          applyLlmFallbackToSummaryPayload(deterministicSummary, {
            summaryZh,
            maxMissing,
          }),
        ]);

        const nextFullText = fullTextFallbackResult.payload;
        const nextSummary = summaryFallbackResult.payload;

        const saveResult = await saveBilingualAlignmentPayload({
          podcastId,
          fullTextBilingualJson: nextFullText,
          summaryBilingualJson: nextSummary,
          bilingualAlignmentVersion: BILINGUAL_ALIGNMENT_VERSION,
        });

        if (!saveResult.success) {
          failed += 1;
          continue;
        }

        processed += 1;
        matched += nextFullText.stats.matched + nextSummary.stats.matched;
        llmMatched += nextFullText.stats.llmMatched + nextSummary.stats.llmMatched;
        unmatched += nextFullText.stats.unmatched + nextSummary.stats.unmatched;
      } catch (error) {
        failed += 1;
        console.error('[alignment-backfill] failed podcast:', podcastId, error);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        processed,
        matched,
        llmMatched,
        unmatched,
        failed,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
