'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import AppFrame from '../components/AppFrame';
import { extractPodcastTags, normalizeDbTags } from '../lib/podcastTags';
import { resolveFilePodcastTitle } from '../lib/podcastTitle';

type HomeView = 'my' | 'explore' | 'topics';
type SortKey = 'date' | 'name' | 'size';
type NavIcon = 'library' | 'compass' | 'topic' | 'star' | 'archive' | 'trash' | 'credits' | 'gift' | 'search' | 'filter';

interface PodcastApiRow {
  id: string;
  title?: string | null;
  originalFileName?: string | null;
  briefSummary?: unknown;
  fileSize?: string | null;
  blobUrl?: string | null;
  sourceReference?: string | null;
  createdAt: string;
  processedAt?: string | null;
  isProcessed?: boolean;
  isPublic?: boolean;
  wordCount?: number | null;
  durationSec?: number | null;
  tags?: unknown;
}

interface AccountOverview {
  user: {
    credits: number;
  };
}

interface SummaryItem {
  id: string;
  title: string;
  briefSummary: string | null;
  fileSize: string | null;
  sourceReference: string | null;
  createdAt: string;
  isProcessed: boolean;
  isPublic: boolean;
  wordCount: number | null;
  durationSec: number | null;
  tags: string[];
  scope: 'my' | 'explore';
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

function mapPodcastRow(row: PodcastApiRow, scope: SummaryItem['scope']): SummaryItem {
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
    createdAt: row.createdAt,
    isProcessed: Boolean(row.isProcessed),
    isPublic: Boolean(row.isPublic),
    wordCount: typeof row.wordCount === 'number' ? row.wordCount : null,
    durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
    tags: dbTags.length > 0 ? dbTags : fallbackTags,
    scope,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '-';
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) {
    return null;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

function parseSizeKb(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getInitialView(status: string): HomeView {
  if (typeof window !== 'undefined') {
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'my' || view === 'explore' || view === 'topics') {
      return view;
    }
  }
  return status === 'authenticated' ? 'my' : 'explore';
}

function getSourceLabel(item: SummaryItem): string {
  const source = item.sourceReference || '';
  if (/youtube\.com|youtu\.be/i.test(source)) {
    return 'YouTube';
  }
  const pieces = item.title.split(/[-:|]/).map((piece) => piece.trim()).filter(Boolean);
  return pieces[0]?.slice(0, 34) || (item.scope === 'my' ? 'Private Library' : 'PodSum');
}

function getCoverText(title: string): string {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'with', 'podcast']);
  const words = title
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word && !stopWords.has(word.toLowerCase()));
  if (words.length === 0) {
    return 'PS';
  }
  if (words.length === 1) {
    return words[0].slice(0, 4).toUpperCase();
  }
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

function getCoverClass(title: string): string {
  const palettes = [
    'from-[#20211e] to-[#4a493e] text-[#fff8e8]',
    'from-[#123f37] to-[#7da593] text-[#f7fbf4]',
    'from-[#3d315e] to-[#7464a3] text-[#fbf8ff]',
    'from-[#8a5f1d] to-[#e2b34a] text-[#fff9e7]',
    'from-[#253d5a] to-[#70a2bd] text-[#f8fbff]',
    'from-[#653233] to-[#c97663] text-[#fff6f1]',
  ];
  const index = Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palettes.length;
  return palettes[index];
}

