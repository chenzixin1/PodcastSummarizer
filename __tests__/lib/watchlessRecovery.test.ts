/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWatchlessD1 } from '../helpers/watchlessD1';
import { sampleWatchlessArticle } from '../../lib/watchless/sample';
import { buildAnalysisParts } from '../../lib/watchless/fullAnalysis';
import { analysisRecoveryStatus, startAnalysisRecovery, tickAnalysisRecovery, saveAnalysisRecoveryResult, pauseAnalysisRecovery, type RecoveryTick } from '../../lib/watchless/analysisRecovery';
import { canSpendAttempt, retryAt, retryableHttp } from '../../lib/watchless/recoveryPolicy';
let mockD1: ReturnType<typeof createWatchlessD1>;
let mockObjects: Map<string,unknown>;
let mockStorageFailure=false;
const mockCreate=jest.fn(async()=>({}));
const mockStatus=jest.fn(async()=>({status:'complete'}));
const article={...sampleWatchlessArticle,scenes:sampleWatchlessArticle.scenes.slice(0,1)};
jest.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:async()=>({env:{WATCHLESS_ANALYSIS_WORKFLOW:{create:mockCreate,get:async()=>({status:mockStatus})}}})}));
jest.mock('../../lib/sql',()=>({getD1DatabaseBinding:()=>mockD1.binding}));
jest.mock('../../lib/watchless/repository',()=>({
  getStoredWatchlessPublication:async()=>({podcastId:article.id,videoId:article.videoId,articleKey:'old/article.json'}),
  loadStoredWatchlessArticle:async()=>article,
}));
jest.mock('../../lib/objectStorage',()=>({
  getObjectText:jest.fn(async(key:string)=>{if(!mockObjects.has(key))throw new Error('Object not found');return JSON.stringify(mockObjects.get(key));}),
  uploadObject:jest.fn(async(key:string,text:string)=>{if(mockStorageFailure)throw new Error('R2 unavailable');mockObjects.set(key,JSON.parse(text));}),
}));
jest.mock('../../lib/staticSnapshotHooks',()=>({refreshSnapshotsForPodcastMutation:jest.fn()}));
jest.mock('../../lib/watchless/modelProvider',()=>({
  watchlessModelRequest:(body:unknown)=>({url:'https://model.test',headers:{},body,provider:'cloudflare'}),
  watchlessModelText:(body:unknown)=>JSON.stringify(body),
}));
const part=()=>buildAnalysisParts(article)[0];
const valid=()=>({version:1,scenes:[{id:part().id,titleZh:'真实的观点',titleEn:'Real arguments',points:[{zh:'这里保留完整的论点与事实依据。',en:'The complete argument and evidence are preserved.'},{zh:'这里保留所有限定条件和争议。',en:'All qualifications and disagreements are preserved.'}]}]});
const legacyKey=()=>`watchless-runs/analysis/${article.id}/${createHash('sha256').update(JSON.stringify({version:1,model:'test-model',part:part()})).digest('hex')}.json`;
const active=()=>mockD1.run('SELECT id,workflow_id FROM watchless_analysis_runs')[0] as {id:string;workflow_id:string};
async function tick() {const r=active();return tickAnalysisRecovery(r.id,r.workflow_id);}
async function advance():Promise<RecoveryTick>{for(let i=0;i<8;i++){const r=await tick();if(r.pending||r.done||r.waitMs)return r;}throw Error('No progress');}
beforeEach(()=>{
  process.env.WATCHLESS_ANALYSIS_RECOVERY_ENABLED='true';process.env.WATCHLESS_MODEL='test-model';
  mockD1=createWatchlessD1(article.id,article.videoId);
  mockD1.exec(readFileSync('migrations/d1/0010_watchless_analysis_recovery.sql','utf8'));
  mockD1.run("UPDATE processing_jobs SET status='failed'");mockObjects=new Map();mockStorageFailure=false;
  mockCreate.mockClear();mockStatus.mockResolvedValue({status:'running'});
  global.fetch=jest.fn(async()=>new Response(JSON.stringify(valid()),{status:200}));
});
afterEach(()=>{mockD1.close();delete process.env.WATCHLESS_ANALYSIS_RECOVERY_ENABLED;delete process.env.WATCHLESS_MODEL;});

