'use client';

import { Children, isValidElement, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logDebug, logError, logUserAction, logPerformance, getBrowserInfo, getClientErrors } from '../../../lib/debugUtils';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import FloatingQaAssistant from '../../../components/FloatingQaAssistant';
import AppHeader from '../../../components/AppHeader';
import LiteYouTubeEmbed from '../../../components/LiteYouTubeEmbed';
import type { MindMapData, MindMapNode } from '../../../lib/mindMap';
import { enforceLineBreaks } from '../../../lib/fullTextFormatting';
import {
  annotateEnglishWithHints,
  buildHintDictionaryCard,
  buildFullTextBilingualMarkdown,
  buildSummaryBilingualMarkdown,
  emphasizeSummaryMarkdown,
  stripPronunciationLinks,
  type AdvancedWordDict,
  type HintDictionaryCard,
} from '../../../lib/vocabHint';
import { createPronunciationController, type PronunciationController } from '../../../lib/pronunciationClient';
import {
  normalizeFullTextBilingualPayload,
  normalizeSummaryBilingualPayload,
  renderFullTextBilingualMarkdown,
  renderSummaryBilingualMarkdown,
  type FullTextBilingualPayload,
  type SummaryBilingualPayload,
} from '../../../lib/bilingualAlignment';

const DASHBOARD_DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true';
function dashboardDebugLog(...args: unknown[]) {
  if (!DASHBOARD_DEBUG_ENABLED) {
    return;
  }
  console.log(...args);
}

// VERCEL DEBUG: Add version number to help track deployments
const APP_VERSION = '1.0.5'; // Increment version for tracking
dashboardDebugLog(`[DEBUG] Podcast Summarizer v${APP_VERSION} loading...`);

// Define types for the processed data
interface ProcessedData {
  title: string;
  originalFileName: string;
  originalFileSize: string;
  summaryZh: string;
  summaryEn: string;
  translation: string;
  fullTextHighlights: string;
  fullTextBilingualJson?: FullTextBilingualPayload | null;
  summaryBilingualJson?: SummaryBilingualPayload | null;
  bilingualAlignmentVersion?: number | null;
  mindMapJsonZh?: MindMapData | null;
  mindMapJsonEn?: MindMapData | null;
  processedAt?: string;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
  sourceReference?: string | null;
  isPublic?: boolean;
}

interface ProcessingJobData {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  currentTask?: 'summary' | 'translation' | 'highlights' | null;
  progressCurrent?: number;
  progressTotal?: number;
  statusMessage?: string | null;
  lastError?: string | null;
}

interface DashboardPodcastPayload {
  title?: string | null;
  originalFileName?: string | null;
  fileSize?: string | null;
  blobUrl?: string | null;
  sourceReference?: string | null;
  isPublic?: boolean;
  userId?: string | null;
}

interface DashboardAnalysisPayload {
  summary?: string | null;
  summaryZh?: string | null;
  summaryEn?: string | null;
  translation?: string | null;
  highlights?: string | null;
  fullTextBilingualJson?: unknown;
  summaryBilingualJson?: unknown;
  bilingualAlignmentVersion?: number | null;
  mindMapJson?: unknown;
  mindMapJsonZh?: unknown;
  mindMapJsonEn?: unknown;
  processedAt?: string;
  tokenCount?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
}

interface DashboardApiPayload {
  success?: boolean;
  error?: string;
  data?: {
    podcast?: DashboardPodcastPayload | null;
    analysis?: DashboardAnalysisPayload | null;
    isProcessed?: boolean;
    canEdit?: boolean;
    processingJob?: ProcessingJobData | null;
    session?: unknown;
  };
}

type ViewMode = 'summary' | 'fullText' | 'mindMap';
type ProcessingTask = 'summary' | 'translation' | 'highlights';
type ThemeMode = 'light' | 'dark';
type ContentLanguageMode = 'zh' | 'en' | 'bilingual' | 'hint';

interface ProcessingProgress {
  task: ProcessingTask | null;
  completed: number;
  total: number;
}

const COPY_STATUS_RESET_MS = 1500;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 64;
const ANALYSIS_POLL_INTERVAL_MS = 5000;
const DASHBOARD_CONTENT_LANGUAGE_KEY = 'podsum-dashboard-content-language';
const TASK_LABELS: Record<ProcessingTask, string> = {
  summary: 'Summary',
  translation: 'Translation',
  highlights: 'Highlights',
};

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    if (response.ok) {
      return null;
    }
    throw new Error(`${label} returned HTTP ${response.status} with an empty response.`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const contentType = response.headers.get('content-type') || '';
    const preview = trimmed.replace(/\s+/g, ' ').slice(0, 90);
    if (contentType.includes('text/html') || trimmed.toLowerCase().startsWith('<!doctype')) {
      throw new Error(`${label} returned an HTML page instead of JSON (HTTP ${response.status}).`);
    }
    throw new Error(`${label} returned invalid JSON (HTTP ${response.status}): ${preview}`);
  }
}

const normalizeMarkdownOutput = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*•[ \t]+/gm, '- ')
    .replace(/\u00A0/g, ' ')
    .trim();
};

const extractLegacyBilingualSummary = (summaryRaw: string): { zh: string; en: string } => {
  const normalized = String(summaryRaw || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { zh: '', en: '' };
  }

  const markerEn = '<<<SUMMARY_EN>>>';
  const markerZh = '<<<SUMMARY_ZH>>>';
  const markerEnIndex = normalized.indexOf(markerEn);
  const markerZhIndex = normalized.indexOf(markerZh);
  if (markerEnIndex >= 0 && markerZhIndex > markerEnIndex) {
    return {
      en: normalizeMarkdownOutput(normalized.slice(markerEnIndex + markerEn.length, markerZhIndex)),
      zh: normalizeMarkdownOutput(normalized.slice(markerZhIndex + markerZh.length)),
    };
  }

  const englishHeaderIndex = normalized.search(/#\s*English Summary/i);
  const chineseHeaderIndex = normalized.search(/#\s*中文总结/i);
  if (englishHeaderIndex >= 0 && chineseHeaderIndex > englishHeaderIndex) {
    return {
      en: normalizeMarkdownOutput(normalized.slice(englishHeaderIndex, chineseHeaderIndex)),
      zh: normalizeMarkdownOutput(normalized.slice(chineseHeaderIndex)),
    };
  }
  if (chineseHeaderIndex >= 0) {
    return {
      en: normalizeMarkdownOutput(normalized.slice(0, chineseHeaderIndex)),
      zh: normalizeMarkdownOutput(normalized.slice(chineseHeaderIndex)),
    };
  }

  return {
    en: '',
    zh: normalizeMarkdownOutput(normalized),
  };
};


const resolveDashboardSummaries = (analysis: { summary?: string | null; summaryZh?: string | null; summaryEn?: string | null }): { summaryZh: string; summaryEn: string } => {
  const legacyFromCombined = extractLegacyBilingualSummary(analysis.summary || '');
  const splitFromZhField = extractLegacyBilingualSummary(analysis.summaryZh || '');
  const splitFromEnField = extractLegacyBilingualSummary(analysis.summaryEn || '');

  const summaryZh =
    splitFromZhField.zh ||
    legacyFromCombined.zh ||
    analysis.summaryZh ||
    analysis.summary ||
    'Summary not available.';
  const summaryEn =
    splitFromEnField.en ||
    splitFromZhField.en ||
    analysis.summaryEn ||
    legacyFromCombined.en ||
    'English summary not available.';

  return {
    summaryZh: normalizeMarkdownOutput(summaryZh),
    summaryEn: normalizeMarkdownOutput(summaryEn),
  };
};

const MindMapCanvas = dynamic(() => import('../../../components/MindMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      Loading mind map...
    </div>
  ),
});

const normalizeMindMapNode = (value: unknown, depth: number): MindMapNode | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const label = typeof source.label === 'string' ? source.label.trim() : '';
  if (!label) {
    return null;
  }

  const node: MindMapNode = {
    label: label.slice(0, 280),
  };
  if (depth >= 5) {
    return node;
  }

  const childrenRaw = Array.isArray(source.children) ? source.children : [];
  const children = childrenRaw
    .map((child) => normalizeMindMapNode(child, depth + 1))
    .filter((child): child is MindMapNode => Boolean(child))
    .slice(0, 14);

  if (children.length > 0) {
    node.children = children;
  }
  return node;
};