function SmallIcon({ type, className = 'h-5 w-5' }: { type: NavIcon; className?: string }) {
  const common = 'currentColor';
  if (type === 'library') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M5 5.5H19V18.5H5V5.5Z" stroke={common} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 9H16M8 12H14M8 15H12" stroke={common} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'compass') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke={common} strokeWidth="1.8" />
        <path d="M14.8 9.2L13.2 13.2L9.2 14.8L10.8 10.8L14.8 9.2Z" stroke={common} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'topic') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3" stroke={common} strokeWidth="1.8" />
        <circle cx="16" cy="16" r="3" stroke={common} strokeWidth="1.8" />
        <path d="M10.4 10.4L13.6 13.6" stroke={common} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'star') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M12 4.2L14.3 9L19.6 9.7L15.8 13.4L16.8 18.6L12 16.1L7.2 18.6L8.2 13.4L4.4 9.7L9.7 9L12 4.2Z" stroke={common} strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'archive') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M5 8H19V19H5V8Z" stroke={common} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4 5H20V8H4V5ZM9 12H15" stroke={common} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'trash') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M7 8H17M10 11V17M14 11V17M9 8L9.5 5.5H14.5L15 8M8 8L8.7 19H15.3L16 8" stroke={common} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'credits') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <ellipse cx="12" cy="7" rx="6" ry="3" stroke={common} strokeWidth="1.8" />
        <path d="M6 7V13C6 14.7 8.7 16 12 16S18 14.7 18 13V7M6 10C6 11.7 8.7 13 12 13S18 11.7 18 10M6 13V16C6 17.7 8.7 19 12 19S18 17.7 18 16V13" stroke={common} strokeWidth="1.8" />
      </svg>
    );
  }
  if (type === 'gift') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M5 10H19V19H5V10Z" stroke={common} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4 7H20V10H4V7ZM12 7V19M8.5 7C7.4 6.1 7.1 4.7 8 4.1C9 3.4 10.4 4.2 12 7M15.5 7C16.6 6.1 16.9 4.7 16 4.1C15 3.4 13.6 4.2 12 7" stroke={common} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'filter') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M6 7H18M8 12H16M10 17H14" stroke={common} strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" stroke={common} strokeWidth="1.9" />
      <path d="M15 15L19 19" stroke={common} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.8 10.2L9 12.4L13.4 7.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin" fill="none" aria-hidden="true">
      <path d="M10 3A7 7 0 1 0 17 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-[var(--accent-strong)] bg-[var(--btn-primary)] text-[var(--btn-primary-text)] shadow-[0_8px_20px_-16px_rgba(47,102,86,0.8)]'
          : 'border-[var(--border-soft)] bg-[var(--paper-base)] text-[var(--text-secondary)] hover:bg-[var(--paper-muted)] hover:text-[var(--heading)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SidebarLink({
  icon,
  active,
  children,
  onClick,
}: {
  icon: NavIcon;
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-[15px] font-medium transition-colors',
        active
          ? 'bg-[var(--paper-muted)] text-[var(--heading)] shadow-[inset_0_0_0_1px_var(--border-soft)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--paper-subtle)] hover:text-[var(--heading)]',
      ].join(' ')}
    >
      <SmallIcon type={icon} className="h-5 w-5 shrink-0" />
      <span>{children}</span>
    </button>
  );
}

function StatusBadge({ item }: { item: SummaryItem }) {
  if (!item.isProcessed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff1d9] px-3 py-1 text-xs font-semibold text-[#9a5f12]">
        <SpinnerIcon />
        Processing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--heading)]">
      <CheckIcon />
      Completed
    </span>
  );
}

function SummaryCover({ item }: { item: SummaryItem }) {
  return (
    <div className={[
      'flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br p-3 text-center text-lg font-semibold leading-tight shadow-[inset_0_0_28px_rgba(255,255,255,0.12)] sm:h-28 sm:w-28',
      getCoverClass(item.title),
    ].join(' ')}
    >
      {getCoverText(item.title)}
    </div>
  );
}

