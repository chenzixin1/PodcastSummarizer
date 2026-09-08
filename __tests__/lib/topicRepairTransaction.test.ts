/** @jest-environment node */
import { buildTopicStatements } from '../../lib/topicPersistence';
import { extractLocalTopics } from '../../lib/topicExtractor';
import { topicRepairPreview, TOPIC_SOURCE_SQL, TOPIC_SOURCE_FROM } from '../../lib/topicRepair';
const { DatabaseSync } = jest.requireActual('node:sqlite');

describe('tag-only repair transactions', () => {
  let db: InstanceType<typeof DatabaseSync>;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE podcasts(id TEXT PRIMARY KEY,title TEXT,tags_json TEXT);
      CREATE TABLE analysis_results(podcast_id TEXT,brief_summary TEXT,summary_zh TEXT,summary_en TEXT,highlights TEXT,translation TEXT,analysis_kind TEXT);
      CREATE TABLE topic_definitions(id TEXT PRIMARY KEY,canonical_name TEXT,facet TEXT,aliases_json TEXT,parent_id TEXT,keywords_json TEXT,status TEXT,updated_at TEXT);
      CREATE TABLE podcast_topics(podcast_id TEXT,topic_id TEXT,relevance_score REAL,evidence TEXT,extraction_source TEXT,extractor_version TEXT,PRIMARY KEY(podcast_id,topic_id));
      INSERT INTO podcasts VALUES ('p','FDE Interview','["old"]');
      INSERT INTO analysis_results VALUES ('p','','客户交付','FDE interview','','','full');
      INSERT INTO podcast_topics VALUES ('p','old',1,'old','test','old');`);
  });
  afterEach(() => db.close());
  const sourceQuery = `SELECT ${TOPIC_SOURCE_SQL} AS source ${TOPIC_SOURCE_FROM} WHERE p.id='p'`;
  function run(stale = false, failure = false) {
    const source=db.prepare(sourceQuery).get().source;
    const preview=topicRepairPreview(source,'["old"]');
    const statements=buildTopicStatements('p',preview.assignments,{sql:`EXISTS (SELECT 1 ${TOPIC_SOURCE_FROM} WHERE p.id=? AND ${TOPIC_SOURCE_SQL}=? AND p.tags_json IS ?)`,params:['p',source,'["old"]']});
    if(stale) db.exec("UPDATE analysis_results SET summary_zh='changed'");
    db.exec('BEGIN');
    try {
      for(const [i,s] of statements.entries()) {
        db.prepare(s.sql).run(...s.params);
        if(failure && i===statements.length-2) throw new Error('storage fault');
      }
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    return preview.tags;
  }
  it('replaces labels and relations together without changing content', () => {
    const original=db.prepare(sourceQuery).get().source;
    const tags=run();
    expect(JSON.parse(db.prepare('SELECT tags_json FROM podcasts').get().tags_json)).toEqual(tags);
    expect(db.prepare('SELECT topic_id FROM podcast_topics').all().map((r: {topic_id:string})=>r.topic_id)).not.toContain('old');
    expect(db.prepare(sourceQuery).get().source).toBe(original);
  });
  it('does not mutate stale content', () => { run(true); expect(db.prepare('SELECT tags_json FROM podcasts').get().tags_json).toBe('["old"]'); });
  it('rolls back both representations on failure', () => {
    expect(()=>run(false,true)).toThrow('storage fault');
    expect(db.prepare('SELECT tags_json FROM podcasts').get().tags_json).toBe('["old"]');
    expect(db.prepare('SELECT topic_id FROM podcast_topics').all()).toEqual([{topic_id:'old'}]);
  });
  it('leaves an already-tagged import intact', () => {
    const statements=buildTopicStatements('p',extractLocalTopics({title:'FDE'}).assignments,{
      sql:"EXISTS (SELECT 1 FROM podcasts WHERE id=? AND COALESCE(tags_json,'[]') IN ('[]',''))",params:['p'],
    });
    for(const s of statements) db.prepare(s.sql).run(...s.params);
    expect(db.prepare('SELECT tags_json FROM podcasts').get().tags_json).toBe('["old"]');
  });
});
