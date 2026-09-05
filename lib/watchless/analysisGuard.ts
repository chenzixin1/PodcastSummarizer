import { getD1DatabaseBinding } from '../sql';
import { getObjectText } from '../objectStorage';

export interface WatchlessAnalysisLease {
  articleKey: string;
  workerId: string;
  leaseSeconds: number;
}

export function watchlessDatabase() {
  const db = getD1DatabaseBinding();
  if (!db) throw new Error('WATCHLESS_D1_REQUIRED');
  return db;
}

export const ANALYSIS_LEASE_CONDITION = `EXISTS (
  SELECT 1 FROM watchless_publications w JOIN processing_jobs j ON j.podcast_id = w.podcast_id
  WHERE w.podcast_id = ? AND w.article_key = ? AND w.status = 'published'
    AND j.status = 'processing' AND j.worker_id = ?
    AND j.updated_at >= datetime('now', '-' || ? || ' seconds')
)`;

export function analysisLeaseValues(podcastId: string, lease: WatchlessAnalysisLease): unknown[] {
  if (!lease.articleKey || !lease.workerId || !Number.isFinite(lease.leaseSeconds) || lease.leaseSeconds <= 0) {
    throw new Error('WATCHLESS_ANALYSIS_LEASE_REQUIRED');
  }
  return [podcastId, lease.articleKey, lease.workerId, Math.floor(lease.leaseSeconds)];
}

/** A cancelled/reassigned worker or superseded article must stop before spending more. */
export async function assertWatchlessAnalysisLease(podcastId: string, lease: WatchlessAnalysisLease): Promise<void> {
  const result = await watchlessDatabase().prepare(`SELECT 1 AS owned WHERE ${ANALYSIS_LEASE_CONDITION}`)
    .bind(...analysisLeaseValues(podcastId, lease)).all();
  if (!result.results?.length) throw new Error('WATCHLESS_ANALYSIS_SUPERSEDED: article changed or worker lease lost');
}

/** Storage outages/corrupt checkpoints are not permission to regenerate paid work. */
export async function readWatchlessCheckpoint(key: string): Promise<unknown | undefined> {
  let text: string;
  try { text = await getObjectText(key); }
  catch (error) {
    if (error instanceof Error && /^(?:File not found in object storage\.?|Object not found\.?|not found)$/i.test(error.message)) return undefined;
    throw error;
  }
  return JSON.parse(text) as unknown;
}
