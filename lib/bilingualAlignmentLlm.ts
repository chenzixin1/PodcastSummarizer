import { modelConfig } from './modelConfig';
import {
  BILINGUAL_MISSING_ZH_PLACEHOLDER,
  type BilingualPair,
  type FullTextBilingualPayload,
  type SummaryBilingualPayload,
  listFullTextMissingPairIndexes,
  listSummaryMissingPairIndexes,
  parseSummarySections,
  parseTimestampedLines,
  rebuildFullTextAlignmentStats,
  rebuildSummaryAlignmentStats,
} from './bilingualAlignment';

interface LlmCandidate {
  id: string;
  text: string;
  timestamp?: string | null;
  sectionKey?: string;
}

interface LlmMatch {
  order: number;
  candidateId: string;
  confidence?: number;
}

interface LlmResponse {
  matches?: LlmMatch[];
}

export interface LlmFallbackResult<TPayload> {
  payload: TPayload;
  attempted: number;
  llmMatched: number;
}

interface LlmFallbackOptions {
  maxMissing?: number;
}

const DEFAULT_MAX_MISSING = 20;
const MAX_RETRIES = Math.max(0, modelConfig.MAX_RETRIES);
const RETRY_DELAY_MS = Math.max(200, modelConfig.RETRY_DELAY);
const API_TIMEOUT_MS = Math.max(10_000, modelConfig.API_TIMEOUT_MS);
const MODEL = modelConfig.MODEL;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractJsonPayload<T>(raw: string): T | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = safeJsonParse<T>(fenced[1].trim());
    if (parsed) {
      return parsed;
    }
  }

  const direct = safeJsonParse<T>(trimmed);
  if (direct) {
    return direct;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return safeJsonParse<T>(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

function buildLlmSystemPrompt(taskLabel: 'full_text' | 'summary'): string {
  if (taskLabel === 'full_text') {
    return [
      'You map English transcript lines to Chinese transcript lines.',
      'Return strict JSON only with this schema:',
      '{"matches":[{"order":number,"candidateId":string,"confidence":number}]}',
      'Rules:',
      '1. Match by semantics first, then timestamp proximity.',
      '2. Do not invent Chinese text.',
      '3. candidateId must come from the provided candidate list.',
      '4. A candidate can be used at most once.',
      '5. If no confident match exists, omit that order from matches.',
    ].join('\n');
  }

  return [
    'You map missing Chinese summary bullets to English summary bullets.',
    'Return strict JSON only with this schema:',
    '{"matches":[{"order":number,"candidateId":string,"confidence":number}]}',
    'Rules:',
    '1. Match by section/topic consistency and semantic equivalence.',
    '2. Do not invent text.',
    '3. candidateId must come from candidates and cannot repeat.',
    '4. Omit uncertain matches instead of guessing.',
  ].join('\n');
}

function buildLlmUserPrompt(args: {
  missing: Array<{
    order: number;
    en: string;
    enTimestamp?: string | null;
    sectionKey?: string;
    sectionTitle?: string;
  }>;
  candidates: LlmCandidate[];
  taskLabel: 'full_text' | 'summary';
}): string {
  const header =
    args.taskLabel === 'full_text'
      ? 'Map missing Chinese full-text lines to candidates.'
      : 'Map missing Chinese summary bullets to candidates.';

  return [
    header,
    '',
    'Missing entries:',
    JSON.stringify(args.missing, null, 2),
    '',
    'Candidates:',
    JSON.stringify(args.candidates, null, 2),
    '',
    'Output JSON only.',
  ].join('\n');
}

async function callOpenRouterJson(args: {
  taskLabel: 'full_text' | 'summary';
  missing: Array<{
    order: number;
    en: string;
    enTimestamp?: string | null;
    sectionKey?: string;
    sectionTitle?: string;
  }>;
  candidates: LlmCandidate[];
}): Promise<LlmResponse | null> {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    return null;
  }

  const systemPrompt = buildLlmSystemPrompt(args.taskLabel);
  const userPrompt = buildLlmUserPrompt(args);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
          'X-Title': 'PodSum.cc',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1500,
          temperature: 0.1,
          stream: false,
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeout);
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`OpenRouter error ${response.status}: ${message}`);
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      return extractJsonPayload<LlmResponse>(content);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }

  if (lastError) {
    console.warn('[bilingual-llm] fallback failed:', lastError instanceof Error ? lastError.message : String(lastError));
  }
  return null;
}

