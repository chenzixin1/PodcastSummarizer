"use strict";(()=>{var a={};a.id=8245,a.ids=[8245],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},11723:a=>{a.exports=require("querystring")},12412:a=>{a.exports=require("assert")},13440:a=>{a.exports=require("util/types")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{a.exports=require("os")},27910:a=>{a.exports=require("stream")},28354:a=>{a.exports=require("util")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},34631:a=>{a.exports=require("tls")},36686:a=>{a.exports=require("diagnostics_channel")},39598:(a,b,c)=>{c.d(b,{Jq:()=>g,h9:()=>h,le:()=>j,v9:()=>l,wD:()=>i,wN:()=>k});var d=c(79725);let e=a=>({podcastId:String(a.podcastId??""),status:String(a.status??"queued"),currentTask:a.currentTask??null,progressCurrent:Number(a.progressCurrent||0),progressTotal:Number(a.progressTotal||0),statusMessage:a.statusMessage||null,attempts:Number(a.attempts||0),workerId:a.workerId||null,lastError:a.lastError||null,createdAt:String(a.createdAt??""),updatedAt:String(a.updatedAt??""),startedAt:a.startedAt||null,finishedAt:a.finishedAt||null});async function f(){await (0,d.ll)`
    CREATE TABLE IF NOT EXISTS processing_jobs (
      podcast_id TEXT PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      current_task TEXT,
      progress_current INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      status_message TEXT,
      attempts INTEGER DEFAULT 0,
      worker_id TEXT,
      last_error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    )
  `}async function g(a){try{await f();let b=await (0,d.ll)`
      INSERT INTO processing_jobs (
        podcast_id, status, current_task, progress_current, progress_total, status_message, attempts, worker_id, last_error, started_at, finished_at
      )
      VALUES (
        ${a},
        'queued',
        NULL,
        0,
        0,
        'Queued for background processing',
        0,
        NULL,
        NULL,
        NULL,
        NULL
      )
      ON CONFLICT (podcast_id)
      DO UPDATE SET
        status = 'queued',
        current_task = NULL,
        progress_current = 0,
        progress_total = 0,
        status_message = 'Queued for background processing',
        worker_id = NULL,
        last_error = NULL,
        started_at = NULL,
        finished_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;if(0===b.rows.length)return{success:!1,error:"Failed to enqueue processing job"};return{success:!0,data:e(b.rows[0])}}catch(a){return console.error("enqueueProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function h(a){try{await f();let b=await (0,d.ll)`
      SELECT
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
      FROM processing_jobs
      WHERE podcast_id = ${a}
      LIMIT 1
    `;if(0===b.rows.length)return{success:!1,data:null,error:"Processing job not found"};return{success:!0,data:e(b.rows[0])}}catch(a){return console.error("getProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function i(a){try{await f();let b=await (0,d.ll)`
      WITH next_job AS (
        SELECT podcast_id
        FROM processing_jobs
        WHERE status = 'queued'
           OR (status = 'processing' AND updated_at < NOW() - INTERVAL '2 minutes')
        ORDER BY
          CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
          updated_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE processing_jobs j
      SET
        status = 'processing',
        worker_id = ${a},
        attempts = j.attempts + 1,
        current_task = COALESCE(j.current_task, 'summary'),
        status_message = 'Worker picked up the job',
        started_at = COALESCE(j.started_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      FROM next_job
      WHERE j.podcast_id = next_job.podcast_id
      RETURNING
        j.podcast_id as "podcastId",
        j.status,
        j.current_task as "currentTask",
        j.progress_current as "progressCurrent",
        j.progress_total as "progressTotal",
        j.status_message as "statusMessage",
        j.attempts,
        j.worker_id as "workerId",
        j.last_error as "lastError",
        j.created_at as "createdAt",
        j.updated_at as "updatedAt",
        j.started_at as "startedAt",
        j.finished_at as "finishedAt"
    `;if(0===b.rows.length)return{success:!0,data:null};return{success:!0,data:e(b.rows[0])}}catch(a){return console.error("claimNextProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function j(a,b){try{await f();let c=await (0,d.ll)`
      UPDATE processing_jobs
      SET
        current_task = COALESCE(${b.currentTask??null}, current_task),
        progress_current = COALESCE(${b.progressCurrent??null}, progress_current),
        progress_total = COALESCE(${b.progressTotal??null}, progress_total),
        status_message = COALESCE(${b.statusMessage??null}, status_message),
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${a}
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("updateProcessingJobProgress failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function k(a){try{await f();let b=await (0,d.ll)`
      UPDATE processing_jobs
      SET
        status = 'completed',
        status_message = 'Processing completed',
        current_task = NULL,
        progress_current = progress_total,
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${a}
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;if(0===b.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(b.rows[0])}}catch(a){return console.error("completeProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function l(a,b){try{await f();let c=await (0,d.ll)`
      UPDATE processing_jobs
      SET
        status = 'failed',
        status_message = 'Processing failed',
        last_error = ${b},
        finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE podcast_id = ${a}
      RETURNING
        podcast_id as "podcastId",
        status,
        current_task as "currentTask",
        progress_current as "progressCurrent",
        progress_total as "progressTotal",
        status_message as "statusMessage",
        attempts,
        worker_id as "workerId",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt",
        started_at as "startedAt",
        finished_at as "finishedAt"
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("failProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},41204:a=>{a.exports=require("string_decoder")},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},45099:(a,b,c)=>{c.d(b,{S:()=>e});var d=c(96733);async function e(a,b){try{let c={"Content-Type":"application/json"},e=(0,d.ru)();e&&(c.Authorization=`Bearer ${e}`);let f=(0,d.xe)();f&&(c["x-worker-secret"]=f);let g=await fetch(`${process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000"}/api/worker/process`,{method:"POST",headers:c,cache:"no-store",body:JSON.stringify({source:a,podcastId:b})});if(!g.ok){let a=await g.text();return{success:!1,status:g.status,error:a||`Worker trigger failed with status ${g.status}`}}return{success:!0,status:g.status}}catch(a){return{success:!1,error:a instanceof Error?a.message:String(a)}}}},54287:a=>{a.exports=require("console")},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},57075:a=>{a.exports=require("node:stream")},57975:a=>{a.exports=require("node:util")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73496:a=>{a.exports=require("http2")},73566:a=>{a.exports=require("worker_threads")},74075:a=>{a.exports=require("zlib")},74998:a=>{a.exports=require("perf_hooks")},77598:a=>{a.exports=require("node:crypto")},78474:a=>{a.exports=require("node:events")},78918:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>L,patchFetch:()=>K,routeModule:()=>G,serverHooks:()=>J,workAsyncStorage:()=>H,workUnitAsyncStorage:()=>I});var d={};c.r(d),c.d(d,{GET:()=>F,runtime:()=>E});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641),v=c(57932),w=c(50071),x=c(35714),y=c(98338),z=c(59920),A=c(19491),B=c(68941),C=c(39598),D=c(45099);let E="nodejs";async function F(a,b){let c="/api/extension/transcribe-status/:jobId",d=null;try{let e=(0,x.Ue)(a.headers.get("authorization"));if(!e)return u.NextResponse.json({success:!1,code:"AUTH_REQUIRED",error:"Missing Bearer token."},{status:401});let f=(0,x.Q$)(e),{jobId:g}=await b.params;if(!g)return u.NextResponse.json({success:!1,code:"INVALID_JOB_ID",error:"Missing job id."},{status:400});let h=await (0,y.hy)(g,f.id);if(!h.success||!h.data)return u.NextResponse.json({success:!1,code:"NOT_FOUND",error:"Transcription job not found."},{status:404});let i=h.data,j=function(a){let b=(process.env.NEXTAUTH_URL||process.env.NEXT_PUBLIC_APP_URL||"").trim();if(b)return b.replace(/\/+$/g,"");let c=(a.headers.get("origin")||"").trim();if(c)return c.replace(/\/+$/g,"");let d=a.headers.get("x-forwarded-host")||a.headers.get("host"),e=a.headers.get("x-forwarded-proto")||"https";return d?`${e}://${d}`:"https://podsum.cc"}(a),k=await (0,z.k_)(i.id)||await (0,z.hY)({path:"path2",status:"transcribing",stage:"provider_polling",userId:f.id,userEmail:f.email,sourceReference:i.sourceReference,videoId:i.videoId,title:i.title,isPublic:i.isPublic,transcriptionJobId:i.id,providerTaskId:i.providerTaskId,podcastId:i.podcastId});if((d=k?.id||null)&&await (0,z.RB)({taskId:d,level:"info",stage:"provider_polling",endpoint:c,message:"Polling provider transcription status.",meta:{transcriptionJobId:i.id,providerTaskId:i.providerTaskId,currentJobStatus:i.status}}),"completed"===i.status&&i.podcastId)return d&&await (0,z.kl)(d,{status:"queued",stage:"processing_queued",transcriptionJobId:i.id,podcastId:i.podcastId,providerTaskId:i.providerTaskId,clearError:!0}),u.NextResponse.json({success:!0,data:{status:"completed",podcastId:i.podcastId,dashboardUrl:`${j}/dashboard/${i.podcastId}`,lastError:null,monitorTaskId:d}});if("failed"===i.status)return d&&await (0,z.kl)(d,{status:"failed",stage:"failed",transcriptionJobId:i.id,podcastId:i.podcastId,providerTaskId:i.providerTaskId,lastErrorCode:"PATH2_TRANSCRIBE_FAILED",lastErrorMessage:i.error||"Transcription failed.",lastHttpStatus:200}),u.NextResponse.json({success:!0,data:{status:"failed",podcastId:i.podcastId,dashboardUrl:i.podcastId?`${j}/dashboard/${i.podcastId}`:null,lastError:i.error||"Transcription failed.",monitorTaskId:d}});if(!i.providerTaskId)return await (0,y.jC)(i.id,f.id,"Missing provider task id for transcription job."),d&&(await (0,z.kl)(d,{status:"failed",stage:"failed",transcriptionJobId:i.id,lastErrorCode:"PROVIDER_TASK_ID_MISSING",lastErrorMessage:"Missing provider task id for transcription job.",lastHttpStatus:200}),await (0,z.RB)({taskId:d,level:"error",stage:"failed",endpoint:c,message:"Missing provider task id for transcription job."})),u.NextResponse.json({success:!0,data:{status:"failed",lastError:"Missing provider task id for transcription job.",monitorTaskId:d}});let l=(0,A.Dh)("auto"),m=await (0,A.aD)(i.providerTaskId,l);if(!m.done)return await (0,y.uv)(i.id,f.id),d&&await (0,z.kl)(d,{status:"transcribing",stage:"provider_polling",transcriptionJobId:i.id,providerTaskId:i.providerTaskId,podcastId:i.podcastId,clearError:!0}),u.NextResponse.json({success:!0,data:{status:"transcribing",podcastId:i.podcastId,dashboardUrl:i.podcastId?`${j}/dashboard/${i.podcastId}`:null,lastError:null,monitorTaskId:d}});if(m.fatalError)return await (0,y.jC)(i.id,f.id,m.fatalError),d&&(await (0,z.kl)(d,{status:"failed",stage:"failed",transcriptionJobId:i.id,providerTaskId:i.providerTaskId,podcastId:i.podcastId,lastErrorCode:"VOLCANO_QUERY_FAILED",lastErrorMessage:m.fatalError,lastHttpStatus:200}),await (0,z.RB)({taskId:d,level:"error",stage:"failed",endpoint:c,message:m.fatalError,meta:{providerTaskId:i.providerTaskId}})),i.audioBlobUrl&&process.env.BLOB_READ_WRITE_TOKEN&&(0,u.after)(async()=>{try{await (0,v.yH)(i.audioBlobUrl)}catch(a){console.error("[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:",a)}}),u.NextResponse.json({success:!0,data:{status:"failed",podcastId:i.podcastId,dashboardUrl:i.podcastId?`${j}/dashboard/${i.podcastId}`:null,lastError:m.fatalError,monitorTaskId:d}});if(!m.data)return await (0,y.jC)(i.id,f.id,"Volcano returned no payload."),d&&(await (0,z.kl)(d,{status:"failed",stage:"failed",transcriptionJobId:i.id,providerTaskId:i.providerTaskId,podcastId:i.podcastId,lastErrorCode:"VOLCANO_EMPTY_PAYLOAD",lastErrorMessage:"Volcano returned no payload.",lastHttpStatus:200}),await (0,z.RB)({taskId:d,level:"error",stage:"failed",endpoint:c,message:"Volcano returned no payload."})),i.audioBlobUrl&&process.env.BLOB_READ_WRITE_TOKEN&&(0,u.after)(async()=>{try{await (0,v.yH)(i.audioBlobUrl)}catch(a){console.error("[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:",a)}}),u.NextResponse.json({success:!0,data:{status:"failed",podcastId:i.podcastId,dashboardUrl:i.podcastId?`${j}/dashboard/${i.podcastId}`:null,lastError:"Volcano returned no payload.",monitorTaskId:d}});let n=(0,A.fG)(m.data);d&&(await (0,z.kl)(d,{status:"transcribing",stage:"srt_generated",transcriptionJobId:i.id,providerTaskId:i.providerTaskId,clearError:!0}),await (0,z.RB)({taskId:d,level:"info",stage:"srt_generated",endpoint:c,message:"SRT generated from provider payload.",meta:{srtChars:n.length}}));let o=Buffer.from(n,"utf8"),p=(0,w.Ak)(),q=function(a){let b=a.trim().replace(/[^a-zA-Z0-9._-]+/g,"_").replace(/^\.+/,"")||"transcript";return b.toLowerCase().endsWith(".srt")?b:`${b.replace(/\.[a-z0-9]{1,5}$/i,"")}.srt`}(i.originalFileName||`${i.videoId||i.id}.srt`),r=`${(o.length/1024).toFixed(2)} KB`,s=(q||"").replace(/\.srt$/i,"")||i.videoId||p,t=`Transcript Analysis: ${s}`,E="#mock-blob-url";process.env.BLOB_READ_WRITE_TOKEN&&(E=(await (0,v.yJ)(`extension-srt/${p}-${q}`,o,{access:"public",contentType:"application/x-subrip"})).url);let F=await (0,B.Er)({id:p,title:i.title?.trim()||t,originalFileName:q,fileSize:r,blobUrl:E,sourceReference:i.sourceReference,isPublic:i.isPublic,userId:f.id});if(!F.success)throw Error(F.error||"Failed to save podcast from Path2 transcription.");d&&(await (0,z.kl)(d,{stage:"podcast_saved",podcastId:p}),await (0,z.RB)({taskId:d,level:"info",stage:"podcast_saved",endpoint:c,message:"Podcast row saved from Path2 transcription.",meta:{podcastId:p,srtBlobUrl:E}}));let G=await (0,C.Jq)(p);return G.success&&(0,u.after)(async()=>{let a=await (0,D.S)("upload",p);a.success||console.error("[EXTENSION_TRANSCRIBE_STATUS] Failed to trigger worker:",a.error)}),d&&(await (0,z.kl)(d,{status:G.success?"queued":"accepted",stage:G.success?"processing_queued":"response_sent",podcastId:p,transcriptionJobId:i.id,providerTaskId:i.providerTaskId,clearError:!0}),await (0,z.RB)({taskId:d,level:G.success?"info":"warn",stage:G.success?"processing_queued":"response_sent",endpoint:c,message:G.success?"Path2 transcription completed and processing queued.":"Path2 transcription completed, but processing queue failed.",meta:{queueSuccess:G.success,queueError:G.error||null,podcastId:p}})),await (0,y.R7)(i.id,f.id,p),i.audioBlobUrl&&process.env.BLOB_READ_WRITE_TOKEN&&(0,u.after)(async()=>{try{await (0,v.yH)(i.audioBlobUrl)}catch(a){console.error("[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:",a)}}),u.NextResponse.json({success:!0,data:{status:"completed",podcastId:p,dashboardUrl:`${j}/dashboard/${p}`,lastError:null,monitorTaskId:d}})}catch(a){if(d&&(await (0,z.kl)(d,{status:"failed",stage:"failed",lastErrorCode:a instanceof x.yx?a.code:"TRANSCRIBE_STATUS_FAILED",lastErrorMessage:a instanceof Error?a.message:String(a),lastHttpStatus:a instanceof x.yx?a.status:500}).catch(a=>{console.error("[EXT_MON] failed to update monitor task:",a)}),await (0,z.RB)({taskId:d,level:"error",stage:"failed",endpoint:c,httpStatus:a instanceof x.yx?a.status:500,message:a instanceof Error?a.message:String(a),errorStack:a instanceof Error&&a.stack||null}).catch(a=>{console.error("[EXT_MON] failed to record monitor event:",a)})),a instanceof x.yx)return u.NextResponse.json({success:!1,code:a.code,error:a.message},{status:a.status});return u.NextResponse.json({success:!1,code:"TRANSCRIBE_STATUS_FAILED",error:"Failed to fetch extension transcription status.",details:a instanceof Error?a.message:String(a)},{status:500})}}let G=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/extension/transcribe-status/[jobId]/route",pathname:"/api/extension/transcribe-status/[jobId]",filename:"route",bundlePath:"app/api/extension/transcribe-status/[jobId]/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/chenzixin/projects/PodcastSummarizer/app/api/extension/transcribe-status/[jobId]/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:H,workUnitAsyncStorage:I,serverHooks:J}=G;function K(){return(0,g.patchFetch)({workAsyncStorage:H,workUnitAsyncStorage:I})}async function L(a,b,c){var d;let e="/api/extension/transcribe-status/[jobId]/route";"/index"===e&&(e="/");let g=await G.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:C}=g,D=(0,j.normalizeAppPath)(e),E=!!(y.dynamicRoutes[D]||y.routes[C]);if(E&&!x){let a=!!y.routes[C],b=y.dynamicRoutes[D];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let F=null;!E||G.isDev||x||(F="/index"===(F=C)?"/":F);let H=!0===G.isDev||!E,I=E&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>G.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>G.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!E)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await G.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await G.handleResponse({req:a,nextConfig:w,cacheKey:F,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!E)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&E||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await G.onRequestError(a,b,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),E)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},79428:a=>{a.exports=require("buffer")},79551:a=>{a.exports=require("url")},81630:a=>{a.exports=require("http")},84297:a=>{a.exports=require("async_hooks")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{a.exports=require("net")},94175:a=>{a.exports=require("stream/web")},94735:a=>{a.exports=require("events")},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};var b=require("../../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[4996,1692,9725,7028,7932,7146,9920,687],()=>b(b.s=78918));module.exports=c})();