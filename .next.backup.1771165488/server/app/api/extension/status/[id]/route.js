"use strict";(()=>{var a={};a.id=4164,a.ids=[4164],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{a.exports=require("os")},27910:a=>{a.exports=require("stream")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},34631:a=>{a.exports=require("tls")},35714:(a,b,c)=>{c.d(b,{Q$:()=>m,Ue:()=>k,_c:()=>l,w_:()=>n,yx:()=>g});var d=c(7028),e=c(55511),f=c(68941);class g extends Error{constructor(a,b,c){super(c),this.name="ExtensionAuthError",this.code=a,this.status=b}}function h(a){return Buffer.from(a).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function i(){let a=(process.env.EXTENSION_TOKEN_SECRET||process.env.NEXTAUTH_SECRET||"").trim();if(!a)throw new g("TOKEN_SECRET_MISSING",503,"Extension token secret is not configured.");return a}function j(a,b){return h((0,e.createHmac)("sha256",b).update(a).digest())}function k(a){if(!a)return null;let[b,c]=a.trim().split(/\s+/);return b&&c&&"bearer"===b.toLowerCase()?c:null}function l(a){let b=i(),c=Math.floor(Date.now()/1e3),d=function(){let a=Number.parseInt(process.env.EXTENSION_TOKEN_TTL_SECONDS||"",10);return!Number.isFinite(a)||a<=0?604800:a}(),e={uid:a.id,email:a.email,iat:c,exp:c+d},f=h(JSON.stringify({alg:"HS256",typ:"JWT"})),g=h(JSON.stringify(e)),k=`${f}.${g}`,l=j(k,b);return{accessToken:`${k}.${l}`,expiresIn:d}}function m(a){let b,c=i(),d=a.split(".");if(3!==d.length)throw new g("INVALID_TOKEN",401,"Invalid extension token format.");let[f,h,k]=d;if(!function(a,b){let c=Buffer.from(a),d=Buffer.from(b);return c.length===d.length&&(0,e.timingSafeEqual)(c,d)}(k,j(`${f}.${h}`,c)))throw new g("INVALID_TOKEN_SIGNATURE",401,"Invalid extension token signature.");try{b=JSON.parse(function(a){let b=a.replace(/-/g,"+").replace(/_/g,"/"),c=(4-b.length%4)%4,d=b+"=".repeat(c);return Buffer.from(d,"base64").toString("utf8")}(h))}catch{throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload.")}if(!b?.uid||!b?.email||!b?.exp)throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload fields.");let l=Math.floor(Date.now()/1e3);if(b.exp<=l)throw new g("TOKEN_EXPIRED",401,"Extension token has expired.");return{id:b.uid,email:b.email,name:b.email}}async function n(a,b){let c=a.trim();if(!c||!b)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let e=await (0,f.ht)(c);if(!e.success)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let h=e.data;if(!h?.id||!h?.email||!h?.password_hash||!await d.Ay.compare(b,h.password_hash))throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");return{id:h.id,email:h.email,name:h.name||h.email}}},39598:(a,b,c)=>{c.d(b,{Jq:()=>g,h9:()=>h,le:()=>j,v9:()=>l,wD:()=>i,wN:()=>k});var d=c(79725);let e=a=>({podcastId:String(a.podcastId??""),status:String(a.status??"queued"),currentTask:a.currentTask??null,progressCurrent:Number(a.progressCurrent||0),progressTotal:Number(a.progressTotal||0),statusMessage:a.statusMessage||null,attempts:Number(a.attempts||0),workerId:a.workerId||null,lastError:a.lastError||null,createdAt:String(a.createdAt??""),updatedAt:String(a.updatedAt??""),startedAt:a.startedAt||null,finishedAt:a.finishedAt||null});async function f(){await (0,d.ll)`
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
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("failProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},45099:(a,b,c)=>{c.d(b,{S:()=>e});var d=c(96733);async function e(a,b){try{let c={"Content-Type":"application/json"},e=(0,d.ru)();e&&(c.Authorization=`Bearer ${e}`);let f=(0,d.xe)();f&&(c["x-worker-secret"]=f);let g=await fetch(`${process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000"}/api/worker/process`,{method:"POST",headers:c,cache:"no-store",body:JSON.stringify({source:a,podcastId:b})});if(!g.ok){let a=await g.text();return{success:!1,status:g.status,error:a||`Worker trigger failed with status ${g.status}`}}return{success:!0,status:g.status}}catch(a){return{success:!1,error:a instanceof Error?a.message:String(a)}}}},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},74075:a=>{a.exports=require("zlib")},79428:a=>{a.exports=require("buffer")},79551:a=>{a.exports=require("url")},80911:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>H,patchFetch:()=>G,routeModule:()=>C,serverHooks:()=>F,workAsyncStorage:()=>D,workUnitAsyncStorage:()=>E});var d={};c.r(d),c.d(d,{GET:()=>B,runtime:()=>A});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641),v=c(35714),w=c(59920),x=c(68941),y=c(39598),z=c(45099);let A="nodejs";async function B(a,b){let c="/api/extension/status/:id",d=null;try{let e=(0,v.Ue)(a.headers.get("authorization"));if(!e)return u.NextResponse.json({success:!1,code:"AUTH_REQUIRED",error:"Missing Bearer token."},{status:401});let f=(0,v.Q$)(e),{id:g}=await b.params;if(!g)return u.NextResponse.json({success:!1,code:"INVALID_ID",error:"Missing podcast id."},{status:400});let h=await (0,x.rL)(g);if(!h.success)return u.NextResponse.json({success:!1,code:"NOT_FOUND",error:"Podcast not found."},{status:404});let i=h.data;if(!i.userId||i.userId!==f.id)return u.NextResponse.json({success:!1,code:"FORBIDDEN",error:"Access denied."},{status:403});let j=await (0,y.h9)(g),k=j.success?j.data:null;(function(a){if(!a||!a.status)return!1;let b="queued"===a.status,c="processing"===a.status;if(!b&&!c)return!1;if(!a.updatedAt)return!0;let d=new Date(a.updatedAt).getTime();if(!Number.isFinite(d))return!0;let e=Date.now()-d;return b?e>8e3:e>12e4})(k)&&(0,u.after)(async()=>{let a=await (0,z.S)("analysis_poll",g);a.success||console.error("[EXTENSION_STATUS] Failed to trigger worker:",a.error)});let l=await (0,x.VM)(g),m=l.success?l.data:null,n=k?.status||(m?"completed":"queued"),o=function(a,b){if(!a)return!1;let c=function(a){let b=String(a||"").trim();if(!b)return{zh:"",en:""};let c=b.search(/#\s*English Summary/i),d=b.search(/#\s*中文总结/i);return c>=0&&d>c?{en:b.slice(c,d).trim(),zh:b.slice(d).trim()}:d>=0?{en:b.slice(0,d).trim(),zh:b.slice(d).trim()}:{zh:b,en:""}}(String(a.summary||"")),d=(a.summaryZh||c.zh||a.summary||"").trim(),e=(a.summaryEn||c.en||"").trim();return!!(d&&e&&(a.highlights||"").trim())&&(!b||"completed"===b)}(m,k?.status||null),p=await (0,w.R8)(g);if((d=p?.id||null)&&p){let a="failed"===n?"failed":"completed"===n?"completed":"processing"===n?"processing":"queued",b="failed"===n?"processing_failed":"completed"===n?"processing_completed":"processing"===n?"processing_running":"processing_queued";(p.status!==a||p.stage!==b||"failed"===n&&(p.lastErrorMessage||"")!==String(k?.lastError||"Analysis failed."))&&(await (0,w.kl)(d,{status:a,stage:b,podcastId:g,lastErrorCode:"failed"===n?"ANALYSIS_FAILED":void 0,lastErrorMessage:"failed"===n?String(k?.lastError||"Analysis failed."):void 0,lastHttpStatus:"failed"===n?200:void 0,clearError:"failed"!==n}),await (0,w.RB)({taskId:d,level:"failed"===n?"error":"info",stage:b,endpoint:c,message:"failed"===n?String(k?.lastError||"Analysis failed."):`Analysis status is ${n}.`,meta:{podcastId:g,processingStatus:k?.status||null,processingMessage:k?.statusMessage||null,isProcessed:o}}))}return u.NextResponse.json({success:!0,data:{podcastId:g,status:n,isProcessed:o,statusMessage:k?.statusMessage||null,lastError:k?.lastError||null,dashboardUrl:`${function(a){let b=(process.env.NEXTAUTH_URL||process.env.NEXT_PUBLIC_APP_URL||"").trim();if(b)return b.replace(/\/+$/g,"");let c=(a.headers.get("origin")||"").trim();if(c)return c.replace(/\/+$/g,"");let d=a.headers.get("x-forwarded-host")||a.headers.get("host"),e=a.headers.get("x-forwarded-proto")||"https";return d?`${e}://${d}`:"https://podsum.cc"}(a)}/dashboard/${g}`,monitorTaskId:d}})}catch(a){if(d&&(await (0,w.kl)(d,{status:"failed",stage:"failed",lastErrorCode:a instanceof v.yx?a.code:"STATUS_FAILED",lastErrorMessage:a instanceof Error?a.message:String(a),lastHttpStatus:a instanceof v.yx?a.status:500}).catch(a=>{console.error("[EXT_MON] failed to update monitor task:",a)}),await (0,w.RB)({taskId:d,level:"error",stage:"failed",endpoint:c,httpStatus:a instanceof v.yx?a.status:500,message:a instanceof Error?a.message:String(a),errorStack:a instanceof Error&&a.stack||null}).catch(a=>{console.error("[EXT_MON] failed to record monitor event:",a)})),a instanceof v.yx)return u.NextResponse.json({success:!1,code:a.code,error:a.message},{status:a.status});return u.NextResponse.json({success:!1,code:"STATUS_FAILED",error:"Failed to fetch extension task status.",details:a instanceof Error?a.message:String(a)},{status:500})}}let C=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/extension/status/[id]/route",pathname:"/api/extension/status/[id]",filename:"route",bundlePath:"app/api/extension/status/[id]/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/chenzixin/projects/PodcastSummarizer/app/api/extension/status/[id]/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:D,workUnitAsyncStorage:E,serverHooks:F}=C;function G(){return(0,g.patchFetch)({workAsyncStorage:D,workUnitAsyncStorage:E})}async function H(a,b,c){var d;let e="/api/extension/status/[id]/route";"/index"===e&&(e="/");let g=await C.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||C.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===C.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>C.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>C.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await C.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await C.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await C.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},81630:a=>{a.exports=require("http")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{a.exports=require("net")},94735:a=>{a.exports=require("events")},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};var b=require("../../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[4996,1692,9725,7028,7146,9920],()=>b(b.s=80911));module.exports=c})();