function keyOfCandidate(entry: { text: string; timestamp?: string | null; sectionKey?: string }): string {
  return `${entry.sectionKey || ''}|${entry.timestamp || ''}|${normalizeText(entry.text)}`;
}

function buildUsedCandidateCounterForFullText(payload: FullTextBilingualPayload): Map<string, number> {
  const counter = new Map<string, number>();
  for (const pair of payload.pairs) {
    if (pair.matchMethod === 'missing') {
      continue;
    }
    const key = keyOfCandidate({
      text: pair.zh,
      timestamp: pair.zhTimestamp,
    });
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  return counter;
}

function buildUsedCandidateCounterForSummary(payload: SummaryBilingualPayload): Map<string, number> {
  const counter = new Map<string, number>();
  for (const section of payload.sections) {
    for (const pair of section.pairs) {
      if (pair.matchMethod === 'missing') {
        continue;
      }
      const key = keyOfCandidate({
        sectionKey: section.sectionKey,
        text: pair.zh,
      });
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }
  return counter;
}

function buildFullTextCandidates(payload: FullTextBilingualPayload, fullTextZh: string): LlmCandidate[] {
  const usedCounter = buildUsedCandidateCounterForFullText(payload);
  const candidates: LlmCandidate[] = [];
  const zhLines = parseTimestampedLines(fullTextZh);

  for (let i = 0; i < zhLines.length; i += 1) {
    const line = zhLines[i];
    const key = keyOfCandidate({
      text: line.text,
      timestamp: line.timestamp,
    });
    const remainingUsedCount = usedCounter.get(key) || 0;
    if (remainingUsedCount > 0) {
      usedCounter.set(key, remainingUsedCount - 1);
      continue;
    }

    candidates.push({
      id: `zh-${i + 1}`,
      text: line.text,
      timestamp: line.timestamp,
    });
  }

  return candidates;
}

function buildSummaryCandidates(payload: SummaryBilingualPayload, summaryZh: string): LlmCandidate[] {
  const usedCounter = buildUsedCandidateCounterForSummary(payload);
  const sections = parseSummarySections(summaryZh);
  const candidates: LlmCandidate[] = [];

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
      const item = normalizeText(section.items[itemIndex]);
      if (!item) {
        continue;
      }

      const key = keyOfCandidate({
        sectionKey: section.sectionKey,
        text: item,
      });
      const remainingUsedCount = usedCounter.get(key) || 0;
      if (remainingUsedCount > 0) {
        usedCounter.set(key, remainingUsedCount - 1);
        continue;
      }

      candidates.push({
        id: `s${sectionIndex + 1}-i${itemIndex + 1}`,
        sectionKey: section.sectionKey,
        text: item,
      });
    }
  }

  return candidates;
}

function normalizeMatches(response: LlmResponse | null): LlmMatch[] {
  if (!response || !Array.isArray(response.matches)) {
    return [];
  }

  const result: LlmMatch[] = [];
  for (const candidate of response.matches) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const order = Number((candidate as { order?: unknown }).order);
    const candidateId = normalizeText((candidate as { candidateId?: unknown }).candidateId);
    const confidenceRaw = Number((candidate as { confidence?: unknown }).confidence);

    if (!Number.isFinite(order) || !candidateId) {
      continue;
    }

    result.push({
      order: Math.floor(order),
      candidateId,
      confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : undefined,
    });
  }

  return result;
}

