"use strict";(()=>{var a={};a.id=1425,a.ids=[1425],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},11723:a=>{a.exports=require("querystring")},12412:a=>{a.exports=require("assert")},13440:a=>{a.exports=require("util/types")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{a.exports=require("os")},27098:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>K,patchFetch:()=>J,routeModule:()=>F,serverHooks:()=>I,workAsyncStorage:()=>G,workUnitAsyncStorage:()=>H});var d={};c.r(d),c.d(d,{POST:()=>E,maxDuration:()=>D,runtime:()=>C});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641),v=c(57932),w=c(50071),x=c(35714),y=c(59920),z=c(68941),A=c(39598),B=c(45099);let C="nodejs",D=300;async function E(a){let b="/api/extension/upload-srt",c=null;try{let d=(0,x.Ue)(a.headers.get("authorization"));if(!d)return u.NextResponse.json({success:!1,code:"AUTH_REQUIRED",error:"Missing Bearer token."},{status:401});let e=(0,x.Q$)(d),f=await a.json(),g=(f?.sourceReference||"").trim()||null,h=!!f?.isPublic,i=String(f?.clientTaskId||"").trim()||null,j=String(f?.traceId||"").trim()||null,k=await (0,y.hY)({path:"path1",status:"received",stage:"request_received",userId:e.id,userEmail:e.email,clientTaskId:i,traceId:j,sourceReference:g,title:f?.fileName?String(f.fileName).trim():null,isPublic:h});(c=k?.id||null)&&await (0,y.RB)({taskId:c,level:"info",stage:"request_received",endpoint:b,message:"Path1 upload request received.",requestHeaders:Object.fromEntries(a.headers.entries()),requestBody:f});let l=(f?.srtContent||"").replace(/^\uFEFF/,"").trim();if(!l)return c&&(await (0,y.kl)(c,{status:"failed",stage:"failed",lastErrorCode:"INVALID_SRT",lastErrorMessage:"srtContent is required.",lastHttpStatus:400}),await (0,y.RB)({taskId:c,level:"error",stage:"failed",endpoint:b,httpStatus:400,message:"Missing srtContent in request.",responseBody:{success:!1,code:"INVALID_SRT"}})),u.NextResponse.json({success:!1,code:"INVALID_SRT",error:"srtContent is required."},{status:400});c&&(await (0,y.kl)(c,{status:"accepted",stage:"input_validated",clearError:!0}),await (0,y.RB)({taskId:c,level:"info",stage:"input_validated",endpoint:b,message:"SRT payload validated.",meta:{srtChars:l.length}}));let m=(0,w.Ak)(),n=function(a){let b=a.trim().replace(/[^a-zA-Z0-9._-]+/g,"_").replace(/^\.+/,"");return b?b.toLowerCase().endsWith(".srt")?b:`${b}.srt`:"transcript.srt"}(f?.fileName||`${m}.srt`),o=n.replace(/\.srt$/i,"")||"Transcript",p=`Transcript Analysis: ${o}`,q=Buffer.from(l,"utf8"),r=`${(q.length/1024).toFixed(2)} KB`,s="#mock-blob-url";process.env.BLOB_READ_WRITE_TOKEN&&(s=(await (0,v.yJ)(`${m}-${n}`,q,{access:"public",contentType:"application/x-subrip"})).url),c&&(await (0,y.kl)(c,{stage:"srt_blob_saved"}),await (0,y.RB)({taskId:c,level:"info",stage:"srt_blob_saved",endpoint:b,message:"SRT blob stored.",meta:{blobUrl:s,fileSize:r,originalFileName:n}}));let t=await (0,z.Er)({id:m,title:p,originalFileName:n,fileSize:r,blobUrl:s,sourceReference:g,isPublic:h,userId:e.id});if(!t.success)return c&&(await (0,y.kl)(c,{status:"failed",stage:"failed",podcastId:m,lastErrorCode:"SAVE_FAILED",lastErrorMessage:"Failed to save podcast.",lastHttpStatus:500}),await (0,y.RB)({taskId:c,level:"error",stage:"failed",endpoint:b,httpStatus:500,message:"Failed to save podcast.",responseBody:{success:!1,code:"SAVE_FAILED",details:t.error||null}})),u.NextResponse.json({success:!1,code:"SAVE_FAILED",error:"Failed to save podcast.",details:t.error},{status:500});c&&(await (0,y.kl)(c,{stage:"podcast_saved",podcastId:m,videoId:null,title:p}),await (0,y.RB)({taskId:c,level:"info",stage:"podcast_saved",endpoint:b,message:"Podcast row saved from Path1.",meta:{podcastId:m}}));let C=await (0,A.Jq)(m);return C.success&&(0,u.after)(async()=>{let a=await (0,B.S)("upload",m);a.success||console.error("[EXTENSION_UPLOAD] Failed to trigger worker:",a.error)}),c&&(await (0,y.kl)(c,{status:C.success?"queued":"accepted",stage:C.success?"processing_queued":"response_sent",podcastId:m,clearError:!0}),await (0,y.RB)({taskId:c,level:C.success?"info":"warn",stage:C.success?"processing_queued":"response_sent",endpoint:b,message:C.success?"Processing job queued.":"Processing queue failed.",meta:{queueSuccess:C.success,queueError:C.error||null}})),u.NextResponse.json({success:!0,data:{podcastId:m,dashboardUrl:`${function(a){let b=(process.env.NEXTAUTH_URL||process.env.NEXT_PUBLIC_APP_URL||"").trim();if(b)return b.replace(/\/+$/g,"");let c=(a.headers.get("origin")||"").trim();if(c)return c.replace(/\/+$/g,"");let d=a.headers.get("x-forwarded-host")||a.headers.get("host"),e=a.headers.get("x-forwarded-proto")||"https";return d?`${e}://${d}`:"https://podsum.cc"}(a)}/dashboard/${m}`,processingQueued:C.success,monitorTaskId:c}})}catch(a){if(c&&(await (0,y.kl)(c,{status:"failed",stage:"failed",lastErrorCode:a instanceof x.yx?a.code:"UPLOAD_FAILED",lastErrorMessage:a instanceof Error?a.message:String(a),lastHttpStatus:a instanceof x.yx?a.status:500}).catch(a=>{console.error("[EXT_MON] failed to update monitor task:",a)}),await (0,y.RB)({taskId:c,level:"error",stage:"failed",endpoint:b,httpStatus:a instanceof x.yx?a.status:500,message:a instanceof Error?a.message:String(a),errorStack:a instanceof Error&&a.stack||null}).catch(a=>{console.error("[EXT_MON] failed to record monitor event:",a)})),a instanceof x.yx)return u.NextResponse.json({success:!1,code:a.code,error:a.message},{status:a.status});return u.NextResponse.json({success:!1,code:"UPLOAD_FAILED",error:"Failed to upload SRT from extension.",details:a instanceof Error?a.message:String(a)},{status:500})}}let F=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/extension/upload-srt/route",pathname:"/api/extension/upload-srt",filename:"route",bundlePath:"app/api/extension/upload-srt/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/chenzixin/projects/PodcastSummarizer/app/api/extension/upload-srt/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:G,workUnitAsyncStorage:H,serverHooks:I}=F;function J(){return(0,g.patchFetch)({workAsyncStorage:G,workUnitAsyncStorage:H})}async function K(a,b,c){var d;let e="/api/extension/upload-srt/route";"/index"===e&&(e="/");let g=await F.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:C}=g,D=(0,j.normalizeAppPath)(e),E=!!(y.dynamicRoutes[D]||y.routes[C]);if(E&&!x){let a=!!y.routes[C],b=y.dynamicRoutes[D];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!E||F.isDev||x||(G="/index"===(G=C)?"/":G);let H=!0===F.isDev||!E,I=E&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>F.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>F.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!E)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await F.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await F.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!E)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&E||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await F.onRequestError(a,b,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),E)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},27910:a=>{a.exports=require("stream")},28354:a=>{a.exports=require("util")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},34631:a=>{a.exports=require("tls")},35714:(a,b,c)=>{c.d(b,{Q$:()=>m,Ue:()=>k,_c:()=>l,w_:()=>n,yx:()=>g});var d=c(7028),e=c(55511),f=c(68941);class g extends Error{constructor(a,b,c){super(c),this.name="ExtensionAuthError",this.code=a,this.status=b}}function h(a){return Buffer.from(a).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function i(){let a=(process.env.EXTENSION_TOKEN_SECRET||process.env.NEXTAUTH_SECRET||"").trim();if(!a)throw new g("TOKEN_SECRET_MISSING",503,"Extension token secret is not configured.");return a}function j(a,b){return h((0,e.createHmac)("sha256",b).update(a).digest())}function k(a){if(!a)return null;let[b,c]=a.trim().split(/\s+/);return b&&c&&"bearer"===b.toLowerCase()?c:null}function l(a){let b=i(),c=Math.floor(Date.now()/1e3),d=function(){let a=Number.parseInt(process.env.EXTENSION_TOKEN_TTL_SECONDS||"",10);return!Number.isFinite(a)||a<=0?604800:a}(),e={uid:a.id,email:a.email,iat:c,exp:c+d},f=h(JSON.stringify({alg:"HS256",typ:"JWT"})),g=h(JSON.stringify(e)),k=`${f}.${g}`,l=j(k,b);return{accessToken:`${k}.${l}`,expiresIn:d}}function m(a){let b,c=i(),d=a.split(".");if(3!==d.length)throw new g("INVALID_TOKEN",401,"Invalid extension token format.");let[f,h,k]=d;if(!function(a,b){let c=Buffer.from(a),d=Buffer.from(b);return c.length===d.length&&(0,e.timingSafeEqual)(c,d)}(k,j(`${f}.${h}`,c)))throw new g("INVALID_TOKEN_SIGNATURE",401,"Invalid extension token signature.");try{b=JSON.parse(function(a){let b=a.replace(/-/g,"+").replace(/_/g,"/"),c=(4-b.length%4)%4,d=b+"=".repeat(c);return Buffer.from(d,"base64").toString("utf8")}(h))}catch{throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload.")}if(!b?.uid||!b?.email||!b?.exp)throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload fields.");let l=Math.floor(Date.now()/1e3);if(b.exp<=l)throw new g("TOKEN_EXPIRED",401,"Extension token has expired.");return{id:b.uid,email:b.email,name:b.email}}async function n(a,b){let c=a.trim();if(!c||!b)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let e=await (0,f.ht)(c);if(!e.success)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let h=e.data;if(!h?.id||!h?.email||!h?.password_hash||!await d.Ay.compare(b,h.password_hash))throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");return{id:h.id,email:h.email,name:h.name||h.email}}},36686:a=>{a.exports=require("diagnostics_channel")},39598:(a,b,c)=>{c.d(b,{Jq:()=>g,h9:()=>h,le:()=>j,v9:()=>l,wD:()=>i,wN:()=>k});var d=c(79725);let e=a=>({podcastId:String(a.podcastId??""),status:String(a.status??"queued"),currentTask:a.currentTask??null,progressCurrent:Number(a.progressCurrent||0),progressTotal:Number(a.progressTotal||0),statusMessage:a.statusMessage||null,attempts:Number(a.attempts||0),workerId:a.workerId||null,lastError:a.lastError||null,createdAt:String(a.createdAt??""),updatedAt:String(a.updatedAt??""),startedAt:a.startedAt||null,finishedAt:a.finishedAt||null});async function f(){await (0,d.ll)`
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
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("failProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},41204:a=>{a.exports=require("string_decoder")},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},45099:(a,b,c)=>{c.d(b,{S:()=>e});var d=c(96733);async function e(a,b){try{let c={"Content-Type":"application/json"},e=(0,d.ru)();e&&(c.Authorization=`Bearer ${e}`);let f=(0,d.xe)();f&&(c["x-worker-secret"]=f);let g=await fetch(`${process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000"}/api/worker/process`,{method:"POST",headers:c,cache:"no-store",body:JSON.stringify({source:a,podcastId:b})});if(!g.ok){let a=await g.text();return{success:!1,status:g.status,error:a||`Worker trigger failed with status ${g.status}`}}return{success:!0,status:g.status}}catch(a){return{success:!1,error:a instanceof Error?a.message:String(a)}}}},50071:(a,b,c)=>{let d,e;c.d(b,{Ak:()=>g});var f=c(77598);function g(a=21){var b;b=a|=0,!d||d.length<b?(d=Buffer.allocUnsafe(128*b),f.webcrypto.getRandomValues(d),e=0):e+b>d.length&&(f.webcrypto.getRandomValues(d),e=0),e+=b;let c="";for(let b=e-a;b<e;b++)c+="useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"[63&d[b]];return c}},54287:a=>{a.exports=require("console")},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},57075:a=>{a.exports=require("node:stream")},57975:a=>{a.exports=require("node:util")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73496:a=>{a.exports=require("http2")},73566:a=>{a.exports=require("worker_threads")},74075:a=>{a.exports=require("zlib")},74998:a=>{a.exports=require("perf_hooks")},77598:a=>{a.exports=require("node:crypto")},78474:a=>{a.exports=require("node:events")},79428:a=>{a.exports=require("buffer")},79551:a=>{a.exports=require("url")},81630:a=>{a.exports=require("http")},84297:a=>{a.exports=require("async_hooks")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{a.exports=require("net")},94175:a=>{a.exports=require("stream/web")},94735:a=>{a.exports=require("events")},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};var b=require("../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[4996,1692,9725,7028,7932,7146,9920],()=>b(b.s=27098));module.exports=c})();