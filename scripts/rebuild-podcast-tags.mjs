import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!process.env.POSTGRES_URL) {
  dotenv.config({ path: '.env.vercel.prod' });
}

const EN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'in', 'of', 'to', 'that', 'this', 'into', 'about', 'over',
  'your', 'you', 'are', 'was', 'were', 'will', 'how', 'what', 'why', 'when',
  'they', 'them', 'their', 'our', 'ours', 'its', 'can', 'new', 'all', 'not',
  'is', 'on', 'as', 'an', 'at', 'be', 'by', 'or', 'if', 'but', 'than', 'then', 'still',
  'podcast', 'summary', 'video', 'talk', 'episode', 'analysis', 'transcript',
  'public', 'private', 'full', 'text', 'part', 'chapter', 'youtube',
  'interview', 'discussion', 'conversation', 'actually',
]);

const BLOCKED_TAGS = new Set(['youtube', 'andrej']);

const ZH_STOPWORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '一些', '一个', '一种', '这样', '那么',
  '然后', '因为', '所以', '就是', '可以', '需要', '时候', '问题', '内容', '总结',
  '视频', '播客', '字幕', '重点', '分析', '翻译',
  '亿美元', '美元', '负责人', '例如', '下一步', '时间',
]);

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTag(value) {
  return cleanWhitespace(value)
    .replace(/^#+/, '')
    .replace(/[.,;:!?/\\|()[\]{}'"`]+$/g, '');
}

function isUsefulTag(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return !lower.startsWith('youtube-') && !BLOCKED_TAGS.has(lower) && !EN_STOPWORDS.has(lower) && !ZH_STOPWORDS.has(normalized);
}

function stripMarkdown(input) {
  return String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\r\n/g, '\n');
}

function extractTags({ title, fallbackName, summary, sourceReference }) {
  const score = new Map();
  const display = new Map();

  const upsert = (tag, points) => {
    const normalized = normalizeTag(tag);
    if (!isUsefulTag(normalized)) return;
    const key = normalized.toLowerCase();
    score.set(key, (score.get(key) || 0) + points);
    if (!display.has(key)) {
      display.set(key, normalized);
    }
  };

  const source = cleanWhitespace(sourceReference).toLowerCase();
  if (source.includes('bilibili.com')) upsert('Bilibili', 8);
  if (source.includes('x.com') || source.includes('twitter.com')) upsert('X', 8);

  const baseTitle = cleanWhitespace(title || fallbackName);
  const summaryText = cleanWhitespace(stripMarkdown(summary));

  const collect = (text, point) => {
    const enMatches = text.match(/[A-Za-z][A-Za-z0-9+.-]{1,28}/g) || [];
    const runs = [];
    let currentRun = [];
    for (const word of enMatches) {
      const token = normalizeTag(word);
      const lower = token.toLowerCase();
      if (token.length < 2 || EN_STOPWORDS.has(lower) || /^\d+$/.test(token)) {
        if (currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
        continue;
      }
      currentRun.push(token);
      upsert(token, point);
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
    }
    for (const run of runs) {
      for (let size = Math.min(3, run.length); size >= 2; size -= 1) {
        for (let index = 0; index <= run.length - size; index += 1) {
          upsert(run.slice(index, index + size).join(' '), point + size + 1);
        }
      }
    }
    const zhMatches = text.match(/[\u4e00-\u9fff]{2,10}/g) || [];
    for (const phrase of zhMatches) {
      const token = normalizeTag(phrase);
      if (token.length < 2 || ZH_STOPWORDS.has(token)) continue;
      upsert(token, point);
    }
  };

  if (baseTitle) collect(baseTitle, 5);
  if (summaryText) collect(summaryText, 1);

  const tags = Array.from(score.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([key]) => display.get(key) || key);

  const unique = [];
  const seen = new Set();
  for (const tag of tags) {
    const cleaned = normalizeTag(tag);
    if (!isUsefulTag(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cleaned);
  }
  return unique;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is missing');
  }

  await sql`ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS tags_json JSONB DEFAULT '[]'::jsonb`;

  const result = await sql`
    SELECT
      p.id,
      p.title,
      p.original_filename as "originalFileName",
      p.source_reference as "sourceReference",
      ar.summary
    FROM podcasts p
    LEFT JOIN analysis_results ar ON ar.podcast_id = p.id
    ORDER BY p.created_at DESC
  `;

  let updated = 0;
  let skipped = 0;
  for (const row of result.rows) {
    const tags = extractTags({
      title: row.title || null,
      fallbackName: row.originalFileName || null,
      summary: row.summary || null,
      sourceReference: row.sourceReference || null,
    });

    if (tags.length === 0) {
      skipped += 1;
      continue;
    }

    await sql`
      UPDATE podcasts
      SET tags_json = ${JSON.stringify(tags)}::jsonb
      WHERE id = ${row.id}
    `;
    updated += 1;
  }

  console.log(`Tag rebuild completed. total=${result.rows.length}, updated=${updated}, skipped=${skipped}`);
}

main().catch((error) => {
  console.error('Failed to rebuild podcast tags:', error);
  process.exit(1);
});