test('imports paid successful checkpoints without a model call and commits',async()=>{
  mockObjects.set(legacyKey(),valid());
  mockObjects.set(legacyKey().replace('.json','.attempt-0.json'),{startedAt:'2026-09-01T00:00:00Z'});
  await startAnalysisRecovery(article.id);expect((await advance()).status).toBe('completed');
  expect(fetch).not.toHaveBeenCalled();expect((await analysisRecoveryStatus(article.id))?.completed).toBe(1);
  expect(mockD1.run('SELECT analysis_kind FROM analysis_results')[0].analysis_kind).toBe('full');
  const r=active();await pauseAnalysisRecovery(r.id,r.workflow_id);
  expect(mockD1.run('SELECT status FROM processing_jobs')[0].status).toBe('completed');
});
test('repeated submit returns the same workflow without resetting state',async()=>{
  await startAnalysisRecovery(article.id);await startAnalysisRecovery(article.id);
  expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockD1.run('SELECT * FROM watchless_analysis_runs')).toHaveLength(1);
});
test('model result is a durable step output; storage retries never rerun the model',async()=>{
  await startAnalysisRecovery(article.id);const result=await advance();expect(result.pending).toBeDefined();
  const r=active();mockStorageFailure=true;
  await expect(saveAnalysisRecoveryResult(r.id,r.workflow_id,result.pending!)).rejects.toThrow('R2 unavailable');
  mockStorageFailure=false;await saveAnalysisRecoveryResult(r.id,r.workflow_id,result.pending!);
  await saveAnalysisRecoveryResult(r.id,r.workflow_id,result.pending!);
  expect((await advance()).status).toBe('completed');expect(fetch).toHaveBeenCalledTimes(1);
});
test('restart after reservation waits for the attempt deadline, without duplicate spending',async()=>{
  await startAnalysisRecovery(article.id);await advance();const wait=await tick();
  expect(wait.status).toBe('waiting');expect(wait.waitMs).toBeGreaterThan(0);expect(fetch).toHaveBeenCalledTimes(1);
});
test('late response after cancellation cannot be saved or billed again',async()=>{
  await startAnalysisRecovery(article.id);const result=await advance();const r=active();
  mockD1.run("UPDATE processing_jobs SET status='cancelled'");
  await expect(saveAnalysisRecoveryResult(r.id,r.workflow_id,result.pending!)).rejects.toThrow('SUPERSEDED');
  expect(fetch).toHaveBeenCalledTimes(1);expect(mockObjects.size).toBe(0);
});
test.each([401,402,403,400])('permanent HTTP %i pauses without retry',async status=>{
  (fetch as jest.Mock).mockResolvedValue(new Response('{}',{status}));await startAnalysisRecovery(article.id);
  expect((await advance()).status).toBe('paused');expect((await analysisRecoveryStatus(article.id))?.canResume).toBe(false);
});
test('429 persists backoff and counts the request',async()=>{
  (fetch as jest.Mock).mockResolvedValue(new Response('{}',{status:429,headers:{'Retry-After':'300'}}));
  await startAnalysisRecovery(article.id);const result=await advance();expect(result.waitMs).toBeGreaterThan(299000);
  expect(mockD1.run('SELECT * FROM watchless_analysis_attempts')).toHaveLength(1);
});
test('legacy uncertain attempt is counted and retried only within remaining limits',async()=>{
  mockObjects.set(legacyKey().replace('.json','.attempt-0.json'),{startedAt:'2026-09-01T00:00:00Z'});
  await startAnalysisRecovery(article.id);const result=await advance();expect(result.pending?.attempt).toBe(2);
  expect(mockD1.run('SELECT * FROM watchless_analysis_attempts')).toHaveLength(2);
});
test('global reservation limit atomically blocks the fourth concurrent request',async()=>{
  await startAnalysisRecovery(article.id);await tick();const r=active();
  mockD1.run("UPDATE watchless_analysis_runs SET status='running'");
  for(let i=0;i<4;i++)mockD1.run("INSERT INTO watchless_analysis_parts(run_id,part_id,ordinal,cache_key,payload,imported) VALUES(?,?,?,'x','{}',1)",[r.id,`extra-${i}`,i+1]);
  const insert=(i:number)=>mockD1.run("INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline) VALUES(?,?,1,?,'started',?,?)",[r.id,`extra-${i}`,r.workflow_id,Date.now(),Date.now()+180000]);
  insert(0);insert(1);insert(2);expect(()=>insert(3)).toThrow('CONCURRENCY_LIMIT');
});
test('retry policy is bounded and respects Retry-After',()=>{
  expect(canSpendAttempt(3,0,0)).toBe(false);expect(canSpendAttempt(1,10,0)).toBe(false);
  expect(canSpendAttempt(0,10,0)).toBe(true);expect(canSpendAttempt(1,0,2)).toBe(false);
  expect(retryAt(1,0,null,0)).toBe(30000);expect(retryAt(2,0,null,1)).toBe(144000);
  expect(retryAt(1,0,'300',0)).toBe(300000);expect(retryableHttp(403)).toBe(false);expect(retryableHttp(503)).toBe(true);
});