function SummaryCard({ item }: { item: SummaryItem }) {
  const duration = formatDuration(item.durationSec);
  return (
    <article className="group rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-4 shadow-[0_14px_38px_-34px_rgba(80,67,44,0.55)] transition-colors hover:bg-[var(--paper-muted)]">
      <div className="flex gap-4">
        <SummaryCover item={item} />
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <Link href={`/dashboard/${item.id}`} className="min-w-0">
                <h2 className="line-clamp-2 text-lg font-semibold leading-6 text-[var(--text-main)] group-hover:text-[var(--heading)]">
                  {item.title}
                </h2>
              </Link>
              <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">
                <SmallIcon type="star" className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span>{getSourceLabel(item)}</span>
              {duration && <><span className="text-[var(--text-muted)]">•</span><span>{duration}</span></>}
              {item.wordCount ? <><span className="text-[var(--text-muted)]">•</span><span>{item.wordCount.toLocaleString()} words</span></> : null}
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-secondary)]">
              {item.briefSummary || (item.isProcessed ? 'Summary available in the dashboard.' : 'Summary is still processing.')}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.slice(0, 4).map((tag) => (
                <Link
                  key={tag}
                  href={`/?view=topics&tag=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-[var(--paper-subtle)] px-3 py-1 text-xs font-medium text-[var(--heading)] hover:bg-[var(--accent-soft)]"
                >
                  {tag}
                </Link>
              ))}
              {item.tags.length === 0 && (
                <span className="rounded-full bg-[var(--paper-subtle)] px-3 py-1 text-xs font-medium text-[var(--text-muted)]">
                  Untagged
                </span>
              )}
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 md:flex-col md:items-end">
            <div className="space-y-3 text-left md:text-right">
              <StatusBadge item={item} />
              <div className="text-sm text-[var(--text-secondary)]">{formatDate(item.createdAt)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/${item.id}`}
                className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-5 py-2 text-sm font-semibold text-[var(--text-main)] transition-colors hover:bg-[var(--paper-subtle)]"
              >
                View
              </Link>
              <button
                type="button"
                className="rounded-lg px-2 py-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--paper-subtle)] hover:text-[var(--heading)]"
                aria-label={`More actions for ${item.title}`}
              >
                ...
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function HomeWorkspace() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const [view, setView] = useState<HomeView>('explore');
  const [myItems, setMyItems] = useState<SummaryItem[]>([]);
  const [exploreItems, setExploreItems] = useState<SummaryItem[]>([]);
  const [accountOverview, setAccountOverview] = useState<AccountOverview | null>(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMy, setIsLoadingMy] = useState(false);
  const [isLoadingExplore, setIsLoadingExplore] = useState(true);

  useEffect(() => {
    const viewParam = searchParams.get('view');
    if (viewParam === 'my' || viewParam === 'explore' || viewParam === 'topics') {
      setView(viewParam);
    } else {
      setView(getInitialView(status));
    }
    setSelectedTag(searchParams.get('tag') || '');
  }, [searchParams, status]);

  const updateView = useCallback((nextView: HomeView) => {
    setView(nextView);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', nextView);
      if (nextView !== 'topics') {
        url.searchParams.delete('tag');
        setSelectedTag('');
      }
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
  }, []);

  useEffect(() => {
    async function loadExplore() {
      setIsLoadingExplore(true);
      setError(null);
      try {
        const response = await fetch('/api/podcasts?page=1&pageSize=50', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
          throw new Error(payload.error || 'Failed to load public summaries');
        }
        setExploreItems(payload.data.map((row: PodcastApiRow) => mapPodcastRow(row, 'explore')));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingExplore(false);
      }
    }
    loadExplore();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setMyItems([]);
      setAccountOverview(null);
      return;
    }

    async function loadMySummaries() {
      setIsLoadingMy(true);
      setError(null);
      try {
        const [podcastResponse, accountResponse] = await Promise.all([
          fetch('/api/podcasts?page=1&pageSize=50&includePrivate=true', { cache: 'no-store' }),
          fetch('/api/account/overview', { cache: 'no-store' }),
        ]);
        const podcastPayload = await podcastResponse.json();
        if (!podcastResponse.ok || !podcastPayload.success || !Array.isArray(podcastPayload.data)) {
          throw new Error(podcastPayload.error || 'Failed to load my summaries');
        }
        setMyItems(podcastPayload.data.map((row: PodcastApiRow) => mapPodcastRow(row, 'my')));

        if (accountResponse.ok) {
          const accountPayload = await accountResponse.json();
          if (accountPayload.success) {
            setAccountOverview(accountPayload.data);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingMy(false);
      }
    }

    loadMySummaries();
  }, [status]);

  const allTopicItems = useMemo(() => {
    const map = new Map<string, SummaryItem>();
    [...myItems, ...exploreItems].forEach((item) => map.set(`${item.scope}:${item.id}`, item));
    return Array.from(map.values());
  }, [exploreItems, myItems]);

  const topicTags = useMemo(() => {
    const counts = new Map<string, number>();
    allTopicItems.forEach((item) => {
      item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 28);
  }, [allTopicItems]);

  const sourceItems = view === 'my' ? myItems : view === 'topics' ? allTopicItems : exploreItems;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    const filtered = sourceItems.filter((item) => {
      if (view === 'topics' && selectedTag && !item.tags.includes(selectedTag)) {
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

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.title.localeCompare(b.title);
      } else if (sortBy === 'size') {
        comparison = parseSizeKb(a.fileSize) - parseSizeKb(b.fileSize);
      } else {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [normalizedQuery, selectedTag, sortBy, sortDirection, sourceItems, view]);

  const isLoading = view === 'my' ? isLoadingMy : isLoadingExplore;
  const completedCount = sourceItems.filter((item) => item.isProcessed).length;
  const processingCount = sourceItems.length - completedCount;
  const creditCount = accountOverview?.user.credits ?? null;

  return (
    <AppFrame
      activeView={view}
      showViewTabs={false}
      mainClassName="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="grid gap-6 xl:grid-cols-[270px_minmax(0,1fr)_300px]">
        <aside className="hidden xl:block">
          <div className="sticky top-[6.5rem] flex h-[calc(100vh-8rem)] flex-col justify-between">
            <nav className="space-y-2">
              <SidebarLink icon="library" active={view === 'my'} onClick={() => updateView('my')}>My Summaries</SidebarLink>
              <SidebarLink icon="compass" active={view === 'explore'} onClick={() => updateView('explore')}>Explore</SidebarLink>
              <SidebarLink icon="topic" active={view === 'topics'} onClick={() => updateView('topics')}>Topics</SidebarLink>
              <div className="h-2" />
              <SidebarLink icon="star">Starred</SidebarLink>
              <SidebarLink icon="archive">Archive</SidebarLink>
              <SidebarLink icon="trash">Trash</SidebarLink>
            </nav>

            <div className="space-y-4">
              <Link href="/account/credits" className="dashboard-panel block rounded-lg p-5 transition-colors hover:bg-[var(--paper-muted)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#fff2cf] text-[#8a6224]">
                    <SmallIcon type="credits" />
                  </span>
                  <div>
                    <div className="text-sm text-[var(--text-secondary)]">Credits</div>
                    <div className="text-2xl font-semibold text-[var(--text-main)]">
                      {creditCount === null ? '-' : creditCount.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-sm font-medium text-[var(--heading)]">View usage {'->'}</div>
              </Link>

              <Link href="/pricing" className="dashboard-panel flex items-center gap-3 rounded-lg p-4 transition-colors hover:bg-[var(--paper-muted)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--paper-subtle)] text-[#8a6224]">
                  <SmallIcon type="gift" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--text-main)]">Invite friends</div>
                  <div className="text-sm text-[var(--text-muted)]">Get more credits</div>
                </div>
                <span className="text-[var(--text-muted)]">{'->'}</span>
              </Link>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}

          <div className="dashboard-panel rounded-lg p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                  <SmallIcon type="search" />
                </span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search summaries..."
                  className="h-14 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] pl-12 pr-4 text-base text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)]"
                />
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortKey)}
                  className="h-14 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-4 text-sm text-[var(--text-main)] outline-none focus:border-[var(--border-medium)]"
                >
                  <option value="date">Date</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
                <button
                  type="button"
                  onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
                  className="flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] text-[var(--text-main)] transition-colors hover:bg-[var(--paper-muted)]"
                  title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  aria-label={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                >
                  <SmallIcon type="filter" />
                </button>
              </div>
            </div>

            {view === 'topics' && topicTags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <FilterButton active={!selectedTag} onClick={() => setSelectedTag('')}>All topics</FilterButton>
                {topicTags.slice(0, 12).map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={[
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      selectedTag === tag
                        ? 'border-[var(--accent-strong)] bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                        : 'border-[var(--border-soft)] bg-[var(--paper-base)] text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]',
                    ].join(' ')}
                  >
                    {tag} <span className="opacity-70">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === 'my' && status !== 'authenticated' ? (
            <section className="dashboard-panel rounded-lg p-10 text-center">
              <h1 className="text-2xl font-semibold text-[var(--heading)]">Sign in to see My Summaries</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                Your private uploads, processing status, and saved podcast summaries live in this workspace.
              </p>
              <Link href="/auth/signin?callbackUrl=/?view=my" className="mt-5 inline-flex rounded-lg bg-[var(--btn-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
                Sign in
              </Link>
            </section>
          ) : isLoading && visibleItems.length === 0 ? (
            <section className="dashboard-panel rounded-lg p-10 text-center text-[var(--text-muted)]">Loading summaries...</section>
          ) : visibleItems.length === 0 ? (
            <section className="dashboard-panel rounded-lg p-10 text-center">
              <h1 className="text-2xl font-semibold text-[var(--heading)]">No summaries found</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                {view === 'my' ? 'Try a different filter or upload a new transcript.' : 'Try another search or topic.'}
              </p>
              {view === 'my' && (
                <Link href="/upload" className="mt-5 inline-flex rounded-lg bg-[var(--btn-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
                  Upload
                </Link>
              )}
            </section>
          ) : (
            <div className="space-y-4">
              {visibleItems.map((item) => (
                <SummaryCard key={`${item.scope}:${item.id}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <aside className="hidden xl:block">
          <div className="sticky top-[6.5rem] space-y-5">
            <section className="dashboard-panel rounded-lg p-5">
              <h2 className="text-base font-semibold text-[var(--text-main)]">Recent Topics</h2>
              <div className="mt-4 space-y-3">
                {topicTags.slice(0, 7).map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      updateView('topics');
                      setSelectedTag(tag);
                      if (typeof window !== 'undefined') {
                        const url = new URL(window.location.href);
                        url.searchParams.set('view', 'topics');
                        url.searchParams.set('tag', tag);
                        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
                      }
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg text-left text-sm text-[var(--heading)] hover:bg-[var(--paper-muted)]"
                  >
                    <span className="rounded-full bg-[var(--paper-subtle)] px-3 py-1">{tag}</span>
                    <span className="rounded-full bg-[var(--paper-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]">{count}</span>
                  </button>
                ))}
                {topicTags.length === 0 && <p className="text-sm text-[var(--text-muted)]">Topics appear after summaries are loaded.</p>}
              </div>
              <button
                type="button"
                onClick={() => updateView('topics')}
                className="mt-5 text-sm font-medium text-[var(--heading)] hover:text-[var(--link-hover)]"
              >
                View all topics {'->'}
              </button>
            </section>

            <section className="dashboard-panel rounded-lg p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--text-main)]">Library</h2>
                <span className="text-sm text-[var(--text-muted)]">{sourceItems.length}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[var(--paper-subtle)] p-3">
                  <div className="text-2xl font-semibold text-[var(--heading)]">{completedCount}</div>
                  <div className="text-xs text-[var(--text-muted)]">Completed</div>
                </div>
                <div className="rounded-lg bg-[var(--paper-subtle)] p-3">
                  <div className="text-2xl font-semibold text-[#9a5f12]">{processingCount}</div>
                  <div className="text-xs text-[var(--text-muted)]">Processing</div>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </AppFrame>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <AppFrame activeView="explore" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="dashboard-panel rounded-lg p-10 text-center text-[var(--text-muted)]">Loading workspace...</section>
      </AppFrame>
    }>
      <HomeWorkspace />
    </Suspense>
  );
}
