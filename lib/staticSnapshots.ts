import { getAllPodcasts, getAnalysisResults, getPodcast } from './db';
import { deleteObject, getObjectText, uploadObject } from './objectStorage';

const SNAPSHOT_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_PUBLIC_LIST_PAGE_SIZE = 12;
const DEFAULT_PUBLIC_LIST_SNAPSHOT_PAGES = 3;

export const ANALYSIS_SNAPSHOT_VERSION = 1;
export const PUBLIC_LIST_SNAPSHOT_VERSION = 1;

export const ANALYSIS_SNAPSHOT_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';
export const PUBLIC_LIST_SNAPSHOT_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

type SnapshotObject = Record<string, unknown>;

export interface AnalysisSnapshotPayload {
  snapshotVersion: number;
  generatedAt: string;
  data: {
    podcast: SnapshotObject;
    analysis: SnapshotObject;
    isProcessed: true;
    processingJob: null;
    canEdit: false;
  };
}

export interface PublicListSnapshotPayload {
  snapshotVersion: number;
  generatedAt: string;
  page: number;
  pageSize: number;
  data: SnapshotObject[];
}

export interface SnapshotPublishResult {
  success: boolean;
  published?: boolean;
  error?: string;
}

function snapshotSegment(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
}

export function analysisSnapshotKey(podcastId: string): string {
  const segment = snapshotSegment(podcastId);
  return `snapshots/analysis/${segment || 'missing'}.json`;
}

export function normalizePage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function normalizePageSize(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(50, Math.floor(value)))
    : DEFAULT_PUBLIC_LIST_PAGE_SIZE;
}

export function publicListSnapshotKey(page: number, pageSize: number): string {
  return `snapshots/lists/public-page-${normalizePage(page)}-size-${normalizePageSize(pageSize)}.json`;
}

function snapshotPageCount(value = Number(process.env.PUBLIC_LIST_SNAPSHOT_PAGES)): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PUBLIC_LIST_SNAPSHOT_PAGES;
  }
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function asRecord(value: unknown): SnapshotObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as SnapshotObject;
}