test('recent legacy unknown request retains its lease before retry',async()=>{
  mockObjects.set(legacyKey().replace('.json','.attempt-0.json'),{startedAt:new Date().toISOString()});
  await startAnalysisRecovery(article.id);expect((await advance()).waitMs).toBeGreaterThan(170000);
  expect(fetch).not.toHaveBeenCalled();
});
test('network failure is uncertain, counted and waits until the lease expires',async()=>{
  (fetch as jest.Mock).mockRejectedValue(new TypeError('Network disconnected'));
  await startAnalysisRecovery(article.id);expect((await advance()).waitMs).toBeGreaterThan(170000);
  expect(mockD1.run('SELECT status FROM watchless_analysis_attempts')[0].status).toBe('unknown');
  await tick();expect(fetch).toHaveBeenCalledTimes(1);
});
test('cancelled job is presented as cancelled and cannot continue',async()=>{
  await startAnalysisRecovery(article.id);mockD1.run("UPDATE processing_jobs SET status='cancelled'");
  expect((await analysisRecoveryStatus(article.id))?.status).toBe('cancelled');
  expect((await tick()).status).toBe('cancelled');expect(fetch).not.toHaveBeenCalled();
  mockStatus.mockResolvedValue({status:'complete'});
  expect((await startAnalysisRecovery(article.id))?.status).toBe('cancelled');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('late state updates cannot revive a cancelled run or mutate its parts',async()=>{
  await startAnalysisRecovery(article.id);await tick();const r=active();
  mockD1.run("UPDATE processing_jobs SET status='cancelled'");
  mockD1.run("UPDATE watchless_analysis_runs SET status='waiting' WHERE id=?",[r.id]);
  mockD1.run("UPDATE watchless_analysis_runs SET status='completed' WHERE id=?",[r.id]);
  expect(mockD1.run('SELECT status FROM watchless_analysis_runs')[0].status).toBe('cancelled');
  expect(()=>mockD1.run("UPDATE watchless_analysis_parts SET status='completed' WHERE run_id=?",[r.id])).toThrow('SUPERSEDED');
});
test('old enqueue cannot erase workflow progress or its attempt budget',async()=>{
  await startAnalysisRecovery(article.id);await advance();
  mockD1.run("UPDATE processing_jobs SET status='failed',progress_current=7");
  mockD1.run("UPDATE processing_jobs SET status='queued',progress_current=0,worker_id=NULL");
  expect(mockD1.run('SELECT status,progress_current FROM processing_jobs')[0]).toMatchObject({status:'failed',progress_current:7});
  expect(mockD1.run('SELECT * FROM watchless_analysis_attempts')).toHaveLength(1);
});
test('malformed JSON can only be retried once',async()=>{
  (fetch as jest.Mock).mockResolvedValue(new Response('not json',{status:200}));
  await startAnalysisRecovery(article.id);await advance();
  mockD1.run('UPDATE watchless_analysis_attempts SET retry_at=0');
  (fetch as jest.Mock).mockResolvedValue(new Response('still not json',{status:200}));
  await tick();mockD1.run('UPDATE watchless_analysis_attempts SET retry_at=0');
  expect((await tick()).status).toBe('paused');expect(fetch).toHaveBeenCalledTimes(2);
  expect((await analysisRecoveryStatus(article.id))?.pauseReason).toContain('FORMAT_LIMIT');
});
test('R2 saved but D1 acknowledgement lost is recovered without a model call',async()=>{
  await startAnalysisRecovery(article.id);const result=await advance();const r=active();
  const key=mockD1.run('SELECT result_key FROM watchless_analysis_attempts')[0].result_key as string;
  mockObjects.set(key,result.pending!.analysis);
  expect((await advance()).status).toBe('completed');expect(fetch).toHaveBeenCalledTimes(1);
  await expect(saveAnalysisRecoveryResult(r.id,r.workflow_id,result.pending!)).rejects.toThrow('SUPERSEDED');
});
test('final transaction failure resumes only storage, never regenerated analysis',async()=>{
  mockObjects.set(legacyKey(),valid());await startAnalysisRecovery(article.id);await tick();
  mockD1.hooks.failStatementIndex=0;expect((await tick()).status).toBe('paused');
  mockD1.hooks.failStatementIndex=undefined;mockStatus.mockResolvedValue({status:'complete'});
  await startAnalysisRecovery(article.id);expect((await advance()).status).toBe('completed');
  expect(fetch).not.toHaveBeenCalled();
});
test('legacy rejected raw that now validates is reused for free',async()=>{
  mockObjects.set(legacyKey().replace('.json','.rejected-0.json'),{reason:'old parser',raw:JSON.stringify(valid().scenes[0])});
  await startAnalysisRecovery(article.id);expect((await advance()).status).toBe('completed');
  expect(fetch).not.toHaveBeenCalled();expect(mockD1.run('SELECT * FROM watchless_analysis_attempts')).toHaveLength(1);
});
test('SQL rejects an eleventh extra request and a fourth request on one part',async()=>{
  await startAnalysisRecovery(article.id);await tick();const r=active();
  mockD1.run("UPDATE watchless_analysis_runs SET status='running'");
  for(let i=0;i<6;i++) {
    mockD1.run("INSERT INTO watchless_analysis_parts(run_id,part_id,ordinal,cache_key,payload) VALUES(?,?,?,'x','{}')",[r.id,`budget-${i}`,i+1]);
    for(let a=1;a<=(i<5?3:1);a++)mockD1.run("INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline,imported) VALUES(?,?,?,?,'failed',0,0,1)",[r.id,`budget-${i}`,a,r.workflow_id]);
  }
  expect(()=>mockD1.run("INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline) VALUES(?,?,2,?,'started',0,1)",[r.id,'budget-5',r.workflow_id])).toThrow('BUDGET');
  expect(()=>mockD1.run("INSERT INTO watchless_analysis_attempts(run_id,part_id,attempt,workflow_id,status,started_at,deadline,imported) VALUES(?,?,4,?,'started',0,1,1)",[r.id,'budget-0',r.workflow_id])).toThrow('CHECK');
});
