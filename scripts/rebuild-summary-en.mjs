import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || '2', 10);
const RETRY_DELAY_MS = Number.parseInt(process.env.RETRY_DELAY || '1000', 10);
const API_TIMEOUT_MS = Number.parseInt(process.env.API_TIMEOUT_MS || '120000', 10);
const MAX_TOKENS = Number.parseInt(process.env.MAX_SUMMARY_TOKENS || '8000', 10);

const SYSTEM_PROMPT = `
You are a professional editor.
Translate Chinese markdown summary content into English markdown.

Rules:
1. Keep markdown structure and heading hierarchy.
2. Keep bullet list density and factual details.
3. Do not add or remove key information.
4. Output markdown only, with no extra explanation.
`.trim();

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
      const raw = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(raw) && raw > 0) {
        parsed.limit = raw;
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

async function callOpenRouter(summaryZh) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await delay(RETRY_DELAY_MS * attempt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
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
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Translate the following Chinese markdown summary into English markdown:\n\n${summaryZh}`,
            },
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter ${response.status}: ${text || response.statusText}`);
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Model returned empty content');
      }
      return content.trim();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }

  throw lastError || new Error('OpenRouter call failed');
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary_zh as "summaryZh",
        summary_en as "summaryEn"
      FROM analysis_results
      WHERE podcast_id = ${options.podcastId}
      LIMIT 1
    `;
    return result.rows;
  }

  if (options.all) {
    if (options.limit) {
      const result = await sql`
        SELECT
          podcast_id as "podcastId",
          summary_zh as "summaryZh",
          summary_en as "summaryEn"
        FROM analysis_results
        WHERE COALESCE(summary_zh, '') <> ''
        ORDER BY processed_at DESC
        LIMIT ${options.limit}
      `;
      return result.rows;
    }

    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary_zh as "summaryZh",
        summary_en as "summaryEn"
      FROM analysis_results
      WHERE COALESCE(summary_zh, '') <> ''
      ORDER BY processed_at DESC
    `;
    return result.rows;
  }

  if (options.limit) {
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary_zh as "summaryZh",
        summary_en as "summaryEn"
      FROM analysis_results
      WHERE COALESCE(summary_zh, '') <> ''
        AND COALESCE(summary_en, '') = ''
      ORDER BY processed_at DESC
      LIMIT ${options.limit}
    `;
    return result.rows;
  }

  const result = await sql`
    SELECT
      podcast_id as "podcastId",
      summary_zh as "summaryZh",
      summary_en as "summaryEn"
    FROM analysis_results
    WHERE COALESCE(summary_zh, '') <> ''
      AND COALESCE(summary_en, '') = ''
    ORDER BY processed_at DESC
  `;
  return result.rows;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const options = parseArgs(process.argv.slice(2));
  console.log('[summary-en] options:', options);
  console.log('[summary-en] model:', MODEL);

  const rows = await fetchTargetRows(options);
  console.log(`[summary-en] to process: ${rows.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const prefix = `[summary-en] ${i + 1}/${rows.length} podcast=${row.podcastId}`;
    const summaryZh = String(row.summaryZh || '').trim();
    if (!summaryZh) {
      skipped += 1;
      console.log(`${prefix} -> skipped (empty summary_zh)`);
      continue;
    }

    try {
      const summaryEn = await callOpenRouter(summaryZh);
      if (!summaryEn) {
        skipped += 1;
        console.log(`${prefix} -> skipped (empty output)`);
        continue;
      }

      if (!options.dryRun) {
        await sql`
          UPDATE analysis_results
          SET summary_en = ${summaryEn},
              processed_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${row.podcastId}
        `;
      }

      updated += 1;
      console.log(`${prefix} -> updated (chars=${summaryEn.length}, dryRun=${options.dryRun})`);
    } catch (error) {
      failed += 1;
      console.error(`${prefix} -> failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`[summary-en] done. total=${rows.length}, updated=${updated}, skipped=${skipped}, failed=${failed}, dryRun=${options.dryRun}`);
}

main().catch((error) => {
  console.error('[summary-en] fatal:', error);
  process.exit(1);
});