const parseMindMapData = (value: unknown): MindMapData | null => {
  if (!value) {
    return null;
  }

  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const rootCandidate = (parsed as Record<string, unknown>).root ?? parsed;
  const root = normalizeMindMapNode(rootCandidate, 0);
  if (!root || !root.children || root.children.length === 0) {
    return null;
  }

  return { root };
};

const TIMESTAMP_ONLY_PATTERN = /^\[[0-9]{2}:[0-9]{2}:[0-9]{1,3}(?:\s*-->\s*[0-9]{2}:[0-9]{2}:[0-9]{1,3})?\]$/;
const PRONOUNCE_SCHEME = 'pronounce://';
const PRONOUNCE_HASH_PREFIX = '#pronounce:';

const flattenReactNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenReactNodeText).join('');
  }
  if (node && typeof node === 'object' && 'props' in node) {
    return flattenReactNodeText((node as { props?: { children?: ReactNode } }).props?.children ?? '');
  }
  return '';
};

const decodePronounceHref = (href?: string): string | null => {
  if (!href || (!href.startsWith(PRONOUNCE_SCHEME) && !href.startsWith(PRONOUNCE_HASH_PREFIX))) {
    return null;
  }
  try {
    const rawValue = href.startsWith(PRONOUNCE_SCHEME)
      ? href.slice(PRONOUNCE_SCHEME.length)
      : href.slice(PRONOUNCE_HASH_PREFIX.length);
    const raw = decodeURIComponent(rawValue).trim().toLowerCase();
    return raw || null;
  } catch {
    return null;
  }
};

const markdownUrlTransform = (url: string): string => {
  if (url.startsWith(PRONOUNCE_SCHEME) || url.startsWith(PRONOUNCE_HASH_PREFIX)) {
    return url;
  }
  return defaultUrlTransform(url);
};

const createMarkdownComponents = (
  contentLanguage: ContentLanguageMode,
  options?: {
    onHoverWord?: (word: string) => void;
    onLeaveWord?: () => void;
    onTapWord?: (word: string) => void;
    isCoarsePointer?: () => boolean;
    resolveHintCard?: (word: string) => HintDictionaryCard | null;
  }
): Components => ({
  strong({ children }) {
    const normalized = flattenReactNodeText(children).replace(/\s+/g, ' ').trim();
    const isTimestampOnly = TIMESTAMP_ONLY_PATTERN.test(normalized);
    return <strong className={isTimestampOnly ? 'markdown-timestamp-strong' : undefined}>{children}</strong>;
  },
  a({ href, children }) {
    const pronounceWord = contentLanguage === 'hint' ? decodePronounceHref(href) : null;
    if (pronounceWord) {
      const surfaceWord = flattenReactNodeText(children).replace(/\s+/g, ' ').trim() || pronounceWord;
      const hintCard = options?.resolveHintCard?.(pronounceWord) || null;
      const handleHoverStart = () => {
        options?.onHoverWord?.(pronounceWord);
      };
      const handleHoverEnd = () => {
        options?.onLeaveWord?.();
      };
      return (
        <button
          type="button"
          className="hint-pronounce-word"
          onMouseEnter={handleHoverStart}
          onMouseLeave={handleHoverEnd}
          onPointerEnter={(event) => {
            if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
              return;
            }
            handleHoverStart();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
              return;
            }
            handleHoverEnd();
          }}
          onBlur={handleHoverEnd}
          onClick={(event) => {
            event.preventDefault();
            if (options?.isCoarsePointer?.()) {
              options?.onTapWord?.(pronounceWord);
              return;
            }
            options?.onTapWord?.(pronounceWord);
          }}
          aria-label={`Dictionary hint for ${surfaceWord}`}
        >
          <span className="hint-word-text">{children}</span>
          {hintCard ? (
            <span className="hint-dict-tooltip" role="tooltip">
              <span className="hint-dict-headword">{hintCard.word}</span>
              <span className="hint-dict-pos">词性：{hintCard.posSummary.join(' / ')}</span>
              <span className="hint-dict-sense-list">
                {hintCard.senses.map((sense, index) => (
                  <span className="hint-dict-sense-item" key={`${sense.pos}-${sense.meaning}-${index}`}>
                    <span className="hint-dict-sense-pos">{sense.pos}</span>
                    <span className="hint-dict-sense-meaning">{sense.meaning}</span>
                  </span>
                ))}
              </span>
            </span>
          ) : null}
        </button>
      );
    }

    if (href && isValidHttpUrl(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }

    return <a href={href}>{children}</a>;
  },
  p({ children }) {
    if (contentLanguage !== 'bilingual') {
      return <p>{children}</p>;
    }

    const nodes = Children.toArray(children);
    const brIndex = nodes.findIndex((node) => isValidElement(node) && node.type === 'br');
    if (brIndex < 0) {
      return <p>{children}</p>;
    }

    const before = nodes.slice(0, brIndex);
    const after = nodes.slice(brIndex + 1);
    const afterText = flattenReactNodeText(after).trim();
    if (!afterText || !/[\u4E00-\u9FFF]/.test(afterText)) {
      return <p>{children}</p>;
    }

    return (
      <p>
        <span className="bilingual-en-line">{before}</span>
        <br />
        <span className="bilingual-zh-line">{after}</span>
      </p>
    );
  },
});

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const getYouTubeVideoId = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const watchId = parsed.searchParams.get('v');
      if (watchId && /^[A-Za-z0-9_-]{11}$/.test(watchId)) {
        return watchId;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live', 'v'].includes(part));
      const id = markerIndex >= 0 ? parts[markerIndex + 1] : null;
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    const fallback = trimmed.match(/(?:v=|be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);
    return fallback?.[1] || null;
  }

  return null;
};

const getSourceHost = (value: string): string => {
  if (!value) {
    return 'No source';
  }
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Source note';
  }
};

const formatMetricValue = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toLocaleString();
};

const resolveDashboardTitle = (podcast: { title?: string | null; originalFileName?: string | null }) => {
  const normalizedTitle = typeof podcast.title === 'string' ? podcast.title.trim() : '';
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const fileBaseName = String(podcast.originalFileName || '')
    .replace(/\.[^.]+$/g, '')
    .trim();
  return fileBaseName || 'Transcript';
};

// Debug interface to track application state
interface DebugState {
  appVersion: string;
  initialized: boolean;
  lastAction: string;
  processingState: string;
  errors: unknown[];
  networkRequests: {
    url: string;
    status: number;
    timestamp: string;
    duration: number;
  }[];
  sessionInfo: {
    id: string;
    isProcessing: boolean;
    requestSent: boolean;
    lastHeightRef: number;
  };
}

