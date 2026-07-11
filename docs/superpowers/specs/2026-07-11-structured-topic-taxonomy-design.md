# Structured Topic Taxonomy Design

## Goal

Replace PodSum's noisy token and n-gram tags with a stable, English-first taxonomy that separates topical concepts, people, and organizations/products. Rebuild every existing production podcast without using a model API for the historical pass, then classify future online podcasts through the existing model gateway with deterministic validation and fallback behavior.

## Confirmed product decisions

- Use three facets: `topic`, `person`, and `organization_product`.
- Prefer a rich result of 8-12 labels per episode, but never invent labels to meet a quota.
- Use an active controlled taxonomy plus a candidate pool for genuinely new concepts.
- Display canonical labels in English. Chinese terms and abbreviations are matching aliases only.
- Replace all historical tags, not only tags for future uploads.
- Codex curates the initial taxonomy and historical assignments from production data without calling a model API.
- Future online processing may call the existing model API.

## Existing failure mode

`lib/podcastTags.ts` extracts individual English tokens, adjacent n-grams, and long Chinese character runs, then ranks them mostly by frequency. It does not understand entity boundaries, semantic type, aliases, taxonomy granularity, or summary-template text. Current production examples therefore include `AI AI`, `AI AI AI`, `is`, `of`, `to`, `未明确提及`, split names such as `Jensen` and `Huang`, and mixtures of topics, people, products, and generic words in one flat list.

## Architecture

### Canonical taxonomy

Create a versioned repository seed file at `data/topics/taxonomy.v1.json`. Every definition contains:

```ts
type TopicFacet = 'topic' | 'person' | 'organization_product';

interface TopicDefinitionSeed {
  id: string;                    // stable kebab-case identifier
  canonicalName: string;         // English display label
  facet: TopicFacet;
  aliases: string[];             // Chinese names, abbreviations, former names
  parentId?: string;             // optional broader active topic
  keywords?: string[];           // deterministic retrieval hints
  status: 'active' | 'blocked';
}
```

IDs are stable and are never derived again after creation. Canonical names may be corrected without changing IDs. Blocked entries capture known pollution such as `not-explicitly-mentioned`, `time-point`, `owner`, `youtube`, generic interview vocabulary, and summary-section labels.

The initial seed is curated from all existing production titles and brief/core summaries. It must include aliases needed by the current corpus, for example `强化学习 -> Reinforcement Learning`, `黄仁勋 -> Jensen Huang`, `英伟达 -> NVIDIA`, and `大语言模型/LLM -> Large Language Models`.

### Database model

Add three normalized tables while retaining `podcasts.tags_json` as a temporary compatibility projection:

