exports.id=7146,exports.ids=[7146],exports.modules={47990:()=>{},68941:(a,b,c)=>{"use strict";c.d(b,{$Q:()=>s,Ep:()=>r,tN:()=>z,VM:()=>y,rL:()=>x,ht:()=>C,HB:()=>A,ZP:()=>w,ID:()=>v,Er:()=>u,X5:()=>B,Pr:()=>D});var d=c(79725);let e=new Set(["the","and","for","with","from","that","this","into","about","over","your","you","are","was","were","will","how","what","why","when","they","them","their","our","ours","its","can","new","all","not","podcast","summary","video","talk","episode","analysis","transcript","public","private","full","text","part","chapter"]),f=new Set(["我们","你们","他们","这个","那个","一些","一个","一种","这样","那么","然后","因为","所以","就是","可以","需要","时候","问题","内容","总结","视频","播客","字幕","重点","分析","翻译"]);function g(a){return a.replace(/\s+/g," ").trim()}function h(a){return g(a).replace(/^#+/,"").replace(/[.,;:!?/\\|()[\]{}'"`]+$/g,"")}function i(a,b,c){let d=h(b);if(!d)return;let e=d.toLowerCase();a.set(e,(a.get(e)||0)+c)}function j(a,b,c,d){for(let f of b.match(/[A-Za-z][A-Za-z0-9+.-]{1,28}/g)||[]){let b=h(f),g=b.toLowerCase();b.length<2||e.has(g)||/^\d+$/.test(b)||(i(a,b,c),d&&!d.has(g)&&d.set(g,b))}}function k(a,b,c,d){for(let e of b.match(/[\u4e00-\u9fff]{2,10}/g)||[]){let b=h(e);if(b.length<2||f.has(b))continue;i(a,b,c);let g=b.toLowerCase();d&&!d.has(g)&&d.set(g,b)}}let l=!1,m=null;function n(a){if(null==a)return null;try{return JSON.stringify(a)}catch(a){return console.error("JSONB serialization failed:",a),null}}function o(a){return a.replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/!\[[^\]]*]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/^#{1,6}\s*/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/^\s*\d+\.\s+/gm,"").replace(/[*_~>#]/g," ").replace(/\r/g," ").replace(/\n+/g," ").replace(/\s+/g," ").trim()}function p(a,b){let c=a.trim();if(!c||c.length<=b)return c;let d=c.slice(0,b),e=-1;for(let a of["。","！","？",".","!","?","；",";","，",","]){let b=d.lastIndexOf(a);b>e&&(e=b)}return e>=Math.floor(.6*b)?d.slice(0,e+1).trim():d.trim()}function q(a,b){let c="string"==typeof a?a.trim():"";if(c)return p(o(c),220)||null;let d="string"==typeof b?b.trim():"";if(!d)return null;let e=function(a){let b=String(a||"");if(!b)return"";let c=b.indexOf("# 中文总结");return c>=0?b.slice(c):b}(d),f=e.split("\n").map(a=>a.trim()).filter(Boolean).filter(a=>a.startsWith("- ")).map(a=>a.replace(/^-+\s*/,"").trim()).filter(Boolean);return p(o(f.length>0?f.slice(0,4).join("；"):e),220)||null}async function r(){await (0,d.ll)`
    CREATE TABLE IF NOT EXISTS extension_transcription_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      provider_task_id TEXT,
      podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
      audio_blob_url TEXT,
      source_reference TEXT,
      original_file_name TEXT,
      title TEXT,
      video_id TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_user_created
    ON extension_transcription_jobs (user_id, created_at DESC)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_transcription_jobs_provider_task
    ON extension_transcription_jobs (provider_task_id)
  `}async function s(){await (0,d.ll)`
    CREATE TABLE IF NOT EXISTS extension_monitor_tasks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      client_task_id TEXT,
      trace_id TEXT,
      source_reference TEXT,
      video_id TEXT,
      title TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      transcription_job_id TEXT,
      podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL,
      provider_task_id TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      last_http_status INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,await (0,d.ll)`
    CREATE TABLE IF NOT EXISTS extension_monitor_events (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES extension_monitor_tasks(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'info',
      stage TEXT NOT NULL,
      endpoint TEXT,
      http_status INTEGER,
      message TEXT,
      request_headers JSONB,
      request_body JSONB,
      response_headers JSONB,
      response_body JSONB,
      error_stack TEXT,
      meta JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_created
    ON extension_monitor_tasks (created_at DESC)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_status_path_updated
    ON extension_monitor_tasks (status, path, updated_at DESC)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_user_created
    ON extension_monitor_tasks (user_id, created_at DESC)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_transcription_job
    ON extension_monitor_tasks (transcription_job_id)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_podcast
    ON extension_monitor_tasks (podcast_id)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_tasks_trace
    ON extension_monitor_tasks (trace_id)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_extension_monitor_events_task_created
    ON extension_monitor_events (task_id, created_at ASC)
  `}async function t(){l||(m||(m=(async()=>{await (0,d.ll)`
        ALTER TABLE podcasts
        ADD COLUMN IF NOT EXISTS source_reference TEXT
      `,await (0,d.ll)`
        ALTER TABLE podcasts
        ADD COLUMN IF NOT EXISTS tags_json JSONB DEFAULT '[]'::jsonb
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS token_count INTEGER
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS brief_summary TEXT
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS summary_zh TEXT
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS summary_en TEXT
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS word_count INTEGER
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS character_count INTEGER
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json JSONB
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json_zh JSONB
      `,await (0,d.ll)`
        ALTER TABLE analysis_results
        ADD COLUMN IF NOT EXISTS mind_map_json_en JSONB
      `,await r(),await s(),l=!0})().catch(a=>{throw m=null,a})),await m)}async function u(a){try{await t();let b=await (0,d.ll)`
      INSERT INTO podcasts 
        (id, title, original_filename, file_size, blob_url, source_reference, is_public, user_id)
      VALUES 
        (${a.id}, ${a.title}, ${a.originalFileName}, ${a.fileSize}, ${a.blobUrl}, ${a.sourceReference??null}, ${a.isPublic}, ${a.userId||null})
      ON CONFLICT (id) 
      DO UPDATE SET
        title = ${a.title}, 
        original_filename = ${a.originalFileName},
        file_size = ${a.fileSize},
        blob_url = ${a.blobUrl},
        source_reference = ${a.sourceReference??null},
        is_public = ${a.isPublic},
        user_id = ${a.userId||null}
      RETURNING id
    `;return{success:!0,data:b.rows[0]}}catch(a){return console.error("保存播客信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function v(a){try{await t();let b=a.summaryZh??a.summary??null,c=a.summaryEn??null,e=b??a.summary??"",f=a.mindMapJsonZh??a.mindMapJson??null,l=a.mindMapJsonEn??null,m=a.mindMapJson??f??null,o=await (0,d.ll)`
      INSERT INTO analysis_results 
        (
          podcast_id,
          summary,
          summary_zh,
          summary_en,
          brief_summary,
          translation,
          highlights,
          mind_map_json,
          mind_map_json_zh,
          mind_map_json_en,
          token_count,
          word_count,
          character_count
        )
      VALUES 
        (
          ${a.podcastId},
          ${e},
          ${b},
          ${c},
          ${a.briefSummary??null},
          ${a.translation},
          ${a.highlights},
          ${n(m)}::jsonb,
          ${n(f)}::jsonb,
          ${n(l)}::jsonb,
          ${a.tokenCount??null},
          ${a.wordCount??null},
          ${a.characterCount??null}
        )
      ON CONFLICT (podcast_id) 
      DO UPDATE SET
        summary = ${e},
        summary_zh = ${b},
        summary_en = ${c},
        brief_summary = ${a.briefSummary??null},
        translation = ${a.translation},
        highlights = ${a.highlights},
        mind_map_json = ${n(m)}::jsonb,
        mind_map_json_zh = ${n(f)}::jsonb,
        mind_map_json_en = ${n(l)}::jsonb,
        token_count = ${a.tokenCount??null},
        word_count = ${a.wordCount??null},
        character_count = ${a.characterCount??null},
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `,p=await (0,d.ll)`
      SELECT title, original_filename as "originalFileName", source_reference as "sourceReference"
      FROM podcasts
      WHERE id = ${a.podcastId}
      LIMIT 1
    `;if(p.rows.length>0){let b=p.rows[0],c=function(a){let b=g(String(a.title||a.fallbackName||"")),c=g(String(a.summary||"").replace(/```[\s\S]*?```/g," ").replace(/`[^`]*`/g," ").replace(/!\[[^\]]*]\([^)]*\)/g," ").replace(/\[[^\]]*]\([^)]*\)/g," ").replace(/^#{1,6}\s+/gm,"").replace(/[*_~>#-]/g," ").replace(/\r\n/g,"\n")),d=new Map,e=new Map,f=a=>{let b=h(a);if(!b)return;let c=b.toLowerCase();e.has(c)||e.set(c,b)};for(let b of function(a){let b=String(a||"").toLowerCase(),c=[];return(b.includes("youtube.com")||b.includes("youtu.be"))&&c.push("YouTube"),b.includes("bilibili.com")&&c.push("Bilibili"),(b.includes("x.com")||b.includes("twitter.com"))&&c.push("X"),c}(a.sourceReference))i(d,b,8),f(b);b&&(j(d,b,5,e),k(d,b,5,e)),c&&(j(d,c,1,e),k(d,c,1,e));let l=Array.from(d.entries()).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([a])=>e.get(a)||a).map(a=>h(a)).filter(Boolean),m=[],n=new Set;for(let a of l){let b=a.toLowerCase();n.has(b)||(n.add(b),m.push(a))}return m}({title:b.title||null,fallbackName:b.originalFileName||null,summary:e||"",sourceReference:b.sourceReference||null});await (0,d.ll)`
        UPDATE podcasts
        SET tags_json = ${JSON.stringify(c)}::jsonb
        WHERE id = ${a.podcastId}
      `}return{success:!0,data:o.rows[0]}}catch(a){return console.error("保存分析结果失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function w(a){try{await t();let b=a.summaryZh??null,c=a.summaryEn??null,e=a.summary??b??null,f=a.mindMapJsonZh??null,g=a.mindMapJsonEn??null,h=a.mindMapJson??f??null,i=await (0,d.ll)`
      INSERT INTO analysis_results
        (
          podcast_id,
          summary,
          summary_zh,
          summary_en,
          brief_summary,
          translation,
          highlights,
          mind_map_json,
          mind_map_json_zh,
          mind_map_json_en,
          token_count,
          word_count,
          character_count
        )
      VALUES
        (
          ${a.podcastId},
          ${e},
          ${b},
          ${c},
          ${a.briefSummary??null},
          ${a.translation??null},
          ${a.highlights??null},
          ${n(h)}::jsonb,
          ${n(f)}::jsonb,
          ${n(g)}::jsonb,
          ${a.tokenCount??null},
          ${a.wordCount??null},
          ${a.characterCount??null}
        )
      ON CONFLICT (podcast_id)
      DO UPDATE SET
        summary = COALESCE(EXCLUDED.summary, analysis_results.summary),
        summary_zh = COALESCE(EXCLUDED.summary_zh, analysis_results.summary_zh),
        summary_en = COALESCE(EXCLUDED.summary_en, analysis_results.summary_en),
        brief_summary = COALESCE(EXCLUDED.brief_summary, analysis_results.brief_summary),
        translation = COALESCE(EXCLUDED.translation, analysis_results.translation),
        highlights = COALESCE(EXCLUDED.highlights, analysis_results.highlights),
        mind_map_json = COALESCE(EXCLUDED.mind_map_json, analysis_results.mind_map_json),
        mind_map_json_zh = COALESCE(EXCLUDED.mind_map_json_zh, analysis_results.mind_map_json_zh),
        mind_map_json_en = COALESCE(EXCLUDED.mind_map_json_en, analysis_results.mind_map_json_en),
        token_count = COALESCE(EXCLUDED.token_count, analysis_results.token_count),
        word_count = COALESCE(EXCLUDED.word_count, analysis_results.word_count),
        character_count = COALESCE(EXCLUDED.character_count, analysis_results.character_count),
        processed_at = CURRENT_TIMESTAMP
      RETURNING podcast_id
    `;return{success:!0,data:i.rows[0]}}catch(a){return console.error("保存分析结果增量失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function x(a){try{await t();let b=await (0,d.ll)`
      SELECT 
        id, title, original_filename as "originalFileName", 
        file_size as "fileSize", blob_url as "blobUrl", 
        source_reference as "sourceReference",
        tags_json as "tags",
        is_public as "isPublic", user_id as "userId", created_at as "createdAt"
      FROM podcasts 
      WHERE id = ${a}
    `;if(0===b.rows.length)return{success:!1,error:"Podcast not found"};return{success:!0,data:b.rows[0]}}catch(a){return console.error("获取播客信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function y(a){try{await t();let b=await (0,d.ll)`
      SELECT 
        podcast_id as "podcastId",
        summary,
        summary_zh as "summaryZh",
        summary_en as "summaryEn",
        brief_summary as "briefSummary",
        translation, 
        highlights,
        mind_map_json as "mindMapJson",
        mind_map_json_zh as "mindMapJsonZh",
        mind_map_json_en as "mindMapJsonEn",
        token_count as "tokenCount",
        word_count as "wordCount",
        character_count as "characterCount",
        processed_at as "processedAt"
      FROM analysis_results 
      WHERE podcast_id = ${a}
    `;if(0===b.rows.length)return{success:!1,error:"Analysis results not found"};return{success:!0,data:b.rows[0]}}catch(a){return console.error("获取分析结果失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function z(a=1,b=10,c=!1){try{let e;await t(),e=c?(0,d.ll)`
        SELECT 
          p.id, p.title, p.original_filename as "originalFileName", 
          p.file_size as "fileSize", p.blob_url as "blobUrl", 
          p.source_reference as "sourceReference",
          p.tags_json as "tags",
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
          ar.brief_summary as "__briefSummaryRaw",
          COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
          ar.word_count as "wordCount",
          CASE
            WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
              THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
            ELSE NULL
          END as "durationSec"
        FROM podcasts p
        LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
        ORDER BY p.created_at DESC 
        LIMIT ${b} OFFSET ${(a-1)*b}
      `:(0,d.ll)`
        SELECT 
          p.id, p.title, p.original_filename as "originalFileName", 
          p.file_size as "fileSize", p.blob_url as "blobUrl", 
          p.source_reference as "sourceReference",
          p.tags_json as "tags",
          p.is_public as "isPublic", p.created_at as "createdAt",
          CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
          ar.brief_summary as "__briefSummaryRaw",
          COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
          ar.word_count as "wordCount",
          CASE
            WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
              THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
            ELSE NULL
          END as "durationSec"
        FROM podcasts p
        LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
        WHERE p.is_public = true
        ORDER BY p.created_at DESC 
        LIMIT ${b} OFFSET ${(a-1)*b}
      `;let f=(await e).rows.map(a=>{let b={...a,briefSummary:q(a.__briefSummaryRaw,a.__summaryRaw)};return delete b.__briefSummaryRaw,delete b.__summaryRaw,b});return{success:!0,data:f}}catch(a){return console.error("获取所有播客信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function A(a,b=1,c=10){try{await t();let e=(0,d.ll)`
      SELECT 
        p.id, p.title, p.original_filename as "originalFileName", 
        p.file_size as "fileSize", p.blob_url as "blobUrl", 
        p.source_reference as "sourceReference",
        p.tags_json as "tags",
        p.is_public as "isPublic", p.created_at as "createdAt",
        p.user_id as "userId",
        CASE WHEN ar.podcast_id IS NOT NULL THEN true ELSE false END as "isProcessed",
        ar.brief_summary as "__briefSummaryRaw",
        COALESCE(ar.summary_zh, ar.summary) as "__summaryRaw",
        ar.word_count as "wordCount",
        CASE
          WHEN ar.word_count IS NOT NULL AND ar.word_count > 0
            THEN GREATEST(60, ROUND((ar.word_count::numeric / 155) * 60)::int)
          ELSE NULL
        END as "durationSec"
      FROM podcasts p
      LEFT JOIN analysis_results ar ON p.id = ar.podcast_id
      WHERE p.user_id = ${a}
      ORDER BY p.created_at DESC 
      LIMIT ${c} OFFSET ${(b-1)*c}
    `,f=(await e).rows.map(a=>{let b={...a,briefSummary:q(a.__briefSummaryRaw,a.__summaryRaw)};return delete b.__briefSummaryRaw,delete b.__summaryRaw,b});return{success:!0,data:f}}catch(a){return console.error("获取用户播客信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function B(a,b){try{let c;await t();let e="boolean"==typeof b.isPublic,f=Object.prototype.hasOwnProperty.call(b,"sourceReference");if(!e&&!f)return{success:!1,error:"No fields to update"};if(c=e&&f?await (0,d.ll)`
        UPDATE podcasts
        SET is_public = ${b.isPublic},
            source_reference = ${b.sourceReference??null}
        WHERE id = ${a}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `:e?await (0,d.ll)`
        UPDATE podcasts
        SET is_public = ${b.isPublic}
        WHERE id = ${a}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `:await (0,d.ll)`
        UPDATE podcasts
        SET source_reference = ${b.sourceReference??null}
        WHERE id = ${a}
        RETURNING id, is_public as "isPublic", source_reference as "sourceReference"
      `,0===c.rows.length)return{success:!1,error:"Podcast not found"};return{success:!0,data:c.rows[0]}}catch(a){return console.error("更新播客元信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function C(a){try{let b=await (0,d.ll)`
      SELECT id, email, password_hash, name, created_at
      FROM users
      WHERE email = ${a}
    `;if(0===b.rows.length)return{success:!1,error:"User not found"};return{success:!0,data:b.rows[0]}}catch(a){return console.error("获取用户信息失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}async function D(a,b){try{let c=await (0,d.ll)`
      SELECT id FROM podcasts
      WHERE id = ${a} AND user_id = ${b}
    `;return{success:c.rows.length>0,data:c.rows[0]}}catch(a){return console.error("验证播客所有权失败:",a),{success:!1,error:a instanceof Error?a.message:String(a)}}}},78335:()=>{},96487:()=>{}};