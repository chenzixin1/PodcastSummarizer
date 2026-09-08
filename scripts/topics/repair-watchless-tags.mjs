import fs from 'node:fs';
import path from 'node:path';

/** Explicit IDs only. Preview -> inspect JSON report -> apply with matching fingerprints.
 * PROCESS_WORKER_SECRET must be supplied in the environment; never print it.
 * node scripts/topics/repair-watchless-tags.mjs --ids=id1,id2 [--apply=preview.json]
 */
const idsArg=process.argv.find(a=>a.startsWith('--ids='));
const ids=idsArg?.slice(6).split(',').filter(Boolean) || [];
const applyArg=process.argv.find(a=>a.startsWith('--apply='));
if(!ids.length || ids.length>100) throw new Error('Provide 1–100 explicit --ids');
const secret=process.env.PROCESS_WORKER_SECRET;
if(!secret) throw new Error('PROCESS_WORKER_SECRET is required');
const manifest=applyArg ? JSON.parse(fs.readFileSync(applyArg.slice(8),'utf8')) : [];
const out=path.resolve('output',`topic-repair-${applyArg?'apply':'preview'}-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out),{recursive:true});
const report=[];
for(const id of ids) {
  const previous=manifest.find(row=>row.id===id);
  if(applyArg && !previous?.data?.fingerprint) throw new Error(`No reviewed fingerprint for ${id}`);
  const response=await fetch('https://podsum.cc/api/worker/topics-repair',{
    method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':secret},
    body:JSON.stringify({id,action:applyArg?'apply':'preview',fingerprint:previous?.data?.fingerprint}),
    signal:AbortSignal.timeout(60000),
  });
  const result=await response.json();
  report.push({id,...result});
  fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
  if(!response.ok || !result.success) throw new Error(`${id}: ${response.status}; stopped, inspect ${out}`);
  console.log(JSON.stringify({id,tags:result.data.tags,snapshotRefreshed:result.data.snapshotRefreshed}));
}
console.log(`Report: ${out}`);