```sql
CREATE TABLE topic_definitions (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  facet TEXT NOT NULL CHECK (facet IN ('topic', 'person', 'organization_product')),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'candidate', 'blocked')),
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE podcast_topics (
  podcast_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  relevance_score REAL NOT NULL,
  evidence TEXT NOT NULL,
  extraction_source TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (podcast_id, topic_id)
);

CREATE TABLE topic_candidates (
  id TEXT PRIMARY KEY,
  proposed_name TEXT NOT NULL,
  proposed_facet TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  podcast_ids_json TEXT NOT NULL DEFAULT '[]',
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  average_confidence REAL NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Create indexes on `podcast_topics.podcast_id`, `podcast_topics.topic_id`, `topic_definitions.facet`, and `topic_definitions.status`. Foreign keys are deliberately not required because the current production D1 schema and migration workflow already tolerate staged data repair; application validation enforces referential integrity before writes.

`tags_json` remains populated with canonical active labels in display order so existing API/MCP consumers remain compatible during rollout. New list and analysis queries also expose structured `topicFacets`.

## Extraction inputs

Use only high-signal fields:

1. Podcast title.
2. `brief_summary`.
3. Bullets from `summary_zh` or `summary_en` under the core-takeaway section.

Do not feed the entire generated summary to extraction. Exclude Data & Numbers and Decisions & Action Items because their mandatory placeholder language is the source of `未明确提及`, `owner`, `time point`, and `execution conditions` pollution.

Before retrieval, normalize Unicode, whitespace, punctuation, and common aliases. Remove markdown structure and exact blocked phrases in both languages.

## Candidate retrieval

The online extractor loads active taxonomy definitions and assigns a deterministic retrieval score:

```text
exact canonical or alias match       +100
title keyword match                   +40
brief-summary keyword match           +20
core-takeaway keyword match           +10
parent/child of an exact match          +5
blocked definition                 rejected
```

Keep the best 50 candidates, balanced so a single facet cannot occupy more than 60% of the shortlist. If the active taxonomy remains below 150 definitions, sending the entire active taxonomy is allowed and preferred over prematurely adding an embedding service. No embedding infrastructure is part of v1.

## Online model classification

After `brief_summary` exists, the processing pipeline makes one topic-classification call through the existing online model gateway. The model receives normalized source text, shortlisted definitions, facet rules, and the strict response contract:

```ts
interface TopicExtractionResponse {
  selected: Array<{
    topicId: string;
    facet: TopicFacet;
    confidence: number;
    evidence: string;
  }>;
  proposed: Array<{
    canonicalName: string;
    facet: TopicFacet;
    aliases: string[];
    confidence: number;
    evidence: string;
  }>;
}
```

The model may select only supplied IDs. It may propose at most two new labels. Evidence must be a verbatim substring of the normalized title, brief summary, or core-takeaway text. JSON outside this schema is rejected.

Topic extraction is non-fatal. A timeout, invalid JSON, or failed validation falls back to deterministic exact/alias/keyword matches and does not fail the podcast analysis job.

## Deterministic validation and ranking

Reject a selected label when any of the following is true:

- The topic ID is not active or was not supplied to the model.
- The returned facet differs from the stored facet.
- Evidence is empty or cannot be found in the normalized input.
- Confidence is below `0.62`.
- The label is a blocked phrase, URL/platform artifact, summary heading, standalone unit/currency, or generic conversational word.
- A person name is an unambiguous fragment of a selected full person name.
- The label repeats another selected canonical name or alias, case-insensitively.

Rank remaining labels with:

```text
finalScore =
  0.45 * modelConfidence +
  0.25 * evidenceSourceWeight +
  0.20 * deterministicRetrievalScore +
  0.10 * corpusDistinctiveness
