"use strict";(()=>{var a={};a.id=4697,a.ids=[4697],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},11723:a=>{a.exports=require("querystring")},12412:a=>{a.exports=require("assert")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{a.exports=require("os")},27910:a=>{a.exports=require("stream")},28354:a=>{a.exports=require("util")},29021:a=>{a.exports=require("fs")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},34631:a=>{a.exports=require("tls")},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},55511:a=>{a.exports=require("crypto")},55591:a=>{a.exports=require("https")},59521:(a,b,c)=>{c.r(b),c.d(b,{handler:()=>as,patchFetch:()=>ar,routeModule:()=>an,serverHooks:()=>aq,workAsyncStorage:()=>ao,workUnitAsyncStorage:()=>ap});var d={};c.r(d),c.d(d,{POST:()=>am});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641);let v={summarySystem:`
你是一名专业 Podcast 分析助手。请输出稳定且可渲染的 Markdown，不要输出任何结构外文本。

输出必须严格包含以下两个分隔标记，并且仅输出这两个区块：

<<<SUMMARY_EN>>>
# English Summary
## Key Takeaways
- ...
## Data & Numbers
- ...
## Decisions & Action Items
- ...

<<<SUMMARY_ZH>>>
# 中文总结
## 核心观点
- ...
## 关键数据
- ...
## 决策与行动项
- ...

规则：
1. 总长度不超过 24000 字。
2. 必须优先提取数据、金额、比例、日期、时间、增长/下降、案例、方法论、因果关系等事实。
3. 列表统一使用 "- "，不要使用 "•" 或有序编号。
4. 标题和正文必须分行，禁止“标题: 内容”写在同一行。
5. 不要输出代码块、HTML、免责声明、前言或结语。
6. 信息缺失时明确写“未明确提及”。
7. 信息密度要求（必须满足）：
   - English Summary:
     - Key Takeaways 至少 8 条。
     - Data & Numbers 至少 8 条（每条包含“数字 + 含义/上下文”；无数字时写“Not explicitly mentioned”并说明相关事实）。
     - Decisions & Action Items 至少 6 条（尽量包含 owner/time/next step；若未明确则标注“Not explicitly mentioned”）。
   - 中文总结:
     - 核心观点 至少 8 条。
     - 关键数据 至少 8 条（每条包含“数字 + 业务/策略含义”；无数字时写“未明确提及”并说明相关事实）。
     - 决策与行动项 至少 6 条（尽量包含负责人/时间点/执行条件；若未明确则标注“未明确提及”）。
8. 每条 bullet 需要尽量完整，优先包含：
   - 结论本身（发生了什么）
   - 原因或依据（为什么）
   - 潜在影响（意味着什么）
9. 不要泛化，不要空话；优先写具体名词、具体动作、具体数字、具体条件。
10. 必须输出 "<<<SUMMARY_EN>>>" 在前，"<<<SUMMARY_ZH>>>" 在后，不得调换顺序。
  `,translateSystem:`
将每个字幕行翻译成 <<中文>>，保持原始时间码和SRT格式结构。
格式要求：
1. 每个翻译条目必须独占一行
2. 时间码格式必须为 "[HH:MM:SS --> HH:MM:SS]"
3. 时间码和翻译文本之间必须有一个空格
4. 注意!!! 每个条目之间必须有一个空行

正确示例：

[00:01:23 --> 00:01:25] 这是翻译的第一行

[00:01:26 --> 00:01:30] 这是翻译的第二行

返回纯文本，确保保留所有换行符。`,highlightSystem:`
你是一位专业编辑，目标是提升信息密度并保持可读性。

任务要求：
1. 按语义合并相邻字幕，避免同一句话出现多个时间戳。
2. 保持原始顺序，不打乱上下文。
3. 修正明显错别字。
4. 对关键事实、数据、决策、行动、日期时间、观点使用 **加粗** 标记重点。

输出格式必须严格为：
**[HH:MM:SS]** 文本内容

每个条目之间空一行，不要输出标题、项目符号、编号、代码块或额外说明。

额外规则：
- 全文翻译为中文。
- 每条只保留一个时间戳。
- 时间戳与文本之间保留一个空格。
- 不要删除核心信息，不要编造内容。`,mindMapSystemZh:`
你是信息架构师。请把输入内容整理成可渲染的脑图 JSON，且只输出 JSON，不要输出任何额外文本。

输出格式必须严格为：
{
  "root": {
    "label": "中心主题",
    "children": [
      {
        "label": "一级主题",
        "children": [
          { "label": "二级主题" }
        ]
      }
    ]
  }
}

规则：
1. 只能输出合法 JSON 对象，禁止 Markdown、代码块、注释、解释文本。
2. 节点字段只允许 "label" 和可选 "children"。
3. 层级要求：整体 4~6 层（root 算第 1 层），至少有两个分支达到第 5 层，必要时可到第 6 层。
4. root 至少 4 个一级主题；每个一级主题至少 2 个子节点。
5. 每个 label 必须是“完整信息句”，不要写成关键词短语；优先包含结论 + 原因/依据 + 影响/行动。
6. 每个 label 建议 22~120 个中文字符（或等价信息密度），允许更长，不要为了简短而省略关键信息。
7. 只使用输入中可推断的信息，不得杜撰。`,mindMapSystemEn:`
You are an information architect. Convert the input into renderable mind-map JSON and output JSON only.

Output format must strictly be:
{
  "root": {
    "label": "Central Theme",
    "children": [
      {
        "label": "Level-1 Topic",
        "children": [
          { "label": "Level-2 Topic" }
        ]
      }
    ]
  }
}

Rules:
1. Output one valid JSON object only, with no markdown/code fences/comments/explanations.
2. Node fields can only be "label" and optional "children".
3. Depth requirement: total depth 4-6 levels (root is level 1), at least two branches must reach level 5.
4. Root must have at least 4 first-level branches; each first-level branch must have at least 2 children.
5. Every label must be a complete informative sentence, not keyword fragments.
6. Prefer labels that include conclusion + evidence/reason + impact/action.
7. Use only inferable facts from the input. Do not fabricate.
`,mindMapSystem:`你是信息架构师。请把输入内容整理成可渲染的脑图 JSON，且只输出 JSON，不要输出任何额外文本。`,briefSummarySystem:`
你是内容编辑助手。请输出一段中文简介，用于列表卡片预览。

硬性要求：
1. 只输出一段纯文本，不要 Markdown、标题、项目符号、引号或前后缀说明。
2. 长度控制在 100-200 个汉字左右，尽量接近 150 字。
3. 优先写：主题、核心观点、关键结论/分歧、可执行信息。
4. 禁止编造，信息不足时要如实概括。
5. 语言简洁自然，便于用户在点开前快速判断内容价值。`,summaryUserFull:a=>`请基于以下播客转录生成“高信息密度、细节充分”的双语总结。必须严格按系统提示输出分隔标记与结构，不要省略中间层信息。

${a}`,summaryUserSegment:(a,b,c)=>`请先总结以下转录片段（${b}/${c}），要求保留细节：关键术语、关键论据、数据与范围、具体案例、可执行动作、风险与边界条件。必须严格使用系统提示中的分隔标记与结构。

${a}`,summaryUserCombine:a=>`请整合以下分段总结，输出最终结构化结果。必须去重但不能丢信息，优先保留具体数据、条件、因果链和执行步骤。必须严格按系统提示中的分隔标记与结构输出：

${a.join("\n\n")}`,translateUserFull:a=>`将这个完整的 SRT 内容翻译成中文：${a}`,translateUserSegment:(a,b,c)=>`将这个 SRT 内容片段（${b}/${c}）翻译成中文，保持精确的 SRT 格式：${a}`,highlightUserFull:a=>`请按系统格式提炼并翻译以下完整 SRT 内容，突出重点信息：

${a}`,highlightUserSegment:(a,b,c)=>`请按系统格式处理以下 SRT 片段（${b}/${c}），突出重点信息：

${a}`,briefSummaryUser:a=>`请基于以下播客信息，生成一段用于列表展示的中文简介（100-200字）：

标题：
${a.title||"未提供"}

来源：
${a.sourceReference||"未提供"}

详细摘要：
${a.summary||"未提供"}

重点内容：
${a.highlights||"未提供"}`,mindMapUserZh:a=>`请基于以下播客信息生成“高信息密度”的脑图 JSON，并尽量写成更完整、更易记忆的句子节点（不追求短）。

标题：
${a.title||"未提供"}

来源：
${a.sourceReference||"未提供"}

摘要：
${a.summary||"未提供"}

重点内容：
${a.highlights||"未提供"}`,mindMapUserEn:a=>`Generate an information-dense mind-map JSON in English based on:

Title:
${a.title||"N/A"}

Source:
${a.sourceReference||"N/A"}

Summary:
${a.summary||"N/A"}

Full Text Notes:
${a.highlights||"N/A"}`,mindMapUser:a=>`请基于以下播客信息生成“高信息密度”的脑图 JSON，并尽量写成更完整、更易记忆的句子节点（不追求短）。

标题：
${a.title||"未提供"}

来源：
${a.sourceReference||"未提供"}

摘要：
${a.summary||"未提供"}

重点内容：
${a.highlights||"未提供"}`};var w=c(1434),x=c(68941),y=c(1093),z=c(66147),A=c(96733),B=c(42154);let C=process.env.OPENROUTER_MINDMAP_MODEL||"google/gemini-3-flash-preview";async function D(a){let b=process.env.OPENROUTER_API_KEY||"";if(!b)throw Error("OPENROUTER_API_KEY is missing");let c="en"===a.language?"en":"zh",d="en"===c?v.mindMapSystemEn:v.mindMapSystemZh,e="en"===c?v.mindMapUserEn(a):v.mindMapUserZh(a),f=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${b}`,"HTTP-Referer":process.env.VERCEL_URL||"http://localhost:3000","X-Title":"PodSum.cc"},body:JSON.stringify({model:C,messages:[{role:"system",content:d},{role:"user",content:`${e}

${"en"===c?"Additional hard requirement: at least two branches must reach level 5; if enough detail exists, level 6 is allowed.":"额外硬性要求：至少两个分支必须达到第5层；如果信息充足可达到第6层。"}`}],temperature:.35,max_tokens:6e3,stream:!1})});if(!f.ok){let a=await f.text().catch(()=>"");throw Error(`OpenRouter error ${f.status}: ${a||f.statusText}`)}let g=await f.json(),h=function(a){if(!a||"object"!=typeof a)return"";let b=a.message;if(!b||"object"!=typeof b)return"";let c=b.content;return"string"==typeof c?c:Array.isArray(c)?c.map(a=>"string"==typeof a?a:a&&"object"==typeof a&&"string"==typeof a.text?a.text:"").filter(Boolean).join("\n"):""}(g?.choices?.[0]);if(!h.trim())throw Error("Model returned empty mind map content");return h}async function E(a){if(!`${a.title||""}
${a.summary||""}
${a.highlights||""}`.trim())return{success:!1,error:"Insufficient input content for mind map generation"};let b=null,c="";for(let d=0;d<3;d+=1)try{let d=await D(a),e=function(a){let b=a.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();if(b.startsWith("{")&&b.endsWith("}"))return b;let c=b.indexOf("{");if(-1===c)return b;let d=0,e=!1,f=!1;for(let a=c;a<b.length;a+=1){let g=b[a];if(f){f=!1;continue}if("\\"===g){f=!0;continue}if('"'===g){e=!e;continue}if(!e){if("{"===g){d+=1;continue}if("}"===g&&0==(d-=1))return b.slice(c,a+1)}}return b.slice(c)}(d),f=JSON.parse(e),g=function(a){if(!a||"object"!=typeof a)return null;let b=function a(b,c){var d;if(!b||"object"!=typeof b)return null;let e="string"!=typeof(d=b.label)?"":d.replace(/\s+/g," ").trim().slice(0,280);if(!e)return null;let f={label:e};if(c>=5)return f;let g=Array.isArray(b.children)?b.children:[];if(0===g.length)return f;let h=new Set,i=[];for(let b of g){if(i.length>=14)break;let d=a(b,c+1);if(!d)continue;let e=d.label.toLowerCase();h.has(e)||(h.add(e),i.push(d))}return i.length>0&&(f.children=i),f}(a.root??a,0);return b&&b.children&&0!==b.children.length?{root:b}:null}(f);if(!g){c="Model output is not a valid mind map tree";continue}let h=function(a){let b=(a,c)=>{let d=Array.isArray(a.children)?a.children:[];if(0===d.length)return c;let e=c;for(let a of d)e=Math.max(e,b(a,c+1));return e};return b(a.root,1)}(g);if((!b||h>b.depth)&&(b={data:g,rawOutput:d,depth:h}),h>=5)return{success:!0,data:g,rawOutput:d};c=`Mind map depth ${h} is shallower than target 5`}catch(a){c=a instanceof Error?a.message:String(a)}return b?{success:!0,data:b.data,rawOutput:b.rawOutput}:{success:!1,error:c||"Failed to generate mind map"}}let F=w.a.API_VERSION;console.log(`[DEBUG-API] Podcast Summarizer API v${F} loading...`);let G={count:0,calls:[]},H=w.a.MODEL,I=w.a.MAX_RETRIES,J=w.a.RETRY_DELAY,K=w.a.API_TIMEOUT_MS,L=w.a.STATUS_HEARTBEAT_MS,M=w.a.MAX_CONTENT_LENGTH,N=(()=>{let a=Number(w.a.SUMMARY_CHUNK_LENGTH);return!Number.isFinite(a)||a<=0?M:Math.min(a,M)})(),O=(()=>{let a=Number(w.a.TRANSLATION_CHUNK_BLOCKS);return!Number.isFinite(a)||a<=0?120:Math.max(1,Math.floor(a))})(),P=(()=>{let a=Number(w.a.HIGHLIGHTS_CHUNK_BLOCKS);return!Number.isFinite(a)||a<=0?180:Math.max(1,Math.floor(a))})(),Q=(()=>{let a=Number(w.a.MAX_TRANSLATION_CHUNKS);return!Number.isFinite(a)||a<=0?24:Math.max(1,Math.floor(a))})(),R=(()=>{let a=Number(w.a.MAX_HIGHLIGHTS_CHUNKS);return!Number.isFinite(a)||a<=0?24:Math.max(1,Math.floor(a))})(),S=(()=>{let a=Number(w.a.TRANSLATION_CHUNK_CONCURRENCY);return!Number.isFinite(a)||a<=0?3:Math.min(5,Math.max(1,Math.floor(a)))})(),T=(()=>{let a=Number(w.a.HIGHLIGHTS_CHUNK_CONCURRENCY);return!Number.isFinite(a)||a<=0?2:Math.min(5,Math.max(1,Math.floor(a)))})(),U=!!w.a.ENABLE_PARALLEL_TASKS,V=w.a.MAX_TOKENS,W=a=>new Promise(b=>setTimeout(b,a));function X(a){let b,c=/(\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*\n[^\n]*(?:\n[^\n]*)*?)(?=\n\s*\d+\s*\n|$)/g,d=[],e=0;for(;null!==(b=c.exec(a));)d.push(b[0]),e=c.lastIndex;if(e<a.length){let b=a.substring(e).trim();b&&d.push(b)}return d.length>0?d:[a]}function Y(a,b){if(0===a.length)return[];let c=[];for(let d=0;d<a.length;d+=b)c.push(a.slice(d,d+b).join("\n\n"));return c}function Z(a,b,c){return a<=0?b:Math.max(b,Math.ceil(a/Math.max(1,c)))}async function $(a,b,c){let d=Array(a.length),e=0,f=async()=>{for(;;){let b=e;if(e+=1,b>=a.length)return;d[b]=await c(a[b],b)}},g=Math.min(Math.max(1,Math.floor(b)),a.length);return await Promise.all(Array.from({length:g},()=>f())),d}async function _(a,b,c=1500,d=.7,e,f="summary"){let g=null;G.count++,G.calls.push({model:H,task:f,timestamp:Date.now()});let h=Date.now().toString(36)+Math.random().toString(36).substring(2,7);console.log(`[OpenRouter Request ${h}] ---- START ----`),console.log(`[OpenRouter Request ${h}] Model: ${H}`),console.log(`[OpenRouter Request ${h}] Task: ${f} (Call #${G.count}, Total: ${G.count})`),console.log(`[OpenRouter Request ${h}] System: ${a.substring(0,100)}...`),console.log(`[OpenRouter Request ${h}] User: ${b.substring(0,100)}...`),console.log(`[OpenRouter Request ${h}] MaxTokens: ${c}`),console.log(`[OpenRouter Request ${h}] Temperature: ${d}`),console.log(`[OpenRouter Request ${h}] Streaming: ${!!e}`);let i=Date.now(),j="";for(let f=0;f<=I;f++)try{let g;f>0&&(console.log(`[OpenRouter Request ${h}] Retry attempt ${f}`),await W(J*f));let k=Date.now();console.log(`[OpenRouter Request ${h}] Making API call at ${new Date().toISOString()}`);let l=process.env.OPENROUTER_API_KEY||"";console.log(`[OpenRouter Request ${h}] Using API key: ${l.substring(0,5)}...`);let m={model:H,messages:[{role:"system",content:a},{role:"user",content:b}],temperature:d,max_tokens:c,stream:!!e},n=new AbortController,o=setTimeout(()=>{n.abort()},K);try{g=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${l}`,"HTTP-Referer":process.env.VERCEL_URL||"http://localhost:3000","X-Title":"PodSum.cc"},body:JSON.stringify(m),signal:n.signal})}catch(a){if(a instanceof Error&&"AbortError"===a.name)throw Error(`OpenRouter request timed out after ${K}ms`);throw a}finally{clearTimeout(o)}let p=Date.now();if(console.log(`[OpenRouter Request ${h}] API call initiated in ${p-k}ms (stream: ${!!e})`),!g.ok){let a=await g.text().catch(()=>`Failed to get error text, status: ${g.status}`);throw console.error(`[OpenRouter Request ${h}] API ERROR: ${g.status} ${a}`),Error(`API response not ok: ${g.status} ${a}`)}if(e&&g.body){let a=g.body.getReader(),b=new TextDecoder;console.log(`[OpenRouter Request ${h}] Streaming response started...`);let c="";for(;;){let d,{done:f,value:g}=await a.read();if(f){if(c.startsWith("data: "))try{let a=c.substring(5).trim();if(a&&"[DONE]"!==a){let b=al(a);if(b.choices&&b.choices[0]&&b.choices[0].delta&&b.choices[0].delta.content){let a=b.choices[0].delta.content;j+=a,await e(a)}}}catch(a){console.error(`[OpenRouter Request ${h}] Error parsing final buffered data line: "${c}". Error:`,a)}break}for(c+=b.decode(g,{stream:!0});(d=c.indexOf("\n\n"))>=0;){let a=c.substring(0,d);for(let b of(c=c.substring(d+2),a.split("\n")))if(b.startsWith("data: ")){let a=b.substring(5).trim();if("[DONE]"===a){console.log(`[OpenRouter Request ${h}] Stream [DONE] signal received.`);continue}try{let b=al(a);if(b.choices&&b.choices[0]&&b.choices[0].delta&&b.choices[0].delta.content){let a=b.choices[0].delta.content;j+=a,await e(a)}else b.choices&&b.choices[0]&&b.choices[0].finish_reason&&console.log(`[OpenRouter Request ${h}] Stream finish reason: ${b.choices[0].finish_reason}`)}catch(a){console.error(`[OpenRouter Request ${h}] Error parsing JSON from data line: "${b}". Error:`,a)}}else b.trim().startsWith(":")?console.log(`[OpenRouter Request ${h}] Received SSE comment: "${b}"`):b.trim()&&console.log(`[OpenRouter Request ${h}] Received unexpected non-empty, non-data, non-comment line: "${b}"`)}}console.log(`[OpenRouter Request ${h}] Streaming response finished processing loop.`)}else{let a=await g.json();if(!a.choices?.[0]?.message?.content)throw console.log(`[OpenRouter Request ${h}] No content in non-streaming response: ${JSON.stringify(a)}`),Error(`No content in response: ${JSON.stringify(a)}`);j=a.choices[0].message.content,console.log(`[OpenRouter Request ${h}] Non-streaming Response: ${j.substring(0,100)}...`),a.usage&&console.log(`[OpenRouter Request ${h}] Token usage: ${JSON.stringify(a.usage)}`)}let q=Date.now();return console.log(`[OpenRouter Request ${h}] Processing completed in ${q-k}ms (total function time: ${q-i}ms)`),console.log(`[OpenRouter Request ${h}] ---- END ----`),j}catch(a){if(console.error(`[OpenRouter Request ${h}] Error (attempt ${f}):`,a),g=a,f===I)throw console.log(`[OpenRouter Request ${h}] ---- FAILED (Max Retries) ----`),a;continue}throw console.log(`[OpenRouter Request ${h}] ---- FAILED (Exhausted) ----`),g}async function aa(a,b,c,d){let e=Date.now(),f=setInterval(()=>{let d=Math.floor((Date.now()-e)/1e3);c({type:"status",task:a,message:`${b} (running ${d}s)`}).catch(a=>{console.error("Failed to send heartbeat status:",a)})},L);try{return await d()}finally{clearInterval(f)}}async function ab(a){let b=a.split("\n"),c="",d=!1;for(let a of b){let b=a.trim();if(""===b||/^\d+$/.test(b)||b.includes(" --\x3e ")){d=b.includes(" --\x3e ");continue}!d&&c.length>0&&(c+=" "),c+=b,d=!1}return c}let ac="<<<SUMMARY_EN>>>",ad="<<<SUMMARY_ZH>>>";function ae(a){return String(a||"").replace(/\r\n/g,"\n").replace(/^[ \t]*•[ \t]+/gm,"- ").trim()}function af(a){return a.replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/!\[[^\]]*]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/^#{1,6}\s*/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/^\s*\d+\.\s+/gm,"").replace(/[*_~>#]/g," ").replace(/\r/g," ").replace(/\n+/g," ").replace(/\s+/g," ").trim()}function ag(a,b){let c=a.trim();if(!c||c.length<=b)return c;let d=c.slice(0,b),e=-1;for(let a of["。","！","？",".","!","?","；",";","，",","]){let b=d.lastIndexOf(a);b>e&&(e=b)}return e>=Math.floor(.6*b)?d.slice(0,e+1).trim():d.trim()}async function ah(a){let b=function(a,b){let c=`${String(a||"")}
${b||""}`.trim();return c?ag(af(c),220):""}(a.summaryZh,a.highlights);if(!(a.summaryZh||"").trim()&&!(a.highlights||"").trim())return"";try{var c=await _(v.briefSummarySystem,v.briefSummaryUser({title:a.title??null,sourceReference:a.sourceReference??null,summary:a.summaryZh,highlights:a.highlights}),Math.min(400,V.summary),.2,void 0,"brief_summary");let d=ag(af(c).replace(/^["“”']+|["“”']+$/g,"").trim(),220);return d.length>=100||!b?d:d?ag(`${d} ${b}`,220):b}catch(a){return console.warn("短摘要生成失败，使用回退摘要:",a),b}}async function ai(a,b,c){await b({type:"status",task:"summary",message:"Starting summary generation..."});let d="",e=Math.max(2e3,Math.floor(.75*V.summary));if(a.length<=N)return await b({type:"status",task:"summary",message:"Content is short, processing as a single chunk."}),d=await _(v.summarySystem,v.summaryUserFull(a),V.summary,.5,async a=>{await b({type:"summary_token",content:a,chunkIndex:0,totalChunks:1})},"summary"),c&&await c(d),await b({type:"summary_final_result",content:d,chunkIndex:0,totalChunks:1,isFinalChunk:!0}),d;let f=function(a,b){if(a.length<=b)return[a];let c=[],d=a;for(;d.length>0;){let a=Math.min(b,d.length);if(a<d.length){let c=-1,e=0,f=.6*b;for(let b of[{token:"\n\n",keepChars:2},{token:". ",keepChars:1},{token:"? ",keepChars:1},{token:"! ",keepChars:1},{token:"。",keepChars:1},{token:"？",keepChars:1},{token:"！",keepChars:1}]){let g=d.lastIndexOf(b.token,a);g>f&&g>c&&(c=g,e=b.keepChars)}-1!==c&&(a=c+e)}c.push(d.substring(0,a)),d=d.substring(a)}return c}(a,N);await b({type:"status",task:"summary",message:`Content divided into ${f.length} chunks. Processing sequentially.`});let g=[];for(let a=0;a<f.length;a++){let d=`Processing summary for chunk ${a+1} of ${f.length}...`;await b({type:"status",task:"summary",message:d});let h="";h=await aa("summary",d,b,async()=>_(v.summarySystem,v.summaryUserSegment(f[a],a+1,f.length),e,.5,async c=>{await b({type:"summary_token",content:c,chunkIndex:a,totalChunks:f.length})},"summary")),g.push(h),c&&await c(g.join("\n\n")),await b({type:"summary_chunk_result",content:h,chunkIndex:a,totalChunks:f.length,isFinalChunk:a===f.length-1&&f.length>1})}return 1===g.length?(d=g[0],1===f.length&&await b({type:"summary_final_result",content:d,isFinalChunk:!0}),c&&await c(d)):(await b({type:"status",task:"summary",message:"Combining chunk summaries into a final summary..."}),d=await _(v.summarySystem,v.summaryUserCombine(g),V.summary,.5,async a=>{await b({type:"summary_token",content:a,chunkIndex:-1,totalChunks:-1})},"summary"),c&&await c(d),await b({type:"summary_final_result",content:d,isFinalChunk:!0})),d}async function aj(a,b,c){await b({type:"status",task:"translation",message:"Starting translation..."});let d=X(a),e=Z(d.length,O,Q),f=Y(d,e);if(0===f.length)return await b({type:"translation_final_result",content:"",chunkIndex:0,totalChunks:0,isFinalChunk:!0}),"";if(await b({type:"status",task:"translation",message:`Content divided into ${f.length} chunks (~${e} blocks/chunk). Concurrency: ${S}.`}),1===f.length){let a=await _(v.translateSystem,v.translateUserFull(f[0]),V.translation,.3,async a=>{await b({type:"translation_token",content:a,chunkIndex:0,totalChunks:1})},"translation");return c&&await c(a),await b({type:"translation_chunk_result",content:a,chunkIndex:0,totalChunks:1,isFinalChunk:!0}),await b({type:"translation_final_result",content:a,chunkIndex:0,totalChunks:1,isFinalChunk:!0}),a}let g=Array(f.length).fill(""),h=0,i=-1,j=async()=>{if(!c)return;let a=i+1;for(;a<g.length&&g[a];)a+=1;let b=a-1;b>i&&(i=b,await c(g.slice(0,i+1).join("\n\n")))};await $(f,S,async(a,c)=>{let d=`Processing translation for chunk ${c+1} of ${f.length}...`;await b({type:"status",task:"translation",message:d});let e=await aa("translation",d,b,async()=>_(v.translateSystem,v.translateUserSegment(a,c+1,f.length),V.translation,.3,async a=>{await b({type:"translation_token",content:a,chunkIndex:c,totalChunks:f.length})},"translation"));return g[c]=e,h+=1,await j(),await b({type:"translation_chunk_result",content:e,chunkIndex:c,totalChunks:f.length,isFinalChunk:c===f.length-1,message:`Translation chunk ${c+1}/${f.length} completed (${h}/${f.length})`}),e});let k=g.join("\n\n");return c&&await c(k),await b({type:"translation_final_result",content:k,chunkIndex:f.length-1,totalChunks:f.length,isFinalChunk:!0}),k}async function ak(a,b,c){await b({type:"status",task:"highlights",message:"Starting highlights generation..."});let d=X(a),e=Z(d.length,P,R),f=Y(d,e);if(0===f.length)return await b({type:"highlight_final_result",content:"",chunkIndex:0,totalChunks:0,isFinalChunk:!0}),"";if(await b({type:"status",task:"highlights",message:`Content divided into ${f.length} chunks (~${e} blocks/chunk). Concurrency: ${T}.`}),1===f.length){let a=await _(v.highlightSystem,v.highlightUserFull(f[0]),V.highlights,.3,async a=>{await b({type:"highlight_token",content:a,chunkIndex:0,totalChunks:1})},"highlights");return c&&await c(a),await b({type:"highlight_chunk_result",content:a,chunkIndex:0,totalChunks:1,isFinalChunk:!0}),await b({type:"highlight_final_result",content:a,chunkIndex:0,totalChunks:1,isFinalChunk:!0}),a}let g=Array(f.length).fill(""),h=0,i=-1,j=async()=>{if(!c)return;let a=i+1;for(;a<g.length&&g[a];)a+=1;let b=a-1;b>i&&(i=b,await c(g.slice(0,i+1).join("\n\n")))};await $(f,T,async(a,c)=>{let d=`Processing highlights for chunk ${c+1} of ${f.length}...`;await b({type:"status",task:"highlights",message:d});let e=await aa("highlights",d,b,async()=>_(v.highlightSystem,v.highlightUserSegment(a,c+1,f.length),V.highlights,.3,async a=>{await b({type:"highlight_token",content:a,chunkIndex:c,totalChunks:f.length})},"highlights"));return g[c]=e,h+=1,await j(),await b({type:"highlight_chunk_result",content:e,chunkIndex:c,totalChunks:f.length,isFinalChunk:c===f.length-1,message:`Highlights chunk ${c+1}/${f.length} completed (${h}/${f.length})`}),e});let k=g.join("\n\n");return c&&await c(k),await b({type:"highlight_final_result",content:k,chunkIndex:f.length-1,totalChunks:f.length,isFinalChunk:!0}),k}function al(a){try{return JSON.parse(a)}catch(a){return console.error("Error parsing JSON:",a),{}}}async function am(a){console.log("Process API called");let b=await a.json();if(!b||!b.id||!b.blobUrl)return u.NextResponse.json({error:"Invalid request data. Missing required fields."},{status:400});let{id:c,blobUrl:d}=b,e=a.headers.get("x-process-worker-secret"),f=!!(0,A.zy)(e),g=await (0,x.rL)(c);if(!g.success)return u.NextResponse.json({error:"Podcast not found"},{status:404});let h=g.data;if(!f){let a=await (0,y.getServerSession)(z.N);if(!a?.user?.id)return u.NextResponse.json({error:"Authentication required"},{status:401});if(!h.userId||h.userId!==a.user.id)return u.NextResponse.json({error:"Access denied"},{status:403})}let i=new TextEncoder,j=new ReadableStream({async start(a){try{let b,e,f;console.log(`Processing file with ID: ${c}, URL: ${d}`);let g=async b=>{a.enqueue(i.encode(`data: ${JSON.stringify(b)}

`))};await g({type:"status",message:"Starting processing..."});let j=async a=>{let b=await (0,x.ZP)({podcastId:c,summary:a.summary??null,summaryZh:a.summaryZh??null,summaryEn:a.summaryEn??null,briefSummary:a.briefSummary??null,translation:a.translation??null,highlights:a.highlights??null});b.success||console.error("保存分析结果增量失败:",b.error)},k=await fetch(d);if(!k.ok)throw Error(`Failed to fetch file content: ${k.statusText}`);let l=(await k.text()).replace(/^\uFEFF/,"");if(0===l.length)throw Error("SRT file is empty");let m=await ab(l),n=function(a){let b=a.trim();if(!b)return{tokenCount:0,wordCount:0,characterCount:0};let c=b.length,d=(b.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)||[]).length,e=(b.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)||[]).length,f=(b.match(/[\x00-\x7F]/g)||[]).length;return{tokenCount:Math.max(1,Math.round(f/4+(c-f))),wordCount:d+e,characterCount:c}}(m);await g({type:"status",message:"Content loaded. Starting analysis pipeline..."});let o=async()=>{let a=await ai(m,g,async a=>{await j({summary:a})}),b=function(a){let b=ae(a);if(!b)return{summaryLegacy:"",summaryZh:"",summaryEn:""};let c="",d="",e=b.indexOf(ac),f=b.indexOf(ad);if(e>=0&&f>e)c=ae(b.slice(e+ac.length,f)),d=ae(b.slice(f+ad.length));else{let a=b.search(/#\s*English Summary/i),e=b.search(/#\s*中文总结/i);a>=0&&e>a?(c=ae(b.slice(a,e)),d=ae(b.slice(e))):e>=0?(d=ae(b.slice(e)),c=ae(b.slice(0,e))):d=b}let g=c||ae(b),h=d||ae(b);return{summaryLegacy:h,summaryZh:h,summaryEn:g}}(a);return await j({summary:b.summaryLegacy,summaryZh:b.summaryZh,summaryEn:b.summaryEn}),b},p=async()=>{let a=await aj(l,g,async a=>{await j({translation:a})});return await j({translation:a}),a},q=async()=>{let a=await ak(l,g,async a=>{await j({highlights:a})});return await j({highlights:a}),a},r="",s="",t="",u="",v=null,w=null,y=null;U?(await g({type:"status",message:`Running summary, translation, and highlights in parallel. Model: ${H}`}),[f,b,e]=await Promise.all([o(),p(),q()])):(await g({type:"status",message:`Running summary, translation, and highlights sequentially. Model: ${H}`}),f=await o(),b=await p(),e=await q()),r=f.summaryLegacy,s=f.summaryZh,t=f.summaryEn,await g({type:"status",message:"Generating brief list summary..."}),u=await ah({title:h.title??null,sourceReference:h.sourceReference??null,summaryZh:s,highlights:e}),await j({briefSummary:u}),await g({type:"status",message:"Brief list summary generated."}),await g({type:"status",message:"Generating mind map..."});let z=await E({title:h.title??null,sourceReference:h.sourceReference??null,summary:s||r,highlights:e,language:"zh"}),A=await E({title:h.title??null,sourceReference:h.sourceReference??null,summary:t||s||r,highlights:e,language:"en"});z.success&&z.data&&(w=z.data,v=z.data),A.success&&A.data&&(y=A.data,v||(v=A.data)),w||y?await g({type:"status",message:"Mind map generated."}):(console.warn("脑图生成失败，继续保存主分析结果:",{zhError:z.error,enError:A.error}),await g({type:"status",message:"Mind map generation skipped."})),console.log(`准备保存分析结果，podcastId: ${c}, 类型: ${typeof c}`);try{await (0,x.ID)({podcastId:c,summary:r,summaryZh:s,summaryEn:t,briefSummary:u,translation:b,highlights:e,mindMapJson:v,mindMapJsonZh:w,mindMapJsonEn:y,tokenCount:n.tokenCount,wordCount:n.wordCount,characterCount:n.characterCount}),console.log(`分析结果保存成功，podcastId: ${c}`)}catch(a){console.error("保存分析结果到数据库失败:",a)}await g({type:"status",message:"Building QA retrieval index..."});let C=await (0,B.Es)({podcastId:c,summary:s||r,translation:b,highlights:e,transcriptSrt:l});C.success?console.log(`QA 检索索引构建完成，podcastId: ${c}, chunks: ${C.chunkCount}`):console.error("构建 QA 检索索引失败:",C.error),await g({type:"all_done",finalResults:{summary:r,summaryZh:s,summaryEn:t,briefSummary:u,translation:b,highlights:e,mindMapJson:v,mindMapJsonZh:w,mindMapJsonEn:y}}),a.close()}catch(b){console.error("Error in process stream:",b),a.enqueue(i.encode(`data: ${JSON.stringify({type:"error",message:b instanceof Error?b.message:"Unknown error during processing",task:"process"})}

`)),a.close()}}});return new Response(j,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive"}})}let an=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/process/route",pathname:"/api/process",filename:"route",bundlePath:"app/api/process/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/chenzixin/projects/PodcastSummarizer/app/api/process/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:ao,workUnitAsyncStorage:ap,serverHooks:aq}=an;function ar(){return(0,g.patchFetch)({workAsyncStorage:ao,workUnitAsyncStorage:ap})}async function as(a,b,c){var d;let e="/api/process/route";"/index"===e&&(e="/");let g=await an.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:C}=g,D=(0,j.normalizeAppPath)(e),E=!!(y.dynamicRoutes[D]||y.routes[C]);if(E&&!x){let a=!!y.routes[C],b=y.dynamicRoutes[D];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let F=null;!E||an.isDev||x||(F="/index"===(F=C)?"/":F);let G=!0===an.isDev||!E,H=E&&!G,I=a.method||"GET",J=(0,i.getTracer)(),K=J.getActiveScopeSpan(),L={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:G,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:H,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>an.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},M=new k.NodeNextRequest(a),N=new k.NodeNextResponse(b),O=l.NextRequestAdapter.fromNodeNextRequest(M,(0,l.signalFromNodeResponse)(b));try{let d=async c=>an.handle(O,L).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=J.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${I} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${I} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=L.renderOpts.fetchMetrics;let i=L.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=L.renderOpts.collectedTags;if(!E)return await (0,o.I)(M,N,e,L.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==L.renderOpts.collectedRevalidate&&!(L.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&L.renderOpts.collectedRevalidate,d=void 0===L.renderOpts.collectedExpire||L.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:L.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await an.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:H,isOnDemandRevalidate:A})},z),b}},l=await an.handleResponse({req:a,nextConfig:w,cacheKey:F,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!E)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&E||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(M,N,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};K?await g(K):await J.withPropagatedContext(a.headers,()=>J.trace(m.BaseServerSpan.handleRequest,{spanName:`${I} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":I,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await an.onRequestError(a,b,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:H,isOnDemandRevalidate:A})}),E)throw b;return await (0,o.I)(M,N,new Response(null,{status:500})),null}}},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},74075:a=>{a.exports=require("zlib")},77598:a=>{a.exports=require("node:crypto")},79428:a=>{a.exports=require("buffer")},79551:a=>{a.exports=require("url")},81630:a=>{a.exports=require("http")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{a.exports=require("net")},94735:a=>{a.exports=require("events")},96733:(a,b,c)=>{function d(a){if("string"!=typeof a)return null;let b=a.trim();return b.length>0?b:null}function e(){return d(process.env.CRON_SECRET)}function f(){return Array.from(new Set([d(process.env.PROCESS_WORKER_SECRET),d(process.env.NEXTAUTH_SECRET),d(process.env.AUTH_SECRET)].filter(a=>!!a)))}function g(){let a=f();return a.length>0?a[0]:null}function h(a){if(!a)return!1;let b=f();return 0!==b.length&&b.includes(a)}c.d(b,{N6:()=>f,ru:()=>e,xe:()=>g,zy:()=>h})}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[4996,1692,9725,7028,5106,7146,4735],()=>b(b.s=59521));module.exports=c})();