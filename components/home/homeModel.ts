import { extractPodcastTags, normalizeDbTags } from '../../lib/podcastTags';
import { resolveFilePodcastTitle } from '../../lib/podcastTitle';

export type HomeView = 'my' | 'explore' | 'topics' | 'starred';
export type SortKey = 'date' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface PodcastApiRow {
  id: string;
  title?: string | null;
  originalFileName?: string | null;
  briefSummary?: unknown;
  fileSize?: string | null;
  blobUrl?: string | null;
  sourceReference?: string | null;
  sourcePublishedAt?: string | null;
  createdAt: string;
  processedAt?: string | null;
  isProcessed?: boolean;
  isPublic?: boolean;
  wordCount?: number | null;
  durationSec?: number | null;
  tags?: unknown;
}

export interface SummaryItem {
  id: string;
  title: string;
  briefSummary: string | null;
  fileSize: string | null;
  sourceReference: string | null;
  sourcePublishedAt: string | null;
  createdAt: string;
  isProcessed: boolean;
  isPublic: boolean;
  wordCount: number | null;
  durationSec: number | null;
  tags: string[];
  scope: 'my' | 'explore';
}

export function readSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseHomeView(value: string | string[] | undefined): HomeView {
  const view = readSearchParam(value);
  return view === 'my' || view === 'explore' || view === 'topics' || view === 'starred'
    ? view
    : 'explore';
}

function normalizeBriefSummary(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .replace(/#\s*English Summary/gi, ' ')
    .replace(/#\s*中文总结/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

export function mapPodcastRow(row: PodcastApiRow, scope: SummaryItem['scope']): SummaryItem {
  const title =
    (typeof row.title === 'string' ? row.title.trim() : '') ||
    resolveFilePodcastTitle(String(row.originalFileName || ''));
  const dbTags = normalizeDbTags(row.tags);
  const fallbackTags = extractPodcastTags({
    title,
    sourceReference: row.sourceReference || null,
    fallbackName: row.originalFileName || null,
  });

  return {
    id: row.id,
    title,
    briefSummary: normalizeBriefSummary(row.briefSummary),
    fileSize: row.fileSize || null,
    sourceReference: row.sourceReference || null,
    sourcePublishedAt: row.sourcePublishedAt || null,
    createdAt: row.createdAt,
    isProcessed: Boolean(row.isProcessed),
    isPublic: Boolean(row.isPublic),
    wordCount: typeof row.wordCount === 'number' ? row.wordCount : null,
    durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
    tags: dbTags.length > 0 ? dbTags : fallbackTags,
    scope,
  };
}

export function mergeSummaryItems(
  current: SummaryItem[],
  incoming: SummaryItem[],
  replace: boolean,
): SummaryItem[] {
  if (replace) {
    return incoming;
  }
  const merged = new Map<string, SummaryItem>();
  current.forEach((item) => merged.set(item.id, item));
  incoming.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

export function parseStoredStarredIds(value: string | null): Set<string> {
  if (!value) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
    }
  } catch {
    // Ignore malformed local storage data and start with an empty collection.
  }

  return new Set();
}

export function itemDisplayDate(item: SummaryItem): string {
  return item.sourcePublishedAt || item.createdAt;
}

export function formatCoverDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).toUpperCase()
    : '';
}

export function formatSummaryDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    : '-';
}

function parseSizeKb(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function filterSummaryItems(
  items: SummaryItem[],
  options: { view: HomeView; selectedTag: string; query: string },
): SummaryItem[] {
  const normalizedQuery = options.query.trim().toLowerCase();
  return items.filter((item) => {
    if (options.view === 'topics' && options.selectedTag && !item.tags.includes(options.selectedTag)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return (
      item.title.toLowerCase().includes(normalizedQuery) ||
      (item.briefSummary || '').toLowerCase().includes(normalizedQuery) ||
      item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      (item.sourceReference || '').toLowerCase().includes(normalizedQuery)
    );
  });
}

export function sortSummaryItems(
  items: SummaryItem[],
  sortBy: SortKey,
  sortDirection: SortDirection,
): SummaryItem[] {
  return [...items].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = a.title.localeCompare(b.title);
    } else if (sortBy === 'size') {
      comparison = parseSizeKb(a.fileSize) - parseSizeKb(b.fileSize);
    } else {
      comparison = new Date(itemDisplayDate(a)).getTime() - new Date(itemDisplayDate(b)).getTime();
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}
