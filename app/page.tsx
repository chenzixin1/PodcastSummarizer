'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import AppFrame from '../components/AppFrame';
import { extractPodcastTags, normalizeDbTags } from '../lib/podcastTags';
import { resolveFilePodcastTitle } from '../lib/podcastTitle';

type HomeView = 'my' | 'explore' | 'topics' | 'starred';
type SortKey = 'date' | 'name' | 'size';
type NavIcon = 'library' | 'compass' | 'topic' | 'star' | 'credits' | 'gift' | 'search' | 'filter';

const SUMMARY_PAGE_SIZE = 12;
const STARRED_SUMMARIES_STORAGE_KEY = 'podsum-starred-summary-ids';
const TOPIC_TAG_LIMIT = 48;
const TOPIC_FILTER_LIMIT = 32;
const RECENT_TOPIC_LIMIT = 22;

interface PodcastApiRow {
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

interface SummaryItem {
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

interface EditorialCoverSpec {
  kicker: string;
  titleLines: string[];
  footer: string;
  ghost: string;
  toneClass: string;
  isCjk: boolean;
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

function mergeSummaryItems(current: SummaryItem[], incoming: SummaryItem[], replace: boolean): SummaryItem[] {
  if (replace) {
    return incoming;
  }
  const merged = new Map<string, SummaryItem>();
  current.forEach((item) => merged.set(item.id, item));
  incoming.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

function parseStoredStarredIds(value: string | null): Set<string> {
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

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '-';
}

function itemDisplayDate(item: SummaryItem): string {
  return item.sourcePublishedAt || item.createdAt;
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
    if (view === 'my' || view === 'explore' || view === 'topics' || view === 'starred') {
      return view;
    }
  }
  return status === 'authenticated' ? 'my' : 'explore';
}

function cleanSourceCandidate(value: string): string | null {
  const cleaned = value
    .replace(/\b(interview|podcast|episode|full conversation)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—|:：]+|[\s\-–—|:：]+$/g, '')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 34) {
    return null;
  }
  if (!/[A-Za-z0-9\u3400-\u9fff]/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function inferSourceLabelFromTitle(title: string): string | null {
  const withMatch = title.match(/\bwith\s+([^,|–—-]{2,34})$/i);
  const withCandidate = withMatch?.[1] ? cleanSourceCandidate(withMatch[1]) : null;
  if (withCandidate) {
    return withCandidate;
  }

  const chinesePrefix = title.includes('：') ? cleanSourceCandidate(title.split('：')[0] || '') : null;
  if (chinesePrefix) {
    return chinesePrefix;
  }

  const asciiPrefix = title.includes(':') ? cleanSourceCandidate(title.split(':')[0] || '') : null;
  if (asciiPrefix) {
    return asciiPrefix;
  }

  const pipePieces = title.split('|').map((piece) => piece.trim()).filter(Boolean);
  const pipeSuffix = pipePieces.length > 1 ? cleanSourceCandidate(pipePieces[pipePieces.length - 1] || '') : null;
  if (pipeSuffix) {
    return pipeSuffix;
  }

  const dashPieces = title.split(/\s+[–—-]\s+/).map((piece) => piece.trim()).filter(Boolean);
  if (dashPieces.length > 1) {
    const suffix = cleanSourceCandidate(dashPieces[dashPieces.length - 1] || '');
    if (suffix) {
      return suffix;
    }
    const prefix = cleanSourceCandidate(dashPieces[0] || '');
    if (prefix) {
      return prefix;
    }
  }

  return null;
}

function getSourceLabel(item: SummaryItem): string {
  const source = item.sourceReference || '';
  const inferredSource = inferSourceLabelFromTitle(item.title);
  if (/youtube\.com|youtu\.be/i.test(source)) {
    const channelTag = item.tags.find((tag) => tag.toLowerCase() !== 'youtube');
    return inferredSource || channelTag || 'YouTube';
  }
  if (inferredSource) {
    return inferredSource;
  }
  const pieces = item.title.split(/[-:|：]/).map((piece) => piece.trim()).filter(Boolean);
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

const EDITORIAL_COVER_TONES = [
  'from-[#20483e] to-[#88a58e] text-[#fff8e8] border-[#70947f]',
  'from-[#6f3932] to-[#d49b75] text-[#fff8e8] border-[#ad765e]',
  'from-[#7d551c] to-[#e2bc5d] text-[#fff9df] border-[#b88a31]',
  'from-[#24231f] to-[#5f6254] text-[#fff7e6] border-[#656453]',
  'from-[#2f594d] to-[#c1b779] text-[#fff9e7] border-[#8e9667]',
];

const COVER_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'with',
  'for',
  'from',
  'how',
  'why',
  'what',
  'actually',
  'interview',
  'podcast',
  'building',
  'next',
  'generation',
]);

const COVER_PREFERRED_TERMS = [
  'GPT',
  'Claude',
  'Gemini',
  'OpenAI',
  'Codex',
  'LLM',
  'GPU',
  'AI',
  'KV',
  'API',
  'Tokens',
  'Inference',
  'Agents',
  'Agentic',
  'Vibe',
  'Coding',
  'Memory',
  'Context',
  'Eval',
  'Routing',
  'Edge',
];

function getCoverHash(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function compactCoverWord(word: string): string {
  if (/[\u3400-\u9fff]/.test(word)) {
    return word.length <= 4 ? word : word.slice(0, 4);
  }

  const normalized = word.toUpperCase();
  const compact: Record<string, string> = {
    ACTUALLY: 'REAL',
    AGGREGATION: 'AGGREG',
    BANDWIDTH: 'BANDWD',
    BUSINESS: 'BIZ',
    CHANGES: 'SHIFTS',
    CONTEXT: 'CTX',
    DEVELOPER: 'DEV',
    DEVELOPERS: 'DEVS',
    ECONOMICS: 'ECON',
    ENGINEERING: 'ENG',
    EVALUATION: 'EVALS',
    INFERENCE: 'INFER',
    INFRASTRUCTURE: 'INFRA',
    KNOWLEDGE: 'KNOW',
    PRODUCTS: 'PRODUCT',
    RELIABLE: 'RELIAB',
    ROUTING: 'ROUTE',
    SOFTWARE: 'SOFTWR',
    WORKFLOWS: 'FLOW',
    DWARKESH: 'DWARK',
    SEMIANALYSIS: 'SEMI',
    PRAGMATIC: 'PRAG',
    ENGINEER: 'ENGR',
    INVEST: 'INVEST',
  };
  return compact[normalized] || (normalized.length <= 7 ? normalized : normalized.slice(0, 7));
}

function formatCoverDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
    : '';
}

function getCoverInitials(title: string): string {
  if (/[\u3400-\u9fff]/.test(title)) {
    return '中';
  }
  return getCoverText(title);
}

function getCoverKicker(item: SummaryItem): string {
  const sourceName = getSourceLabel(item);
  const sourceAliases: Record<string, string> = {
    'Andrej Karpathy': 'KARPATHY',
    'Dylan Patel': 'DYLAN',
    'Invest Like the Best': 'ILTB',
    'Jensen Huang': 'JENSEN',
    'Latent Space': 'LATENT',
    'No Priors': 'NO PRIORS',
    "OpenAI's Codex Lead": 'CODEX',
    'Reiner Pope': 'REINER',
    SemiAnalysis: 'SEMI',
    'Sundar Pichai': 'SUNDAR',
    'Demis Hassabis': 'DEMIS',
    'The Pragmatic Engineer': 'PRAG ENG',
    最佳拍档: '最佳拍档',
  };
  if (sourceAliases[sourceName]) {
    return sourceAliases[sourceName];
  }

  const sourceWords = sourceName
    .split(/[^A-Za-z0-9\u3400-\u9fff]+/)
    .map((word) => compactCoverWord(word))
    .filter((word) => word && !['A', 'AN', 'THE'].includes(word));

  return sourceWords.length > 1 ? sourceWords.slice(0, 2).join(' ') : sourceWords[0] || 'PODSUM';
}

function buildCoverTitleLines(item: SummaryItem): string[] {
  const afterAsciiColon = item.title.includes(':') ? item.title.split(':').slice(1).join(':') : item.title;
  const titleBody = afterAsciiColon.includes('：')
    ? afterAsciiColon.split('：').slice(1).join('：')
    : afterAsciiColon;

  if (/[\u3400-\u9fff]/.test(titleBody)) {
    if (/蓝鲸|ITSM|落地/.test(titleBody)) {
      return ['蓝鲸', 'ITSM', '落地'];
    }
    if (/AI 原生|AI Native/i.test(titleBody)) {
      return ['AI', '原生', '工作流'];
    }
    if (/半导体|HBM|算力/.test(titleBody)) {
      return ['HBM', '供需', '算力'];
    }
    if (/Agent|Demo|交付/i.test(titleBody)) {
      return ['AGENT', '真实', '交付'];
    }

    const chineseTerms = titleBody.match(/[\u3400-\u9fff]{2,4}|[A-Za-z]{2,8}/g) || [];
    return chineseTerms
      .filter((term) => !['为什么', '如何', '走向', '真实'].includes(term))
      .slice(0, 3)
      .map((term) => compactCoverWord(term));
  }

  if (/Vibe Coding/i.test(afterAsciiColon)) {
    return ['VIBE', 'CODING'];
  }
  if (/AI Tokens/i.test(afterAsciiColon)) {
    return ['AI', 'TOKENS'];
  }
  if (/Infrastructure/i.test(afterAsciiColon)) {
    return ['INFRA', 'AGENTS'];
  }
  if (/Long Context/i.test(afterAsciiColon)) {
    return ['LONG', 'CTX'];
  }
  if (/Model Routing/i.test(afterAsciiColon)) {
    return ['MODEL', 'ROUTE'];
  }
  if (/Private Knowledge/i.test(afterAsciiColon)) {
    return ['PRIVATE', 'KNOW'];
  }
  if (/TPU competition/i.test(afterAsciiColon)) {
    return ['TPU', 'CHINA', 'NVIDIA'];
  }
  if (/history and future of AI at Google/i.test(afterAsciiColon)) {
    return ['GOOGLE', 'AI', 'FUTURE'];
  }
  if (/bottlenecks in AI/i.test(afterAsciiColon)) {
    return ['AGI', 'AI', 'LIMITS'];
  }

  const matches = COVER_PREFERRED_TERMS.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(afterAsciiColon));
  if (matches.length >= 2) {
    return Array.from(new Set(matches.slice(0, 3).map((term) => compactCoverWord(term))));
  }

