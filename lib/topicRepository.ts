import { isD1DatabaseProvider, sql } from './sql';
import {
  projectCompatibilityTags,
  TOPIC_EXTRACTOR_VERSION,
  type TopicAssignment,
  type TopicProposal,
} from './topicTaxonomy';
import { getTopicTaxonomy } from './topicTaxonomyData';

let schemaPromise: Promise<void> | null = null;
let seedPromise: Promise<void> | null = null;

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function candidateId(facet: string, name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'candidate';
  return `${facet}-${slug}`;
}

export async function ensureTopicSchema(): Promise<void> {
  if (isD1DatabaseProvider()) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS topic_definitions (
          id TEXT PRIMARY KEY,
          canonical_name TEXT NOT NULL,
          facet TEXT NOT NULL,
          aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          parent_id TEXT,
          keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL,
          occurrence_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS podcast_topics (
          podcast_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          relevance_score DOUBLE PRECISION NOT NULL,
          evidence TEXT NOT NULL,
          extraction_source TEXT NOT NULL,
          extractor_version TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (podcast_id, topic_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS topic_candidates (
          id TEXT PRIMARY KEY,
          proposed_name TEXT NOT NULL,
          proposed_facet TEXT NOT NULL,
          aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          podcast_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          occurrence_count INTEGER NOT NULL DEFAULT 0,
          average_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          review_status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_podcast_topics_podcast ON podcast_topics (podcast_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_podcast_topics_topic ON podcast_topics (topic_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_topic_definitions_facet_status ON topic_definitions (facet, status)`;
    })();
  }
  await schemaPromise;
}

export async function seedTopicDefinitions(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      await ensureTopicSchema();
      for (const definition of getTopicTaxonomy()) {
        await sql`
          INSERT INTO topic_definitions (
            id, canonical_name, facet, aliases_json, parent_id, keywords_json, status, occurrence_count, updated_at
          ) VALUES (
            ${definition.id}, ${definition.canonicalName}, ${definition.facet}, ${json(definition.aliases)}::jsonb,
            ${definition.parentId ?? null}, ${json(definition.keywords)}::jsonb, ${definition.status},
            ${definition.occurrenceCount || 0}, CURRENT_TIMESTAMP
          )
          ON CONFLICT (id) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            facet = EXCLUDED.facet,
            aliases_json = EXCLUDED.aliases_json,
            parent_id = EXCLUDED.parent_id,
            keywords_json = EXCLUDED.keywords_json,
            status = EXCLUDED.status,
            updated_at = CURRENT_TIMESTAMP
        `;
      }
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  await seedPromise;
}

async function saveCandidates(podcastId: string, proposals: TopicProposal[]): Promise<void> {
  for (const proposal of proposals) {
    const id = candidateId(proposal.facet, proposal.canonicalName);
    const current = await sql<{
      aliasesJson?: unknown;
      evidenceJson?: unknown;
      podcastIdsJson?: unknown;
      occurrenceCount?: number;
      averageConfidence?: number;
    }>`
      SELECT
        aliases_json as "aliasesJson",
        evidence_json as "evidenceJson",
        podcast_ids_json as "podcastIdsJson",
        occurrence_count as "occurrenceCount",
        average_confidence as "averageConfidence"
      FROM topic_candidates
      WHERE id = ${id}
      LIMIT 1
    `;
    const row = current.rows[0];
    const aliases = Array.from(new Set([...parseArray(row?.aliasesJson).map(String), ...proposal.aliases])).slice(0, 12);
    const evidence = [...parseArray(row?.evidenceJson), proposal.evidence].map(String).filter(Boolean).slice(-12);
    const podcastIds = Array.from(new Set([...parseArray(row?.podcastIdsJson).map(String), podcastId])).slice(-50);
    const previousCount = Number(row?.occurrenceCount || 0);
    const occurrenceCount = podcastIds.length;
    const averageConfidence = previousCount > 0
      ? ((Number(row?.averageConfidence || 0) * previousCount) + proposal.confidence) / (previousCount + 1)
      : proposal.confidence;
    await sql`
      INSERT INTO topic_candidates (
        id, proposed_name, proposed_facet, aliases_json, evidence_json, podcast_ids_json,
        occurrence_count, average_confidence, review_status, updated_at
      ) VALUES (
        ${id}, ${proposal.canonicalName}, ${proposal.facet}, ${json(aliases)}::jsonb,
        ${json(evidence)}::jsonb, ${json(podcastIds)}::jsonb, ${occurrenceCount},
        ${averageConfidence}, 'pending', CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        proposed_name = EXCLUDED.proposed_name,
        proposed_facet = EXCLUDED.proposed_facet,
        aliases_json = EXCLUDED.aliases_json,
        evidence_json = EXCLUDED.evidence_json,
        podcast_ids_json = EXCLUDED.podcast_ids_json,
        occurrence_count = EXCLUDED.occurrence_count,
        average_confidence = EXCLUDED.average_confidence,
        updated_at = CURRENT_TIMESTAMP
    `;
  }
}

export async function replacePodcastTopics(input: {
  podcastId: string;
  assignments: TopicAssignment[];
  proposals?: TopicProposal[];
}): Promise<string[]> {
  await seedTopicDefinitions();
  const definitions = getTopicTaxonomy();
  const activeIds = new Set(definitions.filter((definition) => definition.status === 'active').map((definition) => definition.id));
  const assignments = input.assignments.filter((assignment) => activeIds.has(assignment.topicId));
  await sql`DELETE FROM podcast_topics WHERE podcast_id = ${input.podcastId}`;
  for (const assignment of assignments) {
    await sql`
      INSERT INTO podcast_topics (
        podcast_id, topic_id, relevance_score, evidence, extraction_source, extractor_version
      ) VALUES (
        ${input.podcastId}, ${assignment.topicId}, ${assignment.relevanceScore}, ${assignment.evidence},
        ${assignment.extractionSource}, ${assignment.extractorVersion || TOPIC_EXTRACTOR_VERSION}
      )
      ON CONFLICT (podcast_id, topic_id) DO UPDATE SET
        relevance_score = EXCLUDED.relevance_score,
        evidence = EXCLUDED.evidence,
        extraction_source = EXCLUDED.extraction_source,
        extractor_version = EXCLUDED.extractor_version,
        created_at = CURRENT_TIMESTAMP
    `;
  }
  const labels = projectCompatibilityTags(assignments, definitions);
  await sql`
    UPDATE podcasts
    SET tags_json = ${json(labels)}::jsonb
    WHERE id = ${input.podcastId}
  `;
  await saveCandidates(input.podcastId, input.proposals || []);
  return labels;
}

export async function deletePodcastTopics(podcastId: string): Promise<void> {
  await sql`DELETE FROM podcast_topics WHERE podcast_id = ${podcastId}`;
}
