export const BILINGUAL_ALIGNMENT_VERSION = 1;
export const BILINGUAL_MISSING_ZH_PLACEHOLDER = '（未匹配，待校对）';
export const BILINGUAL_MISSING_EN_PLACEHOLDER = '(Not matched)';

export type BilingualMatchMethod =
  | 'ts_exact'
  | 'ts_near'
  | 'order_fallback'
  | 'section_index'
  | 'llm'
  | 'missing';

export interface BilingualPair {
  order: number;
  en: string;
  zh: string;
  enTimestamp?: string | null;
  zhTimestamp?: string | null;
  matchMethod: BilingualMatchMethod;
  confidence: number;
}

export interface AlignmentStats {
  total: number;
  matched: number;
  llmMatched: number;
  unmatched: number;
  methods: Record<string, number>;
}

export interface FullTextBilingualPayload {
  version: number;
  pairs: BilingualPair[];
  stats: AlignmentStats;
  generatedAt: string;
}

export interface SummaryBilingualSection {
  sectionKey: string;
  sectionTitleEn: string;
  sectionTitleZh: string;
  pairs: BilingualPair[];
}

export interface SummaryBilingualPayload {
  version: number;
  sections: SummaryBilingualSection[];
  stats: AlignmentStats;
  generatedAt: string;
}

export interface TimestampedLine {
  timestamp: string | null;
  text: string;
  sourceIndex: number;
}

export interface SummarySectionItems {
  sectionKey: string;
  title: string;
  items: string[];
  sourceIndex: number;
}

