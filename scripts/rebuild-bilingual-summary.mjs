import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

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

function normalizeMarkdown(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*•[ \t]+/gm, '- ')
    .trim();
}

function splitBilingualSummary(rawSummary) {
  const normalized = normalizeMarkdown(rawSummary);
  if (!normalized) {
    return { summaryZh: '', summaryEn: '', summaryLegacy: '' };
  }

  const markerEn = '<<<SUMMARY_EN>>>';
  const markerZh = '<<<SUMMARY_ZH>>>';
  const markerEnIndex = normalized.indexOf(markerEn);
  const markerZhIndex = normalized.indexOf(markerZh);

  let summaryEn = '';
  let summaryZh = '';

  if (markerEnIndex >= 0 && markerZhIndex > markerEnIndex) {
    summaryEn = normalizeMarkdown(normalized.slice(markerEnIndex + markerEn.length, markerZhIndex));
    summaryZh = normalizeMarkdown(normalized.slice(markerZhIndex + markerZh.length));
  } else {
    const englishHeaderIndex = normalized.search(/#\s*English Summary/i);
    const chineseHeaderIndex = normalized.search(/#\s*中文总结/i);

    if (englishHeaderIndex >= 0 && chineseHeaderIndex > englishHeaderIndex) {
      summaryEn = normalizeMarkdown(normalized.slice(englishHeaderIndex, chineseHeaderIndex));
      summaryZh = normalizeMarkdown(normalized.slice(chineseHeaderIndex));
    } else if (chineseHeaderIndex >= 0) {
      summaryEn = normalizeMarkdown(normalized.slice(0, chineseHeaderIndex));
      summaryZh = normalizeMarkdown(normalized.slice(chineseHeaderIndex));
    } else {
      summaryZh = normalized;
    }
  }

  const finalZh = summaryZh || normalized;
  const finalEn = summaryEn || '';
  return {
    summaryZh: finalZh,
    summaryEn: finalEn,
    summaryLegacy: finalZh,
  };
}

async function fetchTargetRows(options) {
  if (options.podcastId) {
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary,
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
          summary,
          summary_zh as "summaryZh",
          summary_en as "summaryEn"
        FROM analysis_results
        WHERE COALESCE(summary, '') <> ''
        ORDER BY processed_at DESC
        LIMIT ${options.limit}
      `;
      return result.rows;
    }
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary,
        summary_zh as "summaryZh",
        summary_en as "summaryEn"
      FROM analysis_results
      WHERE COALESCE(summary, '') <> ''
      ORDER BY processed_at DESC
    `;
    return result.rows;
  }

  if (options.limit) {
    const result = await sql`
      SELECT
        podcast_id as "podcastId",
        summary,
        summary_zh as "summaryZh",
        summary_en as "summaryEn"
      FROM analysis_results
      WHERE COALESCE(summary, '') <> ''
        AND (
          summary_zh IS NULL OR TRIM(summary_zh) = ''
          OR summary_en IS NULL OR TRIM(summary_en) = ''
        )
      ORDER BY processed_at DESC
      LIMIT ${options.limit}
    `;
    return result.rows;
  }

  const result = await sql`
    SELECT
      podcast_id as "podcastId",
      summary,
      summary_zh as "summaryZh",
      summary_en as "summaryEn"
    FROM analysis_results
    WHERE COALESCE(summary, '') <> ''
      AND (
        summary_zh IS NULL OR TRIM(summary_zh) = ''
        OR summary_en IS NULL OR TRIM(summary_en) = ''
      )
    ORDER BY processed_at DESC
  `;
  return result.rows;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }

  const options = parseArgs(process.argv.slice(2));
  console.log('[bilingual-summary] options:', options);

  await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS summary_zh TEXT`;
  await sql`ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS summary_en TEXT`;

  const rows = await fetchTargetRows(options);
  console.log(`[bilingual-summary] to process: ${rows.length}`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const parsed = splitBilingualSummary(row.summary || '');

    const nextZh = parsed.summaryZh || String(row.summaryZh || '').trim();
    const nextEn = parsed.summaryEn || String(row.summaryEn || '').trim();
    const nextLegacy = parsed.summaryLegacy || String(row.summary || '').trim();

    if (!nextZh) {
      skipped += 1;
      continue;
    }

    if (!options.dryRun) {
      await sql`
        UPDATE analysis_results
        SET summary = ${nextLegacy},
            summary_zh = ${nextZh},
            summary_en = ${nextEn || null},
            processed_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ${row.podcastId}
      `;
    }

    updated += 1;
  }

  console.log(`[bilingual-summary] done. total=${rows.length}, updated=${updated}, skipped=${skipped}, dryRun=${options.dryRun}`);
}

main().catch((error) => {
  console.error('[bilingual-summary] fatal error:', error);
  process.exit(1);
});
