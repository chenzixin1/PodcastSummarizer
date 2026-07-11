import {
  buildTopicExtractionInput,
  deterministicTopicFallback,
  parseAndValidateTopicResponse,
  toTopicFacets,
  type TopicAssignment,
  type TopicFacets,
  type TopicProposal,
} from './topicTaxonomy';
import { getTopicTaxonomy } from './topicTaxonomyData';

export type TopicModelCall = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface StructuredTopicInput {
  title?: string | null;
  briefSummary?: string | null;
  summaryZh?: string | null;
  summaryEn?: string | null;
}

export interface StructuredTopicResult {
  assignments: TopicAssignment[];
  proposals: TopicProposal[];
  facets: TopicFacets;
  usedFallback: boolean;
  rejections: Record<string, number>;
}

const SYSTEM_PROMPT = `You classify podcast content into a controlled taxonomy.
Return one JSON object only with keys "selected" and "proposed".

Rules:
- Select only topicId values supplied in the taxonomy.
- Use facet exactly as supplied.
- Evidence must be a short verbatim substring from SOURCE CONTENT.
- Target 4-6 topics, 0-3 people, and 2-4 organizations/products, with 8-12 total only when supported.
- Prefer specific, reusable concepts over generic words.
- Never output summary headings, placeholders, currencies, units, platforms, or fragments of a person's name.
- Propose at most two genuinely new reusable English labels. Do not propose synonyms of supplied labels.

Schema:
{"selected":[{"topicId":"id","facet":"topic|person|organization_product","confidence":0.0,"evidence":"verbatim text"}],"proposed":[{"canonicalName":"English label","facet":"topic|person|organization_product","aliases":[],"confidence":0.0,"evidence":"verbatim text"}]}`;

function buildUserPrompt(source: string): string {
  const taxonomy = getTopicTaxonomy()
    .filter((definition) => definition.status === 'active')
    .map((definition) => ({
      id: definition.id,
      name: definition.canonicalName,
      facet: definition.facet,
      aliases: definition.aliases,
    }));
  return `CONTROLLED TAXONOMY:\n${JSON.stringify(taxonomy)}\n\nSOURCE CONTENT:\n${source}`;
}

export async function extractStructuredTopics(
  input: StructuredTopicInput,
  callModel: TopicModelCall,
): Promise<StructuredTopicResult> {
  const definitions = getTopicTaxonomy();
  const source = buildTopicExtractionInput(input);
  if (!source) {
    return {
      assignments: [],
      proposals: [],
      facets: { topics: [], people: [], organizationsProducts: [] },
      usedFallback: true,
      rejections: { empty_source: 1 },
    };
  }

  try {
    const raw = await callModel(SYSTEM_PROMPT, buildUserPrompt(source));
    const validated = parseAndValidateTopicResponse(raw, definitions, source);
    if (validated.assignments.length > 0) {
      return {
        ...validated,
        facets: toTopicFacets(validated.assignments, definitions),
        usedFallback: false,
      };
    }
    const assignments = deterministicTopicFallback(definitions, source);
    return {
      assignments,
      proposals: validated.proposals,
      facets: toTopicFacets(assignments, definitions),
      usedFallback: true,
      rejections: validated.rejections,
    };
  } catch {
    const assignments = deterministicTopicFallback(definitions, source);
    return {
      assignments,
      proposals: [],
      facets: toTopicFacets(assignments, definitions),
      usedFallback: true,
      rejections: { model_error: 1 },
    };
  }
}
