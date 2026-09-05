import { createHash } from 'node:crypto';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { readWatchlessCheckpoint, watchlessDatabase } from './analysisGuard';
import { getStoredWatchlessPublication, loadStoredWatchlessArticle } from './repository';
import { canonicalWatchlessSource } from './bundleIntegrity';
import { analysisPartRequest, buildAnalysisParts, saveWatchlessFullAnalysis, validateAnalysisBundle, validateGeneratedAnalysis, type WatchlessAnalysisBundle } from './fullAnalysis';
import { watchlessModelText } from './modelProvider';
import { uploadObject } from '../objectStorage';
import { ANALYSIS_LEASE_MS, ANALYSIS_REQUEST_MS, canSpendAttempt, retryAt, retryableHttp, recoveryEnabled } from './recoveryPolicy';
export { recoveryEnabled } from './recoveryPolicy';
import type { AnalysisRecoveryStatus } from './recoveryTypes';

type Run = { id: string; podcast_id: string; article_key: string; model: string; source_hash: string;
  status: AnalysisRecoveryStatus['status']; workflow_id: string | null; generation: number; total: number;
  current_part: string | null; pause_reason: string | null; next_retry_at: number | null; supplied_key: string | null };
type Part = { run_id: string; part_id: string; ordinal: number; cache_key: string; result_key: string | null; payload: string; imported: number; status: string };
type Attempt = { attempt: number; status: string; deadline: number; retry_at: number | null; error_kind: string | null; result_key: string | null };
export type PendingAnalysisResult = {partId:string;attempt:number;analysis:WatchlessAnalysisBundle};
export type RecoveryTick = { done: boolean; waitMs: number; status: string; pending?:PendingAnalysisResult };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await watchlessDatabase().prepare(sql).bind(...params).all<T>()).results || [];
}

async function currentRun(id: string) {
  return (await query<Run>(`SELECT r.* FROM watchless_analysis_runs r JOIN watchless_publications w
    ON w.podcast_id=r.podcast_id AND w.article_key=r.article_key WHERE r.podcast_id=? AND w.status='published'
    ORDER BY r.created_at DESC LIMIT 1`, id))[0] || null;
}

export async function analysisRecoveryStatus(id: string): Promise<AnalysisRecoveryStatus | null> {
  const run = await currentRun(id);
  if (!run) return null;
  const job=(await query<{status:string}>('SELECT status FROM processing_jobs WHERE podcast_id=?',id))[0];
  if(job?.status==='cancelled' && run.status!=='completed') {
    run.status='cancelled'; run.pause_reason='CANCELLED';
  }
  const counts = (await query<{ completed: number; extras: number; attempts: number }>(`SELECT
    (SELECT COUNT(*) FROM watchless_analysis_parts WHERE run_id=? AND status='completed') AS completed,
    (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=? AND attempt>1) AS extras,
    (SELECT COUNT(*) FROM watchless_analysis_attempts WHERE run_id=? AND part_id=?) AS attempts`,
  run.id, run.id, run.id, run.current_part))[0];
  return { status: run.status, completed: run.supplied_key ? run.total : counts.completed, total: run.total,
    currentPart: run.current_part, attempts: counts.attempts, extraAttempts: counts.extras,
    nextRetryAt: run.next_retry_at, pauseReason: run.pause_reason,
    canResume: run.status === 'paused' && !/BUDGET|PERMANENT|FORMAT_LIMIT|SUPERSEDED|RESULT_PENDING/.test(run.pause_reason || '') };
}