const HEADING_PATTERN = /^#{1,6}\s+(.+)$/;
const BULLET_PATTERN = /^\s*[-*+]\s+/;
const ORDERED_BULLET_PATTERN = /^\s*\d+[.)]\s+/;
const TIMESTAMP_PATTERN = /^\*\*\[(\d{2}:\d{2}:\d{2})\]\*\*\s*(.+)$/;
const TIMESTAMP_PLAIN_PATTERN = /^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/;
const SECTION_FALLBACK_TITLES: Record<string, { en: string; zh: string }> = {
  key_takeaways: { en: 'Key Takeaways', zh: '核心观点' },
  data_numbers: { en: 'Data & Numbers', zh: '关键数据' },
  decisions_actions: { en: 'Decisions & Action Items', zh: '决策与行动项' },
  main: { en: 'Main', zh: '主要内容' },
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function cleanLine(line: string): string {
  return String(line || '').replace(/\r/g, '').trim();
}

function stripMarkdownMarkers(line: string): string {
  return line
    .replace(BULLET_PATTERN, '')
    .replace(ORDERED_BULLET_PATTERN, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function normalizeSectionSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'main';
}

function normalizeSummarySectionKey(title: string): string {
  const normalized = title.toLowerCase();
  const compact = normalized.replace(/\s+/g, '');

  if (
    normalized.includes('key takeaway') ||
    normalized.includes('takeaway') ||
    normalized.includes('核心观点') ||
    normalized.includes('要点')
  ) {
    return 'key_takeaways';
  }

  if (
    normalized.includes('data') ||
    normalized.includes('number') ||
    compact.includes('data&numbers') ||
    normalized.includes('关键数据') ||
    normalized.includes('数据')
  ) {
    return 'data_numbers';
  }

  if (
    normalized.includes('decision') ||
    normalized.includes('action') ||
    normalized.includes('决策') ||
    normalized.includes('行动')
  ) {
    return 'decisions_actions';
  }

  if (normalized.includes('main') || normalized.includes('主要')) {
    return 'main';
  }

  return `custom_${normalizeSectionSlug(title)}`;
}

function parseTimeToSeconds(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const matched = String(timestamp).trim().match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) {
    return null;
  }
  const hours = Number.parseInt(matched[1], 10);
  const minutes = Number.parseInt(matched[2], 10);
  const seconds = Number.parseInt(matched[3], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function formatSectionTitle(sectionKey: string, title: string, language: 'en' | 'zh'): string {
  const normalized = cleanLine(title);
  if (normalized) {
    return normalized;
  }
  const fallback = SECTION_FALLBACK_TITLES[sectionKey];
  if (!fallback) {
    return language === 'en' ? 'Section' : '分组';
  }
  return language === 'en' ? fallback.en : fallback.zh;
}

function buildAlignmentStats(pairs: BilingualPair[]): AlignmentStats {
  const methods: Record<string, number> = {};
  let matched = 0;
  let unmatched = 0;
  let llmMatched = 0;

  for (const pair of pairs) {
    methods[pair.matchMethod] = (methods[pair.matchMethod] || 0) + 1;
    if (pair.matchMethod === 'missing') {
      unmatched += 1;
      continue;
    }
    matched += 1;
    if (pair.matchMethod === 'llm') {
      llmMatched += 1;
    }
  }

  return {
    total: pairs.length,
    matched,
    llmMatched,
    unmatched,
    methods,
  };
}

function flattenSummaryPairs(payload: SummaryBilingualPayload): BilingualPair[] {
  const pairs: BilingualPair[] = [];
  for (const section of payload.sections) {
    pairs.push(...section.pairs);
  }
  return pairs;
}

export function rebuildFullTextAlignmentStats(payload: FullTextBilingualPayload): FullTextBilingualPayload {
  return {
    ...payload,
    stats: buildAlignmentStats(payload.pairs),
  };
}

export function rebuildSummaryAlignmentStats(payload: SummaryBilingualPayload): SummaryBilingualPayload {
  return {
    ...payload,
    stats: buildAlignmentStats(flattenSummaryPairs(payload)),
  };
}

export function parseTimestampedLines(markdown: string): TimestampedLine[] {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const result: TimestampedLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const matched = line.match(TIMESTAMP_PATTERN) || line.match(TIMESTAMP_PLAIN_PATTERN);
    if (matched) {
      const text = stripMarkdownMarkers(matched[2]);
      if (!text) {
        continue;
      }
      result.push({
        timestamp: matched[1],
        text,
        sourceIndex: result.length,
      });
      continue;
    }

    const fallback = stripMarkdownMarkers(line);
    if (!fallback) {
      continue;
    }

    result.push({
      timestamp: null,
      text: fallback,
      sourceIndex: result.length,
    });
  }

  return result;
}

export function parseSummarySections(markdown: string): SummarySectionItems[] {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const sections: SummarySectionItems[] = [];

  const ensureSection = (title: string, key: string) => {
    const existing = sections[sections.length - 1];
    if (existing && existing.title === title && existing.sectionKey === key) {
      return existing;
    }
    const next: SummarySectionItems = {
      sectionKey: key,
      title,
      items: [],
      sourceIndex: sections.length,
    };
    sections.push(next);
    return next;
  };

  let currentSection = ensureSection('Main', 'main');

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) {
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const title = stripMarkdownMarkers(heading[1]);
      const key = normalizeSummarySectionKey(title || 'Main');
      currentSection = ensureSection(title || 'Main', key);
      continue;
    }

    const item = stripMarkdownMarkers(line);
    if (!item) {
      continue;
    }

    currentSection.items.push(item);
  }

  return sections.filter((section) => section.items.length > 0);
}

function findFirstUnusedIndex<T>(items: T[], used: Set<number>, minIndex: number, predicate: (item: T, index: number) => boolean): number {
  for (let i = minIndex; i < items.length; i += 1) {
    if (used.has(i)) {
      continue;
    }
    if (predicate(items[i], i)) {
      return i;
    }
  }
  return -1;
}

