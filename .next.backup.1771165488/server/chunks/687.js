"use strict";exports.id=687,exports.ids=[687],exports.modules={19491:(a,b,c)=>{c.d(b,{Dh:()=>f,IV:()=>i,Np:()=>h,aD:()=>j,fG:()=>n});var d=c(55511);function e(a,b){let c=Number.parseInt(a||"",10);return!Number.isFinite(c)||c<=0?b:c}function f(a="auto"){let b=process.env.VOLCANO_ACCESS_KEY||process.env.VOLC_ACCESS_KEY||process.env.BYTEDANCE_ACCESS_KEY||process.env.ACCESS_KEY||"";if(!b.trim())throw Error("Volcano ASR is not configured. Set VOLCANO_ACCESS_KEY (or VOLC_ACCESS_KEY).");return{apiKey:b.trim(),submitUrl:process.env.VOLCANO_SUBMIT_URL||"https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",queryUrl:process.env.VOLCANO_QUERY_URL||"https://openspeech.bytedance.com/api/v3/auc/bigmodel/query",resourceId:process.env.VOLCANO_RESOURCE_ID||"volc.bigasr.auc",lang:(process.env.VOLCANO_ASR_LANG||a||"auto").trim()||"auto",maxRetries:e(process.env.VOLCANO_MAX_RETRIES,60),retryDelayMs:e(process.env.VOLCANO_RETRY_DELAY_MS,5e3)}}async function g(a){let b=await a.text();if(!b)return{text:b,data:null};try{return{text:b,data:JSON.parse(b)}}catch{return{text:b,data:null}}}function h(a,b=""){let c=b.toLowerCase();if(c.includes("audio/mpeg"))return"mp3";if(c.includes("audio/wav")||c.includes("audio/x-wav"))return"wav";if(c.includes("audio/mp4"))return"m4a";if(c.includes("audio/aac"))return"aac";if(c.includes("audio/ogg"))return"ogg";if(c.includes("audio/flac"))return"flac";if(c.includes("audio/webm"))return"webm";let d=a.toLowerCase().split(".").pop()||"";return["mp3","wav","m4a","aac","ogg","flac","webm","mp4","opus"].includes(d)?d:"mp3"}async function i(a,b,c,e="auto"){let f=(0,d.randomUUID)(),h={user:{uid:f},audio:{format:b,url:a},request:{model_name:"bigmodel",enable_itn:!0,enable_punc:!0,enable_speaker_info:!0,enable_channel_split:!1,enable_ddc:!1,show_utterances:!0,vad_segment:!0,lang:e||c.lang||"auto",sensitive_words_filter:""}},j=await fetch(c.submitUrl,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":c.apiKey,"X-Api-Resource-Id":c.resourceId,"X-Api-Request-Id":f,"X-Api-Sequence":"-1"},body:JSON.stringify(h)}),{text:k,data:l}=await g(j),m=j.headers.get("x-api-status-code")||"",n=j.headers.get("x-api-message")||"";if(!j.ok)throw Error(`Volcano submit API failed (${j.status}): ${k||j.statusText}`);if(m&&"20000000"!==m&&!l?.result)throw Error(`Volcano submit rejected request (status code ${m||"unknown"}): ${n||k}`);return f}async function j(a,b){let c=await fetch(b.queryUrl,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":b.apiKey,"X-Api-Resource-Id":b.resourceId,"X-Api-Request-Id":a},body:JSON.stringify({})});if(429===c.status||503===c.status)return{done:!1};let{text:d,data:e}=await g(c),f=c.headers.get("x-api-status-code")||"",h=c.headers.get("x-api-message")||"";if(!c.ok)return{done:!0,fatalError:`Volcano query API failed (${c.status}): ${d||c.statusText}`};if(f.startsWith("45"))return{done:!0,fatalError:`Volcano query returned client error ${f}: ${h||d}`};if(f.startsWith("55"))return{done:!1};let i=function(a){let b=a?.result||{},c="string"==typeof b?.text?b.text.trim():"",d=Array.isArray(b?.utterances)?b.utterances:[];return c||d.length>0?{success:!0,complete:!0}:"FAILED"===("string"==typeof a?.status?a.status.toUpperCase():"")?{success:!1,complete:!0,fatalError:a?.message||"Volcano task failed."}:{success:!1,complete:!1}}(e);return i.complete&&i.success?{done:!0,data:e||void 0}:i.complete&&!i.success?{done:!0,fatalError:i.fatalError||"Volcano task failed."}:["20000001","20000002",""].includes(f)||"20000000"===f?{done:!1}:{done:!0,fatalError:`Volcano query returned unexpected status ${f}: ${h||d}`}}function k(a){return a.replace(/\s+/g," ").trim()}function l(a){let b=Math.max(0,Number.isFinite(a)?a:0),c=Math.floor(b/3600),d=Math.floor(b%3600/60),e=Math.floor(b%60),f=Math.floor((b-Math.floor(b))*1e3);return`${String(c).padStart(2,"0")}:${String(d).padStart(2,"0")}:${String(e).padStart(2,"0")},${String(f).padStart(3,"0")}`}function m(a){return a.map((a,b)=>{let c=l(a.startSec),d=l(a.startSec+Math.max(.2,a.durationSec));return`${b+1}
${c} --> ${d}
${a.text}`}).join("\n\n")}function n(a){let b=a?.result||{},c=Array.isArray(b?.utterances)?b.utterances:[];if(c.length>0){let a=c.map(a=>{let b=k(String(a?.text||""));if(!b)return null;let c=Number(a?.start_time||0)/1e3;return{startSec:c,durationSec:Math.max(.2,Number(a?.end_time||0)/1e3-c),text:b}}).filter(a=>!!a);if(a.length>0)return m(a)}let d=k(String(b?.text||""));if(!d)throw Error("Volcano transcription completed but returned empty text.");return m([{startSec:0,durationSec:Math.max(2,Math.ceil(d.length/10)),text:d}])}},35714:(a,b,c)=>{c.d(b,{Q$:()=>m,Ue:()=>k,_c:()=>l,w_:()=>n,yx:()=>g});var d=c(7028),e=c(55511),f=c(68941);class g extends Error{constructor(a,b,c){super(c),this.name="ExtensionAuthError",this.code=a,this.status=b}}function h(a){return Buffer.from(a).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function i(){let a=(process.env.EXTENSION_TOKEN_SECRET||process.env.NEXTAUTH_SECRET||"").trim();if(!a)throw new g("TOKEN_SECRET_MISSING",503,"Extension token secret is not configured.");return a}function j(a,b){return h((0,e.createHmac)("sha256",b).update(a).digest())}function k(a){if(!a)return null;let[b,c]=a.trim().split(/\s+/);return b&&c&&"bearer"===b.toLowerCase()?c:null}function l(a){let b=i(),c=Math.floor(Date.now()/1e3),d=function(){let a=Number.parseInt(process.env.EXTENSION_TOKEN_TTL_SECONDS||"",10);return!Number.isFinite(a)||a<=0?604800:a}(),e={uid:a.id,email:a.email,iat:c,exp:c+d},f=h(JSON.stringify({alg:"HS256",typ:"JWT"})),g=h(JSON.stringify(e)),k=`${f}.${g}`,l=j(k,b);return{accessToken:`${k}.${l}`,expiresIn:d}}function m(a){let b,c=i(),d=a.split(".");if(3!==d.length)throw new g("INVALID_TOKEN",401,"Invalid extension token format.");let[f,h,k]=d;if(!function(a,b){let c=Buffer.from(a),d=Buffer.from(b);return c.length===d.length&&(0,e.timingSafeEqual)(c,d)}(k,j(`${f}.${h}`,c)))throw new g("INVALID_TOKEN_SIGNATURE",401,"Invalid extension token signature.");try{b=JSON.parse(function(a){let b=a.replace(/-/g,"+").replace(/_/g,"/"),c=(4-b.length%4)%4,d=b+"=".repeat(c);return Buffer.from(d,"base64").toString("utf8")}(h))}catch{throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload.")}if(!b?.uid||!b?.email||!b?.exp)throw new g("INVALID_TOKEN_PAYLOAD",401,"Invalid extension token payload fields.");let l=Math.floor(Date.now()/1e3);if(b.exp<=l)throw new g("TOKEN_EXPIRED",401,"Extension token has expired.");return{id:b.uid,email:b.email,name:b.email}}async function n(a,b){let c=a.trim();if(!c||!b)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let e=await (0,f.ht)(c);if(!e.success)throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");let h=e.data;if(!h?.id||!h?.email||!h?.password_hash||!await d.Ay.compare(b,h.password_hash))throw new g("INVALID_CREDENTIALS",401,"Invalid email or password.");return{id:h.id,email:h.email,name:h.name||h.email}}},50071:(a,b,c)=>{let d,e;c.d(b,{Ak:()=>g});var f=c(77598);function g(a=21){var b;b=a|=0,!d||d.length<b?(d=Buffer.allocUnsafe(128*b),f.webcrypto.getRandomValues(d),e=0):e+b>d.length&&(f.webcrypto.getRandomValues(d),e=0),e+=b;let c="";for(let b=e-a;b<e;b++)c+="useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"[63&d[b]];return c}},98338:(a,b,c)=>{c.d(b,{$5:()=>g,R7:()=>k,eb:()=>i,hy:()=>h,jC:()=>j,uv:()=>l});var d=c(79725),e=c(68941);let f=a=>({id:String(a.id||""),userId:String(a.userId||""),status:String(a.status||"submitted"),providerTaskId:a.providerTaskId||null,podcastId:a.podcastId||null,audioBlobUrl:a.audioBlobUrl||null,sourceReference:a.sourceReference||null,originalFileName:a.originalFileName||null,title:a.title||null,videoId:a.videoId||null,isPublic:!!a.isPublic,error:a.error||null,createdAt:String(a.createdAt||""),updatedAt:String(a.updatedAt||"")});async function g(a){try{await (0,e.Ep)();let b=await (0,d.ll)`
      INSERT INTO extension_transcription_jobs (
        id,
        user_id,
        status,
        provider_task_id,
        podcast_id,
        audio_blob_url,
        source_reference,
        original_file_name,
        title,
        video_id,
        is_public,
        error
      )
      VALUES (
        ${a.id},
        ${a.userId},
        ${a.status},
        ${a.providerTaskId??null},
        ${a.podcastId??null},
        ${a.audioBlobUrl??null},
        ${a.sourceReference??null},
        ${a.originalFileName??null},
        ${a.title??null},
        ${a.videoId??null},
        ${!!a.isPublic},
        ${a.error??null}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        status = EXCLUDED.status,
        provider_task_id = EXCLUDED.provider_task_id,
        podcast_id = EXCLUDED.podcast_id,
        audio_blob_url = EXCLUDED.audio_blob_url,
        source_reference = EXCLUDED.source_reference,
        original_file_name = EXCLUDED.original_file_name,
        title = EXCLUDED.title,
        video_id = EXCLUDED.video_id,
        is_public = EXCLUDED.is_public,
        error = EXCLUDED.error,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;if(0===b.rows.length)return{success:!1,error:"Failed to create extension transcription job"};return{success:!0,data:f(b.rows[0])}}catch(a){return console.error("createExtensionTranscriptionJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function h(a,b){try{await (0,e.Ep)();let c=await (0,d.ll)`
      SELECT
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_transcription_jobs
      WHERE id = ${a} AND user_id = ${b}
      LIMIT 1
    `;if(0===c.rows.length)return{success:!1,data:null,error:"Extension transcription job not found"};return{success:!0,data:f(c.rows[0])}}catch(a){return console.error("getExtensionTranscriptionJobForUser failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function i(a,b,c,g){try{await (0,e.Ep)();let h=await (0,d.ll)`
      UPDATE extension_transcription_jobs
      SET
        status = 'transcribing',
        provider_task_id = ${c},
        audio_blob_url = ${g},
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${a} AND user_id = ${b}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;if(0===h.rows.length)return{success:!1,data:null,error:"Extension transcription job not found"};return{success:!0,data:f(h.rows[0])}}catch(a){return console.error("updateExtensionTranscriptionJobTranscribing failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function j(a,b,c){try{await (0,e.Ep)();let g=await (0,d.ll)`
      UPDATE extension_transcription_jobs
      SET
        status = 'failed',
        error = ${c.slice(0,4096)},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${a} AND user_id = ${b}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;if(0===g.rows.length)return{success:!1,data:null,error:"Extension transcription job not found"};return{success:!0,data:f(g.rows[0])}}catch(a){return console.error("updateExtensionTranscriptionJobFailed failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function k(a,b,c){try{await (0,e.Ep)();let g=await (0,d.ll)`
      UPDATE extension_transcription_jobs
      SET
        status = 'completed',
        podcast_id = ${c},
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${a} AND user_id = ${b}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;if(0===g.rows.length)return{success:!1,data:null,error:"Extension transcription job not found"};return{success:!0,data:f(g.rows[0])}}catch(a){return console.error("updateExtensionTranscriptionJobCompleted failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function l(a,b){try{await (0,e.Ep)();let c=await (0,d.ll)`
      UPDATE extension_transcription_jobs
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ${a} AND user_id = ${b}
      RETURNING
        id,
        user_id as "userId",
        status,
        provider_task_id as "providerTaskId",
        podcast_id as "podcastId",
        audio_blob_url as "audioBlobUrl",
        source_reference as "sourceReference",
        original_file_name as "originalFileName",
        title,
        video_id as "videoId",
        is_public as "isPublic",
        error,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;if(0===c.rows.length)return{success:!1,data:null,error:"Extension transcription job not found"};return{success:!0,data:f(c.rows[0])}}catch(a){return console.error("touchExtensionTranscriptionJob failed:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}}};