function extractLegacySummary(summary: string): { zh: string; en: string } {
  const normalized = String(summary || '').trim();
  if (!normalized) {
    return { zh: '', en: '' };
  }
  const enIndex = normalized.search(/#\s*English Summary/i);
  const zhIndex = normalized.search(/#\s*中文总结/i);
  if (enIndex >= 0 && zhIndex > enIndex) {
    return {
      en: normalized.slice(enIndex, zhIndex).trim(),
      zh: normalized.slice(zhIndex).trim(),
    };
  }
  if (zhIndex >= 0) {
    return {
      en: normalized.slice(0, zhIndex).trim(),
      zh: normalized.slice(zhIndex).trim(),
    };
  }
  return { zh: normalized, en: '' };
}

function hasCompleteAnalysis(analysis: SnapshotObject | null): boolean {
  if (!analysis) {
    return false;
  }
  const legacySummary = extractLegacySummary(String(analysis.summary || ''));
  const summaryZh = String(analysis.summaryZh || legacySummary.zh || analysis.summary || '').trim();
  const highlights = String(analysis.highlights || '').trim();
  return Boolean(summaryZh && highlights);
}

async function writeJsonSnapshot(key: string, payload: unknown): Promise<void> {
  await uploadObject(key, JSON.stringify(payload), {
    contentType: SNAPSHOT_CONTENT_TYPE,
  });
}

async function readJsonSnapshot<T>(key: string): Promise<T | null> {
  try {
    const text = await getObjectText(key);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function getAnalysisSnapshot(podcastId: string): Promise<AnalysisSnapshotPayload | null> {
  const snapshot = await readJsonSnapshot<AnalysisSnapshotPayload>(analysisSnapshotKey(podcastId));
  if (!snapshot || snapshot.snapshotVersion !== ANALYSIS_SNAPSHOT_VERSION) {
    return null;
  }

  const data = asRecord(snapshot.data);
  const podcast = asRecord(data?.podcast);
  const analysis = asRecord(data?.analysis);
  if (!data || !podcast || !analysis) {
    return null;
  }

  if (podcast.id !== podcastId || podcast.isPublic !== true) {
    return null;
  }

  if (data.isProcessed !== true || data.processingJob !== null || data.canEdit !== false) {
    return null;
  }

  if (!hasCompleteAnalysis(analysis)) {
    return null;
  }

  return snapshot;
}

export async function getPublicListSnapshot(page: number, pageSize: number): Promise<PublicListSnapshotPayload | null> {
  const normalizedPage = normalizePage(page);
  const normalizedPageSize = normalizePageSize(pageSize);
  const snapshot = await readJsonSnapshot<PublicListSnapshotPayload>(
    publicListSnapshotKey(normalizedPage, normalizedPageSize),
  );

  if (!snapshot || snapshot.snapshotVersion !== PUBLIC_LIST_SNAPSHOT_VERSION) {
    return null;
  }

  if (snapshot.page !== normalizedPage || snapshot.pageSize !== normalizedPageSize || !Array.isArray(snapshot.data)) {
    return null;
  }

  return snapshot;
}

export async function publishAnalysisSnapshotForPodcast(podcastId: string): Promise<SnapshotPublishResult> {
  try {
    const podcastResult = await getPodcast(podcastId);
    if (!podcastResult.success) {
      await deleteObject(analysisSnapshotKey(podcastId));
      return { success: true, published: false };
    }

    const podcast = asRecord(podcastResult.data);
    if (!podcast || podcast.isPublic !== true) {
      await deleteObject(analysisSnapshotKey(podcastId));
      return { success: true, published: false };
    }

    const analysisResult = await getAnalysisResults(podcastId);
    const analysis = analysisResult.success ? asRecord(analysisResult.data) : null;
    if (!hasCompleteAnalysis(analysis)) {
      await deleteObject(analysisSnapshotKey(podcastId));
      return { success: true, published: false };
    }
    const analysisPayload = analysis as SnapshotObject;

    const payload: AnalysisSnapshotPayload = {
      snapshotVersion: ANALYSIS_SNAPSHOT_VERSION,
      generatedAt: new Date().toISOString(),
      data: {
        podcast,
        analysis: analysisPayload,
        isProcessed: true,
        processingJob: null,
        canEdit: false,
      },
    };

    await writeJsonSnapshot(analysisSnapshotKey(podcastId), payload);
    return { success: true, published: true };
  } catch (error) {
    return {
      success: false,
      published: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function rebuildPublicListSnapshots(
  options: { pageSize?: number; pages?: number } = {},
): Promise<SnapshotPublishResult> {
  const pageSize = normalizePageSize(options.pageSize ?? DEFAULT_PUBLIC_LIST_PAGE_SIZE);
  const pages = options.pages === undefined ? snapshotPageCount() : normalizePage(options.pages);

  try {
    for (let page = 1; page <= pages; page += 1) {
      const result = await getAllPodcasts(page, pageSize, false);
      if (!result.success) {
        return { success: false, published: false, error: result.error || 'Failed to load public podcasts' };
      }

      const data = Array.isArray(result.data) ? result.data : [];
      const payload: PublicListSnapshotPayload = {
        snapshotVersion: PUBLIC_LIST_SNAPSHOT_VERSION,
        generatedAt: new Date().toISOString(),
        page,
        pageSize,
        data: data.map((item) => asRecord(item)).filter((item): item is SnapshotObject => item !== null),
      };

      await writeJsonSnapshot(publicListSnapshotKey(page, pageSize), payload);
    }

    return { success: true, published: true };
  } catch (error) {
    return {
      success: false,
      published: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshStaticSnapshotsForPodcast(podcastId: string): Promise<SnapshotPublishResult> {
  const analysisResult = await publishAnalysisSnapshotForPodcast(podcastId);
  const listResult = await rebuildPublicListSnapshots();

  if (!analysisResult.success || !listResult.success) {
    return {
      success: false,
      published: Boolean(analysisResult.published || listResult.published),
      error: analysisResult.error || listResult.error || 'Failed to refresh static snapshots',
    };
  }

  return {
    success: true,
    published: Boolean(analysisResult.published || listResult.published),
  };
}