export function buildFullTextBilingualPayload(
  fullTextEn: string,
  fullTextZh: string,
  options?: {
    nearWindowSec?: number;
    generatedAt?: string;
  }
): FullTextBilingualPayload {
  const generatedAt = options?.generatedAt || new Date().toISOString();
  const nearWindowSec = Number.isFinite(options?.nearWindowSec)
    ? Math.max(1, Math.floor(options?.nearWindowSec || 0))
    : 12;

  const enLines = parseTimestampedLines(fullTextEn);
  const zhLines = parseTimestampedLines(fullTextZh);
  const usedZh = new Set<number>();
  const pairs: BilingualPair[] = [];

  let minZhIndex = 0;
  for (let i = 0; i < enLines.length; i += 1) {
    const enLine = enLines[i];
    let matchedZhIndex = -1;
    let matchMethod: BilingualMatchMethod = 'missing';
    let confidence = 0;

    if (enLine.timestamp) {
      matchedZhIndex = findFirstUnusedIndex(
        zhLines,
        usedZh,
        minZhIndex,
        (zhLine) => Boolean(zhLine.timestamp) && zhLine.timestamp === enLine.timestamp
      );
      if (matchedZhIndex >= 0) {
        matchMethod = 'ts_exact';
        confidence = 0.98;
      }
    }

    if (matchedZhIndex < 0 && enLine.timestamp) {
      const enSeconds = parseTimeToSeconds(enLine.timestamp);
      if (enSeconds !== null) {
        let nearBestIndex = -1;
        let nearBestDiff = Number.POSITIVE_INFINITY;

        for (let candidateIndex = minZhIndex; candidateIndex < zhLines.length; candidateIndex += 1) {
          if (usedZh.has(candidateIndex)) {
            continue;
          }
          const candidate = zhLines[candidateIndex];
          if (!candidate.timestamp) {
            continue;
          }
          const candidateSeconds = parseTimeToSeconds(candidate.timestamp);
          if (candidateSeconds === null) {
            continue;
          }
          const diff = Math.abs(candidateSeconds - enSeconds);
          if (diff > nearWindowSec) {
            continue;
          }
          if (diff < nearBestDiff) {
            nearBestDiff = diff;
            nearBestIndex = candidateIndex;
          }
        }

        if (nearBestIndex >= 0) {
          matchedZhIndex = nearBestIndex;
          matchMethod = 'ts_near';
          confidence = clamp(0.92 - nearBestDiff / Math.max(nearWindowSec, 1) * 0.22, 0.7, 0.92);
        }
      }
    }

    if (matchedZhIndex < 0) {
      matchedZhIndex = findFirstUnusedIndex(
        zhLines,
        usedZh,
        minZhIndex,
        () => true
      );
      if (matchedZhIndex >= 0) {
        matchMethod = 'order_fallback';
        confidence = 0.56;
      }
    }

    if (matchedZhIndex >= 0) {
      const matchedZhLine = zhLines[matchedZhIndex];
      usedZh.add(matchedZhIndex);
      minZhIndex = matchedZhIndex + 1;

      pairs.push({
        order: i + 1,
        en: enLine.text,
        zh: matchedZhLine.text,
        enTimestamp: enLine.timestamp,
        zhTimestamp: matchedZhLine.timestamp,
        matchMethod,
        confidence,
      });
      continue;
    }

    pairs.push({
      order: i + 1,
      en: enLine.text,
      zh: BILINGUAL_MISSING_ZH_PLACEHOLDER,
      enTimestamp: enLine.timestamp,
      zhTimestamp: null,
      matchMethod: 'missing',
      confidence: 0,
    });
  }

  return {
    version: BILINGUAL_ALIGNMENT_VERSION,
    pairs,
    stats: buildAlignmentStats(pairs),
    generatedAt,
  };
}

function makeSummarySectionPairing(
  sectionKey: string,
  enSection: SummarySectionItems | undefined,
  zhSection: SummarySectionItems | undefined,
  orderStart: number
): { section: SummaryBilingualSection; nextOrder: number } {
  const enItems = enSection?.items || [];
  const zhItems = zhSection?.items || [];
  const itemCount = Math.max(enItems.length, zhItems.length);
  const sectionPairs: BilingualPair[] = [];

  let order = orderStart;
  for (let i = 0; i < itemCount; i += 1) {
    const en = cleanLine(enItems[i]) || BILINGUAL_MISSING_EN_PLACEHOLDER;
    const zhValue = cleanLine(zhItems[i]);
    const hasZh = Boolean(zhValue);

    sectionPairs.push({
      order,
      en,
      zh: hasZh ? zhValue : BILINGUAL_MISSING_ZH_PLACEHOLDER,
      enTimestamp: null,
      zhTimestamp: null,
      matchMethod: hasZh ? 'section_index' : 'missing',
      confidence: hasZh ? 0.9 : 0,
    });

    order += 1;
  }

  return {
    section: {
      sectionKey,
      sectionTitleEn: formatSectionTitle(sectionKey, enSection?.title || '', 'en'),
      sectionTitleZh: formatSectionTitle(sectionKey, zhSection?.title || '', 'zh'),
      pairs: sectionPairs,
    },
    nextOrder: order,
  };
}

