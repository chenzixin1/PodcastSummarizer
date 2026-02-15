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
const MAX_TOKENS = Number.parseInt(process.env.MAX_TRANSLATION_TOKENS || '16000', 10);
const BASE_BLOCKS_PER_CHUNK = Math.max(
  1,
  Number.parseInt(process.env.TRANSLATION_CHUNK_BLOCKS || '180', 10)
);
const MAX_CHUNKS = Math.max(
  1,
  Number.parseInt(process.env.MAX_TRANSLATION_CHUNKS || '24', 10)
);
const PODCAST_DELAY_MS = 400;

const TRANSLATE_SYSTEM_PROMPT = `
You are an expert transcript editor. Rewrite the SRT content into an English "full-text notes" format with better readability and higher information density.

Task requirements:
1. Merge adjacent subtitle lines by meaning so each idea appears once.
2. Keep original chronological order.
3. Preserve key facts, numbers, actions, names, and constraints. Do not fabricate.
4. Each entry must keep exactly one timestamp.
5. Bold important facts/decisions/metrics with **...**.

Output format (strict):
**[HH:MM:SS]** English sentence(s)

Rules:
- Leave one blank line between entries.
- No title, bullets, numbering, code block, or extra explanation.
- Timestamp and text must be separated by one space.
`.trim();

