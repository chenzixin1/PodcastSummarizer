"use strict";exports.id=4735,exports.ids=[4735],exports.modules={1434:(a,b,c)=>{c.d(b,{a:()=>d});let d={API_VERSION:"1.0.1",MODEL:"google/gemini-2.5-flash",MAX_CONTENT_LENGTH:parseInt("300000",10),SUMMARY_CHUNK_LENGTH:parseInt("80000",10),TRANSLATION_CHUNK_BLOCKS:parseInt("120",10),HIGHLIGHTS_CHUNK_BLOCKS:parseInt("120",10),MAX_TRANSLATION_CHUNKS:parseInt(process.env.MAX_TRANSLATION_CHUNKS||"24",10),MAX_HIGHLIGHTS_CHUNKS:parseInt(process.env.MAX_HIGHLIGHTS_CHUNKS||"24",10),TRANSLATION_CHUNK_CONCURRENCY:parseInt(process.env.TRANSLATION_CHUNK_CONCURRENCY||"3",10),HIGHLIGHTS_CHUNK_CONCURRENCY:parseInt(process.env.HIGHLIGHTS_CHUNK_CONCURRENCY||"2",10),ENABLE_PARALLEL_TASKS:"false"!==process.env.ENABLE_PARALLEL_TASKS,MAX_TOKENS:{summary:parseInt("8000",10),translation:parseInt("16000",10),highlights:parseInt("12000",10)},MAX_RETRIES:parseInt("2",10),RETRY_DELAY:parseInt("1000",10),API_TIMEOUT_MS:parseInt(process.env.API_TIMEOUT_MS||"120000",10),STATUS_HEARTBEAT_MS:parseInt(process.env.STATUS_HEARTBEAT_MS||"8000",10)}},42154:(a,b,c)=>{c.d(b,{Es:()=>u,mE:()=>x,pD:()=>w});var d=c(79725);let e=process.env.OPENROUTER_EMBEDDING_MODEL||process.env.OPENROUTER_QA_EMBEDDING_MODEL||"openai/text-embedding-3-small",f=Math.max(1,Math.min(32,Number.parseInt(process.env.QA_EMBEDDING_BATCH_SIZE||"16",10))),g=Math.max(40,Math.min(400,Number.parseInt(process.env.QA_MAX_TOTAL_CHUNKS||"180",10))),h=new Set(["这个","那个","哪些","什么","如何","为什么","请问","一下","里面","还有","关于","可以","是否","是不是","有没有","总结","翻译","全文","重点","相关"]),i=new Set(["the","and","that","this","what","with","from","about","have","will","would","could","should","which","where","when","how","why","are","is","for","you","your","podcast","episode","into","than","then","there","their","they","them","been","were","was","can","did","does","any","more","less","just","also","talked","mention"]),j=[{triggers:["失业","就业","岗位","裁员","工作"],terms:["就业","失业","岗位","裁员","工作","职位","劳动力","招聘","需求"]},{triggers:["风险","影响","冲击"],terms:["风险","影响","冲击","副作用","不确定性","隐患"]},{triggers:["ai","人工智能","模型","自动化"],terms:["ai","人工智能","模型","自动化","agent","智能体","效率"]}];function k(a){return"string"!=typeof a?"":a.replace(/\r\n/g,"\n").replace(/\u0000/g,"").trim()}function l(a){if(!a)return null;if(Array.isArray(a)){let b=a.map(a=>Number(a)).filter(a=>Number.isFinite(a));return b.length>0?b:null}if("string"==typeof a)try{let b=JSON.parse(a);if(Array.isArray(b)){let a=b.map(a=>Number(a)).filter(a=>Number.isFinite(a));return a.length>0?a:null}}catch{}return null}function m(a){let b=a.match(/^(\d{2}):(\d{2}):(\d{2})(?:[,.:](\d{1,3}))?$/);if(!b)return null;let c=Number.parseInt(b[1],10),d=Number.parseInt(b[2],10),e=Number.parseInt(b[3],10),f=Number.parseInt((b[4]||"0").padEnd(3,"0").slice(0,3),10);return Number.isFinite(c)&&Number.isFinite(d)&&Number.isFinite(e)&&Number.isFinite(f)?Math.floor(3600*c+60*d+e+f/1e3):null}function n(a,b,c,d){let e=k(a);if(!e)return[];if(e.length<=b)return[{source:d,chunkIndex:0,startSec:null,endSec:null,content:e}];let f=[],g=0,h=0;for(;g<e.length;){let a=Math.min(e.length,g+b),i=a;if(a<e.length){let c=e.slice(g,a),d=Math.max(c.lastIndexOf("\n\n"),c.lastIndexOf("。"),c.lastIndexOf(". "));d>Math.floor(.55*b)&&(i=g+d+1)}let j=e.slice(g,i).trim();if(j&&(f.push({source:d,chunkIndex:h,startSec:null,endSec:null,content:j}),h+=1),i>=e.length)break;g=Math.max(i-c,g+1)}return f}function o(a){if("number"!=typeof a||!Number.isFinite(a)||a<0)return"00:00:00";let b=Math.floor(a/3600).toString().padStart(2,"0"),c=Math.floor(a%3600/60).toString().padStart(2,"0"),d=Math.floor(a%60).toString().padStart(2,"0");return`${b}:${c}:${d}`}function p(a){let b=k(a).toLowerCase();if(!b)return"";let c=new Set([b]);for(let a of j)if(a.triggers.some(a=>b.includes(a)))for(let b of a.terms)c.add(b);return Array.from(c).join(" ")}async function q(a){let b=process.env.OPENROUTER_API_KEY;if(!b)return a.map(()=>null);if(0===a.length)return[];try{let c=await fetch("https://openrouter.ai/api/v1/embeddings",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${b}`,"HTTP-Referer":process.env.NEXTAUTH_URL?process.env.NEXTAUTH_URL:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"http://localhost:3000","X-Title":"PodSum.cc QA Embeddings"},body:JSON.stringify({model:e,input:a.map(a=>a.slice(0,3e3))})});if(!c.ok)return a.map(()=>null);let d=await c.json();if(!Array.isArray(d.data))return a.map(()=>null);let f=d.data.map(a=>l(a.embedding));if(f.length<a.length)return[...f,...Array.from({length:a.length-f.length},()=>null)];return f.slice(0,a.length)}catch{return a.map(()=>null)}}async function r(a){if(0===a.length)return[];let b=[];for(let c=0;c<a.length;c+=f){let d=a.slice(c,c+f),e=await q(d);b.push(...e)}return b}function s(a){return"transcript"===a?.08:"highlights"===a?.07:"translation"===a?.05:.04}async function t(){await (0,d.ll)`
    CREATE TABLE IF NOT EXISTS qa_context_chunks (
      id BIGSERIAL PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      source TEXT NOT NULL,
      start_sec INTEGER,
      end_sec INTEGER,
      content TEXT NOT NULL,
      content_tsv TSVECTOR,
      embedding_json JSONB,
      embedding_model TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (podcast_id, source, chunk_index)
    )
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_podcast
    ON qa_context_chunks (podcast_id, source, chunk_index)
  `,await (0,d.ll)`
    CREATE INDEX IF NOT EXISTS idx_qa_context_chunks_content_tsv
    ON qa_context_chunks USING GIN (content_tsv)
  `}async function u(a){try{await t();let b=function(a){let b=n(k(a.summary),900,120,"summary"),c=n(k(a.highlights),1100,140,"highlights"),d=function(a){let b=k(a);if(!b)return[];let c=b.match(/\[\d{2}:\d{2}:\d{2}\s*-->\s*\d{2}:\d{2}:\d{2}\][^\n]*/g)||[];if(0===c.length)return n(b,900,120,"translation");let d=[],e=0,f=0;for(;e<c.length;){let a=c.slice(e,e+10),b=a.join("\n").trim();if(b){let c=a[0].match(/\[(\d{2}:\d{2}:\d{2})\s*-->\s*(\d{2}:\d{2}:\d{2})\]/),e=a[a.length-1].match(/\[(\d{2}:\d{2}:\d{2})\s*-->\s*(\d{2}:\d{2}:\d{2})\]/);d.push({source:"translation",chunkIndex:f,startSec:c?m(c[1]):null,endSec:e?m(e[2]):null,content:b}),f+=1}e+=8}return d}(k(a.translation)),e=function(a){let b=function(a){let b=k(a);if(!b)return[];let c=b.split(/\n\s*\n+/g),d=[];for(let a of c){let b=a.split("\n").map(a=>a.trim()).filter(Boolean);if(0===b.length)continue;let c=0;/^\d+$/.test(b[0])&&(c=1);let e=b[c];if(!e||!e.includes("--\x3e"))continue;let[f,g]=e.split("--\x3e").map(a=>a.trim()),h=m(f),i=m(g),j=b.slice(c+1).join(" ").trim();j&&d.push({startSec:h,endSec:i,text:j})}return d}(a);if(0===b.length)return[];let c=[],d=0,e=0;for(;d<b.length;){let a=b.slice(d,d+8),f=a.map(a=>{let b=a.startSec??0,c=a.endSec??b;return`[${o(b)} --> ${o(c)}] ${a.text}`}).join("\n").trim();f&&(c.push({source:"transcript",chunkIndex:e,startSec:a[0]?.startSec??null,endSec:a[a.length-1]?.endSec??null,content:f}),e+=1),d+=6}return c}(k(a.transcriptSrt));return function(a){let b=new Set,c=[];for(let d of a){let a=k(d.content);if(!a)continue;let e=`${d.source}:${a}`;if(!b.has(e)&&(b.add(e),c.push({...d,content:a}),c.length>=g))break}return c.map((a,b)=>({...a,chunkIndex:b}))}([...b.slice(0,24),...c.slice(0,48),...d.slice(0,48),...e.slice(0,96)])}(a),c=await r(b.map(a=>a.content));await (0,d.ll)`DELETE FROM qa_context_chunks WHERE podcast_id = ${a.podcastId}`;for(let f=0;f<b.length;f+=1){let g=b[f],h=c[f];await (0,d.ll)`
        INSERT INTO qa_context_chunks (
          podcast_id,
          chunk_index,
          source,
          start_sec,
          end_sec,
          content,
          content_tsv,
          embedding_json,
          embedding_model
        )
        VALUES (
          ${a.podcastId},
          ${g.chunkIndex},
          ${g.source},
          ${g.startSec},
          ${g.endSec},
          ${g.content},
          to_tsvector('simple', ${g.content}),
          ${h?JSON.stringify(h):null}::jsonb,
          ${h?e:null}
        )
      `}return{success:!0,chunkCount:b.length}}catch(a){return{success:!1,chunkCount:0,error:a instanceof Error?a.message:String(a)}}}async function v(a){return await t(),(await (0,d.ll)`
    SELECT
      id,
      chunk_index as "chunkIndex",
      source,
      start_sec as "startSec",
      end_sec as "endSec",
      content,
      embedding_json as "embeddingJson"
    FROM qa_context_chunks
    WHERE podcast_id = ${a}
    ORDER BY source ASC, chunk_index ASC
    LIMIT 1000
  `).rows.map(a=>({id:Number(a.id),chunkIndex:Number(a.chunkIndex),source:String(a.source),startSec:null===a.startSec||void 0===a.startSec?null:Number(a.startSec),endSec:null===a.endSec||void 0===a.endSec?null:Number(a.endSec),content:String(a.content||""),embedding:l(a.embeddingJson)}))}async function w(a,b,c=8){let d=await v(a);if(0===d.length)return[];let e=function(a){let b=p(a),c=b.match(/[a-z0-9][a-z0-9_-]{1,}/g)||[],d=b.match(/[\u4e00-\u9fff]{2,6}/g)||[],e=b.match(/[\u4e00-\u9fff]/g)||[],f=[];for(let a=0;a<e.length-1;a++)f.push(`${e[a]}${e[a+1]}`);return Array.from(new Set([...c,...d,...f].map(a=>a.trim()).filter(Boolean).filter(a=>/^[a-z]/.test(a)?!i.has(a):!h.has(a)).slice(0,24)))}(b),f=p(b),g=(await r([f||b]))[0]||null,j=!!(g&&g.length>0),k=d.map(a=>{let b=function(a,b){if(!a||0===b.length)return 0;let c=a.toLowerCase(),d=0,e=0;for(let a of b){let b=RegExp(a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"),f=c.match(b);f&&f.length>0&&(d+=1,e+=f.length)}return 0===d?0:Math.min(1,.75*(d/b.length)+.25*Math.min(1,e/10))}(a.content,e),c=j?function(a,b){if(!a||!b||0===a.length||0===b.length||a.length!==b.length)return 0;let c=0,d=0,e=0;for(let f=0;f<a.length;f+=1)c+=a[f]*b[f],d+=a[f]*a[f],e+=b[f]*b[f];if(0===d||0===e)return 0;let f=c/(Math.sqrt(d)*Math.sqrt(e));return Number.isFinite(f)?f:0}(g,a.embedding):0,d=j?(c+1)/2:0,f=j?.6*d+.3*b+s(a.source):.9*b+s(a.source);return{...a,lexicalScore:Number(b.toFixed(4)),semanticScore:Number(d.toFixed(4)),finalScore:Number(f.toFixed(4))}});k.sort((a,b)=>b.finalScore-a.finalScore);let l=[],m=new Set;for(let a of k){if(l.length>=c)break;if(a.finalScore<.16)continue;let b=`${a.source}:${a.chunkIndex}:${a.content.slice(0,120)}`;m.has(b)||(m.add(b),l.push(a))}return l.length>0?l:k.slice(0,Math.min(c,4))}function x(a){return"number"==typeof a.startSec||"number"==typeof a.endSec?`${a.source.toUpperCase()} ${o(a.startSec)}-${o(a.endSec)}`:`${a.source.toUpperCase()} #${a.chunkIndex+1}`}},66147:(a,b,c)=>{c.d(b,{N:()=>k});var d=c(52963),e=c.n(d),f=c(28120),g=c(75783),h=c(7028),i=c(79725),j=c(50071);let k={providers:[...process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET?[(0,g.A)({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET})]:[],(0,f.A)({name:"credentials",credentials:{email:{label:"Email",type:"email"},password:{label:"Password",type:"password"}},async authorize(a){if(!a?.email||!a?.password)return null;try{let b=await (0,i.ll)`
            SELECT id, email, password_hash, name, created_at 
            FROM users 
            WHERE email = ${a.email}
          `;if(0===b.rows.length)return null;let c=b.rows[0];if(!await h.Ay.compare(a.password,c.password_hash))return null;return{id:c.id,email:c.email,name:c.name}}catch(a){return console.error("Auth error:",a),null}}})],session:{strategy:"jwt"},pages:{signIn:"/auth/signin"},secret:process.env.NEXTAUTH_SECRET||"development-secret-key",callbacks:{async signIn({user:a,account:b,profile:c}){if(b?.provider==="google")try{let b=await (0,i.ll)`
            SELECT id FROM users WHERE email = ${a.email}
          `;if(0===b.rows.length){let b=(0,j.Ak)();await (0,i.ll)`
              INSERT INTO users (id, email, name, password_hash, created_at)
              VALUES (${b}, ${a.email}, ${a.name||a.email}, '', NOW())
            `,a.id=b}else a.id=b.rows[0].id}catch(a){return console.error("Google sign in error:",a),!1}return!0},jwt:async({token:a,user:b})=>(b&&(a.id=b.id),a),session:async({session:a,token:b})=>(b&&(a.user.id=b.id),a)}};e()(k)}};