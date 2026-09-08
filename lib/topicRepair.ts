import { createHash } from 'node:crypto';
import { extractLocalTopics } from './topicExtractor';
import { projectCompatibilityTags } from './topicTaxonomy';
import { getTopicTaxonomy } from './topicTaxonomyData';

// Same exact expression is used for the read and transactional compare-and-set.
export const TOPIC_SOURCE_SQL = `json_object('title',p.title,'briefSummary',a.brief_summary,
  'summaryZh',a.summary_zh,'summaryEn',a.summary_en,
  'content',CASE WHEN a.analysis_kind='full' THEN '' ELSE COALESCE(a.highlights,'') || char(10) || COALESCE(a.translation,'') END)`;
export const TOPIC_SOURCE_FROM = 'FROM podcasts p LEFT JOIN analysis_results a ON a.podcast_id=p.id';

export function topicRepairPreview(source: string, oldTags: string | null) {
  const extraction = extractLocalTopics(JSON.parse(source));
  return { assignments: extraction.assignments,
    tags: projectCompatibilityTags(extraction.assignments, getTopicTaxonomy()),
    fingerprint: createHash('sha256').update(JSON.stringify([source, oldTags])).digest('hex') };
}
