import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

const MODEL = process.env.OPENROUTER_BRIEF_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const DELAY_MS = Number.parseInt(process.env.BRIEF_REBUILD_DELAY_MS || '600', 10);
const MAX_TOKENS = Number.parseInt(process.env.BRIEF_REBUILD_MAX_TOKENS || '400', 10);

const BRIEF_SUMMARY_SYSTEM_PROMPT = `
你是内容编辑助手。请输出一段中文简介，用于列表卡片预览。

硬性要求：
1. 只输出一段纯文本，不要 Markdown、标题、项目符号、引号或前后缀说明。
2. 长度控制在 100-200 个汉字左右，尽量接近 150 字。
3. 优先写：主题、核心观点、关键结论/分歧、可执行信息。
4. 禁止编造，信息不足时要如实概括。
5. 语言简洁自然，便于用户在点开前快速判断内容价值。
`.trim();

const BRIEF_SUMMARY_MIN_CHARS = 100;
const BRIEF_SUMMARY_MAX_CHARS = 220;

function parseArgs(argv) {
  const parsed = {
    podcastId: null,
    limit: null,
    all: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--id=')) {
      const value = arg.slice('--id='.length).trim();
      if (value) {
        parsed.podcastId = value;
      }
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        parsed.limit = value;
      }
      continue;
    }
    if (arg === '--all' || arg === '--overwrite') {
      parsed.all = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripMarkdownToPlainText(input) {
  return String(input || '')
    .replace(/#\s*English Summary/gi, ' ')
    .replace(/#\s*中文总结/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimToNaturalBoundary(input, maxChars) {
  const normalized = String(input || '').trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  const candidate = normalized.slice(0, maxChars);
  const punctuation = ['。', '！', '？', '.', '!', '?', '；', ';', '，', ','];
  let best = -1;
  for (const token of punctuation) {
    const index = candidate.lastIndexOf(token);
    if (index > best) {
      best = index;
    }
  }
  if (best >= Math.floor(maxChars * 0.6)) {
    return candidate.slice(0, best + 1).trim();
  }
  return candidate.trim();
}

function extractChineseSummaryBody(summary) {
  const normalized = String(summary || '');
  if (!normalized) {
    return '';
  }
  const chineseHeaderIndex = normalized.indexOf('# 中文总结');
  if (chineseHeaderIndex >= 0) {
    return normalized.slice(chineseHeaderIndex);
  }
  return normalized;
}

function buildFallbackBriefSummary(summary, highlights) {
  const chineseSummary = extractChineseSummaryBody(summary);
  const lines = chineseSummary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
  const base = bullets.length > 0
    ? bullets.slice(0, 4).join('；')
    : `${chineseSummary}\n${highlights || ''}`;
  const plain = stripMarkdownToPlainText(base);
  return trimToNaturalBoundary(plain, BRIEF_SUMMARY_MAX_CHARS);
}

function finalizeBriefSummary(rawText, fallback) {
  const normalized = trimToNaturalBoundary(
    stripMarkdownToPlainText(rawText).replace(/^["“”']+|["“”']+$/g, '').trim(),
    BRIEF_SUMMARY_MAX_CHARS
  );
  if (normalized.length >= BRIEF_SUMMARY_MIN_CHARS) {
    return normalized;
  }
  if (!fallback) {
    return normalized;
  }
  if (!normalized) {
    return fallback;
  }
  return trimToNaturalBoundary(`${normalized} ${fallback}`, BRIEF_SUMMARY_MAX_CHARS);
}

function buildBriefSummaryUserPrompt(payload) {
  return `请基于以下播客信息，生成一段用于列表展示的中文简介（100-200字）：

标题：
${payload.title || '未提供'}

来源：
${payload.sourceReference || '未提供'}

详细摘要：
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

async function generateBriefSummaryWithModel(payload) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

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
          { role: 'system', content: BRIEF_SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: buildBriefSummaryUserPrompt(payload) },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      lastError = `OpenRouter request failed (${response.status}): ${text || response.statusText}`;
      continue;
    }

    const json = await response.json();
    const content = readChoiceContent(json?.choices?.[0]).trim();
    if (!content) {
      lastError = 'Model returned empty response';
      continue;
    }
    return content;
  }

  throw new Error(lastError || 'Failed to generate brief summary');
}

function needsRebuild(briefSummary) {
  const raw = String(briefSummary || '').trim();
  if (!raw) {
    return true;
  }
  if (raw.length < 40) {
    return true;
  }
  if (/#/.test(raw) || /English Summary/i.test(raw) || /^- /.test(raw)) {
    return true;
  }
  return false;
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    const rows = await sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.highlights,
        ar.brief_summary as "briefSummary"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE p.id = ${options.podcastId}
        AND COALESCE(ar.summary_zh, ar.summary, '') <> ''
      LIMIT 1
    `;
    if (options.all) {
      return rows;
    }
    return {
      rows: rows.rows.filter((row) => needsRebuild(row.briefSummary)),
    };
  }

  if (options.limit) {
    const rows = await sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.highlights,
        ar.brief_summary as "briefSummary"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(ar.summary_zh, ar.summary, '') <> ''
      ORDER BY p.created_at DESC
      LIMIT ${options.limit}
    `;
    if (options.all) {
      return rows;
    }
    return {
      rows: rows.rows.filter((row) => needsRebuild(row.briefSummary)),
    };
  }

  if (options.all) {
    return sql`
      SELECT
        p.id,
        p.title,
        p.source_reference as "sourceReference",
        ar.summary,
        ar.summary_zh as "summaryZh",
        ar.highlights,
        ar.brief_summary as "briefSummary"
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(ar.summary_zh, ar.summary, '') <> ''
      ORDER BY p.created_at DESC
    `;
  }

  return sql`
    SELECT
      p.id,
      p.title,
      p.source_reference as "sourceReference",
      ar.summary,
      ar.summary_zh as "summaryZh",
      ar.highlights,
      ar.brief_summary as "briefSummary"
    FROM podcasts p
    INNER JOIN analysis_results ar ON ar.podcast_id = p.id
    WHERE COALESCE(ar.summary_zh, ar.summary, '') <> ''
      AND (
        ar.brief_summary IS NULL
        OR TRIM(ar.brief_summary) = ''
        OR ar.brief_summary ILIKE '%english summary%'
        OR ar.brief_summary ~ '#'
      )
    ORDER BY p.created_at DESC
  `;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }

  const options = parseArgs(process.argv.slice(2));
  console.log('[brief-summary] options:', options);

  await sql`
    ALTER TABLE analysis_results
    ADD COLUMN IF NOT EXISTS brief_summary TEXT
  `;

  const rowsResult = await fetchTargetRows(options);
  console.log(`[brief-summary] to process: ${rowsResult.rows.length}`);

  const hasModel = Boolean(process.env.OPENROUTER_API_KEY);
  if (!hasModel) {
    console.warn('[brief-summary] OPENROUTER_API_KEY missing, fallback-only mode.');
  }

  let updated = 0;
  let fallbackUsed = 0;
  let failed = 0;

  for (let i = 0; i < rowsResult.rows.length; i += 1) {
    const row = rowsResult.rows[i];
    const prefix = `[brief-summary] ${i + 1}/${rowsResult.rows.length} podcast=${row.id}`;
    const summaryZh = row.summaryZh || row.summary || '';
    const fallback = buildFallbackBriefSummary(summaryZh, row.highlights || '');
    let finalText = '';
    let usedFallback = false;

    try {
      if (hasModel) {
        const raw = await generateBriefSummaryWithModel({
          title: row.title || null,
          sourceReference: row.sourceReference || null,
          summary: summaryZh || null,
          highlights: row.highlights || null,
        });
        finalText = finalizeBriefSummary(raw, fallback);
      } else {
        finalText = fallback;
        usedFallback = true;
      }

      if (!finalText) {
        failed += 1;
        console.warn(`${prefix} -> skipped (empty summary after normalization)`);
      } else {
        if (!options.dryRun) {
          await sql`
            UPDATE analysis_results
            SET brief_summary = ${finalText},
                processed_at = CURRENT_TIMESTAMP
            WHERE podcast_id = ${row.id}
          `;
        }
        updated += 1;
        if (usedFallback || finalText === fallback) {
          fallbackUsed += 1;
        }
        console.log(`${prefix} -> updated${options.dryRun ? ' (dry-run)' : ''}`);
      }
    } catch (error) {
      if (fallback) {
        usedFallback = true;
        finalText = fallback;
        try {
          if (!options.dryRun) {
            await sql`
              UPDATE analysis_results
              SET brief_summary = ${finalText},
                  processed_at = CURRENT_TIMESTAMP
              WHERE podcast_id = ${row.id}
            `;
          }
          updated += 1;
          fallbackUsed += 1;
          console.warn(`${prefix} -> model failed, fallback updated: ${error instanceof Error ? error.message : String(error)}`);
        } catch (updateError) {
          failed += 1;
          console.error(`${prefix} -> failed to update fallback:`, updateError instanceof Error ? updateError.message : String(updateError));
        }
      } else {
        failed += 1;
        console.error(`${prefix} -> failed:`, error instanceof Error ? error.message : String(error));
      }
    }

    await delay(Number.isFinite(DELAY_MS) && DELAY_MS >= 0 ? DELAY_MS : 600);
  }

  console.log(
    `[brief-summary] done. total=${rowsResult.rows.length}, updated=${updated}, fallback=${fallbackUsed}, failed=${failed}, dryRun=${options.dryRun}`
  );
}

main().catch((error) => {
  console.error('[brief-summary] fatal error:', error);
  process.exit(1);
});
