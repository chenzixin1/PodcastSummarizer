import taxonomySeed from '../data/topics/taxonomy.v1.json';
import type { TopicDefinition, TopicFacet, TopicDefinitionStatus } from './topicTaxonomy';

function isFacet(value: unknown): value is TopicFacet {
  return value === 'topic' || value === 'person' || value === 'organization_product';
}

function isStatus(value: unknown): value is TopicDefinitionStatus {
  return value === 'active' || value === 'candidate' || value === 'blocked';
}

function parseDefinition(value: unknown, index: number): TopicDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid topic definition at index ${index}`);
  }
  const row = value as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const canonicalName = String(row.canonicalName || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`Invalid topic id at index ${index}: ${id}`);
  }
  if (!canonicalName || !isFacet(row.facet) || !isStatus(row.status)) {
    throw new Error(`Incomplete topic definition: ${id}`);
  }
  return {
    id,
    canonicalName,
    facet: row.facet,
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String).map((item) => item.trim()).filter(Boolean) : [],
    keywords: Array.isArray(row.keywords) ? row.keywords.map(String).map((item) => item.trim()).filter(Boolean) : [],
    parentId: row.parentId ? String(row.parentId) : undefined,
    status: row.status,
    occurrenceCount: 0,
  };
}

const TAXONOMY = (taxonomySeed as unknown[]).map(parseDefinition);
const ids = new Set<string>();
for (const definition of TAXONOMY) {
  if (ids.has(definition.id)) {
    throw new Error(`Duplicate topic id: ${definition.id}`);
  }
  ids.add(definition.id);
}

export function getTopicTaxonomy(): TopicDefinition[] {
  return TAXONOMY.map((definition) => ({
    ...definition,
    aliases: [...definition.aliases],
    keywords: [...definition.keywords],
  }));
}
