import { extractLocalTopics } from '../../lib/topicExtractor';
import { buildTopicStatements } from '../../lib/topicPersistence';
import { projectCompatibilityTags } from '../../lib/topicTaxonomy';
import { getTopicTaxonomy } from '../../lib/topicTaxonomyData';
import { topicRepairPreview } from '../../lib/topicRepair';

const labels = (title: string, summaryZh = '', summaryEn = '') => projectCompatibilityTags(
  extractLocalTopics({ title, summaryZh, summaryEn }).assignments, getTopicTaxonomy());

describe('specific evidence-backed topics', () => {
  it.each(['Forward Deployed Engineering', 'Forward Deployed Engineer', 'Forward Deployment Engineer', 'FDE工程师'])('normalizes %s', term => {
    expect(labels(`What is ${term}?`)[0]).toBe('Forward Deployed Engineering');
  });
  it('distinguishes FDE hiring from an ordinary podcast interview', () => {
    expect(labels('What an FDE (Forward Deployment Engineer) Interview Actually Tests').slice(0, 2))
      .toEqual(expect.arrayContaining(['Forward Deployed Engineering','Technical Hiring']));
    expect(labels('An interview with Sam Altman', 'This interview is a conversation.')).not.toContain('Technical Hiring');
  });
  it('reads scene summaries without requiring a Key Takeaways heading', () => {
    expect(labels('FDE with Sierra', '## 客户交付\n客户交付讨论。', '## Technical Hiring\nTechnical hiring and coding interviews.'))
      .toEqual(expect.arrayContaining(['Forward Deployed Engineering','Enterprise Delivery','Technical Hiring','Sierra']));
  });
  it('does not match acronyms inside unrelated Latin words', () => {
    const tags = labels('Details of HTML and email in retail.');
    expect(tags).not.toEqual(expect.arrayContaining(['Artificial Intelligence']));
    expect(tags).not.toContain('Machine Learning');
  });
  it('keeps specific AI safety above umbrella AI and caps facets without padding', () => {
    expect(labels('AI safety and AI', '## Reinforcement Learning\n强化学习')).toEqual([
      'AI Safety','Reinforcement Learning','Artificial Intelligence',
    ]);
    expect(labels('A quiet walk')).toEqual([]);
  });
  it('is deterministic and preserves actual source evidence', () => {
    const input = { title: 'FDE with Sierra', summaryZh: '## 客户交付\n客户交付的方法。' };
    const first = extractLocalTopics(input);
    expect(extractLocalTopics(input)).toEqual(first);
    for (const a of first.assignments) expect(`${input.title}\n${input.summaryZh}`).toContain(a.evidence);
  });
  it('detects changed content and old tags in repair fingerprints', () => {
    const source=JSON.stringify({title:'FDE'});
    expect(topicRepairPreview(source,'[]').fingerprint).not.toBe(topicRepairPreview(source,'["AI"]').fingerprint);
    expect(topicRepairPreview(source,'[]').fingerprint).not.toBe(topicRepairPreview(JSON.stringify({title:'AI'}),'[]').fingerprint);
  });
  it('guards every article mutation, seeds before relations, and binds data separately', () => {
    const a=extractLocalTopics({title:'FDE with Sierra'}).assignments;
    const statements=buildTopicStatements("id'",a,{sql:'EXISTS (SELECT 1 WHERE ? = ?)',params:['v1','v1']});
    expect(statements[0].sql).toContain('INSERT INTO topic_definitions');
    expect(statements.at(-1)?.sql).toContain('UPDATE podcasts SET tags_json');
    for (const s of statements.filter(s=>!s.sql.includes('INTO topic_definitions'))) {
      expect(s.sql).toContain('EXISTS (SELECT 1 WHERE ? = ?)');
      expect(s.sql).not.toContain("id'");
      expect(s.params.slice(-2)).toEqual(['v1','v1']);
    }
  });
});