```

Evidence source weights are title `1.0`, brief summary `0.8`, and core takeaway `0.6`. Retrieval scores are normalized to `0..1`. Corpus distinctiveness is `1 - min(occurrenceCount / totalPodcasts, 0.9)` so `AI` cannot crowd out more informative concepts.

Apply facet quotas after ranking:

- Topics: target 4-6, hard maximum 6.
- People: target 0-3, hard maximum 3.
- Organizations/products: target 2-4, hard maximum 4.
- Overall: target 8-12, hard maximum 12.

Never lower the confidence threshold or create proposed labels merely to reach eight. When a parent and child topic are both selected, retain both only if each has independent evidence; otherwise retain the more specific child. Preserve at least one broad topic when available so cross-library navigation remains useful.

## New-label candidate policy

New proposals never appear in homepage filters immediately.

- Topic proposals become eligible for automatic promotion after appearing in at least three distinct podcasts, average confidence `>= 0.82`, valid evidence for every occurrence, and no active definition with a matching alias or near-identical normalized name.
- Person and organization/product proposals may be promoted after two distinct podcasts when the canonical proper name appears verbatim in evidence. A one-off proposal stays attached only as candidate evidence and is not shown globally.
- Promotion runs through a deterministic maintenance command. It writes an audit report before changing definitions.
- No candidate-management UI is added in v1; the command and audit artifact are sufficient.

## Historical backfill without a model API

The historical pass is a curated, reproducible data operation:

1. Export every production podcast ID, title, source, brief summary, and core summary section to a local restricted artifact. Do not commit private text.
2. Codex builds `data/topics/taxonomy.v1.json` from the corpus.
3. Codex creates `data/topics/backfill.v1.json`, mapping every production podcast ID to canonical topic IDs with facet, score, and short evidence. The committed manifest contains IDs and evidence excerpts only; it must not contain transcripts or full private summaries.
4. A validator proves every referenced topic exists, every production podcast is present exactly once, no unknown production ID is present, evidence is non-empty, facet quotas are respected, and blocked labels cannot be written.
5. Before applying, export existing `tags_json` and topic rows to a timestamped local rollback artifact.
6. Apply taxonomy definitions and podcast assignments transactionally in bounded D1 batches, then refresh `tags_json` from canonical active labels.
7. Regenerate static snapshots only after database verification succeeds.

The apply command requires `--apply`, an explicit environment, and the expected production podcast count. Dry-run is the default. A mismatch aborts before mutation.

## Read paths and user interface

Homepage list data includes:

```ts
interface TopicFacets {
  topics: string[];
  people: string[];
  organizationsProducts: string[];
}
```

The Topics view presents three labeled groups: Topics, People, and Organizations & Products. Counts are computed by canonical ID, not display-string equality. Selecting any chip filters the same podcast collection. Cards retain a maximum of four chips, ordered by the highest-scoring topic, organization/product, person, then remaining score. Search matches canonical names and aliases.

Legacy rows without `podcast_topics` temporarily fall back to normalized `tags_json`; the old token/n-gram extractor is not used as a display fallback after the migration lands.

## Write paths

- Initial upload may store a trusted channel name only as source metadata, not directly as a topic.
- Final analysis processing runs online topic extraction after brief-summary generation and before the final analysis save completes.
- Saving analysis replaces that podcast's `podcast_topics` in one transaction and refreshes its compatibility `tags_json`.
- Partial saves do not erase existing topic assignments.
- Podcast deletion removes its assignments and candidate references through explicit cleanup code.

## Failure handling and observability

Record extractor version, source (`codex_backfill`, `model`, or `deterministic_fallback`), selected counts by facet, rejection reason counts, proposed-candidate count, latency, and whether fallback was used. Do not log source summaries, evidence bodies, API credentials, or private podcast titles.

An online extraction failure does not roll back a successful podcast analysis. Deterministic fallback assignments are stored with their own source and can be reprocessed later. Taxonomy or backfill validation failure is fatal before database mutation.

## Testing and acceptance criteria

### Unit tests

- Normalize English, Chinese, and abbreviated aliases to one canonical ID.
- Reject `AI AI`, `AI AI AI`, `is`, `of`, `to`, `YouTube`, `未明确提及`, `执行条件`, `时间点`, currency/unit fragments, and split person-name fragments.
- Validate exact evidence and reject invented evidence.
- Enforce facet and total quotas without padding.
- Resolve parent/child redundancy and duplicate aliases.
- Parse strict model JSON and trigger deterministic fallback on invalid output or timeout.
- Validate taxonomy and full backfill manifests.

### Integration tests

- Final analysis processing calls the extractor once, persists normalized assignments, and refreshes compatibility tags.
- Extraction failure still saves the analysis and uses deterministic fallback.
- List/snapshot APIs expose grouped facets and canonical counts.
- Deleting a podcast removes assignments without corrupting definitions.
- Preview and Production configurations cannot point at each other's databases.

### Historical acceptance

- Backfill validator reports 100% of current production podcast IDs covered exactly once.
- Zero stored active canonical names match the blocked-noise fixture list.
- Every stored relation references an active canonical definition.
- Every podcast has at least one evidence-backed label unless its source text is genuinely empty; empty cases are explicitly listed in the audit.
- A before/after audit reports unique label count, singleton rate, alias-collapse count, facet distribution, and the 30 most common labels.

### Live acceptance

- Deploy and migrate Preview first.
- Process a disposable Preview fixture through the real online model path and verify 8-12 evidence-backed labels across the expected facets, then delete the fixture.
- Verify existing Preview podcasts render grouped filters and no blocked labels.
- Merge only after unit, integration, type-check, lint, build, and bundle gates pass.
- Deploy the exact merged commit to Production.
- Apply the validated production backfill manifest and regenerate snapshots.
- Confirm the live build ID, structured list API, 100% production row coverage, zero blocked labels, canonical filter counts, and at least three representative live podcast assignments.
- Confirm a new online extraction can succeed after deployment without exposing secrets; use a controlled production-safe fixture only if an existing queued item cannot exercise the path, and remove it immediately afterward.

## Rollback

Code rollback restores the prior Worker version. Data rollback restores `tags_json` and topic assignments from the pre-apply artifact; taxonomy tables are additive and may remain unused. Static snapshots are regenerated after either forward apply or rollback. No old tag data is destroyed until the post-apply audit and live checks pass.

## Out of scope

- Embedding infrastructure or a vector database.
- A taxonomy administration UI.
- User-personalized topics.
- Automatic translation of canonical display labels.
- Changing the podcast summary or transcript-generation prompts beyond isolating high-signal extraction input.
