import 'server-only';
import type { PodcastApiRow } from '../components/home/homeModel';
import { getAllPodcasts } from './db';
import { getPublicListSnapshot } from './staticSnapshots';

const HOMEPAGE_PAGE_SIZE = 12;

function normalizeDate(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizePublicRow(value: unknown): PodcastApiRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const createdAt = normalizeDate(row.createdAt);
  if (typeof row.id !== 'string' || row.id.length === 0 || !createdAt || row.isPublic !== true) {
    return null;
  }

  return {
    id: row.id,
    title: nullableString(row.title),
    originalFileName: nullableString(row.originalFileName),
    briefSummary: nullableString(row.briefSummary),
    fileSize: nullableString(row.fileSize),
    blobUrl: nullableString(row.blobUrl),
    sourceReference: nullableString(row.sourceReference),
    sourcePublishedAt: normalizeDate(row.sourcePublishedAt),
    createdAt,
    processedAt: normalizeDate(row.processedAt),
    isProcessed: row.isProcessed === true,
    isPublic: true,
    wordCount: typeof row.wordCount === 'number' ? row.wordCount : null,
    durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
    tags: row.tags,
  };
}

function normalizePublicRows(value: unknown): PodcastApiRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: PodcastApiRow[] = [];
  for (const valueRow of value) {
    const row = normalizePublicRow(valueRow);
    if (row) {
      rows.push(row);
    }
    if (rows.length === HOMEPAGE_PAGE_SIZE) {
      break;
    }
  }
  return rows;
}

export async function getHomepagePublicData(): Promise<{
  rows: PodcastApiRow[];
  generatedAt: string | null;
}> {
  try {
    const snapshot = await getPublicListSnapshot(1, HOMEPAGE_PAGE_SIZE);
    if (snapshot) {
      return {
        rows: normalizePublicRows(snapshot.data),
        generatedAt: snapshot.generatedAt || null,
      };
    }
  } catch {
    // R2 snapshots are an acceleration layer; D1 remains the fallback source.
  }

  try {
    const result = await getAllPodcasts(1, HOMEPAGE_PAGE_SIZE, false);
    if (result.success) {
      return {
        rows: normalizePublicRows(result.data),
        generatedAt: null,
      };
    }
  } catch {
    // The homepage must remain available even if both public data sources fail.
  }

  return { rows: [], generatedAt: null };
}