  const words = afterAsciiColon
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !COVER_STOP_WORDS.has(word.toLowerCase()));

  return words.slice(0, 3).map((word) => compactCoverWord(word));
}

function buildEditorialCoverSpec(item: SummaryItem): EditorialCoverSpec {
  const titleLines = buildCoverTitleLines(item);
  const ghost = getCoverInitials(item.title);
  const lines = titleLines.length > 0 ? titleLines.slice(0, 3) : [ghost];
  const kicker = getCoverKicker(item);
  const duration = formatDuration(item.durationSec)?.replace(/\s+/g, '').toUpperCase() || '';
  const footer = [formatCoverDate(itemDisplayDate(item)), duration].filter(Boolean).join(' / ');
  const toneClass = EDITORIAL_COVER_TONES[getCoverHash(item.title) % EDITORIAL_COVER_TONES.length];

  return {
    kicker,
    titleLines: lines,
    footer,
    ghost,
    toneClass,
    isCjk: /[\u3400-\u9fff]/.test(lines.join('') + kicker),
  };
}

function SmallIcon({ type, className = 'h-5 w-5', filled = false }: { type: NavIcon; className?: string; filled?: boolean }) {
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
      <svg viewBox="0 0 24 24" className={className} fill={filled ? common : 'none'} aria-hidden="true">
        <path d="M12 4.2L14.3 9L19.6 9.7L15.8 13.4L16.8 18.6L12 16.1L7.2 18.6L8.2 13.4L4.4 9.7L9.7 9L12 4.2Z" stroke={common} strokeWidth="1.7" strokeLinejoin="round" />
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
  const [coverSpec, setCoverSpec] = useState<EditorialCoverSpec | null>(null);

  useEffect(() => {
    let cancelled = false;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const requestIdle = idleWindow.requestIdleCallback?.bind(window);
    const cancelIdle = idleWindow.cancelIdleCallback?.bind(window);

    setCoverSpec(null);
    const buildCover = () => {
      if (!cancelled) {
        setCoverSpec(buildEditorialCoverSpec(item));
      }
    };

    const idleHandle = requestIdle
      ? requestIdle(buildCover, { timeout: 500 })
      : window.setTimeout(buildCover, 0);

    return () => {
      cancelled = true;
      if (cancelIdle && requestIdle) {
        cancelIdle(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [item]);

  if (coverSpec) {
    return (
      <div
        className={[
          'relative grid h-24 w-24 shrink-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border bg-gradient-to-br p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-18px_36px_rgba(43,34,24,0.10),0_16px_30px_-25px_rgba(77,61,39,0.90)] sm:h-28 sm:w-28',
          coverSpec.toneClass,
        ].join(' ')}
        aria-label={`${coverSpec.kicker}: ${coverSpec.titleLines.join(' ')}`}
      >
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[8px] font-bold uppercase leading-none tracking-[0.07em] text-current/80 sm:text-[9px]">
          {coverSpec.kicker}
        </div>
        <div
          className={[
            'flex min-w-0 flex-col justify-center overflow-hidden font-extrabold uppercase leading-[0.96] tracking-normal text-current',
            coverSpec.titleLines.length === 1
              ? 'text-[23px] sm:text-[25px]'
              : coverSpec.titleLines.length === 2
                ? 'text-[18px] sm:text-[20px]'
                : 'text-[14px] leading-[1.06] sm:text-[16px]',
          ].join(' ')}
          style={coverSpec.isCjk ? {
            fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif',
            letterSpacing: '0.02em',
          } : undefined}
        >
          {coverSpec.titleLines.map((line, index) => (
            <span key={`${line}-${index}`} className="block max-w-full overflow-hidden text-clip whitespace-nowrap">
              {line}
            </span>
          ))}
        </div>
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[7px] font-bold uppercase leading-none tracking-[0.08em] text-current/80 sm:text-[8px]">
          {coverSpec.footer}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-4 -right-2 text-[64px] font-black leading-none tracking-[-0.08em] text-current/10 sm:text-[72px]">
          {coverSpec.ghost}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-2.5 border-y border-[rgba(255,250,236,0.22)]" />
      </div>
    );
  }

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

function SummaryCard({
  item,
  isStarred,
  onToggleStar,
}: {
  item: SummaryItem;
  isStarred: boolean;
  onToggleStar: (item: SummaryItem) => void;
}) {
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
              <button
                type="button"
                onClick={() => onToggleStar(item)}
                aria-pressed={isStarred}
                aria-label={`${isStarred ? 'Remove from' : 'Add to'} Starred: ${item.title}`}
                title={isStarred ? 'Remove from Starred' : 'Add to Starred'}
                className={[
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  isStarred
                    ? 'text-[#b87912] hover:bg-[#fff2cf]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--paper-subtle)] hover:text-[#b87912]',
                ].join(' ')}
              >
                <SmallIcon type="star" className="h-5 w-5" filled={isStarred} />
              </button>
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
              <div className="text-sm text-[var(--text-secondary)]">{formatDate(itemDisplayDate(item))}</div>
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
  const [myPage, setMyPage] = useState(0);
  const [explorePage, setExplorePage] = useState(0);
  const [hasMoreMy, setHasMoreMy] = useState(true);
  const [hasMoreExplore, setHasMoreExplore] = useState(true);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMy, setIsLoadingMy] = useState(false);
  const [isLoadingExplore, setIsLoadingExplore] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [starredLoaded, setStarredLoaded] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewParam = searchParams.get('view');
    if (viewParam === 'my' || viewParam === 'explore' || viewParam === 'topics' || viewParam === 'starred') {
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
    if (status !== 'authenticated') {
      setMyItems([]);
      setMyPage(0);
      setHasMoreMy(true);
    }
  }, [status]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setStarredIds(parseStoredStarredIds(window.localStorage.getItem(STARRED_SUMMARIES_STORAGE_KEY)));
    setStarredLoaded(true);
  }, []);

  useEffect(() => {
    if (!starredLoaded || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STARRED_SUMMARIES_STORAGE_KEY, JSON.stringify(Array.from(starredIds)));
  }, [starredIds, starredLoaded]);

  const toggleStarred = useCallback((item: SummaryItem) => {
    setStarredIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }, []);

  const loadSummaryPage = useCallback(async (scope: SummaryItem['scope'], page: number) => {
    if (scope === 'my' && status !== 'authenticated') {
      return;
    }

    const setLoading = scope === 'my' ? setIsLoadingMy : setIsLoadingExplore;
    setLoading(true);
    setError(null);

    try {
      let payload: { success?: boolean; data?: unknown; error?: string } | null = null;
      let responseOk = true;

      if (scope === 'explore') {
        try {
          const snapshotResponse = await fetch(
            `/api/snapshots/lists/public?page=${page}&pageSize=${SUMMARY_PAGE_SIZE}`,
            { cache: 'force-cache' },
          );
          if (snapshotResponse.ok) {
            const snapshotPayload = await snapshotResponse.json();
            if (snapshotPayload?.success && Array.isArray(snapshotPayload.data)) {
              payload = snapshotPayload;
            }
          }
        } catch {
          // Static snapshots are an acceleration layer; the DB API remains authoritative.
        }
      }

      if (!payload) {
        const includePrivate = scope === 'my' ? '&includePrivate=true' : '';
        const response = await fetch(`/api/podcasts?page=${page}&pageSize=${SUMMARY_PAGE_SIZE}${includePrivate}`, {
          cache: 'no-store',
        });
        responseOk = response.ok;
        payload = await response.json();
      }

      if (!responseOk || !payload || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload?.error || `Failed to load ${scope === 'my' ? 'my' : 'public'} summaries`);
      }

      const items = payload.data.map((row: PodcastApiRow) => mapPodcastRow(row, scope));
      if (scope === 'my') {
        setMyItems((current) => mergeSummaryItems(current, items, page === 1));
        setMyPage(page);
        setHasMoreMy(payload.data.length === SUMMARY_PAGE_SIZE);
      } else {
        setExploreItems((current) => mergeSummaryItems(current, items, page === 1));
        setExplorePage(page);
        setHasMoreExplore(payload.data.length === SUMMARY_PAGE_SIZE);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (scope === 'my') {
        setMyPage((current) => Math.max(current, page));
        setHasMoreMy(false);
      } else {
        setExplorePage((current) => Math.max(current, page));
        setHasMoreExplore(false);
      }
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    const explicitView = searchParams.get('view');
    if (status === 'loading' && !explicitView) {
      return;
    }

    const shouldLoadCombined = view === 'topics' || (view === 'starred' && starredLoaded && starredIds.size > 0);
    const shouldLoadExplore = (view === 'explore' || shouldLoadCombined) && explorePage === 0 && !isLoadingExplore;
    const shouldLoadMy = (view === 'my' || shouldLoadCombined) && status === 'authenticated' && myPage === 0 && !isLoadingMy;

    if (shouldLoadExplore) {
      loadSummaryPage('explore', 1);
    }
    if (shouldLoadMy) {
      loadSummaryPage('my', 1);
    }
  }, [
    explorePage,
    isLoadingExplore,
    isLoadingMy,
    loadSummaryPage,
    myPage,
    searchParams,
    starredIds.size,
    starredLoaded,
    status,
    view,
  ]);

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
      .slice(0, TOPIC_TAG_LIMIT);
  }, [allTopicItems]);

  const starredItems = useMemo(() => {
    return allTopicItems.filter((item) => starredIds.has(item.id));
  }, [allTopicItems, starredIds]);

  const sourceItems = view === 'my'
    ? myItems
    : view === 'topics'
      ? allTopicItems
      : view === 'starred'
        ? starredItems
        : exploreItems;
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
        comparison = new Date(itemDisplayDate(a)).getTime() - new Date(itemDisplayDate(b)).getTime();
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [normalizedQuery, selectedTag, sortBy, sortDirection, sourceItems, view]);

  const loadMoreActiveView = useCallback(() => {
    if (view === 'my') {
      if (status === 'authenticated' && hasMoreMy && !isLoadingMy) {
        loadSummaryPage('my', myPage + 1);
      }
      return;
    }

    if (view === 'explore') {
      if (hasMoreExplore && !isLoadingExplore) {
        loadSummaryPage('explore', explorePage + 1);
      }
      return;
    }

    if (hasMoreExplore && !isLoadingExplore) {
      loadSummaryPage('explore', explorePage + 1);
    }
    if (status === 'authenticated' && hasMoreMy && !isLoadingMy) {
      loadSummaryPage('my', myPage + 1);
    }
  }, [
    explorePage,
    hasMoreExplore,
    hasMoreMy,
    isLoadingExplore,
    isLoadingMy,
    loadSummaryPage,
    myPage,
    status,
    view,
  ]);

  const isCombinedView = view === 'topics' || view === 'starred';
  const shouldLoadStarredLibrary = view === 'starred' && starredLoaded && starredIds.size > 0;
  const canLoadMore = view === 'my'
    ? status === 'authenticated' && hasMoreMy
    : view === 'starred'
      ? shouldLoadStarredLibrary && (hasMoreExplore || (status === 'authenticated' && hasMoreMy))
      : isCombinedView
        ? hasMoreExplore || (status === 'authenticated' && hasMoreMy)
        : hasMoreExplore;
  const hasRequestedCurrentView = view === 'my'
    ? status === 'authenticated' && myPage > 0
    : view === 'starred'
      ? starredLoaded && (starredIds.size === 0 || (explorePage > 0 && (status !== 'authenticated' || myPage > 0)))
      : isCombinedView
        ? explorePage > 0 && (status !== 'authenticated' || myPage > 0)
        : explorePage > 0;
  const isLoading = view === 'my'
    ? isLoadingMy
    : view === 'starred'
      ? !starredLoaded || (shouldLoadStarredLibrary && (isLoadingExplore || (status === 'authenticated' && isLoadingMy)))
      : isCombinedView
        ? isLoadingExplore || (status === 'authenticated' && isLoadingMy)
        : isLoadingExplore;
  const showInitialLoading = !error && visibleItems.length === 0 && (isLoading || !hasRequestedCurrentView);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !canLoadMore) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadMoreActiveView();
      }
    }, { rootMargin: '600px 0px' });

    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, loadMoreActiveView]);

  useEffect(() => {
    if (view !== 'starred' || starredIds.size === 0 || visibleItems.length > 0 || !canLoadMore || isLoading) {
      return;
    }

    loadMoreActiveView();
  }, [canLoadMore, isLoading, loadMoreActiveView, starredIds.size, view, visibleItems.length]);

  return (
    <AppFrame
      activeView={view === 'starred' ? undefined : view}
      showViewTabs={false}
      mainClassName="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="grid gap-6 xl:grid-cols-[270px_minmax(0,1fr)_340px]">
        <aside className="hidden xl:block">
          <div className="sticky top-[6.5rem] flex h-[calc(100vh-8rem)] flex-col justify-between">
            <nav className="space-y-2">
              <SidebarLink icon="library" active={view === 'my'} onClick={() => updateView('my')}>My Summaries</SidebarLink>
              <SidebarLink icon="compass" active={view === 'explore'} onClick={() => updateView('explore')}>Explore</SidebarLink>
              <SidebarLink icon="topic" active={view === 'topics'} onClick={() => updateView('topics')}>Topics</SidebarLink>
              <div className="h-2" />
              <SidebarLink icon="star" active={view === 'starred'} onClick={() => updateView('starred')}>Starred</SidebarLink>
            </nav>

            <div />
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
                {topicTags.slice(0, TOPIC_FILTER_LIMIT).map(([tag, count]) => (
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

          {view === 'my' && status === 'unauthenticated' ? (
            <section className="dashboard-panel rounded-lg p-10 text-center">
              <h1 className="text-2xl font-semibold text-[var(--heading)]">Sign in to see My Summaries</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                Your private uploads, processing status, and saved podcast summaries live in this workspace.
              </p>
              <Link href="/auth/signin?callbackUrl=/?view=my" className="mt-5 inline-flex rounded-lg bg-[var(--btn-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
                Sign in
              </Link>
            </section>
          ) : showInitialLoading ? (
            <section className="dashboard-panel rounded-lg p-10 text-center text-[var(--text-muted)]">Loading summaries...</section>
          ) : visibleItems.length === 0 ? (
            <section className="dashboard-panel rounded-lg p-10 text-center">
              <h1 className="text-2xl font-semibold text-[var(--heading)]">No summaries found</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                {view === 'my'
                  ? 'Try a different filter or upload a new transcript.'
                  : view === 'starred'
                    ? 'Star summaries to collect them here.'
                    : 'Try another search or topic.'}
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
                <SummaryCard
                  key={`${item.scope}:${item.id}`}
                  item={item}
                  isStarred={starredIds.has(item.id)}
                  onToggleStar={toggleStarred}
                />
              ))}
              <div ref={loadMoreRef} className="py-6 text-center text-sm text-[var(--text-muted)]">
                {isLoading ? 'Loading more summaries...' : canLoadMore ? 'Scroll to load more' : 'All summaries loaded'}
              </div>
            </div>
          )}
        </section>

        <aside className="hidden xl:block">
          <div className="sticky top-[6.5rem]">
            <section className="dashboard-panel rounded-lg p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[var(--text-main)]">Recent Topics</h2>
                <span className="text-xs font-medium text-[var(--text-muted)]">{topicTags.length}</span>
              </div>
              <div className="mt-4 flex max-h-[calc(100vh-15rem)] flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
                {topicTags.slice(0, RECENT_TOPIC_LIMIT).map(([tag, count], index) => (
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
                    className={[
                      'inline-flex max-w-full items-center gap-1.5 rounded-full border text-left font-medium leading-tight text-[var(--heading)] transition-colors hover:bg-[var(--paper-muted)]',
                      index < 4
                        ? 'border-[var(--border-medium)] bg-[var(--paper-subtle)] px-3 py-1.5 text-xs'
                        : 'border-[var(--border-soft)] bg-[var(--paper-base)] px-2.5 py-1 text-[11px]',
                    ].join(' ')}
                  >
                    <span className="min-w-0 break-words">{tag}</span>
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{count}</span>
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