export function buildSummaryBilingualPayload(
  summaryEn: string,
  summaryZh: string,
  options?: { generatedAt?: string }
): SummaryBilingualPayload {
  const generatedAt = options?.generatedAt || new Date().toISOString();
  const enSections = parseSummarySections(summaryEn);
  const zhSections = parseSummarySections(summaryZh);

  const canonicalKeys = ['key_takeaways', 'data_numbers', 'decisions_actions'];
  const enByCanonical = new Map<string, SummarySectionItems>();
  const zhByCanonical = new Map<string, SummarySectionItems>();
  const usedEnIndexes = new Set<number>();
  const usedZhIndexes = new Set<number>();

  for (let i = 0; i < enSections.length; i += 1) {
    const section = enSections[i];
    if (canonicalKeys.includes(section.sectionKey) && !enByCanonical.has(section.sectionKey)) {
      enByCanonical.set(section.sectionKey, section);
      usedEnIndexes.add(i);
    }
  }
  for (let i = 0; i < zhSections.length; i += 1) {
    const section = zhSections[i];
    if (canonicalKeys.includes(section.sectionKey) && !zhByCanonical.has(section.sectionKey)) {
      zhByCanonical.set(section.sectionKey, section);
      usedZhIndexes.add(i);
    }
  }

  const sections: SummaryBilingualSection[] = [];
  let order = 1;

  for (const key of canonicalKeys) {
    const enSection = enByCanonical.get(key);
    const zhSection = zhByCanonical.get(key);
    if (!enSection && !zhSection) {
      continue;
    }

    const paired = makeSummarySectionPairing(key, enSection, zhSection, order);
    sections.push(paired.section);
    order = paired.nextOrder;
  }

  const remainingEn = enSections.filter((_, index) => !usedEnIndexes.has(index));
  const remainingZh = zhSections.filter((_, index) => !usedZhIndexes.has(index));
  const remainingCount = Math.max(remainingEn.length, remainingZh.length);

  for (let i = 0; i < remainingCount; i += 1) {
    const enSection = remainingEn[i];
    const zhSection = remainingZh[i];
    const fallbackKey = enSection?.sectionKey || zhSection?.sectionKey || `section_${i + 1}`;
    const paired = makeSummarySectionPairing(fallbackKey, enSection, zhSection, order);
    sections.push(paired.section);
    order = paired.nextOrder;
  }

  const pairs = flattenSummaryPairs({
    version: BILINGUAL_ALIGNMENT_VERSION,
    sections,
    stats: { total: 0, matched: 0, llmMatched: 0, unmatched: 0, methods: {} },
    generatedAt,
  });

  return {
    version: BILINGUAL_ALIGNMENT_VERSION,
    sections,
    stats: buildAlignmentStats(pairs),
    generatedAt,
  };
}