/** Read existing paid results before enabling any new model request. IDs/hash preserve the legacy contract. */
async function initializeRun(id: string): Promise<Run> {
  const publication = await getStoredWatchlessPublication(id);
  if (!publication) throw new Error('Watchless publication not found');
  const article = await loadStoredWatchlessArticle(publication);
  const model = process.env.WATCHLESS_MODEL || '@cf/zai-org/glm-5.3-flash';
  const sourceHash = createHash('sha256').update(canonicalWatchlessSource(article)).digest('hex');
  const runId = hash({ id, articleKey: publication.articleKey, sourceHash, model, promptVersion: 1 });
  await query(`UPDATE watchless_analysis_runs SET status='cancelled',pause_reason='SUPERSEDED',updated_at=?
    WHERE podcast_id=? AND status IN ('initializing','running','waiting') AND article_key!=?`,Date.now(),id,publication.articleKey);
  const existing = (await query<Run>('SELECT * FROM watchless_analysis_runs WHERE id=?', runId))[0];
  if (existing) return existing;
  const oldJob = (await query<{ status: string; recent: number; executor: string }>(`SELECT status,executor,
    updated_at>=datetime('now','-5 minutes') AS recent FROM processing_jobs WHERE podcast_id=?`, id))[0];
  if (oldJob?.status === 'processing' && oldJob.recent) throw new Error('Existing analysis is still running; wait for its lease');
  const suppliedKey = publication.articleKey.replace(/[^/]+$/, 'analysis.json');
  const supplied = await readWatchlessCheckpoint(suppliedKey);
  if (supplied !== undefined) validateAnalysisBundle(supplied, article.scenes.map(s => s.id));
  const parts = buildAnalysisParts(article);
  if (!parts.length || parts.length > 100) throw new Error('Analysis requires 1–100 sections');
  const db = watchlessDatabase();
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO watchless_analysis_runs(id,podcast_id,article_key,source_hash,model,total,supplied_key,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(runId,id,publication.articleKey,sourceHash,model,supplied !== undefined ? article.scenes.length : parts.length,supplied !== undefined ? suppliedKey : null,now,now),
    ...parts.map((part, ordinal) => db.prepare(`INSERT INTO watchless_analysis_parts(run_id,part_id,ordinal,cache_key,payload)
      VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(runId,part.id,ordinal,`watchless-runs/analysis/${id}/${hash({version:1,model,part})}.json`,JSON.stringify(part))),
    db.prepare(`INSERT INTO processing_jobs(podcast_id,status,executor) VALUES(?,'queued','watchless-workflow')
      ON CONFLICT(podcast_id) DO UPDATE SET executor='watchless-workflow',status='queued',worker_id=NULL,last_error=NULL,
      updated_at=CURRENT_TIMESTAMP WHERE processing_jobs.status!='processing' OR processing_jobs.updated_at<datetime('now','-5 minutes')`).bind(id),
  ]);
  return (await query<Run>('SELECT * FROM watchless_analysis_runs WHERE id=?',runId))[0];
}

type Binding = { create(options: { id: string; params: { runId: string } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }> }> };

export async function startAnalysisRecovery(id: string) {
  if (!recoveryEnabled(id)) return null;
  const env = (await getCloudflareContext({ async:true })).env as unknown as { WATCHLESS_ANALYSIS_WORKFLOW?: Binding };
  const binding = env.WATCHLESS_ANALYSIS_WORKFLOW;
  if (!binding) throw new Error('Analysis Workflow is not configured');
  let run = await initializeRun(id);
  if (run.status === 'completed' || run.status === 'cancelled') return analysisRecoveryStatus(id);
  const status = await analysisRecoveryStatus(id);
  if(status?.status==='cancelled') return status;
  if (run.status === 'paused' && !status?.canResume) return status;
  if (run.workflow_id) {
    try {
      const instance = await binding.get(run.workflow_id);
      const live = await instance.status();
      if (!['errored','terminated','complete'].includes(live.status)) return status;
    } catch {
      // A create that failed before reaching Cloudflare can be safely retried with the SAME id.
      await binding.create({ id:run.workflow_id, params:{runId:run.id} });
      return analysisRecoveryStatus(id);
    }
  }
  const workflowId = `analysis-${run.id.slice(0,32)}-${run.generation + 1}`;
  const changed = await query<Run>(`UPDATE watchless_analysis_runs SET workflow_id=?, generation=generation+1,
    status=CASE WHEN status='initializing' THEN status ELSE 'running' END,pause_reason=NULL,updated_at=?
    WHERE id=? AND generation=? AND status IN ('initializing','running','waiting','paused')
    AND NOT EXISTS(SELECT 1 FROM processing_jobs WHERE podcast_id=watchless_analysis_runs.podcast_id AND status='cancelled')
    RETURNING *`,workflowId,Date.now(),run.id,run.generation);
  if (!changed.length) return analysisRecoveryStatus(id);
  run = changed[0];
  await query(`UPDATE processing_jobs SET status='processing',worker_id=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
    current_task='summary',status_message='Watchless analysis recovery',progress_total=?
    WHERE podcast_id=? AND executor='watchless-workflow' AND status!='cancelled'`,workflowId,run.total,id);
  await binding.create({id:workflowId,params:{runId:run.id}});
  return analysisRecoveryStatus(id);
}

async function assertOwner(run: Run, owner: string) {
  const rows = await query(`SELECT r.id FROM watchless_analysis_runs r JOIN watchless_publications w ON w.podcast_id=r.podcast_id
    JOIN processing_jobs j ON j.podcast_id=r.podcast_id WHERE r.id=? AND r.workflow_id=?
    AND r.status IN ('initializing','running','waiting') AND w.article_key=r.article_key AND w.status='published'
    AND j.worker_id=? AND j.executor='watchless-workflow' AND j.status='processing'`,run.id,owner,owner);
  if (!rows.length) throw new Error('ANALYSIS_SUPERSEDED');
  await query(`UPDATE processing_jobs SET updated_at=CURRENT_TIMESTAMP WHERE podcast_id=? AND worker_id=? AND status='processing'`,run.podcast_id,owner);
}

/** Only retry dispatches that never started; paused/failed work requires explicit resume. */
export async function reconcileAnalysisDispatches() {
  const rows=await query<{podcast_id:string}>(`SELECT j.podcast_id FROM processing_jobs j
    LEFT JOIN watchless_analysis_runs r ON r.podcast_id=j.podcast_id
    WHERE j.executor='watchless-workflow' AND (j.status='queued' OR
      (j.status='processing' AND r.status='initializing')) ORDER BY j.updated_at LIMIT 10`);
  for(const row of rows) if(recoveryEnabled(row.podcast_id)) {
    await startAnalysisRecovery(row.podcast_id).catch(()=>console.error('Analysis dispatch pending',row.podcast_id));
  }
}

async function pause(run: Run, owner: string, reason: string): Promise<RecoveryTick> {
  await query(`UPDATE watchless_analysis_runs SET status='paused',pause_reason=?,next_retry_at=NULL,updated_at=?
    WHERE id=? AND workflow_id=? AND status NOT IN ('completed','cancelled')`,reason.slice(0,1000),Date.now(),run.id,owner);
  await query(`UPDATE processing_jobs SET status='failed',last_error=?,status_message='完整分析已暂停',updated_at=CURRENT_TIMESTAMP,
    finished_at=CURRENT_TIMESTAMP WHERE podcast_id=? AND worker_id=? AND status IN ('queued','processing')
    AND EXISTS(SELECT 1 FROM watchless_analysis_runs WHERE id=? AND status='paused' AND workflow_id=?)`,reason.slice(0,1000),run.podcast_id,owner,run.id,owner);
  return {done:true,waitMs:0,status:'paused'};
}

async function wait(run: Run, owner: string, until: number): Promise<RecoveryTick> {
  await query(`UPDATE watchless_analysis_runs SET status='waiting',next_retry_at=?,updated_at=? WHERE id=? AND workflow_id=?`,until,Date.now(),run.id,owner);
  return {done:false,waitMs:Math.max(1000,until-Date.now()),status:'waiting'};
}

async function importPart(run: Run, part: Part, owner: string) {
  let cached = await readWatchlessCheckpoint(part.cache_key);
  let resultKey=part.cache_key;
  if (cached !== undefined) validateAnalysisBundle(cached,[part.part_id]);
  const records = [];
  for (let i=0;i<2;i++) {
    const started = await readWatchlessCheckpoint(part.cache_key.replace(/\.json$/,`.attempt-${i}.json`)) as {startedAt?:string} | undefined;
    const rejected = await readWatchlessCheckpoint(part.cache_key.replace(/\.json$/,`.rejected-${i}.json`)) as {raw?:string;reason?:string} | undefined;
    if (!started && !rejected) continue;
    if(cached===undefined && typeof rejected?.raw==='string') {
      try { cached=validateGeneratedAnalysis(JSON.parse(rejected.raw),part.part_id); }
      catch { /* Invalid paid output still consumes the recorded attempt. */ }
      if(cached!==undefined) {
        resultKey=`watchless-runs/recovery/${run.id}/imported-${part.ordinal}.json`;
        await assertOwner(run,owner);
        await uploadObject(resultKey,JSON.stringify(cached),{contentType:'application/json'});
      }
    }
    const at = Date.parse(started?.startedAt || '') || Date.now()-ANALYSIS_LEASE_MS;
    records.push({attempt:i+1,status:rejected ? 'failed' : cached !== undefined ? 'succeeded' : 'unknown',at,kind:rejected ? 'format' : cached === undefined ? 'timeout' : null});
  }
  // A completed checkpoint without a started marker still represents one paid request.
  if (!records.length && cached !== undefined) records.push({attempt:1,status:'succeeded',at:Date.now()-ANALYSIS_LEASE_MS,kind:null});
  await assertOwner(run,owner);
  const db=watchlessDatabase();
  await db.batch([
    ...records.map(r=>db.prepare(`INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline,error_kind,imported)
      VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING`).bind(run.id,part.part_id,r.attempt,'legacy',r.status,r.at,r.at+ANALYSIS_LEASE_MS,r.kind)),
    db.prepare(`UPDATE watchless_analysis_parts SET imported=1,status=?,result_key=? WHERE run_id=? AND part_id=?`).bind(cached === undefined ? 'pending':'completed',cached === undefined?null:resultKey,run.id,part.part_id),
  ]);
}

/** One bounded step: import a checkpoint, execute one request, or commit. No implicit paid retries. */
export async function tickAnalysisRecovery(runId: string, owner: string): Promise<RecoveryTick> {
  const run=(await query<Run>('SELECT * FROM watchless_analysis_runs WHERE id=?',runId))[0];
  if (!run || ['completed','cancelled','paused'].includes(run.status)) return {done:true,waitMs:0,status:run?.status || 'missing'};
  try {
    await assertOwner(run,owner);
    if(!recoveryEnabled(run.podcast_id)) return pause(run,owner,'DISABLED: 分析续跑已暂停发布');
    if (!run.supplied_key) {
      const unimported=(await query<Part>('SELECT * FROM watchless_analysis_parts WHERE run_id=? AND imported=0 ORDER BY ordinal LIMIT 1',runId))[0];
      if(unimported) { await importPart(run,unimported,owner); return {done:false,waitMs:0,status:'initializing'}; }
    }
    await query(`UPDATE watchless_analysis_runs SET status='running',next_retry_at=NULL WHERE id=? AND workflow_id=?`,runId,owner);
    const parts=await query<Part>('SELECT * FROM watchless_analysis_parts WHERE run_id=? ORDER BY ordinal',runId);
    const part=run.supplied_key ? undefined : parts.find(p=>p.status!=='completed');
    if (!part) {
      const publication=await getStoredWatchlessPublication(run.podcast_id);
      if(!publication || publication.articleKey!==run.article_key) throw new Error('ANALYSIS_SUPERSEDED');
      const article=await loadStoredWatchlessArticle(publication);
      if(createHash('sha256').update(canonicalWatchlessSource(article)).digest('hex')!==run.source_hash) throw new Error('ANALYSIS_SUPERSEDED');
      let analysis: WatchlessAnalysisBundle;
      if(run.supplied_key) analysis=validateAnalysisBundle(await readWatchlessCheckpoint(run.supplied_key),article.scenes.map(s=>s.id));
      else { analysis={version:1,scenes:[]}; for(const p of parts) analysis.scenes.push(...validateAnalysisBundle(await readWatchlessCheckpoint(p.result_key || p.cache_key),[p.part_id]).scenes); }
      await assertOwner(run,owner);
      await saveWatchlessFullAnalysis(article,analysis,run.supplied_key ? 'mcp-supplied':run.model,{articleKey:run.article_key,workerId:owner,leaseSeconds:300});
      await assertOwner(run,owner);
      await watchlessDatabase().batch([
        watchlessDatabase().prepare(`UPDATE watchless_analysis_runs SET status='completed',pause_reason=NULL,current_part=NULL,updated_at=? WHERE id=? AND workflow_id=?`).bind(Date.now(),runId,owner),
        watchlessDatabase().prepare(`UPDATE processing_jobs SET status='completed',progress_current=progress_total,last_error=NULL,
          status_message='完整分析已完成',finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE podcast_id=? AND worker_id=? AND status='processing'`).bind(run.podcast_id,owner),
      ]);
      return {done:true,waitMs:0,status:'completed'};
    }
    await query(`UPDATE watchless_analysis_runs SET current_part=? WHERE id=? AND workflow_id=?`,part.part_id,runId,owner);
    const attempts=await query<Attempt>('SELECT * FROM watchless_analysis_attempts WHERE run_id=? AND part_id=? ORDER BY attempt',runId,part.part_id);
    // Recover durable result BEFORE considering another request (including a failed D1 update).
    const resultKey=attempts.at(-1)?.result_key || part.result_key || part.cache_key;
    const cached=await readWatchlessCheckpoint(resultKey);
    if(cached!==undefined) {
      validateAnalysisBundle(cached,[part.part_id]);
      await assertOwner(run,owner);
      await query(`UPDATE watchless_analysis_parts SET status='completed',result_key=? WHERE run_id=? AND part_id=?`,resultKey,runId,part.part_id);
      await query(`UPDATE watchless_analysis_attempts SET status='succeeded' WHERE run_id=? AND part_id=? AND status='started'
        AND EXISTS(SELECT 1 FROM watchless_analysis_runs WHERE id=? AND workflow_id=?)`,runId,part.part_id,runId,owner);
      await query(`UPDATE processing_jobs SET progress_current=(SELECT COUNT(*) FROM watchless_analysis_parts WHERE run_id=? AND status='completed'),
        updated_at=CURRENT_TIMESTAMP WHERE podcast_id=? AND worker_id=?`,runId,run.podcast_id,owner);
      return {done:false,waitMs:0,status:'running'};
    }
    const last=attempts.at(-1);
    if(last && ['started','unknown'].includes(last.status) && last.deadline>Date.now()) return wait(run,owner,last.deadline);
    if(last?.status==='started') await query(`UPDATE watchless_analysis_attempts SET status='unknown',error_kind='timeout' WHERE run_id=? AND part_id=? AND attempt=?
      AND EXISTS(SELECT 1 FROM watchless_analysis_runs WHERE id=? AND workflow_id=?)`,runId,part.part_id,last.attempt,runId,owner);
    if(last?.error_kind==='permanent') return pause(run,owner,'PERMANENT: 模型权限、余额或参数错误，请先处理配置');
    if(last?.retry_at && last.retry_at>Date.now()) return wait(run,owner,last.retry_at);
    const extras=(await query<{n:number}>('SELECT COUNT(*) AS n FROM watchless_analysis_attempts WHERE run_id=? AND attempt>1',runId))[0].n;
    const formatFailures=attempts.filter(a=>a.error_kind==='format').length;
    if(!canSpendAttempt(attempts.length,extras,formatFailures)) return pause(run,owner,formatFailures>=2?'FORMAT_LIMIT: 输出格式连续不合格':'BUDGET: 已达到分段或整篇请求上限');
    const attempt=attempts.length+1, now=Date.now();
    let request:ReturnType<typeof analysisPartRequest>;
    try { request=analysisPartRequest(JSON.parse(part.payload),run.model,formatFailures ? 'Return valid JSON with the specified schema':''); }
    catch { return pause(run,owner,'PERMANENT: 模型配置无效，请先处理配置'); }
    try {
      await query(`INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline,result_key)
        VALUES(?,?,?,?,'started',?,?,?)`,runId,part.part_id,attempt,owner,now,now+ANALYSIS_LEASE_MS,`watchless-runs/recovery/${runId}/${part.ordinal}-${attempt}.json`);
    } catch(error) {
      if(/CONCURRENCY|ATTEMPT_ACTIVE|ATTEMPT_CONFLICT/.test(String(error))) return wait(run,owner,Date.now()+30_000);
      if(/BUDGET/.test(String(error))) return pause(run,owner,'BUDGET: 已达到请求上限');
      throw error;
    }
    let response:Response, raw:string, analysis:WatchlessAnalysisBundle;
    let kind='network', retryAfter:string|null=null;
    try {
      response=await fetch(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),signal:AbortSignal.timeout(ANALYSIS_REQUEST_MS)});
      retryAfter=response.headers.get('retry-after');
      if(!response.ok) {kind=retryableHttp(response.status)?'http':'permanent';throw new Error(`Model HTTP ${response.status}`);}
      kind='format'; const body=await response.json();
      raw=watchlessModelText(body,request.provider); analysis=validateGeneratedAnalysis(JSON.parse(raw),part.part_id);
    } catch(error) {
      if(error instanceof Error && (error.name==='TimeoutError'||error.name==='AbortError')) kind='timeout';
      const uncertain=kind==='timeout'||kind==='network';
      const next=kind==='permanent'?null:Math.max(retryAt(attempt,Date.now(),retryAfter),uncertain?now+ANALYSIS_LEASE_MS:0);
      await assertOwner(run,owner);
      await query(`UPDATE watchless_analysis_attempts SET status=?,finished_at=?,error_kind=?,retry_at=? WHERE run_id=? AND part_id=? AND attempt=? AND workflow_id=?
        AND EXISTS(SELECT 1 FROM watchless_analysis_runs WHERE id=? AND workflow_id=?)`,
        uncertain?'unknown':'failed',Date.now(),kind,next,runId,part.part_id,attempt,owner,runId,owner);
      if(kind==='permanent') return pause(run,owner,'PERMANENT: 模型权限、余额或参数错误');
      return wait(run,owner,next!);
    }
    await assertOwner(run,owner);
    // Workflow durably saves this step output before a SEPARATE storage-only step.
    return {done:false,waitMs:0,status:'saving',pending:{partId:part.part_id,attempt,analysis}};
  } catch(error) {
    if(/SUPERSEDED/.test(String(error))) {
      await query(`UPDATE watchless_analysis_runs SET status='cancelled',pause_reason='SUPERSEDED',updated_at=?
        WHERE id=? AND workflow_id=? AND status IN ('initializing','running','waiting')`,Date.now(),runId,owner);
      return {done:true,waitMs:0,status:'superseded'};
    }
    // Storage/commit failures pause without opening another paid attempt.
    return pause(run,owner,`STORAGE: ${error instanceof Error?error.message:'持久化失败'}`);
  }
}

export async function saveAnalysisRecoveryResult(runId:string,owner:string,pending:PendingAnalysisResult):Promise<RecoveryTick> {
  const run=(await query<Run>('SELECT * FROM watchless_analysis_runs WHERE id=?',runId))[0];
  if(!run) throw new Error('ANALYSIS_SUPERSEDED');
  await assertOwner(run,owner);
  const attempt=(await query<Attempt>(`SELECT * FROM watchless_analysis_attempts WHERE run_id=? AND part_id=? AND attempt=? AND workflow_id=?`,runId,pending.partId,pending.attempt,owner))[0];
  if(!attempt?.result_key || !['started','succeeded'].includes(attempt.status)) throw new Error('ANALYSIS_SUPERSEDED');
  const analysis=validateAnalysisBundle(pending.analysis,[pending.partId]);
  const existing=await readWatchlessCheckpoint(attempt.result_key);
  if(existing===undefined) await uploadObject(attempt.result_key,JSON.stringify(analysis),{contentType:'application/json'});
  else validateAnalysisBundle(existing,[pending.partId]);
  await assertOwner(run,owner);
  const changed=await query(`UPDATE watchless_analysis_attempts SET status='succeeded',finished_at=? WHERE run_id=? AND part_id=? AND attempt=? AND workflow_id=?
    AND EXISTS(SELECT 1 FROM watchless_analysis_runs WHERE id=? AND workflow_id=? AND status IN ('running','waiting')) RETURNING attempt`,Date.now(),runId,pending.partId,pending.attempt,owner,runId,owner);
  if(!changed.length) throw new Error('ANALYSIS_SUPERSEDED');
  return {done:false,waitMs:0,status:'running'};
}

export async function pauseAnalysisRecovery(runId:string,owner:string,resultPending=false) {
  const run=(await query<Run>('SELECT * FROM watchless_analysis_runs WHERE id=?',runId))[0];
  if(run) return pause(run,owner,resultPending?'RESULT_PENDING: 模型结果保存在 Workflow，需要恢复存储步骤，不能重新请求模型':'STORAGE: 执行步骤中断，请继续恢复已保存结果');
}
