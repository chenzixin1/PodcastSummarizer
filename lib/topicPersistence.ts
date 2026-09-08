import { projectCompatibilityTags, type TopicAssignment } from './topicTaxonomy';
import { getTopicTaxonomy } from './topicTaxonomyData';

export interface TopicStatement { sql: string; params: unknown[] }

/** Execute the entire list in one D1 batch. Guard SQL is internal, never user input. */
export function buildTopicStatements(podcastId: string, input: TopicAssignment[],
  guard: TopicStatement = { sql: 'EXISTS (SELECT 1 FROM podcasts WHERE id = ?)', params: [podcastId] },
): TopicStatement[] {
  const definitions = getTopicTaxonomy();
  const byId = new Map(definitions.filter(d => d.status === 'active').map(d => [d.id, d]));
  const assignments = [...new Map(input.filter(a => byId.has(a.topicId)).map(a => [a.topicId, a])).values()];
  const statements: TopicStatement[] = assignments.map(a => {
    const d = byId.get(a.topicId)!;
    return { sql: `INSERT INTO topic_definitions (id,canonical_name,facet,aliases_json,parent_id,keywords_json,status)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,
      facet=excluded.facet,aliases_json=excluded.aliases_json,parent_id=excluded.parent_id,
      keywords_json=excluded.keywords_json,status=excluded.status,updated_at=CURRENT_TIMESTAMP`,
    params: [d.id,d.canonicalName,d.facet,JSON.stringify(d.aliases),d.parentId || null,JSON.stringify(d.keywords),d.status] };
  });
  statements.push({ sql: `DELETE FROM podcast_topics WHERE podcast_id = ? AND (${guard.sql})`, params: [podcastId,...guard.params] });
  for (const a of assignments) statements.push({ sql: `INSERT INTO podcast_topics
    (podcast_id,topic_id,relevance_score,evidence,extraction_source,extractor_version)
    SELECT ?,?,?,?,?,? WHERE (${guard.sql})`, params: [podcastId,a.topicId,a.relevanceScore,a.evidence,a.extractionSource,a.extractorVersion,...guard.params] });
  statements.push({ sql: `UPDATE podcasts SET tags_json = ? WHERE id = ? AND (${guard.sql})`,
    params: [JSON.stringify(projectCompatibilityTags(assignments, definitions)),podcastId,...guard.params] });
  return statements;
}