export function renderFullTextBilingualMarkdown(payload: FullTextBilingualPayload): string {
  const lines: string[] = [];

  for (const pair of payload.pairs) {
    const timestampPrefix = pair.enTimestamp ? `**[${pair.enTimestamp}]** ` : '';
    lines.push(`${timestampPrefix}${pair.en}  `);
    lines.push(pair.zh || BILINGUAL_MISSING_ZH_PLACEHOLDER);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').trim();
}

export function renderSummaryBilingualMarkdown(payload: SummaryBilingualPayload): string {
  const lines: string[] = [];

  for (const section of payload.sections) {
    const title = cleanLine(section.sectionTitleEn) || cleanLine(section.sectionTitleZh) || 'Section';
    lines.push(`## ${title}`);

    for (const pair of section.pairs) {
      lines.push(`${pair.en}  `);
      lines.push(pair.zh || BILINGUAL_MISSING_ZH_PLACEHOLDER);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function normalizePair(value: unknown, index: number): BilingualPair | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const en = cleanLine(String(source.en || ''));
  const zh = cleanLine(String(source.zh || '')) || BILINGUAL_MISSING_ZH_PLACEHOLDER;
  const method = String(source.matchMethod || 'missing') as BilingualMatchMethod;
  const confidence = clamp(Number(source.confidence ?? 0), 0, 1);

  return {
    order: Number.isFinite(Number(source.order)) ? Math.max(1, Math.floor(Number(source.order))) : index + 1,
    en: en || BILINGUAL_MISSING_EN_PLACEHOLDER,
    zh,
    enTimestamp: source.enTimestamp ? String(source.enTimestamp) : null,
    zhTimestamp: source.zhTimestamp ? String(source.zhTimestamp) : null,
    matchMethod: method,
    confidence,
  };
}

export function normalizeFullTextBilingualPayload(value: unknown): FullTextBilingualPayload | null {
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

  const source = parsed as Record<string, unknown>;
  const pairs = Array.isArray(source.pairs)
    ? source.pairs
        .map((pair, index) => normalizePair(pair, index))
        .filter((pair): pair is BilingualPair => Boolean(pair))
    : [];

  if (pairs.length === 0) {
    return null;
  }

  return {
    version: Number(source.version || BILINGUAL_ALIGNMENT_VERSION),
    pairs,
    stats: buildAlignmentStats(pairs),
    generatedAt: cleanLine(String(source.generatedAt || '')) || new Date().toISOString(),
  };
}

export function normalizeSummaryBilingualPayload(value: unknown): SummaryBilingualPayload | null {
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

  const source = parsed as Record<string, unknown>;
  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  const sections: SummaryBilingualSection[] = [];
  let order = 1;

  for (let i = 0; i < rawSections.length; i += 1) {
    const rawSection = rawSections[i];
    if (!rawSection || typeof rawSection !== 'object') {
      continue;
    }
    const sectionRecord = rawSection as Record<string, unknown>;
    const rawPairs = Array.isArray(sectionRecord.pairs) ? sectionRecord.pairs : [];
    const pairs = rawPairs
      .map((pair, pairIndex) => normalizePair(pair, pairIndex))
      .filter((pair): pair is BilingualPair => Boolean(pair))
      .map((pair) => ({ ...pair, order: order++ }));

    if (pairs.length === 0) {
      continue;
    }

    sections.push({
      sectionKey: cleanLine(String(sectionRecord.sectionKey || '')) || `section_${i + 1}`,
      sectionTitleEn: cleanLine(String(sectionRecord.sectionTitleEn || '')) || 'Section',
      sectionTitleZh: cleanLine(String(sectionRecord.sectionTitleZh || '')) || '分组',
      pairs,
    });
  }

  if (sections.length === 0) {
    return null;
  }

  const payload: SummaryBilingualPayload = {
    version: Number(source.version || BILINGUAL_ALIGNMENT_VERSION),
    sections,
    stats: buildAlignmentStats(flattenSummaryPairs({
      version: BILINGUAL_ALIGNMENT_VERSION,
      sections,
      stats: { total: 0, matched: 0, llmMatched: 0, unmatched: 0, methods: {} },
      generatedAt: new Date().toISOString(),
    })),
    generatedAt: cleanLine(String(source.generatedAt || '')) || new Date().toISOString(),
  };

  return payload;
}

export function listFullTextMissingPairIndexes(payload: FullTextBilingualPayload): number[] {
  return payload.pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => pair.matchMethod === 'missing')
    .map(({ index }) => index);
}

export function listSummaryMissingPairIndexes(payload: SummaryBilingualPayload): Array<{ sectionIndex: number; pairIndex: number }> {
  const indexes: Array<{ sectionIndex: number; pairIndex: number }> = [];
  for (let sectionIndex = 0; sectionIndex < payload.sections.length; sectionIndex += 1) {
    const section = payload.sections[sectionIndex];
    for (let pairIndex = 0; pairIndex < section.pairs.length; pairIndex += 1) {
      if (section.pairs[pairIndex].matchMethod === 'missing') {
        indexes.push({ sectionIndex, pairIndex });
      }
    }
  }
  return indexes;
}
