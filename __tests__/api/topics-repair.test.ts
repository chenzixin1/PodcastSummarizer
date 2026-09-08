/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/worker/topics-repair/route';
import { createWatchlessD1 } from '../helpers/watchlessD1';
import { isWorkerAuthorizedBySecret } from '../../lib/workerAuth';
import { uploadObject } from '../../lib/objectStorage';
let mockD1: ReturnType<typeof createWatchlessD1>;
jest.mock('../../lib/sql', () => ({ getD1DatabaseBinding: () => mockD1.binding }));
jest.mock('../../lib/workerAuth', () => ({ isWorkerAuthorizedBySecret: jest.fn(() => true) }));
jest.mock('../../lib/objectStorage', () => ({ uploadObject: jest.fn(async()=>({provider:'r2'})) }));
jest.mock('../../lib/staticSnapshotHooks', () => ({ refreshSnapshotsForPodcastMutation: jest.fn(async()=>({success:true})) }));
const request=(body: unknown)=>new NextRequest('https://podsum.test/api/worker/topics-repair',{method:'POST',headers:{'x-worker-secret':'test','Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
  jest.clearAllMocks();
  (isWorkerAuthorizedBySecret as jest.Mock).mockReturnValue(true);
  (uploadObject as jest.Mock).mockResolvedValue({provider:'r2'});
  mockD1=createWatchlessD1('p','12345678901');
  mockD1.run("UPDATE podcasts SET title='FDE Interview',tags_json='[]'");
});
afterEach(()=>mockD1.close());
test('rejects unauthenticated requests before accessing records',async()=>{
  (isWorkerAuthorizedBySecret as jest.Mock).mockReturnValue(false);
  expect((await POST(request({id:'p',action:'apply'}))).status).toBe(401);
  expect(uploadObject).not.toHaveBeenCalled();
});
test('preview is read-only and returns meaningful labels',async()=>{
  const response=await POST(request({id:'p',action:'preview'}));
  expect((await response.json()).data.tags).toContain('Forward Deployed Engineering');
  expect(uploadObject).not.toHaveBeenCalled();
  expect(mockD1.run('SELECT tags_json FROM podcasts')[0].tags_json).toBe('[]');
});
test('refuses stale previews',async()=>{
  const preview=await (await POST(request({id:'p',action:'preview'}))).json();
  mockD1.run("UPDATE podcasts SET title='changed'");
  expect((await POST(request({id:'p',action:'apply',fingerprint:preview.data.fingerprint}))).status).toBe(409);
  expect(uploadObject).not.toHaveBeenCalled();
});
test('requires successful private backup before any tag write',async()=>{
  const preview=await (await POST(request({id:'p',action:'preview'}))).json();
  (uploadObject as jest.Mock).mockRejectedValue(new Error('R2 unavailable'));
  expect((await POST(request({id:'p',action:'apply',fingerprint:preview.data.fingerprint}))).status).toBe(500);
  expect(uploadObject).toHaveBeenCalledWith(expect.stringContaining('watchless-runs/topic-repairs/'),expect.any(String),expect.objectContaining({requirePrivateR2:true}));
  expect(mockD1.run('SELECT tags_json FROM podcasts')[0].tags_json).toBe('[]');
});
test('applies labels without scheduling analysis or changing source',async()=>{
  const before=mockD1.run('SELECT * FROM analysis_results');
  const job=mockD1.run('SELECT * FROM processing_jobs');
  const preview=await (await POST(request({id:'p',action:'preview'}))).json();
  expect((await POST(request({id:'p',action:'apply',fingerprint:preview.data.fingerprint}))).status).toBe(200);
  expect(mockD1.run('SELECT * FROM analysis_results')).toEqual(before);
  expect(mockD1.run('SELECT * FROM processing_jobs')).toEqual(job);
  expect(mockD1.run('SELECT * FROM podcast_topics').length).toBeGreaterThan(0);
});
