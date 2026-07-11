export type TopicFacet = 'topic' | 'person' | 'organization_product';
export type TopicDefinitionStatus = 'active' | 'candidate' | 'blocked';
export type TopicExtractionSource = 'codex_backfill' | 'model' | 'deterministic_fallback';

export interface TopicDefinition {
  id: string;
  canonicalName: string;
  facet: TopicFacet;
  aliases: string[];
  parentId?: string;
  keywords: string[];
  status: TopicDefinitionStatus;
  occurrenceCount?: number;
}

export interface TopicCandidateScore {
  definition: TopicDefinition;
  retrievalScore: number;
  evidence: string;
}

export interface TopicAssignment {
  topicId: string;
  facet: TopicFacet;
  relevanceScore: number;
  evidence: string;
  extractionSource: TopicExtractionSource;
  extractorVersion: string;
}

export interface TopicProposal {
  canonicalName: string;
  facet: TopicFacet;
  aliases: string[];
  confidence: number;
  evidence: string;
}

export interface TopicFacets {
  topics: string[];
  people: string[];
  organizationsProducts: string[];
}

export interface TopicExtractionValidationResult {
  assignments: TopicAssignment[];
  proposals: TopicProposal[];
  rejections: Record<string, number>;
}

export const TOPIC_EXTRACTOR_VERSION = 'topic-taxonomy-v1';

const MIN_CONFIDENCE = 0.62;
const FACET_LIMITS: Record<TopicFacet, number> = {
  topic: 6,
  person: 3,
  organization_product: 4,
};

const NOISE_TERMS = new Set([
  'ai ai', 'ai ai ai', 'youtube', 'youtube-source', 'interview', 'discussion', 'conversation',
  'not explicitly mentioned', 'owner', 'time', 'time point', 'execution conditions',
  '未明确提及', '负责人', '时间点', '执行条件', '亿美元', '万美元', '美元',
  'is', 'of', 'to', 'in', 'on', 'an', 'as', 'be', 'by', 'or', 'and', 'the',
]);

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1;
}

