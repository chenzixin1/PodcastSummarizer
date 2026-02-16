"use strict";(()=>{var a={};a.id=4210,a.ids=[4210],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},11723:a=>{a.exports=require("querystring")},12412:a=>{a.exports=require("assert")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{a.exports=require("os")},27910:a=>{a.exports=require("stream")},28354:a=>{a.exports=require("util")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},34631:a=>{a.exports=require("tls")},39598:(a,b,c)=>{c.d(b,{Jq:()=>g,h9:()=>h,le:()=>j,v9:()=>l,wD:()=>i,wN:()=>k});var d=c(79725);let e=a=>({podcastId:String(a.podcastId??""),status:String(a.status??"queued"),currentTask:a.currentTask??null,progressCurrent:Number(a.progressCurrent||0),progressTotal:Number(a.progressTotal||0),statusMessage:a.statusMessage||null,attempts:Number(a.attempts||0),workerId:a.workerId||null,lastError:a.lastError||null,createdAt:String(a.createdAt??""),updatedAt:String(a.updatedAt??""),startedAt:a.startedAt||null,finishedAt:a.finishedAt||null});async function f(){await (0,d.ll)`
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
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("failProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},45099:(a,b,c)=>{c.d(b,{S:()=>e});var d=c(96733);async function e(a,b){try{let c={"Content-Type":"application/json"},e=(0,d.ru)();e&&(c.Authorization=`Bearer ${e}`);let f=(0,d.xe)();f&&(c["x-worker-secret"]=f);let g=await fetch(`${process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000"}/api/worker/process`,{method:"POST",headers:c,cache:"no-store",body:JSON.stringify({source:a,podcastId:b})});if(!g.ok){let a=await g.text();return{success:!1,status:g.status,error:a||`Worker trigger failed with status ${g.status}`}}return{success:!0,status:g.status}}catch(a){return{success:!1,error:a instanceof Error?a.message:String(a)}}}},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},66147:(a,b,c)=>{c.d(b,{N:()=>k});var d=c(52963),e=c.n(d),f=c(28120),g=c(75783),h=c(7028),i=c(79725),j=c(50071);let k={providers:[...process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET?[(0,g.A)({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET})]:[],(0,f.A)({name:"credentials",credentials:{email:{label:"Email",type:"email"},password:{label:"Password",type:"password"}},async authorize(a){if(!a?.email||!a?.password)return null;try{let b=await (0,i.ll)`
            SELECT id, email, password_hash, name, created_at 
            FROM users 
            WHERE email = ${a.email}
          `;if(0===b.rows.length)return null;let c=b.rows[0];if(!await h.Ay.compare(a.password,c.password_hash))return null;return{id:c.id,email:c.email,name:c.name}}catch(a){return console.error("Auth error:",a),null}}})],session:{strategy:"jwt"},pages:{signIn:"/auth/signin"},secret:process.env.NEXTAUTH_SECRET||"development-secret-key",callbacks:{async signIn({user:a,account:b,profile:c}){if(b?.provider==="google")try{let b=await (0,i.ll)`
            SELECT id FROM users WHERE email = ${a.email}
          `;if(0===b.rows.length){let b=(0,j.Ak)();await (0,i.ll)`
              INSERT INTO users (id, email, name, password_hash, created_at)
              VALUES (${b}, ${a.email}, ${a.name||a.email}, '', NOW())
            `,a.id=b}else a.id=b.rows[0].id}catch(a){return console.error("Google sign in error:",a),!1}return!0},jwt:async({token:a,user:b})=>(b&&(a.id=b.id),a),session:async({session:a,token:b})=>(b&&(a.user.id=b.id),a)}};e()(k)},74075:a=>{a.exports=require("zlib")},77598:a=>{a.exports=require("node:crypto")},79428:a=>{a.exports=require("buffer")},79551:a=>{a.exports=require("url")},81630:a=>{a.exports=require("http")},83879:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>G,patchFetch:()=>F,routeModule:()=>B,serverHooks:()=>E,workAsyncStorage:()=>C,workUnitAsyncStorage:()=>D});var d={};c.r(d),c.d(d,{GET:()=>A});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641),v=c(68941),w=c(39598),x=c(1093),y=c(66147),z=c(45099);async function A(a,b){try{let{id:a}=await b.params;if(!a)return u.NextResponse.json({error:"Missing ID parameter"},{status:400});console.log(`获取分析结果 API 调用，ID: ${a}`);let c=await (0,v.rL)(a);if(!c.success)return console.log(`播客不存在，ID: ${a}`),u.NextResponse.json({error:"Podcast not found"},{status:404});let d=c.data,e=await (0,x.getServerSession)(y.N);if(!d.isPublic){if(!e?.user?.id)return u.NextResponse.json({error:"Authentication required"},{status:401});if(!(await (0,v.Pr)(a,e.user.id)).success)return u.NextResponse.json({error:"Access denied"},{status:403})}let f=await (0,w.h9)(a),g=f.success?f.data:null;(function(a){if(!a||!a.status)return!1;let b="queued"===a.status,c="processing"===a.status;if(!b&&!c)return!1;if(!a.updatedAt)return!0;let d=new Date(a.updatedAt).getTime();if(!Number.isFinite(d))return!0;let e=Date.now()-d;return b?e>8e3:e>12e4})(g)&&(0,u.after)(async()=>{let b=await (0,z.S)("analysis_poll",a);b.success||console.error("Failed to trigger worker from analysis poll:",b.error)});let h=await (0,v.VM)(a);if(!h.success)return console.log(`分析结果不存在，ID: ${a}`),u.NextResponse.json({success:!0,data:{podcast:c.data,analysis:null,isProcessed:!1,processingJob:g,canEdit:e?.user?.id===d.userId}});let i=h.data||null,j=function(a,b){if(!a)return!1;let c=function(a){let b=String(a||"").trim();if(!b)return{zh:"",en:""};let c=b.search(/#\s*English Summary/i),d=b.search(/#\s*中文总结/i);return c>=0&&d>c?{en:b.slice(c,d).trim(),zh:b.slice(d).trim()}:d>=0?{en:b.slice(0,d).trim(),zh:b.slice(d).trim()}:{zh:b,en:""}}(String(a.summary||"")),d=(a.summaryZh||c.zh||a.summary||"").trim(),e=(a.summaryEn||c.en||"").trim();return!!(d&&e&&(a.highlights||"").trim())&&(!b||"completed"===b)}(i,g?.status||null);return console.log(`成功获取分析结果，ID: ${a}`),u.NextResponse.json({success:!0,data:{podcast:c.data,analysis:i,isProcessed:j,processingJob:g,canEdit:e?.user?.id===d.userId}})}catch(a){return console.error("获取分析结果失败:",a),u.NextResponse.json({success:!1,error:a instanceof Error?a.message:"Unknown error"},{status:500})}}let B=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/analysis/[id]/route",pathname:"/api/analysis/[id]",filename:"route",bundlePath:"app/api/analysis/[id]/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/chenzixin/projects/PodcastSummarizer/app/api/analysis/[id]/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:C,workUnitAsyncStorage:D,serverHooks:E}=B;function F(){return(0,g.patchFetch)({workAsyncStorage:C,workUnitAsyncStorage:D})}async function G(a,b,c){var d;let e="/api/analysis/[id]/route";"/index"===e&&(e="/");let g=await B.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:C,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||B.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===B.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>B.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>B.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await B.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await B.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await B.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{a.exports=require("net")},94735:a=>{a.exports=require("events")},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};var b=require("../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[4996,1692,9725,7028,5106,7146],()=>b(b.s=83879));module.exports=c})();