"use strict";exports.id=9920,exports.ids=[9920],exports.modules={59920:(a,b,c)=>{c.d(b,{H3:()=>v,R8:()=>u,RB:()=>s,e3:()=>A,el:()=>z,hY:()=>q,k_:()=>t,kl:()=>r,pc:()=>j,zD:()=>i});var d=c(79725),e=c(55511),f=c(68941);let g=0;function h(a,b){if(!a)return b;let c=a.trim().toLowerCase();return"1"===c||"true"===c||"yes"===c||"on"===c||"0"!==c&&"false"!==c&&"no"!==c&&"off"!==c&&b}function i(){return h(process.env.EXTENSION_MONITOR_ENABLED,!1)}function j(){return h(process.env.EXTENSION_MONITOR_CAPTURE_RAW,!1)}function k(a,b=4096){let c=String(a||"").trim();return c?c.slice(0,b):null}function l(a){if(null==a)return null;let b=function(a){if(null==a)return null;try{return JSON.stringify(a)}catch(a){return JSON.stringify({__non_serializable__:!0,error:a instanceof Error?a.message:String(a)})}}(function a(b){if(Array.isArray(b))return b.map(b=>a(b));if(!b||"object"!=typeof b)return b;let c={};for(let[d,e]of Object.entries(b)){let b=d.toLowerCase();if("password"===b||"pass"===b||"pwd"===b){c[d]="***";continue}c[d]=a(e)}return c}(a));return b?b.length>2e5?JSON.stringify({__truncated__:!0,bytes:b.length,preview:b.slice(0,2e5)}):b:null}function m(a){return{id:String(a.id||""),path:"path2"===String(a.path||"path1")?"path2":"path1",status:String(a.status||"received"),stage:String(a.stage||""),userId:a.userId||null,userEmail:a.userEmail||null,clientTaskId:a.clientTaskId||null,traceId:a.traceId||null,sourceReference:a.sourceReference||null,videoId:a.videoId||null,title:a.title||null,isPublic:!!a.isPublic,transcriptionJobId:a.transcriptionJobId||null,podcastId:a.podcastId||null,providerTaskId:a.providerTaskId||null,lastErrorCode:a.lastErrorCode||null,lastErrorMessage:a.lastErrorMessage||null,lastHttpStatus:a.lastHttpStatus?Number(a.lastHttpStatus):null,createdAt:String(a.createdAt||""),updatedAt:String(a.updatedAt||"")}}function n(a){return{id:Number(a.id||0),taskId:String(a.taskId||""),level:String(a.level||"info"),stage:String(a.stage||""),endpoint:a.endpoint||null,httpStatus:a.httpStatus?Number(a.httpStatus):null,message:a.message||null,requestHeaders:a.requestHeaders||null,requestBody:a.requestBody||null,responseHeaders:a.responseHeaders||null,responseBody:a.responseBody||null,errorStack:a.errorStack||null,meta:a.meta||null,createdAt:String(a.createdAt||"")}}async function o(){return!!i()&&(await (0,f.$Q)(),!0)}async function p(){if(!await o())return;let a=Date.now();if(a-g<6e5)return;g=a;let b=function(){let a=Number.parseInt(process.env.EXTENSION_MONITOR_RETENTION_DAYS||"",10);return!Number.isFinite(a)||a<=0?3:a}();await (0,d.ll)`
    DELETE FROM extension_monitor_events
    WHERE created_at < NOW() - (${b} * INTERVAL '1 day')
  `,await (0,d.ll)`
    DELETE FROM extension_monitor_tasks
    WHERE created_at < NOW() - (${b} * INTERVAL '1 day')
  `}async function q(a){if(!await o())return null;let b=a.id||(0,e.randomUUID)(),c=await (0,d.ll)`
    INSERT INTO extension_monitor_tasks (
      id,
      path,
      status,
      stage,
      user_id,
      user_email,
      client_task_id,
      trace_id,
      source_reference,
      video_id,
      title,
      is_public,
      transcription_job_id,
      podcast_id,
      provider_task_id,
      last_error_code,
      last_error_message,
      last_http_status
    )
    VALUES (
      ${b},
      ${a.path},
      ${a.status},
      ${a.stage},
      ${a.userId??null},
      ${k(a.userEmail)},
      ${k(a.clientTaskId)},
      ${k(a.traceId)},
      ${k(a.sourceReference,1024)},
      ${k(a.videoId,128)},
      ${k(a.title,512)},
      ${!!a.isPublic},
      ${k(a.transcriptionJobId)},
      ${k(a.podcastId)},
      ${k(a.providerTaskId)},
      ${k(a.lastErrorCode,128)},
      ${k(a.lastErrorMessage)},
      ${"number"==typeof a.lastHttpStatus?a.lastHttpStatus:null}
    )
    ON CONFLICT (id)
    DO UPDATE SET
      status = EXCLUDED.status,
      stage = EXCLUDED.stage,
      user_id = COALESCE(EXCLUDED.user_id, extension_monitor_tasks.user_id),
      user_email = COALESCE(EXCLUDED.user_email, extension_monitor_tasks.user_email),
      client_task_id = COALESCE(EXCLUDED.client_task_id, extension_monitor_tasks.client_task_id),
      trace_id = COALESCE(EXCLUDED.trace_id, extension_monitor_tasks.trace_id),
      source_reference = COALESCE(EXCLUDED.source_reference, extension_monitor_tasks.source_reference),
      video_id = COALESCE(EXCLUDED.video_id, extension_monitor_tasks.video_id),
      title = COALESCE(EXCLUDED.title, extension_monitor_tasks.title),
      is_public = EXCLUDED.is_public,
      transcription_job_id = COALESCE(EXCLUDED.transcription_job_id, extension_monitor_tasks.transcription_job_id),
      podcast_id = COALESCE(EXCLUDED.podcast_id, extension_monitor_tasks.podcast_id),
      provider_task_id = COALESCE(EXCLUDED.provider_task_id, extension_monitor_tasks.provider_task_id),
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      last_http_status = EXCLUDED.last_http_status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;return(await p().catch(a=>{console.error("[EXT_MON] cleanup failed:",a)}),c.rows.length)?m(c.rows[0]):null}async function r(a,b){if(!a||!await o())return null;let c=!!b.clearError,e=await (0,d.ll)`
    UPDATE extension_monitor_tasks
    SET
      status = COALESCE(${b.status??null}, status),
      stage = COALESCE(${b.stage??null}, stage),
      user_email = COALESCE(${k(b.userEmail)} , user_email),
      client_task_id = COALESCE(${k(b.clientTaskId)} , client_task_id),
      trace_id = COALESCE(${k(b.traceId)} , trace_id),
      source_reference = COALESCE(${k(b.sourceReference,1024)} , source_reference),
      video_id = COALESCE(${k(b.videoId,128)} , video_id),
      title = COALESCE(${k(b.title,512)} , title),
      is_public = COALESCE(${"boolean"==typeof b.isPublic?b.isPublic:null}, is_public),
      transcription_job_id = COALESCE(${k(b.transcriptionJobId)} , transcription_job_id),
      podcast_id = COALESCE(${k(b.podcastId)} , podcast_id),
      provider_task_id = COALESCE(${k(b.providerTaskId)} , provider_task_id),
      last_error_code =
        CASE
          WHEN ${c} THEN NULL
          ELSE COALESCE(${k(b.lastErrorCode,128)}, last_error_code)
        END,
      last_error_message =
        CASE
          WHEN ${c} THEN NULL
          ELSE COALESCE(${k(b.lastErrorMessage)}, last_error_message)
        END,
      last_http_status =
        CASE
          WHEN ${c} THEN NULL
          ELSE COALESCE(${"number"==typeof b.lastHttpStatus?b.lastHttpStatus:null}, last_http_status)
        END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${a}
    RETURNING
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;return e.rows.length?m(e.rows[0]):null}async function s(a){if(!a.taskId||!await o())return null;let b=j(),c=b?l(a.requestHeaders):null,e=b?l(a.requestBody):null,f=b?l(a.responseHeaders):null,g=b?l(a.responseBody):null,h=l(a.meta),i=await (0,d.ll)`
    INSERT INTO extension_monitor_events (
      task_id,
      level,
      stage,
      endpoint,
      http_status,
      message,
      request_headers,
      request_body,
      response_headers,
      response_body,
      error_stack,
      meta
    )
    VALUES (
      ${a.taskId},
      ${a.level||"info"},
      ${a.stage},
      ${k(a.endpoint,256)},
      ${"number"==typeof a.httpStatus?a.httpStatus:null},
      ${k(a.message)},
      ${c}::jsonb,
      ${e}::jsonb,
      ${f}::jsonb,
      ${g}::jsonb,
      ${k(a.errorStack,2e5)},
      ${h}::jsonb
    )
    RETURNING
      id,
      task_id as "taskId",
      level,
      stage,
      endpoint,
      http_status as "httpStatus",
      message,
      request_headers as "requestHeaders",
      request_body as "requestBody",
      response_headers as "responseHeaders",
      response_body as "responseBody",
      error_stack as "errorStack",
      meta,
      created_at as "createdAt"
  `;return(await p().catch(a=>{console.error("[EXT_MON] cleanup failed:",a)}),i.rows.length)?n(i.rows[0]):null}async function t(a){if(!a||!await o())return null;let b=await (0,d.ll)`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE transcription_job_id = ${a}
    ORDER BY updated_at DESC
    LIMIT 1
  `;return b.rows.length?m(b.rows[0]):null}async function u(a){if(!a||!await o())return null;let b=await (0,d.ll)`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE podcast_id = ${a}
    ORDER BY updated_at DESC
    LIMIT 1
  `;return b.rows.length?m(b.rows[0]):null}async function v(a,b,c){if(!a||!await o())return null;let e=String(b||"").trim(),f=String(c||"").trim();if(!e&&!f)return null;let g=await (0,d.ll)`
    SELECT
      id,
      path,
      status,
      stage,
      user_id as "userId",
      user_email as "userEmail",
      client_task_id as "clientTaskId",
      trace_id as "traceId",
      source_reference as "sourceReference",
      video_id as "videoId",
      title,
      is_public as "isPublic",
      transcription_job_id as "transcriptionJobId",
      podcast_id as "podcastId",
      provider_task_id as "providerTaskId",
      last_error_code as "lastErrorCode",
      last_error_message as "lastErrorMessage",
      last_http_status as "lastHttpStatus",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM extension_monitor_tasks
    WHERE user_id = ${a}
      AND (
        (${e} <> '' AND trace_id = ${e})
        OR (${f} <> '' AND client_task_id = ${f})
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `;return g.rows.length?m(g.rows[0]):null}function w(a){let b=Number(a||1);return!Number.isFinite(b)||b<1?1:Math.floor(b)}function x(a){let b=Number(a||20);return!Number.isFinite(b)||b<1?20:Math.min(Math.floor(b),100)}function y(a){let b=String(a||"").trim();if(!b)return null;let c=Date.parse(b);return Number.isFinite(c)?new Date(c).toISOString():null}async function z(a={}){if(!await o())return{tasks:[],total:0,page:w(a.page),pageSize:x(a.pageSize)};let b=w(a.page),c=x(a.pageSize),e=a.path||"",f=a.status||"",g=String(a.q||"").trim(),h=g?`%${g}%`:"",i=y(a.from),j=y(a.to),[k,l]=await Promise.all([(0,d.ll)`
      SELECT COUNT(*)::INT AS total
      FROM extension_monitor_tasks
      WHERE (${e} = '' OR path = ${e})
        AND (${f} = '' OR status = ${f})
        AND (${g} = ''
          OR COALESCE(user_email, '') ILIKE ${h}
          OR COALESCE(video_id, '') ILIKE ${h}
          OR COALESCE(title, '') ILIKE ${h}
          OR COALESCE(client_task_id, '') ILIKE ${h}
          OR COALESCE(trace_id, '') ILIKE ${h}
          OR COALESCE(transcription_job_id, '') ILIKE ${h}
          OR COALESCE(podcast_id, '') ILIKE ${h}
        )
        AND (${i||""} = '' OR created_at >= ${i||null}::timestamptz)
        AND (${j||""} = '' OR created_at <= ${j||null}::timestamptz)
    `,(0,d.ll)`
      SELECT
        id,
        path,
        status,
        stage,
        user_id as "userId",
        user_email as "userEmail",
        client_task_id as "clientTaskId",
        trace_id as "traceId",
        source_reference as "sourceReference",
        video_id as "videoId",
        title,
        is_public as "isPublic",
        transcription_job_id as "transcriptionJobId",
        podcast_id as "podcastId",
        provider_task_id as "providerTaskId",
        last_error_code as "lastErrorCode",
        last_error_message as "lastErrorMessage",
        last_http_status as "lastHttpStatus",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_monitor_tasks
      WHERE (${e} = '' OR path = ${e})
        AND (${f} = '' OR status = ${f})
        AND (${g} = ''
          OR COALESCE(user_email, '') ILIKE ${h}
          OR COALESCE(video_id, '') ILIKE ${h}
          OR COALESCE(title, '') ILIKE ${h}
          OR COALESCE(client_task_id, '') ILIKE ${h}
          OR COALESCE(trace_id, '') ILIKE ${h}
          OR COALESCE(transcription_job_id, '') ILIKE ${h}
          OR COALESCE(podcast_id, '') ILIKE ${h}
        )
        AND (${i||""} = '' OR created_at >= ${i||null}::timestamptz)
        AND (${j||""} = '' OR created_at <= ${j||null}::timestamptz)
      ORDER BY updated_at DESC
      LIMIT ${c}
      OFFSET ${(b-1)*c}
    `]),n=Number(k.rows[0]?.total||0);return{tasks:l.rows.map(a=>m(a)),total:n,page:b,pageSize:c}}async function A(a){if(!a||!await o())return null;let[b,c]=await Promise.all([(0,d.ll)`
      SELECT
        id,
        path,
        status,
        stage,
        user_id as "userId",
        user_email as "userEmail",
        client_task_id as "clientTaskId",
        trace_id as "traceId",
        source_reference as "sourceReference",
        video_id as "videoId",
        title,
        is_public as "isPublic",
        transcription_job_id as "transcriptionJobId",
        podcast_id as "podcastId",
        provider_task_id as "providerTaskId",
        last_error_code as "lastErrorCode",
        last_error_message as "lastErrorMessage",
        last_http_status as "lastHttpStatus",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM extension_monitor_tasks
      WHERE id = ${a}
      LIMIT 1
    `,(0,d.ll)`
      SELECT
        id,
        task_id as "taskId",
        level,
        stage,
        endpoint,
        http_status as "httpStatus",
        message,
        request_headers as "requestHeaders",
        request_body as "requestBody",
        response_headers as "responseHeaders",
        response_body as "responseBody",
        error_stack as "errorStack",
        meta,
        created_at as "createdAt"
      FROM extension_monitor_events
      WHERE task_id = ${a}
      ORDER BY created_at ASC, id ASC
    `]);return b.rows.length?{task:m(b.rows[0]),events:c.rows.map(a=>n(a))}:null}}};