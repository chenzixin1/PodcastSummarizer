"use strict";exports.id=2869,exports.ids=[2869],exports.modules={39598:(a,b,c)=>{c.d(b,{Jq:()=>g,h9:()=>h,le:()=>j,v9:()=>l,wD:()=>i,wN:()=>k});var d=c(79725);let e=a=>({podcastId:String(a.podcastId??""),status:String(a.status??"queued"),currentTask:a.currentTask??null,progressCurrent:Number(a.progressCurrent||0),progressTotal:Number(a.progressTotal||0),statusMessage:a.statusMessage||null,attempts:Number(a.attempts||0),workerId:a.workerId||null,lastError:a.lastError||null,createdAt:String(a.createdAt??""),updatedAt:String(a.updatedAt??""),startedAt:a.startedAt||null,finishedAt:a.finishedAt||null});async function f(){await (0,d.ll)`
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
    `;if(0===c.rows.length)return{success:!1,error:"Processing job not found"};return{success:!0,data:e(c.rows[0])}}catch(a){return console.error("failProcessingJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},45099:(a,b,c)=>{c.d(b,{S:()=>e});var d=c(96733);async function e(a,b){try{let c={"Content-Type":"application/json"},e=(0,d.ru)();e&&(c.Authorization=`Bearer ${e}`);let f=(0,d.xe)();f&&(c["x-worker-secret"]=f);let g=await fetch(`${process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000"}/api/worker/process`,{method:"POST",headers:c,cache:"no-store",body:JSON.stringify({source:a,podcastId:b})});if(!g.ok){let a=await g.text();return{success:!1,status:g.status,error:a||`Worker trigger failed with status ${g.status}`}}return{success:!0,status:g.status}}catch(a){return{success:!1,error:a instanceof Error?a.message:String(a)}}}},66431:(a,b,c)=>{c.d(b,{Y:()=>f,j:()=>g});let d=new Set(["untitled"]);function e(a){return"string"!=typeof a?null:a.replace(/\s+/g," ").trim()||null}function f(a){let b=e(a.videoTitle);if(b&&!d.has(b.toLowerCase()))return b;let c=e(a.videoId);return c||"YouTube Transcript"}function g(a){let b=e(function(a){let b=a.trim(),c=b.lastIndexOf(".");return c<=0?b:b.slice(0,c)}(a));return b||"Transcript"}},85578:(a,b,c)=>{c.d(b,{W:()=>n,_:()=>e});let d="https://api.apify.com/v2";class e extends Error{constructor(a,b,c,d){super(c),this.name="ApifyTranscriptError",this.code=a,this.status=b,this.details=d}}function f(a){let b=a;for(let a=0;a<2;a+=1){let a=b;if((b=b.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#39;/g,"'").replace(/&#x([0-9a-fA-F]+);/g,(a,b)=>{let c=Number.parseInt(b,16);if(!Number.isFinite(c))return a;try{return String.fromCodePoint(c)}catch{return a}}).replace(/&#([0-9]+);/g,(a,b)=>{let c=Number.parseInt(b,10);if(!Number.isFinite(c))return a;try{return String.fromCodePoint(c)}catch{return a}}))===a)break}return b}function g(a){return f(a).replace(/\r/g,"").replace(/<[^>]+>/g,"").trim()}function h(a){let b="number"==typeof a?a:Number(a);return Number.isFinite(b)?b:null}function i(a,b){return String(a).padStart(b,"0")}function j(a){let b=Math.round(1e3*(Number.isFinite(a)&&a>=0?a:0)),c=Math.floor(b/36e5),d=Math.floor(b%36e5/6e4),e=Math.floor(b%6e4/1e3);return`${i(c,2)}:${i(d,2)}:${i(e,2)},${i(b%1e3,3)}`}async function k(a,b,c){let f=(process.env.APIFY_YOUTUBE_TRANSCRIPT_ACTOR_ID||"").trim()||"karamelo~youtube-transcripts",g={urls:[a],outputFormat:"textWithTimestamps"};c?.trim()&&(g.preferredLanguage=c.trim());let h=await fetch(`${d}/acts/${encodeURIComponent(f)}/runs`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${b}`},body:JSON.stringify(g),cache:"no-store"});if(!h.ok){let a=null;try{a=function(a){if(!a||"object"!=typeof a)return null;let b=a.error;return("string"==typeof b?.message?b.message.trim():"")||null}(await h.json())}catch{a=null}if(401===h.status)throw new e("APIFY_AUTH_FAILED",401,"APIFY token is invalid.",a||void 0);if(402===h.status)throw new e("APIFY_QUOTA_EXCEEDED",402,"APIFY quota exceeded. Please check billing/credits.",a||void 0);if(400===h.status)throw new e("APIFY_INPUT_INVALID",400,"APIFY request input is invalid.",a||void 0);throw new e("APIFY_FETCH_FAILED",502,"Failed to start APIFY actor run.",a||`http_${h.status}`)}let i=await h.json(),j=i?.data?.id;if(!j)throw new e("APIFY_FETCH_FAILED",502,"APIFY run response missing run ID.");return j}async function l(a,b){let c=Number.parseInt(process.env.APIFY_TRANSCRIPT_TIMEOUT_MS||"",10)||12e4,f=Number.parseInt(process.env.APIFY_TRANSCRIPT_POLL_MS||"",10)||2e3,g=Date.now()+c;for(;Date.now()<g;){let c=await fetch(`${d}/actor-runs/${encodeURIComponent(a)}`,{method:"GET",headers:{Authorization:`Bearer ${b}`},cache:"no-store"});if(!c.ok)throw new e("APIFY_FETCH_FAILED",502,"Failed to query APIFY run status.",`http_${c.status}`);let g=await c.json(),h=String(g?.data?.status||"");if("SUCCEEDED"===h){let a=String(g?.data?.defaultDatasetId||"");if(!a)throw new e("APIFY_RUN_FAILED",502,"APIFY completed but dataset ID is missing.");return a}if(["FAILED","ABORTED","TIMED-OUT"].includes(h))throw new e("APIFY_RUN_FAILED",502,`APIFY actor run failed with status: ${h}.`,g?.data?.statusMessage||void 0);await new Promise(a=>setTimeout(a,f))}throw new e("APIFY_TIMEOUT",504,"Timed out while waiting for APIFY transcript result.")}async function m(a,b){let c=await fetch(`${d}/datasets/${encodeURIComponent(a)}/items`,{method:"GET",headers:{Authorization:`Bearer ${b}`},cache:"no-store"});if(!c.ok)throw new e("APIFY_FETCH_FAILED",502,"Failed to fetch APIFY dataset items.",`http_${c.status}`);let f=await c.json(),g=Array.isArray(f)?f:[];if(0===g.length)throw new e("APIFY_NO_TRANSCRIPT",404,"No transcript was returned for this video.");return g[0]||{}}async function n(a,b){let c=function(a){let b=a.trim();if(/^[A-Za-z0-9_-]{11}$/.test(b))return b;try{let a=new URL(b),c=a.hostname.toLowerCase();if("youtu.be"===c||c.endsWith(".youtu.be")){let b=a.pathname.split("/").filter(Boolean)[0];if(b&&/^[A-Za-z0-9_-]{11}$/.test(b))return b}if(c.includes("youtube.com")||c.includes("youtube-nocookie.com")){let b=a.searchParams.get("v");if(b&&/^[A-Za-z0-9_-]{11}$/.test(b))return b;let c=a.pathname.split("/").filter(Boolean),d=c.findIndex(a=>["shorts","embed","live","v"].includes(a));if(d>=0&&c[d+1]&&/^[A-Za-z0-9_-]{11}$/.test(c[d+1]))return c[d+1]}}catch{}let c=b.match(/(?:v=|be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);if(c?.[1])return c[1];throw new e("INVALID_YOUTUBE_URL",400,"Invalid YouTube URL. Unable to extract video ID.")}(a),d=`https://www.youtube.com/watch?v=${c}`,i=function(){let a=(process.env.APIFY_API_TOKEN||"").trim();if(!a)throw new e("APIFY_NOT_CONFIGURED",503,"APIFY_API_TOKEN is missing on server. Please configure it in Vercel environment variables.");return a}(),n=await k(d,i,b),o=await l(n,i),p=await m(o,i),q=function(a){if(Array.isArray(a)){let b=a.filter(a=>!!a&&"object"==typeof a&&!Array.isArray(a));if(b.length>0){let a=[];for(let c=0;c<b.length;c+=1){let d=b[c],e=b[c+1],f=g(String(d.text||""));if(!f)continue;let i=h(d.start)??0,j=h(d.end),k=h(d.duration),l=e?h(e.start):null,m=j??(null!==k?i+k:null)??l??i+2;Number.isFinite(m)&&m>i||(m=i+2),a.push({startSec:i,endSec:m,text:f})}return a}return a.map(a=>g(String(a||""))).filter(Boolean).map((a,b)=>{let c=2.2*b;return{startSec:c,endSec:c+2,text:a}})}if("string"==typeof a&&a.trim()){if(a.includes("<text start="))return function(a){let b=[];for(let c of[...a.matchAll(/<text start="([^"]*)" dur="([^"]*)">([\s\S]*?)<\/text>/g)]){let a=h(c[1]),d=h(c[2]),e=g(c[3]||"");if(!e||null===a)continue;let f=null!==d&&d>0?d:2;b.push({startSec:a,endSec:a+f,text:e})}return b}(a);let b=g(a);return b?[{startSec:0,endSec:Math.max(2,Math.ceil(b.length/12)),text:b}]:[]}return[]}(p.captions);if(0===q.length)throw new e("APIFY_NO_TRANSCRIPT",404,"Transcript payload is empty for this video.");let r=q.map((a,b)=>`${b+1}
${j(a.startSec)} --> ${j(a.endSec)}
${a.text}`).join("\n\n").trim();if(!r)throw new e("APIFY_NO_TRANSCRIPT",404,"Transcript conversion produced empty SRT content.");return{videoId:c,title:("string"==typeof p.title?f(p.title).trim():"")||void 0,source:"apify_text_with_timestamps",srtContent:r,fullText:q.map(a=>a.text).join(" ").trim(),entries:q.length}}},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};