const TRANSLATE_FROM_ZH_HIGHLIGHTS_SYSTEM_PROMPT = `
You are a precise translator. Convert Chinese timestamped full-text notes into English.

Strict output rules:
1. Keep each line in this format: **[HH:MM:SS]** English sentence(s)
2. Keep the original order.
3. Keep one blank line between entries.
4. Preserve key numbers, names, decisions, and constraints. Do not fabricate.
5. Keep markdown emphasis (**...**) when it marks important facts.
6. Output only the converted notes with no extra explanation.
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

function splitSrtIntoBlocks(srtContent) {
  const regex = /(\d+\s*\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*\n[^\n]*(?:\n[^\n]*)*?)(?=\n\s*\d+\s*\n|$)/g;
  const blocks = [];
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(srtContent)) !== null) {
    blocks.push(match[0]);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < srtContent.length) {
    const remaining = srtContent.slice(lastIndex).trim();
    if (remaining) {
      blocks.push(remaining);
    }
  }

  return blocks.length > 0 ? blocks : [srtContent];
}

function groupBlocks(blocks, blocksPerChunk) {
  if (blocks.length === 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < blocks.length; i += blocksPerChunk) {
    chunks.push(blocks.slice(i, i + blocksPerChunk).join('\n\n'));
  }
  return chunks;
}

function resolveBlocksPerChunk(totalBlocks, baseBlocksPerChunk, maxChunks) {
  if (totalBlocks <= 0) {
    return baseBlocksPerChunk;
  }
  const minBlocksForBudget = Math.ceil(totalBlocks / Math.max(1, maxChunks));
  return Math.max(baseBlocksPerChunk, minBlocksForBudget);
}

function buildTranslateUserPrompt(content, index, total) {
  if (total <= 1) {
    return `Rewrite this complete SRT into the required English full-text notes format:\n\n${content}`;
  }
  return `Rewrite this SRT segment (${index}/${total}) into the required English full-text notes format:\n\n${content}`;
}

async function callOpenRouter(systemPrompt, userPrompt) {
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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.3,
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

async function buildEnglishFullTextFromSrt(srtContent) {
  const cleanSrt = String(srtContent || '').replace(/^\uFEFF/, '').trim();
  if (!cleanSrt) {
    return '';
  }

  const blocks = splitSrtIntoBlocks(cleanSrt);
  const blocksPerChunk = resolveBlocksPerChunk(blocks.length, BASE_BLOCKS_PER_CHUNK, MAX_CHUNKS);
  const chunks = groupBlocks(blocks, blocksPerChunk);
  if (chunks.length === 0) {
    return '';
  }

  const outputs = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const userPrompt = buildTranslateUserPrompt(chunks[i], i + 1, chunks.length);
    const output = await callOpenRouter(TRANSLATE_SYSTEM_PROMPT, userPrompt);
    outputs.push(output);
  }

  return outputs.filter(Boolean).join('\n\n').trim();
}

async function buildEnglishFullTextFromHighlights(highlightsMarkdown) {
  const normalized = String(highlightsMarkdown || '').trim();
  if (!normalized) {
    return '';
  }
  const userPrompt = `Convert the following Chinese full-text notes into English while preserving the exact required format:\n\n${normalized}`;
  return callOpenRouter(TRANSLATE_FROM_ZH_HIGHLIGHTS_SYSTEM_PROMPT, userPrompt);
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    const result = await sql`
      SELECT
        p.id,
        p.blob_url as "blobUrl",
        ar.translation,
        ar.highlights
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
          p.blob_url as "blobUrl",
          ar.translation,
          ar.highlights
        FROM podcasts p
        INNER JOIN analysis_results ar ON ar.podcast_id = p.id
        WHERE COALESCE(p.blob_url, '') <> ''
        ORDER BY p.created_at DESC
        LIMIT ${options.limit}
      `;
      return result.rows;
    }

    const result = await sql`
      SELECT
        p.id,
        p.blob_url as "blobUrl",
        ar.translation,
        ar.highlights
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(p.blob_url, '') <> ''
      ORDER BY p.created_at DESC
    `;
    return result.rows;
  }

  if (options.limit) {
    const result = await sql`
      SELECT
        p.id,
        p.blob_url as "blobUrl",
        ar.translation,
        ar.highlights
      FROM podcasts p
      INNER JOIN analysis_results ar ON ar.podcast_id = p.id
      WHERE COALESCE(p.blob_url, '') <> ''
        AND COALESCE(ar.translation, '') = ''
      ORDER BY p.created_at DESC
      LIMIT ${options.limit}
    `;
    return result.rows;
  }

  const result = await sql`
    SELECT
      p.id,
      p.blob_url as "blobUrl",
      ar.translation,
      ar.highlights
    FROM podcasts p
    INNER JOIN analysis_results ar ON ar.podcast_id = p.id
    WHERE COALESCE(p.blob_url, '') <> ''
      AND COALESCE(ar.translation, '') = ''
    ORDER BY p.created_at DESC
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
  console.log('[fulltext-en] options:', options);
  console.log('[fulltext-en] model:', MODEL);

  const rows = await fetchTargetRows(options);
  console.log(`[fulltext-en] to process: ${rows.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const prefix = `[fulltext-en] ${i + 1}/${rows.length} podcast=${row.id}`;
    const blobUrl = String(row.blobUrl || '').trim();
    const highlights = String(row.highlights || '').trim();

    try {
      let rebuilt = '';

      if (blobUrl) {
        try {
          const response = await fetch(blobUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch SRT (${response.status})`);
          }
          const srtContent = await response.text();
          rebuilt = await buildEnglishFullTextFromSrt(srtContent);
        } catch (fetchError) {
          if (!highlights) {
            throw fetchError;
          }
          rebuilt = await buildEnglishFullTextFromHighlights(highlights);
          console.warn(`${prefix} -> blob fetch failed, fallback to highlights`);
        }
      } else if (highlights) {
        rebuilt = await buildEnglishFullTextFromHighlights(highlights);
      }

      if (!rebuilt) {
        skipped += 1;
        console.log(`${prefix} -> skipped (missing blob_url and highlights or empty output)`);
        continue;
      }

      if (!options.dryRun) {
        await sql`
          UPDATE analysis_results
          SET translation = ${rebuilt},
              processed_at = CURRENT_TIMESTAMP
          WHERE podcast_id = ${row.id}
        `;
      }

      updated += 1;
      console.log(`${prefix} -> updated (chars=${rebuilt.length}, dryRun=${options.dryRun})`);
    } catch (error) {
      failed += 1;
      console.error(`${prefix} -> failed:`, error instanceof Error ? error.message : String(error));
    }

    await delay(PODCAST_DELAY_MS);
  }

  console.log(`[fulltext-en] done. total=${rows.length}, updated=${updated}, skipped=${skipped}, failed=${failed}, dryRun=${options.dryRun}`);
}

main().catch((error) => {
  console.error('[fulltext-en] fatal:', error);
  process.exit(1);
});