export async function applyLlmFallbackToFullTextPayload(
  payload: FullTextBilingualPayload,
  args: {
    fullTextZh: string;
    maxMissing?: number;
  }
): Promise<LlmFallbackResult<FullTextBilingualPayload>> {
  const maxMissing = Math.max(0, Math.min(args.maxMissing ?? DEFAULT_MAX_MISSING, DEFAULT_MAX_MISSING));
  if (maxMissing === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const missingIndexes = listFullTextMissingPairIndexes(payload);
  if (missingIndexes.length === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const candidates = buildFullTextCandidates(payload, args.fullTextZh);
  if (candidates.length === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const targetIndexes = missingIndexes.slice(0, maxMissing);
  const missing = targetIndexes.map((index) => {
    const pair = payload.pairs[index];
    return {
      order: pair.order,
      en: pair.en,
      enTimestamp: pair.enTimestamp || null,
    };
  });

  const modelResponse = await callOpenRouterJson({
    taskLabel: 'full_text',
    missing,
    candidates,
  });

  const matches = normalizeMatches(modelResponse);
  if (matches.length === 0) {
    return { payload, attempted: missing.length, llmMatched: 0 };
  }

  const orderToPairIndex = new Map<number, number>();
  for (const pairIndex of targetIndexes) {
    orderToPairIndex.set(payload.pairs[pairIndex].order, pairIndex);
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const usedCandidateIds = new Set<string>();
  const nextPairs = payload.pairs.map((pair) => ({ ...pair }));

  let llmMatched = 0;
  for (const match of matches) {
    const pairIndex = orderToPairIndex.get(match.order);
    if (pairIndex === undefined) {
      continue;
    }
    if (usedCandidateIds.has(match.candidateId)) {
      continue;
    }

    const candidate = candidateById.get(match.candidateId);
    if (!candidate || !normalizeText(candidate.text)) {
      continue;
    }

    const pair = nextPairs[pairIndex];
    if (pair.matchMethod !== 'missing' || pair.zh !== BILINGUAL_MISSING_ZH_PLACEHOLDER) {
      continue;
    }

    pair.zh = candidate.text;
    pair.zhTimestamp = candidate.timestamp || null;
    pair.matchMethod = 'llm';
    pair.confidence = clamp(match.confidence ?? 0.75, 0.55, 0.98);
    usedCandidateIds.add(match.candidateId);
    llmMatched += 1;
  }

  return {
    payload: rebuildFullTextAlignmentStats({
      ...payload,
      pairs: nextPairs,
    }),
    attempted: missing.length,
    llmMatched,
  };
}

export async function applyLlmFallbackToSummaryPayload(
  payload: SummaryBilingualPayload,
  args: {
    summaryZh: string;
    maxMissing?: number;
  }
): Promise<LlmFallbackResult<SummaryBilingualPayload>> {
  const maxMissing = Math.max(0, Math.min(args.maxMissing ?? DEFAULT_MAX_MISSING, DEFAULT_MAX_MISSING));
  if (maxMissing === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const missingIndexes = listSummaryMissingPairIndexes(payload);
  if (missingIndexes.length === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const candidates = buildSummaryCandidates(payload, args.summaryZh);
  if (candidates.length === 0) {
    return { payload, attempted: 0, llmMatched: 0 };
  }

  const targetIndexes = missingIndexes.slice(0, maxMissing);
  const missing = targetIndexes.map(({ sectionIndex, pairIndex }) => {
    const section = payload.sections[sectionIndex];
    const pair = section.pairs[pairIndex];
    return {
      order: pair.order,
      en: pair.en,
      sectionKey: section.sectionKey,
      sectionTitle: section.sectionTitleEn || section.sectionTitleZh,
    };
  });

  const modelResponse = await callOpenRouterJson({
    taskLabel: 'summary',
    missing,
    candidates,
  });

  const matches = normalizeMatches(modelResponse);
  if (matches.length === 0) {
    return { payload, attempted: missing.length, llmMatched: 0 };
  }

  const orderToLocation = new Map<number, { sectionIndex: number; pairIndex: number }>();
  for (const loc of targetIndexes) {
    const pair = payload.sections[loc.sectionIndex].pairs[loc.pairIndex];
    orderToLocation.set(pair.order, loc);
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const usedCandidateIds = new Set<string>();
  const nextSections = payload.sections.map((section) => ({
    ...section,
    pairs: section.pairs.map((pair) => ({ ...pair })),
  }));

  let llmMatched = 0;
  for (const match of matches) {
    const location = orderToLocation.get(match.order);
    if (!location) {
      continue;
    }
    if (usedCandidateIds.has(match.candidateId)) {
      continue;
    }

    const candidate = candidateById.get(match.candidateId);
    if (!candidate || !normalizeText(candidate.text)) {
      continue;
    }

    const pair = nextSections[location.sectionIndex].pairs[location.pairIndex];
    if (pair.matchMethod !== 'missing' || pair.zh !== BILINGUAL_MISSING_ZH_PLACEHOLDER) {
      continue;
    }

    pair.zh = candidate.text;
    pair.zhTimestamp = null;
    pair.matchMethod = 'llm';
    pair.confidence = clamp(match.confidence ?? 0.72, 0.55, 0.97);
    usedCandidateIds.add(match.candidateId);
    llmMatched += 1;
  }

  return {
    payload: rebuildSummaryAlignmentStats({
      ...payload,
      sections: nextSections,
    }),
    attempted: missing.length,
    llmMatched,
  };
}