// 声明 window.__PODSUM_DEBUG__ 用于调试
declare global {
  interface Window {
    __PODSUM_DEBUG__?: unknown;
  }
}

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string;
  const { status: sessionStatus } = useSession();
  const dashboardAccessMode = sessionStatus === 'authenticated' ? 'authenticated' : 'public';
  
  // Initialize all hooks first, before any conditional returns
  const [activeView, setActiveView] = useState<ViewMode>('summary');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isSummaryFinal, setIsSummaryFinal] = useState(true);
  const [isHighlightsFinal, setIsHighlightsFinal] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pollTick, setPollTick] = useState(0);
  const [assistantPanelHeight, setAssistantPanelHeight] = useState<number | undefined>(undefined);
  const [assistantStickyTop, setAssistantStickyTop] = useState(96);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [contentLanguage, setContentLanguage] = useState<ContentLanguageMode>('zh');
  const [vocabDict, setVocabDict] = useState<AdvancedWordDict | null>(null);
  const [vocabLoadError, setVocabLoadError] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    task: null,
    completed: 0,
    total: 0,
  });
  const [sourceInput, setSourceInput] = useState('');
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [sourceSaveStatus, setSourceSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [sourceSaveError, setSourceSaveError] = useState<string | null>(null);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [visibilitySaveError, setVisibilitySaveError] = useState<string | null>(null);
  
  // Refs for scroll control and processing state
  const contentRef = useRef<HTMLElement | null>(null);
  const contentPanelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const isProcessingRef = useRef(false);
  const isAutoScrollEnabledRef = useRef(true);
  const viewScrollPositionsRef = useRef<Record<ViewMode, number>>({
    summary: 0,
    fullText: 0,
    mindMap: 0,
  });
  const lastHeightRef = useRef(0);
  const requestSentRef = useRef(false);
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasResolvedInitialFetchRef = useRef(false);
  const lastLoadedIdRef = useRef<string | null>(null);
  const pronunciationControllerRef = useRef<PronunciationController | null>(null);

  // Debug state
  const [debugMode, setDebugMode] = useState(false);
  const [debugState, setDebugState] = useState<DebugState>({
    appVersion: APP_VERSION,
    initialized: false,
    lastAction: 'init',
    processingState: 'idle',
    errors: [],
    networkRequests: [],
    sessionInfo: {
      id: id || '',
      isProcessing: false,
      requestSent: false,
      lastHeightRef: 0
    }
  });
  
  // Track network requests for debugging
  const networkRequestsRef = useRef<DebugState['networkRequests']>([]);

  dashboardDebugLog(`[DEBUG] Dashboard initializing for ID: ${id}`);
  logDebug(`Dashboard initializing for ID: ${id}`);

  const setContentElement = useCallback((element: HTMLElement | null) => {
    contentRef.current = element;
    if (!element) {
      return;
    }
    const savedTop = viewScrollPositionsRef.current[activeView] || 0;
    element.scrollTop = savedTop;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isAutoScrollEnabledRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, [activeView]);

  const syncAssistantLayout = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const headerHeight = Math.round(headerRef.current?.getBoundingClientRect().height ?? 0);
    const nextStickyTop = Math.max(16, headerHeight + 16);
    setAssistantStickyTop((prev) => (prev === nextStickyTop ? prev : nextStickyTop));

    const panelHeight = Math.round(contentPanelRef.current?.getBoundingClientRect().height ?? 0);
    const viewportMaxHeight = Math.max(260, Math.floor(window.innerHeight - nextStickyTop - 16));
    const targetHeight = panelHeight > 0 ? Math.round(panelHeight * 0.8) : viewportMaxHeight;
    const nextHeight = Math.max(260, Math.min(targetHeight, viewportMaxHeight));
    setAssistantPanelHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const handleContentScroll = useCallback(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    viewScrollPositionsRef.current[activeView] = element.scrollTop;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isAutoScrollEnabledRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, [activeView]);

  const switchActiveView = (nextView: ViewMode) => {
    if (nextView === activeView) {
      return;
    }
    if (contentRef.current) {
      viewScrollPositionsRef.current[activeView] = contentRef.current.scrollTop;
    }
    if (copyStatusTimerRef.current !== null) {
      clearTimeout(copyStatusTimerRef.current);
      copyStatusTimerRef.current = null;
    }
    setCopyStatus('idle');
    setActiveView(nextView);
  };

  const resetProcessingProgress = useCallback(() => {
    setProcessingProgress({
      task: null,
      completed: 0,
      total: 0,
    });
  }, []);

  const updateProcessingProgress = useCallback(
    (task: ProcessingTask, chunkIndex?: unknown, totalChunks?: unknown) => {
      if (typeof chunkIndex === 'number' && typeof totalChunks === 'number' && totalChunks > 0) {
        setProcessingProgress({
          task,
          completed: Math.min(Math.max(chunkIndex + 1, 0), totalChunks),
          total: totalChunks,
        });
        return;
      }
      setProcessingProgress(prev => ({ ...prev, task }));
    },
    [],
  );

  const setCopyStatusWithReset = useCallback((nextStatus: 'idle' | 'copied' | 'failed') => {
    setCopyStatus(nextStatus);
    if (copyStatusTimerRef.current !== null) {
      clearTimeout(copyStatusTimerRef.current);
      copyStatusTimerRef.current = null;
    }
    if (nextStatus !== 'idle') {
      copyStatusTimerRef.current = setTimeout(() => {
        setCopyStatus('idle');
      }, COPY_STATUS_RESET_MS);
    }
  }, []);

  const applyProcessingJobState = useCallback((job: ProcessingJobData | null) => {
    if (!job) {
      setIsProcessing(false);
      isProcessingRef.current = false;
      setProcessingStatus(null);
      requestSentRef.current = false;
      resetProcessingProgress();
      return;
    }

    if (job.status === 'queued' || job.status === 'processing') {
      setError(null);
      setIsProcessing(true);
      isProcessingRef.current = true;
      requestSentRef.current = true;
      setIsSummaryFinal(false);
      setIsHighlightsFinal(false);
      setProcessingStatus(job.statusMessage || (job.status === 'queued' ? '已进入后台队列' : '后台处理中...'));

      const task =
        job.currentTask === 'summary' || job.currentTask === 'translation' || job.currentTask === 'highlights'
          ? job.currentTask
          : 'summary';
      const completed = typeof job.progressCurrent === 'number' ? job.progressCurrent : 0;
      const total = typeof job.progressTotal === 'number' ? job.progressTotal : 0;
      setProcessingProgress({
        task,
        completed,
        total,
      });
      return;
    }

    if (job.status === 'failed') {
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
      setProcessingStatus(job.statusMessage || null);
      if (job.lastError) {
        setError(`后台处理失败: ${job.lastError}`);
      }
      resetProcessingProgress();
      return;
    }

    setIsProcessing(false);
    isProcessingRef.current = false;
    requestSentRef.current = false;
    setError(null);
    setProcessingStatus(null);
    setIsSummaryFinal(true);
    setIsHighlightsFinal(true);
    resetProcessingProgress();
  }, [resetProcessingProgress]);

  const enqueueBackgroundProcessing = useCallback(async (force = false) => {
    if (!id) return;
    if (!force && requestSentRef.current) return;

    requestSentRef.current = true;
    setError(null);
    setIsProcessing(true);
    isProcessingRef.current = true;
    setIsSummaryFinal(false);
    setIsHighlightsFinal(false);
    setProcessingStatus(force ? '已提交重新处理任务...' : '已提交后台处理任务...');
    setProcessingProgress({
      task: 'summary',
      completed: 0,
      total: 0,
    });

    try {
      const response = await fetch('/api/process/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, force }),
      });

      const result = await readJsonResponse(response, 'Process enqueue API') as {
        success?: boolean;
        data?: { job?: unknown };
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to enqueue job (${response.status})`);
      }

      if (result.data?.job) {
        applyProcessingJobState(result.data.job as ProcessingJobData);
      }
    } catch (enqueueError) {
      const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      setError(`提交后台任务失败: ${message}`);
      setIsProcessing(false);
      isProcessingRef.current = false;
      requestSentRef.current = false;
      setProcessingStatus(null);
      resetProcessingProgress();
    }
  }, [applyProcessingJobState, id, resetProcessingProgress]);

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current !== null) {
        clearTimeout(copyStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!id) {
      return;
    }
    if (lastLoadedIdRef.current !== id) {
      lastLoadedIdRef.current = id;
      hasResolvedInitialFetchRef.current = false;
      setIsLoading(true);
    }
  }, [id]);

  useEffect(() => {
    syncAssistantLayout();

    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      syncAssistantLayout();
    };
    window.addEventListener('resize', handleResize);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    const observer = new ResizeObserver(() => {
      syncAssistantLayout();
    });
    if (contentPanelRef.current) {
      observer.observe(contentPanelRef.current);
    }
    if (headerRef.current) {
      observer.observe(headerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [syncAssistantLayout, activeView, data, isProcessing, processingProgress.completed, processingProgress.total]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem('podsum-dashboard-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setThemeMode(storedTheme);
      return;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setThemeMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('podsum-dashboard-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const savedLanguage = window.localStorage.getItem(DASHBOARD_CONTENT_LANGUAGE_KEY);
    if (savedLanguage === 'zh' || savedLanguage === 'en' || savedLanguage === 'bilingual' || savedLanguage === 'hint') {
      setContentLanguage(savedLanguage);
      return;
    }
    setContentLanguage('zh');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(DASHBOARD_CONTENT_LANGUAGE_KEY, contentLanguage);
  }, [contentLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const controller = createPronunciationController({
      accent: 'en-US',
      repeatGapMs: 900,
      ttsTimeoutMs: 2000,
      ttsRate: 0.88,
      ttsPitch: 0.84,
      preferRecordedAudio: true,
    });
    pronunciationControllerRef.current = controller;
    return () => {
      controller.dispose();
      pronunciationControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const shouldPronounce =
      contentLanguage === 'hint' && (activeView === 'summary' || activeView === 'fullText');
    if (!shouldPronounce) {
      pronunciationControllerRef.current?.stop();
    }
  }, [activeView, contentLanguage]);

  const isCoarsePointerDevice = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
  }, []);

  const handleHintWordHoverStart = useCallback((word: string) => {
    pronunciationControllerRef.current?.startHoverLoop(word);
  }, []);

  const handleHintWordHoverEnd = useCallback(() => {
    pronunciationControllerRef.current?.stop();
  }, []);

  const handleHintWordTap = useCallback((word: string) => {
    pronunciationControllerRef.current?.playTap(word);
  }, []);

  const activateHintMode = useCallback(() => {
    pronunciationControllerRef.current?.prime();
    setContentLanguage('hint');
  }, []);

  const resolveHintDictionaryCard = useCallback(
    (word: string): HintDictionaryCard | null => {
      if (!vocabDict) {
        return null;
      }
      const key = String(word || '').toLowerCase().trim();
      if (!key) {
        return null;
      }
      return buildHintDictionaryCard(key, vocabDict[key] || null);
    },
    [vocabDict]
  );

  useEffect(() => {
    const shouldLoadVocab =
      contentLanguage === 'hint' &&
      (activeView === 'summary' || activeView === 'fullText') &&
      !vocabDict &&
      !vocabLoadError;
    if (!shouldLoadVocab) {
      return;
    }

    let cancelled = false;
    const loadVocab = async () => {
      try {
        const response = await fetch('/vocab/advanced-words.json');
        if (!response.ok) {
          throw new Error(`Vocabulary loading failed (${response.status})`);
        }
        const payload = await response.json();
        if (!cancelled) {
          setVocabDict(payload as AdvancedWordDict);
          setVocabLoadError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setVocabLoadError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    };

    void loadVocab();
    return () => {
      cancelled = true;
    };
  }, [activeView, contentLanguage, vocabDict, vocabLoadError]);

  useEffect(() => {
    if (!data) {
      setSourceInput('');
      setSourceSaveStatus('idle');
      setSourceSaveError(null);
      return;
    }
    setSourceInput(data.sourceReference || '');
    setSourceSaveStatus('idle');
    setSourceSaveError(null);
  }, [data?.sourceReference, id]);


  const hasInvalidId = !id || id === 'undefined' || id === 'null';

  // Function to capture current debug state (use useCallback to fix hook dependency issues)
  const captureDebugState = useCallback((action: string) => {
    try {
      setDebugState({
        appVersion: APP_VERSION,
        initialized: true,
        lastAction: action,
        processingState: isProcessing ? 'processing' : (data?.summaryZh ? 'complete' : 'idle'),
        errors: getClientErrors(),
        networkRequests: networkRequestsRef.current,
        sessionInfo: {
          id,
          isProcessing,
          requestSent: requestSentRef.current,
          lastHeightRef: lastHeightRef.current
        }
      });
    } catch (error) {
      console.error('[DEBUG] Error capturing debug state:', error);
    }
  }, [id]); // 简化依赖，避免无限循环

  // Update debug state periodically
  useEffect(() => {
    if (!debugMode) return;
    
    captureDebugState('init');
    
    const interval = setInterval(() => {
      if (debugMode) {
        captureDebugState('interval');
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [debugMode, isProcessing, captureDebugState]);

  // Enhanced fetch with debugging (use useCallback to fix hook dependency issues)
  const debugFetch = useCallback(async (url: string, options: RequestInit) => {
    const startTime = performance.now();
    const requestId = Date.now().toString(36);
    
    try {
      dashboardDebugLog(`[DEBUG-NET-${requestId}] Starting request to ${url}`);
      logDebug(`Network request started`, { url, options: { 
        method: options.method,
        headers: options.headers
      }});
      
      const response = await fetch(url, options);
      
      const duration = performance.now() - startTime;
      dashboardDebugLog(`[DEBUG-NET-${requestId}] Response received: ${response.status} in ${duration.toFixed(0)}ms`);
      
      // Track network request
      networkRequestsRef.current = [
        ...networkRequestsRef.current.slice(-9),
        {
          url,
          status: response.status,
          timestamp: new Date().toISOString(),
          duration: Number(duration.toFixed(0))
        }
      ];
      
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`[DEBUG-NET-${requestId}] Request failed after ${duration.toFixed(0)}ms:`, error);
      logError(`Network request failed`, { url, error, duration });
      throw error;
    }
  }, []); // 移除所有依赖，避免无限循环

  // Copy debug info to clipboard
  const copyDebugInfo = () => {
    try {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        app: {
          version: APP_VERSION,
          url: window.location.href,
          id
        },
        state: {
          isLoading,
          isProcessing,
          requestSent: requestSentRef.current,
          hasError: !!error,
          errorMessage: error,
          dataSummaryLength: data?.summaryZh?.length
        },
        debug: debugState,
        browser: getBrowserInfo(),
        errors: getClientErrors()
      };
      
      const debugString = JSON.stringify(debugInfo, null, 2);
      navigator.clipboard.writeText(debugString);
      
      alert('Debug info copied to clipboard!');
      logUserAction('copy-debug-info');
    } catch (error) {
      console.error('[DEBUG] Failed to copy debug info:', error);
      alert('Failed to copy debug info: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Enhanced scroll function with debug (use useCallback to fix hook dependency issues)
  const scrollToBottom = useCallback(() => {
    dashboardDebugLog(`[DEBUG] Attempting to scroll to bottom, isProcessing: ${isProcessingRef.current}, autoScroll: ${isAutoScrollEnabledRef.current}`);
    if (!isAutoScrollEnabledRef.current) {
      return;
    }
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
      lastHeightRef.current = contentRef.current.scrollHeight;
      dashboardDebugLog(`[DEBUG] Updated lastHeightRef to ${lastHeightRef.current}`);
    }
  }, []); // 移除所有依赖，避免无限循环

  // Monitor content changes and scroll
  useEffect(() => {
    dashboardDebugLog(`[DEBUG] Content change detected, summary length: ${data?.summaryZh?.length}, isProcessing: ${isProcessingRef.current}`);
    if (activeView === 'summary' && data?.summaryZh && isProcessingRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [activeView, data?.summaryZh, scrollToBottom]);

  // Main data loading effect - only use database
  useEffect(() => {
    if (id) {
      dashboardDebugLog(`[DEBUG] useEffect triggered for ID: ${id}, isProcessing: ${isProcessing}, requestSent: ${requestSentRef.current}`);
      logDebug('Dashboard useEffect triggered', { id, isProcessing, requestSent: requestSentRef.current });
      
      const startTime = performance.now();
      const isInitialLoadForCurrentId = !hasResolvedInitialFetchRef.current;
      const finishLoadCycle = () => {
        hasResolvedInitialFetchRef.current = true;
        setIsLoading(false);
      };
      const handleLoadFailure = (message: string) => {
        if (hasResolvedInitialFetchRef.current) {
          dashboardDebugLog('[DEBUG] Dashboard refresh failed after initial load:', message);
          setProcessingStatus((current) => current || '等待后台处理...');
          finishLoadCycle();
          return;
        }
        setError(message);
        finishLoadCycle();
      };
      
      if (isInitialLoadForCurrentId) {
        setIsLoading(true);
      }
      setError(null);
      
      const loadDatabaseResult = () => {
        dashboardDebugLog('[DEBUG] 从数据库获取分析结果...');
        return debugFetch(`/api/analysis/${id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
          .then(response => readJsonResponse(response, 'Analysis API'))
          .then(result => ({
            result: result as DashboardApiPayload,
            source: 'database' as const,
          }));
      };

      const loadSnapshotResult = () => {
        dashboardDebugLog('[DEBUG] 从静态快照获取分析结果...');
        return debugFetch(`/api/snapshots/analysis/${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'force-cache',
          headers: {
            'Content-Type': 'application/json',
          },
        })
          .then(async response => {
            if (!response.ok) {
              throw new Error(`Static snapshot unavailable (${response.status})`);
            }
            const result = await readJsonResponse(response, 'Static analysis snapshot API') as DashboardApiPayload;
            if (
              !result?.success ||
              !result?.data?.isProcessed ||
              !result?.data?.analysis ||
              !result?.data?.podcast?.isPublic
            ) {
              throw new Error('Static snapshot is not usable for this dashboard load.');
            }
            return { result, source: 'snapshot' as const };
          });
      };

      const shouldTrySnapshot = pollTick === 0 && dashboardAccessMode === 'public';
      const resultRequest = shouldTrySnapshot
        ? loadSnapshotResult().catch((snapshotError) => {
            dashboardDebugLog('[DEBUG] 静态快照不可用，回退数据库:', snapshotError);
            return loadDatabaseResult();
          })
        : loadDatabaseResult();

      resultRequest
      .then(({ result, source }) => {
        dashboardDebugLog(`[DEBUG] ${source === 'snapshot' ? '静态快照' : '数据库'}API响应:`, result);
        // 调试：打印 canEdit 相关信息
        if (typeof window !== 'undefined') {
          window.__PODSUM_DEBUG__ = result;
          // 强制在页面显示调试信息
          dashboardDebugLog('[DEBUG] 完整API响应:', JSON.stringify(result, null, 2));
          dashboardDebugLog('[DEBUG] canEdit值:', result.data?.canEdit);
          dashboardDebugLog('[DEBUG] 用户会话:', result.data?.session);
          dashboardDebugLog('[DEBUG] podcast.userId:', result.data?.podcast?.userId);
        }
        
        if (result.success && result.data) {
          const { podcast, analysis, isProcessed, canEdit, processingJob } = result.data;
          const canEditValue = Boolean(canEdit);
          
          if (isProcessed && analysis && podcast) {
            // 数据库中有完整的分析结果
            dashboardDebugLog('[DEBUG] 从数据库加载完整分析结果');
            const resolvedSummaries = resolveDashboardSummaries(analysis);
            const normalizedFullTextBilingualJson = normalizeFullTextBilingualPayload(analysis.fullTextBilingualJson);
            const normalizedSummaryBilingualJson = normalizeSummaryBilingualPayload(analysis.summaryBilingualJson);
            const loadedData: ProcessedData = {
              title: resolveDashboardTitle(podcast),
              originalFileName: podcast.originalFileName || 'Transcript',
              originalFileSize: podcast.fileSize || '-',
              summaryZh: resolvedSummaries.summaryZh,
              summaryEn: resolvedSummaries.summaryEn,
              translation: normalizeMarkdownOutput(
                enforceLineBreaks(analysis.translation || 'Translation not available.')
              ),
              fullTextHighlights: normalizeMarkdownOutput(
                enforceLineBreaks(analysis.highlights || 'Highlights not available.')
              ),
              fullTextBilingualJson: normalizedFullTextBilingualJson,
              summaryBilingualJson: normalizedSummaryBilingualJson,
              bilingualAlignmentVersion: analysis.bilingualAlignmentVersion ?? null,
              mindMapJsonZh: parseMindMapData(analysis.mindMapJsonZh ?? analysis.mindMapJson),
              mindMapJsonEn: parseMindMapData(analysis.mindMapJsonEn),
              processedAt: analysis.processedAt,
              tokenCount: analysis.tokenCount ?? null,
              wordCount: analysis.wordCount ?? null,
              characterCount: analysis.characterCount ?? null,
              sourceReference: podcast.sourceReference ?? null,
              isPublic: Boolean(podcast.isPublic),
            };
            setData(loadedData);
            setIsSummaryFinal(true);
            setIsHighlightsFinal(true);
            setProcessingStatus(null);
            setCopyStatusWithReset('idle');
            resetProcessingProgress();
            setIsProcessing(false);
            isProcessingRef.current = false;
            requestSentRef.current = false;
            finishLoadCycle();
            setCanEdit(canEditValue); // 新增
            
            const loadTime = performance.now() - startTime;
              logPerformance(
                source === 'snapshot' ? 'dashboard-load-static-snapshot' : 'dashboard-load-database-data',
                loadTime,
                {
              id, 
              dataSize: {
                summaryZh: (analysis.summaryZh || analysis.summary)?.length || 0,
                summaryEn: analysis.summaryEn?.length || 0,
                translation: analysis.translation?.length || 0,
                highlights: analysis.highlights?.length || 0
              }
            });
          } else if (podcast) {
            // 数据库中有播客信息但没有分析结果，需要处理
            dashboardDebugLog('[DEBUG] 数据库中有播客信息但无分析结果，开始处理');
            setData(prev => {
              const resolvedSummaries = analysis ? resolveDashboardSummaries(analysis) : null;
              const normalizedFullTextBilingualJson = normalizeFullTextBilingualPayload(analysis?.fullTextBilingualJson);
              const normalizedSummaryBilingualJson = normalizeSummaryBilingualPayload(analysis?.summaryBilingualJson);
              return ({
              title: resolveDashboardTitle(podcast),
              originalFileName: podcast.originalFileName || 'Transcript',
              originalFileSize: podcast.fileSize || '-',
              summaryZh: resolvedSummaries
                ? resolvedSummaries.summaryZh
                : prev?.summaryZh || '',
              summaryEn: resolvedSummaries
                ? resolvedSummaries.summaryEn
                : prev?.summaryEn || '',
              translation: analysis?.translation
                ? normalizeMarkdownOutput(
                    enforceLineBreaks(analysis.translation)
                  )
                : prev?.translation || '',
              fullTextHighlights: analysis?.highlights
                ? normalizeMarkdownOutput(
                    enforceLineBreaks(analysis.highlights)
                  )
                : prev?.fullTextHighlights || '',
              fullTextBilingualJson:
                normalizedFullTextBilingualJson ?? prev?.fullTextBilingualJson ?? null,
              summaryBilingualJson:
                normalizedSummaryBilingualJson ?? prev?.summaryBilingualJson ?? null,
              bilingualAlignmentVersion:
                analysis?.bilingualAlignmentVersion ?? prev?.bilingualAlignmentVersion ?? null,
              mindMapJsonZh:
                parseMindMapData(analysis?.mindMapJsonZh ?? analysis?.mindMapJson) ?? prev?.mindMapJsonZh ?? null,
              mindMapJsonEn:
                parseMindMapData(analysis?.mindMapJsonEn) ?? prev?.mindMapJsonEn ?? null,
              processedAt: analysis?.processedAt || prev?.processedAt || undefined,
              tokenCount: analysis?.tokenCount ?? prev?.tokenCount ?? null,
              wordCount: analysis?.wordCount ?? prev?.wordCount ?? null,
              characterCount: analysis?.characterCount ?? prev?.characterCount ?? null,
              sourceReference: podcast.sourceReference ?? prev?.sourceReference ?? null,
              isPublic: typeof podcast.isPublic === 'boolean' ? podcast.isPublic : prev?.isPublic ?? false,
            });
            });
            setIsSummaryFinal(false);
            setIsHighlightsFinal(false);
            setProcessingStatus('等待后台处理...');
            if (isInitialLoadForCurrentId) {
              setCopyStatusWithReset('idle');
              resetProcessingProgress();
            }
            finishLoadCycle();
            setCanEdit(canEditValue);
            
            if (processingJob) {
              applyProcessingJobState(processingJob);
            } else if (canEditValue) {
              enqueueBackgroundProcessing(false);
            } else {
              setIsProcessing(false);
              isProcessingRef.current = false;
              requestSentRef.current = false;
            }
          } else {
            // 数据库中完全没有该ID的信息
            dashboardDebugLog('[DEBUG] 数据库中没有找到该ID的信息');
            handleLoadFailure('File not found in database. The file may have been deleted or never uploaded.');
          }
        } else {
          // API调用失败
          dashboardDebugLog('[DEBUG] 数据库API调用失败');
          handleLoadFailure(result.error || 'Failed to load file information from database.');
        }
      })
      .catch(error => {
        console.error('[DEBUG] 数据库API调用出错:', error);
        const message = error instanceof Error ? error.message : String(error);
        handleLoadFailure('Failed to load dashboard data: ' + message);
      });
    }
  }, [dashboardAccessMode, id, pollTick]); // 轮询时刷新状态

  // 后台处理中时轮询数据库状态（页面只做展示）
  useEffect(() => {
    if (!id || !isProcessing) {
      return;
    }
    const interval = setInterval(() => {
      setPollTick(prev => prev + 1);
    }, ANALYSIS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [id, isProcessing]);

  // Retry processing function
  const retryProcessing = () => {
    dashboardDebugLog('[DEBUG] Retry button clicked');
    logUserAction('retry-processing', { id });
    captureDebugState('retry-clicked');
    
    if (isProcessing) {
      dashboardDebugLog(`[DEBUG] Already processing ID: ${id}, avoiding duplicate retry request`);
      return;
    }
    
    dashboardDebugLog('[DEBUG] Starting retry process');
    setError(null);
    requestSentRef.current = false;
    enqueueBackgroundProcessing(true);
  };

  const saveSourceReference = async () => {
    if (!id || !canEdit || isSavingSource) {
      return;
    }

    const normalizedSource = sourceInput.trim();
    setIsSavingSource(true);
    setSourceSaveError(null);
    setSourceSaveStatus('idle');

    try {
      const response = await fetch(`/api/podcasts/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceReference: normalizedSource || null,
        }),
      });

      const result = await readJsonResponse(response, 'Podcast metadata API') as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Save failed (${response.status})`);
      }

      setData(prev => prev ? { ...prev, sourceReference: normalizedSource || null } : prev);
      setSourceSaveStatus('saved');
    } catch (saveError) {
      setSourceSaveStatus('failed');
      setSourceSaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSavingSource(false);
    }
  };

  const currentSourceReference = (data?.sourceReference || '').trim();
  const sourceReferenceIsUrl = currentSourceReference ? isValidHttpUrl(currentSourceReference) : false;
  const youtubeVideoId = getYouTubeVideoId(currentSourceReference);
  const sourceHost = getSourceHost(currentSourceReference);

  const toggleVisibility = async () => {
    if (!id || !canEdit || !data || isSavingVisibility) {
      return;
    }

    const nextIsPublic = !Boolean(data.isPublic);
    setIsSavingVisibility(true);
    setVisibilitySaveError(null);

    try {
      const response = await fetch(`/api/podcasts/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isPublic: nextIsPublic,
        }),
      });

      const result = await readJsonResponse(response, 'Podcast visibility API') as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Visibility update failed (${response.status})`);
      }

      setData((prev) => (prev ? { ...prev, isPublic: nextIsPublic } : prev));
    } catch (saveError) {
      setVisibilitySaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const getSingleLanguageForMindMap = useCallback((): 'zh' | 'en' => {
    return contentLanguage === 'en' ? 'en' : 'zh';
  }, [contentLanguage]);

  const getRenderableViewContent = useCallback(() => {
    if (!data) {
      return '';
    }

    if (activeView === 'summary') {
      if (contentLanguage === 'zh') {
        return emphasizeSummaryMarkdown(data.summaryZh);
      }
      if (contentLanguage === 'en') {
        return emphasizeSummaryMarkdown(data.summaryEn);
      }
      if (contentLanguage === 'bilingual') {
        if (data.summaryBilingualJson) {
          return emphasizeSummaryMarkdown(renderSummaryBilingualMarkdown(data.summaryBilingualJson));
        }
        return emphasizeSummaryMarkdown(buildSummaryBilingualMarkdown(data.summaryEn, data.summaryZh));
      }
      return annotateEnglishWithHints(data.summaryEn, vocabDict || {}, {
        maxHintsPerParagraph: 3,
        segmentByLine: true,
        interactionMode: 'pronounceLink',
      });
    }

    if (activeView === 'mindMap') {
      const singleLanguage = getSingleLanguageForMindMap();
      const activeMindMap =
        singleLanguage === 'zh'
          ? (data.mindMapJsonZh ?? data.mindMapJsonEn ?? null)
          : (data.mindMapJsonEn ?? data.mindMapJsonZh ?? null);
      return activeMindMap ? JSON.stringify(activeMindMap, null, 2) : '';
    }

    if (contentLanguage === 'zh') {
      return data.fullTextHighlights;
    }
    if (contentLanguage === 'en') {
      return data.translation;
    }
    if (contentLanguage === 'bilingual') {
      if (data.fullTextBilingualJson) {
        return renderFullTextBilingualMarkdown(data.fullTextBilingualJson);
      }
      return buildFullTextBilingualMarkdown(data.translation, data.fullTextHighlights);
    }
    return annotateEnglishWithHints(data.translation, vocabDict || {}, {
      maxHintsPerParagraph: 3,
      segmentByLine: false,
      interactionMode: 'pronounceLink',
    });
  }, [activeView, contentLanguage, data, getSingleLanguageForMindMap, vocabDict]);

  const copyCurrentView = async () => {
    let content = getRenderableViewContent().trim();
    if (contentLanguage === 'hint') {
      content = stripPronunciationLinks(content).trim();
    }
    if (!content) {
      setCopyStatusWithReset('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatusWithReset('copied');
    } catch (copyError) {
      console.error('[DEBUG] Failed to copy current view:', copyError);
      setCopyStatusWithReset('failed');
    }
  };

  const scrollCurrentViewToTop = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      viewScrollPositionsRef.current[activeView] = 0;
      isAutoScrollEnabledRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollCurrentViewToBottom = () => {
    if (!contentRef.current) {
      return;
    }
    contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    viewScrollPositionsRef.current[activeView] = contentRef.current.scrollHeight;
    isAutoScrollEnabledRef.current = true;
  };

  const markdownComponents = useMemo(
    () =>
      createMarkdownComponents(contentLanguage, {
        onHoverWord: handleHintWordHoverStart,
        onLeaveWord: handleHintWordHoverEnd,
        onTapWord: handleHintWordTap,
        isCoarsePointer: isCoarsePointerDevice,
        resolveHintCard: resolveHintDictionaryCard,
      }),
    [
      contentLanguage,
      handleHintWordHoverEnd,
      handleHintWordHoverStart,
      handleHintWordTap,
      isCoarsePointerDevice,
      resolveHintDictionaryCard,
    ]
  );

  if (hasInvalidId) {
    return (
      <div className="dashboard-shell min-h-screen text-[var(--text-main)]" data-theme={themeMode}>
        <AppHeader currentLabel="Invalid File" themeMode={themeMode} onThemeToggle={setThemeMode} showViewTabs={false} />
        <main className="flex min-h-[70vh] items-center justify-center px-4 py-8">
          <div className="dashboard-panel max-w-md rounded-lg p-8 text-center">
            <h1 className="mb-4 text-2xl font-bold text-[var(--danger)]">Invalid File ID</h1>
            <p className="mb-6 text-[var(--text-secondary)]">
              The file ID in the URL is invalid or missing. This usually happens when:
            </p>
            <ul className="mb-6 list-disc space-y-2 pl-5 text-left text-sm text-[var(--text-muted)]">
              <li>You navigated to an incomplete URL</li>
              <li>The file upload process was interrupted</li>
              <li>You&rsquo;re using an old or broken bookmark</li>
            </ul>
            <div className="space-y-3">
              <Link
                href="/upload"
                className="block w-full rounded-lg bg-[var(--btn-primary)] px-4 py-3 font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)]"
              >
                Upload New File
              </Link>
              <Link
                href="/?view=my"
                className="block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-subtle)] px-4 py-3 font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-muted)]"
              >
                View File History
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const renderContent = () => {
    if (isLoading && !data) {
      return <div className="text-center p-10 text-[var(--text-muted)]">Loading content...</div>;
    }
    if (error) {
      return <div className="text-center p-10 text-[var(--danger)]">Error: {error}</div>;
    }
    if (!data) {
      return <div className="text-center p-10 text-[var(--text-muted)]">No data available.</div>;
    }

    switch (activeView) {
      case 'summary':
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={markdownUrlTransform}>
                  {getRenderableViewContent() || '正在生成摘要...'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      case 'fullText':
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <div className="streaming-content dashboard-reading" ref={setContentElement} onScroll={handleContentScroll}>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={markdownUrlTransform}>
                      {getRenderableViewContent() || '正在生成重点内容...'}
                    </ReactMarkdown>
                  </div>
                </div>
            </div>
        );
      case 'mindMap': {
        const singleLanguage = getSingleLanguageForMindMap();
        const activeMindMap =
          singleLanguage === 'zh'
            ? (data.mindMapJsonZh ?? data.mindMapJsonEn ?? null)
            : (data.mindMapJsonEn ?? data.mindMapJsonZh ?? null);
        return (
          <div className="p-2 sm:p-3 lg:p-4 h-[62vh] min-h-[440px] max-h-[840px]">
            {activeMindMap ? (
              <MindMapCanvas data={activeMindMap} themeMode={themeMode} />
            ) : (
              <div className="h-full w-full flex items-center justify-center rounded-xl border border-dashed border-[var(--border-medium)] bg-[var(--paper-base)] px-6 text-center text-sm text-[var(--text-muted)] leading-7">
                {isProcessing ? '脑图正在生成中，请稍候...' : '当前内容还没有脑图数据，可点击“重新处理文件”后生成。'}
              </div>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) =>
    `shrink-0 px-3 sm:px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap
     ${activeView === view
       ? 'text-[var(--heading)] border-[var(--btn-primary)]'
       : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)] hover:border-[var(--border-medium)]'}`;

  const isQaAssistantEnabled = Boolean(
    data &&
    !isProcessing &&
    isSummaryFinal &&
    isHighlightsFinal
  );
  
  // Modify rendering to wrap in ErrorBoundary and include Debug Panel
  return (
    <ErrorBoundary>
      <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col" data-theme={themeMode}>
        <div ref={headerRef}>
          <AppHeader
            currentLabel={data?.title || (error ? 'Summary' : '')}
            themeMode={themeMode}
            onThemeToggle={setThemeMode}
            showViewTabs={false}
          />
        </div>

        {/* 中间内容区域 */}
        {!data && !error && isLoading && (
          <div className="flex-grow flex items-center justify-center">
              <div className="text-center rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-8 py-8 shadow-[0_18px_40px_-28px_rgba(80,67,44,0.45)]">
                  <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)] mx-auto mb-4"></div>
                  <p className="text-[var(--text-secondary)] text-sm sm:text-base tracking-wide">Loading transcript data...</p>
              </div>
          </div>
        )}

        {error && (
           <div className="flex-grow flex items-center justify-center">
             <div className="flex max-w-md flex-col items-center rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-6 text-[var(--danger)] shadow-[0_18px_42px_-30px_rgba(125,73,73,0.52)] sm:p-7">
                <p className="mb-5 text-center leading-7">{error}</p>
                <div className="grid w-full gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={retryProcessing}
                    className="rounded-lg bg-[var(--danger)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#8f4343] disabled:opacity-60"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <span className="mr-2 inline-block animate-spin">↻</span>
                        处理中...
                      </>
                    ) : '重新处理'}
                  </button>
                  <Link
                    href="/?view=my"
                    className="rounded-lg border border-[#d8b7b7] bg-[var(--paper-base)] px-5 py-2.5 text-center text-sm font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--paper-muted)]"
                  >
                    My Summaries
                  </Link>
                </div>
              </div>
          </div>
        )}

        {data && (
          <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow flex flex-col gap-4 md:gap-6">
            <section className="dashboard-panel overflow-hidden rounded-2xl">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="border-b border-[var(--border-soft)] bg-[var(--paper-subtle)] lg:border-b-0 lg:border-r">
                  {youtubeVideoId ? (
                    <LiteYouTubeEmbed
                      videoId={youtubeVideoId}
                      title={`Original video for ${data.title}`}
                    />
                  ) : (
                    <div className="flex aspect-video min-h-[220px] w-full flex-col justify-between p-5 sm:min-h-[320px] lg:min-h-[520px]">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Source</p>
                        <p className="mt-2 break-words text-sm leading-6 text-[var(--text-secondary)]">
                          {currentSourceReference || 'No source link saved yet.'}
                        </p>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{sourceHost}</p>
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span className="font-semibold uppercase tracking-[0.14em]">Source</span>
                        <span className="h-1 w-1 rounded-full bg-[var(--border-medium)]" />
                        <span>{youtubeVideoId ? 'YouTube video' : sourceHost}</span>
                      </div>
                      <h2 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-[var(--heading)] sm:text-lg">
                        {data.title}
                      </h2>
                    </div>

                    {canEdit && (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleVisibility()}
                          disabled={isSavingVisibility}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                          aria-pressed={Boolean(data.isPublic)}
                        >
                          <span className={`relative h-5 w-9 rounded-full transition-colors ${data.isPublic ? 'bg-[var(--btn-primary)]' : 'bg-[var(--border-medium)]'}`}>
                            <span className={`absolute left-1 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${data.isPublic ? 'translate-x-4' : ''}`} />
                          </span>
                          <span>{data.isPublic ? 'Public' : 'Private'}</span>
                        </button>
                        <button
                          onClick={retryProcessing}
                          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--paper-subtle)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isProcessing}
                        >
                          {isProcessing ? (
                            <>
                              <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-medium)] border-t-[var(--btn-primary)]" />
                              处理中
                            </>
                          ) : '重新处理'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {canEdit ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={sourceInput}
                          onChange={(event) => {
                            setSourceInput(event.target.value);
                            setSourceSaveStatus('idle');
                            setSourceSaveError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveSourceReference();
                            }
                          }}
                          placeholder="Source URL 或备注"
                          className="min-h-10 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)] focus:border-[var(--border-medium)] focus:outline-none"
                        />
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            onClick={saveSourceReference}
                            disabled={isSavingSource}
                            className="min-h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSavingSource ? 'Saving...' : 'Save Source'}
                          </button>
                          {currentSourceReference && sourceReferenceIsUrl && (
                            <a
                              href={currentSourceReference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-xs font-medium text-[var(--btn-primary)] transition-colors hover:bg-[var(--paper-subtle)]"
                            >
                              打开来源
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">
                        {currentSourceReference ? (
                          sourceReferenceIsUrl ? (
                            <a
                              href={currentSourceReference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-[var(--btn-primary)] underline"
                            >
                              {currentSourceReference}
                            </a>
                          ) : (
                            <p className="break-words leading-6 text-[var(--text-main)]">{currentSourceReference}</p>
                          )
                        ) : (
                          <p className="text-[var(--text-muted)]">-</p>
                        )}
                      </div>
                    )}
                    <div className="min-h-4 text-xs">
                      {sourceSaveStatus === 'saved' && <span className="text-emerald-700">Saved</span>}
                      {sourceSaveStatus === 'failed' && <span className="text-[var(--danger)]">{sourceSaveError || 'Save failed'}</span>}
                      {visibilitySaveError && <span className="text-[var(--danger)]">{visibilitySaveError}</span>}
                    </div>
                  </div>

                  <details className="group rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <summary className="cursor-pointer list-none text-[var(--text-muted)] marker:hidden">
                      <span className="inline-flex items-center gap-2">
                        <span>文件信息</span>
                        <span className="text-[10px] transition-transform group-open:rotate-90">›</span>
                      </span>
                    </summary>
                    <dl className="mt-2 grid gap-x-3 gap-y-1.5 border-t border-[var(--border-soft)] pt-2">
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--text-muted)]">Original</dt>
                        <dd className="truncate text-[var(--text-main)]" title={data.originalFileName}>{data.originalFileName}</dd>
                      </div>
                      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--text-muted)]">Processed</dt>
                        <dd className="text-[var(--text-main)]">{data.processedAt ? new Date(data.processedAt).toLocaleString() : '-'}</dd>
                      </div>
                      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--text-muted)]">Tokens</dt>
                        <dd className="text-[var(--text-main)]">{formatMetricValue(data.tokenCount)}</dd>
                      </div>
                      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="text-[var(--text-muted)]">Words</dt>
                        <dd className="text-[var(--text-main)]">{formatMetricValue(data.wordCount)}</dd>
                      </div>
                    </dl>
                  </details>
                </div>
              </div>

              {debugMode && (
                <div className="mt-4 p-3 bg-[var(--paper-subtle)] border border-[var(--border-soft)] rounded-xl text-xs text-[var(--text-secondary)]">
                  <h3 className="font-bold mb-2 tracking-wide">Debug Info</h3>
                  <div>canEdit: {canEdit.toString()}</div>
                  <div>isLoading: {isLoading.toString()}</div>
                  <div>isProcessing: {isProcessing.toString()}</div>
                  <div>hasError: {!!error}</div>
                  <button
                    onClick={() => dashboardDebugLog('window.__PODSUM_DEBUG__:', window.__PODSUM_DEBUG__)}
                    className="mt-2 px-2.5 py-1 bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] rounded-lg text-xs transition-colors"
                  >
                    Log Debug to Console
                  </button>
                </div>
              )}
            </section>

            <div className="mb-1 sm:mb-2">
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-soft)] pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button onClick={() => switchActiveView('summary')} className={`${getButtonClass('summary')} shrink-0`}>Summary</button>
                <button onClick={() => switchActiveView('fullText')} className={`${getButtonClass('fullText')} shrink-0`}>Full Text</button>
                <button onClick={() => switchActiveView('mindMap')} className={`${getButtonClass('mindMap')} shrink-0`}>Mind Map</button>
              </div>
              <div className="mt-3 inline-flex items-center rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-0.5">
                <button
                  onClick={() => setContentLanguage('zh')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    contentLanguage === 'zh'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  中文
                </button>
                <button
                  onClick={() => setContentLanguage('en')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    contentLanguage === 'en'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  English
                </button>
                <button
                  onClick={() => setContentLanguage('bilingual')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    contentLanguage === 'bilingual'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  中英对照
                </button>
                <button
                  onClick={activateHintMode}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    contentLanguage === 'hint'
                      ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)]'
                  }`}
                >
                  词汇提示
                </button>
              </div>
              {contentLanguage === 'hint' && vocabLoadError && (
                <p className="mt-2 text-xs text-[var(--danger)]">词表加载失败，已降级为英文原文：{vocabLoadError}</p>
              )}
            </div>

            {isProcessing && (
              <div className="mb-4 rounded-2xl border border-[#bed3c9] bg-[var(--paper-base)] p-3.5 sm:p-4 shadow-[0_12px_28px_-24px_rgba(73,93,83,0.5)]">
                <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                  <div className="text-[var(--text-secondary)] flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
                    <span>{processingStatus || '处理中...'}</span>
                  </div>
                  <span className="text-[var(--text-muted)] tracking-wide">
                    {processingProgress.task ? TASK_LABELS[processingProgress.task] : 'Preparing'}
                    {processingProgress.total > 0 ? ` · ${processingProgress.completed}/${processingProgress.total}` : ''}
                  </span>
                </div>
                {processingProgress.total > 0 && (
                  <div className="mt-2.5 h-2 w-full rounded-full bg-[#d9d3c7] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#7ea08f] to-[#3f7a68] transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, Math.round((processingProgress.completed / processingProgress.total) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] gap-4 md:gap-6 xl:items-start">
              <section className="w-full min-w-0">
                <div ref={contentPanelRef} className="dashboard-panel min-h-[240px] sm:min-h-[320px] rounded-2xl overflow-hidden">
                  {renderContent()}
                </div>
              </section>

              <div className="w-full self-start xl:sticky" style={{ top: assistantStickyTop }}>
                {isQaAssistantEnabled ? (
                  <FloatingQaAssistant
                    podcastId={id}
                    enabled={isQaAssistantEnabled}
                    panelHeight={assistantPanelHeight}
                  />
                ) : (
                  <aside
                    className="dashboard-panel w-full min-h-[260px] rounded-2xl overflow-hidden flex flex-col justify-center px-5 text-sm text-[var(--text-secondary)]"
                    style={typeof assistantPanelHeight === 'number' && assistantPanelHeight > 0 ? { height: assistantPanelHeight } : undefined}
                  >
                    Copilot 会在当前文件处理完成后启用。
                  </aside>
                )}
              </div>
            </div>
          </main>
        )}
        
        {debugMode && (
          <div className="fixed bottom-0 right-0 w-80 max-h-80 overflow-auto bg-[var(--paper-base)] border border-[var(--border-medium)] rounded-tl-xl p-3 text-xs z-50 shadow-[0_16px_32px_-24px_rgba(80,67,44,0.5)]">
            <h3 className="text-[var(--accent-strong)] font-semibold mb-2">Debug Status v{APP_VERSION}</h3>
            <div className="space-y-1 mb-2">
              <div><span className="text-[var(--text-muted)]">ID:</span> <span className="text-[var(--text-main)]">{id}</span></div>
              <div><span className="text-[var(--text-muted)]">State:</span> <span className={`${isProcessing ? 'text-amber-700' : 'text-emerald-700'}`}>
                {isProcessing ? 'PROCESSING' : (data ? 'LOADED' : 'IDLE')}</span></div>
              <div><span className="text-[var(--text-muted)]">Request Sent:</span> <span className={`${requestSentRef.current ? 'text-amber-700' : 'text-emerald-700'}`}>
                {requestSentRef.current ? 'YES' : 'NO'}</span></div>
              {error && <div><span className="text-[var(--danger)]">Error:</span> <span className="text-[var(--text-main)]">{error}</span></div>}
            </div>

            <h4 className="text-[var(--accent-strong)] font-semibold mt-2 mb-1">Last Requests:</h4>
            <div className="space-y-1 mb-2 max-h-20 overflow-y-auto">
              {debugState.networkRequests.slice(-3).reverse().map((req, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-[var(--text-muted)] truncate">{req.url.split('/').pop()}</span>
                  <span className={`${req.status < 300 ? 'text-emerald-700' : 'text-[var(--danger)]'}`}>
                    {req.status} ({req.duration}ms)
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-[var(--border-soft)] flex space-x-2">
              <button
                onClick={() => captureDebugState('refresh-clicked')}
                className="text-xs bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] px-2 py-1 rounded hover:bg-[var(--paper-muted)]"
              >
                Refresh
              </button>
              <button
                onClick={copyDebugInfo}
                className="text-xs bg-[var(--paper-subtle)] border border-[var(--border-soft)] text-[var(--text-secondary)] px-2 py-1 rounded hover:bg-[var(--paper-muted)]"
              >
                Copy Debug Info
              </button>
            </div>
          </div>
        )}
        
      </div>
    </ErrorBoundary>
  );
} 
