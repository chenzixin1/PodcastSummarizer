import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

const MODEL = process.env.OPENROUTER_MINDMAP_MODEL || 'google/gemini-3-flash-preview';
const MAX_DEPTH = 5;
const MAX_CHILDREN = 14;
const TARGET_MIN_DEPTH = 5;
const DELAY_MS = 500;

const MIND_MAP_SYSTEM_PROMPT_ZH = `
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
5. 每个 label 必须是完整信息句，不要只给关键词短语；尽量包含结论 + 依据 + 影响/行动。
6. 每个 label 建议 22~120 个中文字符（或等价信息密度），允许更长。
7. 只使用输入中可推断的信息，不得杜撰。
`.trim();

const MIND_MAP_SYSTEM_PROMPT_EN = `
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
`.trim();

function parseArgs(argv) {
  const parsed = {
    limit: null,
    podcastId: null,
    all: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.limit = value;
      }
    } else if (arg.startsWith('--id=')) {
      const value = arg.slice('--id='.length).trim();
      if (value) {
        parsed.podcastId = value;
      }
    } else if (arg === '--all' || arg === '--overwrite') {
      parsed.all = true;
    }
  }
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function normalizeNode(value, depth) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const label = cleanLabel(value.label);
  if (!label) {
    return null;
  }

  const node = { label };
  if (depth >= MAX_DEPTH || !Array.isArray(value.children) || value.children.length === 0) {
    return node;
  }

  const children = [];
  const dedupe = new Set();
  for (const child of value.children) {
    if (children.length >= MAX_CHILDREN) {
      break;
    }
    const normalized = normalizeNode(child, depth + 1);
    if (!normalized) {
      continue;
    }
    const key = normalized.label.toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    children.push(normalized);
  }
  if (children.length > 0) {
    node.children = children;
  }
  return node;
}

function extractJsonObject(rawOutput) {
  const cleaned = String(rawOutput || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return cleaned;
  }

  const start = cleaned.indexOf('{');
  if (start === -1) {
    return cleaned;
  }

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return cleaned.slice(start);
}

function normalizeMindMap(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const rootCandidate = parsed.root || parsed;
  const root = normalizeNode(rootCandidate, 0);
  if (!root || !Array.isArray(root.children) || root.children.length === 0) {
    return null;
  }
  return { root };
}

function getMindMapDepth(mindMap) {
  const walk = (node, depth) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      return depth;
    }
    let maxDepth = depth;
    children.forEach((child) => {
      maxDepth = Math.max(maxDepth, walk(child, depth + 1));
    });
    return maxDepth;
  };
  return walk(mindMap.root, 1);
}

function buildMindMapUserPrompt(payload, language) {
  if (language === 'en') {
    return `Generate an information-dense mind-map JSON in English based on:\n\nTitle:\n${payload.title || 'N/A'}\n\nSource:\n${payload.sourceReference || 'N/A'}\n\nSummary:\n${payload.summary || 'N/A'}\n\nFull Text Notes:\n${payload.highlights || 'N/A'}`;
  }

  return `请基于以下播客信息生成“高信息密度”的脑图 JSON，并尽量写成更完整、更易记忆的句子节点（不追求短）。\n\n标题：\n${payload.title || '未提供'}\n\n来源：\n${payload.sourceReference || '未提供'}\n\n摘要：\n${payload.summary || '未提供'}\n\n重点内容：\n${payload.highlights || '未提供'}`;
}

