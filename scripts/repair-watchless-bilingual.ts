import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensureBilingualArticle, translateWatchlessBlocks } from '../lib/watchless/bilingual';
import { normalizeWatchlessArticle, type WatchlessArticle } from '../lib/watchless/article';

const directory = path.resolve('outputs/watchless-bilingual-repair');
const rows = JSON.parse(fs.readFileSync(path.join(directory, 'inventory.json'), 'utf8')) as Array<{podcast_id:string;video_id:string;article_key:string}>;
const apply = process.argv.includes('--apply');
const selected = process.argv.find(a => a.startsWith('--id='))?.slice(5);
const exclude = process.argv.find(a => a.startsWith('--exclude='))?.slice(10);
const queue = rows.filter(r => (!selected || r.podcast_id === selected) && r.podcast_id !== exclude);
const quote = (s:string) => `'${s.replace(/'/g, "''")}'`;
const wrangler = (...args:string[]) => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding:'utf8', timeout:120000 });
const failures: string[] = [];

async function repair(row: typeof rows[number]) {
  const original = JSON.parse(fs.readFileSync(path.join(directory, `${row.podcast_id}.original.json`), 'utf8')) as WatchlessArticle;
  const cache = path.join(directory, row.podcast_id);
  fs.mkdirSync(cache, { recursive:true });
  const fixed = await ensureBilingualArticle({ ...original, id:row.podcast_id }, async (blocks, target, scene) => {
    const hash = createHash('sha256').update(JSON.stringify({blocks,target,version:1})).digest('hex').slice(0,16);
    const file = path.join(cache, `${scene}-${hash}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8'));
    const translation = await translateWatchlessBlocks(blocks, target);
    fs.writeFileSync(file, JSON.stringify(translation));
    console.log(`${row.podcast_id} ${scene} translated`);
    return translation;
  });
  const normalized = normalizeWatchlessArticle(fixed);
  if (!normalized) throw new Error('Final schema validation failed');
  for (let i=0;i<fixed.scenes.length;i++) {
    if (fixed.scenes[i].sourceTranscript !== original.scenes[i].transcriptEn && !original.scenes[i].sourceTranscript && original.transcriptEnKind !== 'translation') throw new Error('Source transcript changed');
  }
  const file = path.join(directory, `${row.podcast_id}.bilingual.json`);
  fs.writeFileSync(file, JSON.stringify(normalized,null,2)+'\n');
  const key = `watchless/${row.video_id}/article.bilingual-v1-20260905.json`;
  if (apply) {
    wrangler('r2','object','put',`podsum-uploads/${key}`,'--remote','--file',file,'--content-type','application/json');
    const sql = `UPDATE watchless_publications SET article_key=${quote(key)},has_english_transcript=1,updated_at=CURRENT_TIMESTAMP WHERE podcast_id=${quote(row.podcast_id)} AND article_key IN (${quote(row.article_key)},${quote(key)});`;
    const updated = JSON.parse(wrangler('d1','execute','podsum-d1-production','--remote','--command',sql,'--json'));
    if (updated[0]?.meta?.changes !== 1) throw new Error('Publication changed concurrently; pointer was not updated');
    const live = await (await fetch(`https://podsum.cc/api/watchless/${row.podcast_id}?bilingual=${Date.now()}`)).json() as {data?:{article?:WatchlessArticle}};
    if (!live.data?.article || JSON.stringify(live.data.article.scenes) !== JSON.stringify(normalized.scenes)) throw new Error('Live publication verification failed');
    console.log(`${row.podcast_id} PUBLISHED`);
  } else console.log(`${row.podcast_id} READY`);
}

async function worker() {
  for (;;) {
    const row = queue.shift(); if (!row) return;
    try { await repair(row); } catch(error) { failures.push(row.podcast_id); console.error(row.podcast_id, error instanceof Error ? error.message : 'Failed'); }
  }
}
Promise.all(Array.from({length:4},worker)).then(() => {
  console.log(JSON.stringify({finished:true,failures}));
  if(failures.length) process.exitCode=1;
});
