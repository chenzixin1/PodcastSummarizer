import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

const MIND_MAP_SYSTEM_PROMPT = `
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
3. root 至少 4 个一级主题；每个一级主题至少 2 个二级主题。
4. 每个 label 不超过 36 个字符，尽量使用短语，不使用完整长句。
5. 保持层级清晰：最多 4 层，避免过深。
6. 只使用输入中可推断的信息，不得杜撰。
`.trim();

const MAX_DEPTH = 3;
const MAX_CHILDREN = 10;
const DELAY_MS = 500;

function parseArgs(argv) {
  const parsed = {
    limit: null,
    podcastId: null,
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
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
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

function buildMindMapUserPrompt(payload) {
  return `请基于以下播客信息生成脑图 JSON。

标题：
${payload.title || '未提供'}

来源：
${payload.sourceReference || '未提供'}

摘要：
${payload.summary || '未提供'}

重点内容：
${payload.highlights || '未提供'}`;
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

async function generateMindMap(payload) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

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
        { role: 'system', content: MIND_MAP_SYSTEM_PROMPT },
        { role: 'user', content: buildMindMapUserPrompt(payload) },
      ],
      temperature: 0.2,
      max_tokens: 2600,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter request failed (${response.status}): ${text || response.statusText}`);
  }

  const json = await response.json();
  const content = readChoiceContent(json?.choices?.[0]);
  if (!content.trim()) {
    throw new Error('Model returned empty response');
  }

  const objectText = extractJsonObject(content);
  const parsed = JSON.parse(objectText);
  const mindMap = normalizeMindMap(parsed);
  if (!mindMap) {
    throw new Error('Model output is not a valid mind map tree');
  }
  return mindMap;
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    return sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.highlights
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE p.id = ${options.podcastId}
      LIMIT 1
    `;
  }

  if (options.limit) {
    return sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.highlights
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE ar.mind_map_json IS NULL
        AND COALESCE(ar.summary, '') <> ''
        AND COALESCE(ar.highlights, '') <> ''
      ORDER BY p.created_at DESC
      LIMIT ${options.limit}
    `;
  }

  return sql`
    SELECT
      p.id,
      p.title,
      p.source_reference as "sourceReference",
      ar.summary,
      ar.highlights
    FROM podcasts p
    INNER JOIN analysis_results ar ON ar.podcast_id = p.id
    WHERE ar.mind_map_json IS NULL
      AND COALESCE(ar.summary, '') <> ''
      AND COALESCE(ar.highlights, '') <> ''
    ORDER BY p.created_at DESC
  `;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }

  const options = parseArgs(process.argv.slice(2));
  console.log('[mind-map] options:', options);

  await sql`
    ALTER TABLE analysis_results
    ADD COLUMN IF NOT EXISTS mind_map_json JSONB
  `;

  const rowsResult = await fetchTargetRows(options);
  console.log(`[mind-map] to process: ${rowsResult.rows.length}`);

  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < rowsResult.rows.length; i += 1) {
    const row = rowsResult.rows[i];
    const prefix = `[mind-map] ${i + 1}/${rowsResult.rows.length} podcast=${row.id}`;
    try {
      const mindMap = await generateMindMap({
        title: row.title || null,
        sourceReference: row.sourceReference || null,
        summary: row.summary || null,
        highlights: row.highlights || null,
      });

      await sql`
        UPDATE analysis_results
        SET mind_map_json = ${JSON.stringify(mindMap)}::jsonb,
            processed_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ${row.id}
      `;
      successCount += 1;
      console.log(`${prefix} -> updated`);
    } catch (error) {
      failedCount += 1;
      console.error(`${prefix} -> failed:`, error instanceof Error ? error.message : String(error));
    }

    await delay(DELAY_MS);
  }

  console.log(`[mind-map] done. total=${rowsResult.rows.length}, updated=${successCount}, failed=${failedCount}`);
}

main().catch((error) => {
  console.error('[mind-map] fatal error:', error);
  process.exit(1);
});