function readChoiceContent(choice) {
  if (!choice || typeof choice !== 'object') {
    return '';
  }
  const message = choice.message;
  if (!message || typeof message !== 'object') {
    return '';
  }
  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          return item.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function generateMindMap(payload, language) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  let bestCandidate = null;
  let lastError = '';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
        'X-Title': 'PodSum.cc',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: language === 'en' ? MIND_MAP_SYSTEM_PROMPT_EN : MIND_MAP_SYSTEM_PROMPT_ZH },
          {
            role: 'user',
            content:
              `${buildMindMapUserPrompt(payload, language)}\n\n` +
              (language === 'en'
                ? 'Additional hard requirement: at least two branches must reach level 5; if enough detail exists, level 6 is allowed.'
                : '额外硬性要求：至少两个分支必须达到第5层；如果信息充足可达到第6层。'),
          },
        ],
        temperature: 0.35,
        max_tokens: 6000,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      lastError = `OpenRouter request failed (${response.status}): ${text || response.statusText}`;
      continue;
    }

    const json = await response.json();
    const content = readChoiceContent(json?.choices?.[0]);
    if (!content.trim()) {
      lastError = 'Model returned empty response';
      continue;
    }

    const objectText = extractJsonObject(content);
    const parsed = JSON.parse(objectText);
    const mindMap = normalizeMindMap(parsed);
    if (!mindMap) {
      lastError = 'Model output is not a valid mind map tree';
      continue;
    }

    const depth = getMindMapDepth(mindMap);
    if (!bestCandidate || depth > bestCandidate.depth) {
      bestCandidate = { mindMap, depth };
    }
    if (depth >= TARGET_MIN_DEPTH) {
      return mindMap;
    }
    lastError = `Mind map depth ${depth} is shallower than target ${TARGET_MIN_DEPTH}`;
  }

  if (bestCandidate) {
    return bestCandidate.mindMap;
  }

  throw new Error(lastError || 'Failed to generate mind map');
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    const result = await sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.summary_en as "summaryEn",
        ar.translation,
        ar.highlights,
        ar.mind_map_json_zh as "mindMapJsonZh",
        ar.mind_map_json_en as "mindMapJsonEn"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE p.id = ${options.podcastId}
      LIMIT 1
    `;
    return result.rows;
  }

  if (options.all) {
    if (options.limit) {
      const result = await sql`
        SELECT
          p.id,
          p.title,
          p.source_reference as "sourceReference",
          ar.summary,
          ar.summary_zh as "summaryZh",
          ar.summary_en as "summaryEn",
          ar.translation,
          ar.highlights,
          ar.mind_map_json_zh as "mindMapJsonZh",
          ar.mind_map_json_en as "mindMapJsonEn"
        FROM podcasts p
        INNER JOIN analysis_results ar ON ar.podcast_id = p.id
        WHERE COALESCE(ar.highlights, '') <> ''
          AND COALESCE(ar.summary_zh, ar.summary, '') <> ''
        ORDER BY p.created_at DESC
        LIMIT ${options.limit}
      `;
      return result.rows;
    }

    const result = await sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.summary_en as "summaryEn",
        ar.translation,
        ar.highlights,
        ar.mind_map_json_zh as "mindMapJsonZh",
        ar.mind_map_json_en as "mindMapJsonEn"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(ar.highlights, '') <> ''
        AND COALESCE(ar.summary_zh, ar.summary, '') <> ''
      ORDER BY p.created_at DESC
    `;
    return result.rows;
  }

  if (options.limit) {
    const result = await sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.summary_en as "summaryEn",
        ar.translation,
        ar.highlights,
        ar.mind_map_json_zh as "mindMapJsonZh",
        ar.mind_map_json_en as "mindMapJsonEn"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(ar.highlights, '') <> ''
        AND COALESCE(ar.summary_zh, ar.summary, '') <> ''
        AND (ar.mind_map_json_zh IS NULL OR ar.mind_map_json_en IS NULL)
      ORDER BY p.created_at DESC
      LIMIT ${options.limit}
    `;
    return result.rows;
  }

  const result = await sql`
    SELECT
      p.id,
      p.title,
      p.source_reference as "sourceReference",
      ar.summary,
      ar.summary_zh as "summaryZh",
      ar.summary_en as "summaryEn",
      ar.translation,
      ar.highlights,
      ar.mind_map_json_zh as "mindMapJsonZh",
      ar.mind_map_json_en as "mindMapJsonEn"
    FROM podcasts p
    INNER JOIN analysis_results ar ON ar.podcast_id = p.id
    WHERE COALESCE(ar.highlights, '') <> ''
      AND COALESCE(ar.summary_zh, ar.summary, '') <> ''
      AND (ar.mind_map_json_zh IS NULL OR ar.mind_map_json_en IS NULL)
    ORDER BY p.created_at DESC
  `;
  return result.rows;
}

function toJsonb(value) {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }

  const options = parseArgs(process.argv.slice(2));
  console.log('[mind-map] options:', options);

  await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json JSONB`;
  await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json_zh JSONB`;
  await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS mind_map_json_en JSONB`;

  const rows = await fetchTargetRows(options);
  console.log(`[mind-map] to process: ${rows.length}`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const prefix = `[mind-map] ${i + 1}/${rows.length} podcast=${row.id}`;

    const summaryZh = String(row.summaryZh || row.summary || '').trim();
    const summaryEn = String(row.summaryEn || '').trim();
    const translation = String(row.translation || '').trim();
    const highlights = String(row.highlights || '').trim();

    let mindMapZh = null;
    let mindMapEn = null;

    try {
      if (summaryZh && highlights) {
        mindMapZh = await generateMindMap(
          {
            title: row.title || null,
            sourceReference: row.sourceReference || null,
            summary: summaryZh,
            highlights,
          },
          'zh'
        );
      }

      if ((summaryEn || summaryZh) && (translation || highlights)) {
        mindMapEn = await generateMindMap(
          {
            title: row.title || null,
            sourceReference: row.sourceReference || null,
            summary: summaryEn || summaryZh,
            highlights: translation || highlights,
          },
          'en'
        );
      }

      await sql`
        UPDATE analysis_results
        SET mind_map_json = COALESCE(${toJsonb(mindMapZh || mindMapEn)}::jsonb, mind_map_json),
            mind_map_json_zh = COALESCE(${toJsonb(mindMapZh)}::jsonb, mind_map_json_zh),
            mind_map_json_en = COALESCE(${toJsonb(mindMapEn)}::jsonb, mind_map_json_en),
            processed_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ${row.id}
      `;

      updated += 1;
      console.log(`${prefix} -> updated (zh=${Boolean(mindMapZh)}, en=${Boolean(mindMapEn)})`);
    } catch (error) {
      failed += 1;
      console.error(`${prefix} -> failed:`, error instanceof Error ? error.message : String(error));
    }

    await delay(DELAY_MS);
  }

  console.log(`[mind-map] done. total=${rows.length}, updated=${updated}, failed=${failed}`);
}

main().catch((error) => {
  console.error('[mind-map] fatal error:', error);
  process.exit(1);
});