export function normalizeTopicText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparisonText(value: string): string {
  return normalizeTopicText(value)
    .toLocaleLowerCase('en-US')
    .replace(/[\s_\-/|:;,.!?()[\]{}'"`]+/g, ' ')
    .trim();
}

function isNoiseLabel(value: string): boolean {
  const normalized = comparisonText(value);
  if (!normalized || NOISE_TERMS.has(normalized)) return true;
  if (/^(ai\s+){1,}ai$/i.test(normalized)) return true;
  if (/^(?:\d+(?:\.\d+)?|\d+%|\$\d+)$/.test(normalized)) return true;
  return false;
}

function extractSection(markdown: string, headings: string[]): string {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const headingPattern = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = normalized.match(new RegExp(`^##\\s+(?:${headingPattern})\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'im'));
  if (!match) return '';
  return match[1]
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]/g, ' ')
    .trim();
}

function removeTemplateNoise(value: string): string {
  let result = String(value || '');
  for (const phrase of ['未明确提及', '负责人', '时间点', '执行条件', 'Not explicitly mentioned', 'Owner', 'Time point']) {
    result = result.replace(new RegExp(phrase, 'gi'), ' ');
  }
  return normalizeTopicText(result);
}

export function buildTopicExtractionInput(input: {
  title?: string | null;
  briefSummary?: string | null;
  summaryZh?: string | null;
  summaryEn?: string | null;
}): string {
  const coreZh = extractSection(String(input.summaryZh || ''), ['核心观点']);
  const coreEn = extractSection(String(input.summaryEn || ''), ['Key Takeaways']);
  return [input.title, input.briefSummary, coreZh || coreEn]
    .map((part) => removeTemplateNoise(String(part || '')))
    .filter(Boolean)
    .join('\n');
}

function findEvidence(input: string, terms: string[]): { evidence: string; weight: number } | null {
  const haystack = comparisonText(input);
  for (const term of terms.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const needle = comparisonText(term);
    if (needle && haystack.includes(needle)) {
      return { evidence: normalizeTopicText(term), weight: 1 };
    }
  }
  return null;
}

export function retrieveTopicCandidates(
  definitions: TopicDefinition[],
  input: string,
  limit = 50,
): TopicCandidateScore[] {
  const results: TopicCandidateScore[] = [];
  for (const definition of definitions) {
    if (definition.status !== 'active' || isNoiseLabel(definition.canonicalName)) continue;
    const exact = findEvidence(input, [definition.canonicalName, ...definition.aliases]);
    const keyword = findEvidence(input, definition.keywords);
    if (!exact && !keyword) continue;
    const retrievalScore = Math.min(100, (exact ? 100 : 0) + (keyword ? 20 : 0));
    results.push({
      definition,
      retrievalScore,
      evidence: exact?.evidence || keyword?.evidence || definition.canonicalName,
    });
  }
  return results
    .sort((a, b) => b.retrievalScore - a.retrievalScore || a.definition.canonicalName.localeCompare(b.definition.canonicalName))
    .slice(0, limit);
}

function parseJsonObject(raw: string): unknown {
  const source = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(source);
}

function isFacet(value: unknown): value is TopicFacet {
  return value === 'topic' || value === 'person' || value === 'organization_product';
}

function evidenceExists(input: string, evidence: string): boolean {
  const needle = comparisonText(evidence);
  return Boolean(needle && comparisonText(input).includes(needle));
}

function applyLimits(assignments: TopicAssignment[]): TopicAssignment[] {
  const counts: Record<TopicFacet, number> = { topic: 0, person: 0, organization_product: 0 };
  const result: TopicAssignment[] = [];
  for (const assignment of assignments) {
    if (result.length >= 12 || counts[assignment.facet] >= FACET_LIMITS[assignment.facet]) continue;
    counts[assignment.facet] += 1;
    result.push(assignment);
  }
  return result;
}

export function parseAndValidateTopicResponse(
  raw: string,
  definitions: TopicDefinition[],
  input: string,
): TopicExtractionValidationResult {
  const rejections: Record<string, number> = {};
  let parsed: { selected?: unknown; proposed?: unknown };
  try {
    parsed = parseJsonObject(raw) as { selected?: unknown; proposed?: unknown };
  } catch {
    return { assignments: [], proposals: [], rejections: { invalid_json: 1 } };
  }

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const assignments: TopicAssignment[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(parsed.selected) ? parsed.selected : []) {
    const candidate = item as Record<string, unknown>;
    const topicId = String(candidate.topicId || '');
    const definition = byId.get(topicId);
    if (!definition) {
      increment(rejections, 'unknown');
      continue;
    }
    if (definition.status !== 'active' || isNoiseLabel(definition.canonicalName)) {
      increment(rejections, 'blocked');
      continue;
    }
    if (!isFacet(candidate.facet) || candidate.facet !== definition.facet) {
      increment(rejections, 'facet');
      continue;
    }
    const confidence = Number(candidate.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
      increment(rejections, 'confidence');
      continue;
    }
    const evidence = normalizeTopicText(String(candidate.evidence || ''));
    if (!evidenceExists(input, evidence)) {
      increment(rejections, 'evidence');
      continue;
    }
    if (!findEvidence(input, [definition.canonicalName, ...definition.aliases, ...definition.keywords])) {
      increment(rejections, 'semantic_support');
      continue;
    }
    if (seen.has(topicId)) {
      increment(rejections, 'duplicate');
      continue;
    }
    seen.add(topicId);
    assignments.push({
      topicId,
      facet: definition.facet,
      relevanceScore: Math.max(0, Math.min(1, confidence)),
      evidence,
      extractionSource: 'model',
      extractorVersion: TOPIC_EXTRACTOR_VERSION,
    });
  }

  const selectedPersonNames = assignments
    .filter((assignment) => assignment.facet === 'person')
    .map((assignment) => comparisonText(byId.get(assignment.topicId)?.canonicalName || ''));
  const withoutFragments = assignments.filter((assignment) => {
    if (assignment.facet !== 'person') return true;
    const name = comparisonText(byId.get(assignment.topicId)?.canonicalName || '');
    const fragment = selectedPersonNames.some((other) => other !== name && other.split(' ').includes(name));
    if (fragment) increment(rejections, 'person_fragment');
    return !fragment;
  });

  const proposals: TopicProposal[] = [];
  for (const item of (Array.isArray(parsed.proposed) ? parsed.proposed : []).slice(0, 2)) {
    const proposal = item as Record<string, unknown>;
    const canonicalName = normalizeTopicText(String(proposal.canonicalName || ''));
    const confidence = Number(proposal.confidence);
    const evidence = normalizeTopicText(String(proposal.evidence || ''));
    if (
      isNoiseLabel(canonicalName) ||
      !isFacet(proposal.facet) ||
      !Number.isFinite(confidence) || confidence < 0.75 ||
      !evidenceExists(input, evidence)
    ) {
      increment(rejections, isNoiseLabel(canonicalName) ? 'proposal_noise' : 'proposal_invalid');
      continue;
    }
    proposals.push({
      canonicalName,
      facet: proposal.facet,
      aliases: Array.isArray(proposal.aliases) ? proposal.aliases.map(String).map(normalizeTopicText).filter(Boolean).slice(0, 6) : [],
      confidence,
      evidence,
    });
  }

  return { assignments: applyLimits(withoutFragments), proposals, rejections };
}

export function deterministicTopicFallback(
  definitions: TopicDefinition[],
  input: string,
): TopicAssignment[] {
  const candidates = retrieveTopicCandidates(definitions, input);
  return applyLimits(candidates.map((candidate) => ({
    topicId: candidate.definition.id,
    facet: candidate.definition.facet,
    relevanceScore: Math.min(1, 0.7 + candidate.retrievalScore / 500),
    evidence: candidate.evidence,
    extractionSource: 'deterministic_fallback' as const,
    extractorVersion: TOPIC_EXTRACTOR_VERSION,
  })));
}

export function toTopicFacets(
  assignments: TopicAssignment[],
  definitions: TopicDefinition[],
): TopicFacets {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const facets: TopicFacets = { topics: [], people: [], organizationsProducts: [] };
  for (const assignment of assignments) {
    const definition = byId.get(assignment.topicId);
    if (!definition) continue;
    if (definition.facet === 'topic') facets.topics.push(definition.canonicalName);
    if (definition.facet === 'person') facets.people.push(definition.canonicalName);
    if (definition.facet === 'organization_product') facets.organizationsProducts.push(definition.canonicalName);
  }
  return facets;
}

export function projectCompatibilityTags(
  assignments: TopicAssignment[],
  definitions: TopicDefinition[],
): string[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const label = byId.get(assignment.topicId)?.canonicalName;
    const key = comparisonText(label || '');
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result.slice(0, 12);
}

export function labelsToTopicFacets(
  labels: string[],
  definitions: TopicDefinition[],
): TopicFacets {
  const byLabel = new Map<string, TopicDefinition>();
  for (const definition of definitions) {
    if (definition.status !== 'active') continue;
    for (const value of [definition.canonicalName, ...definition.aliases]) {
      const key = comparisonText(value);
      if (key && !byLabel.has(key)) byLabel.set(key, definition);
    }
  }
  const assignments: TopicAssignment[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    const definition = byLabel.get(comparisonText(label));
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    assignments.push({
      topicId: definition.id,
      facet: definition.facet,
      relevanceScore: 1,
      evidence: label,
      extractionSource: 'codex_backfill',
      extractorVersion: TOPIC_EXTRACTOR_VERSION,
    });
  }
  return toTopicFacets(assignments, definitions);
}
