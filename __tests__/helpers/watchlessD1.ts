import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { DatabaseSync } = jest.requireActual('node:sqlite');

/** Real SQLite transactions model D1 batch atomicity, including changes(). */
export function createWatchlessD1(id: string, videoId: string) {
  const database = new DatabaseSync(':memory:');
  for (const file of ['0001_initial_schema.sql', '0005_add_watchless_publications.sql', '0008_watchless_analysis_origin.sql']) {
    database.exec(readFileSync(join(process.cwd(), 'migrations/d1', file), 'utf8'));
  }
  const run = (query: string, values: unknown[] = []) => database.prepare(query).all(...values) as Record<string, unknown>[];
  run("INSERT INTO podcasts(id,title,original_filename,file_size,blob_url) VALUES(?, 'Title','old.txt','1','old-source')", [id]);
  run("INSERT INTO analysis_results(podcast_id,summary,translation,highlights,analysis_kind) VALUES(?,'old-summary','old-en','旧中文','overview')", [id]);
  run("INSERT INTO watchless_publications(podcast_id,video_id,article_key,scene_count,duration_label,status) VALUES(?,?,'old/article.json',1,'1 min','published')", [id, videoId]);
  run("INSERT INTO processing_jobs(podcast_id,status,worker_id) VALUES(?,'processing','worker-1')", [id]);
  run("INSERT INTO qa_context_chunks(podcast_id,chunk_index,source,content) VALUES(?,0,'transcript','stale-text')", [id]);
  const hooks: { beforeBatch?: () => void; failStatementIndex?: number } = {};
  const binding = {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) { values = args; return this; },
        async all() { return { results: run(query, values) }; },
      };
    },
    async batch(statements: Array<{ all(): Promise<{ results: Record<string, unknown>[] }> }>) {
      hooks.beforeBatch?.();
      database.exec('BEGIN');
      try {
        const results = [];
        for (let i = 0; i < statements.length; i++) {
          if (hooks.failStatementIndex === i) throw new Error('simulated D1 write failure');
          results.push(await statements[i].all());
        }
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  return { binding, run, hooks, exec: (text:string) => database.exec(text), close: () => database.close() };
}
