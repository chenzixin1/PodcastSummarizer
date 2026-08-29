import fs from 'node:fs';
import path from 'node:path';

/**
 * Converts completed Watchless output directories into validated PodSum article JSON,
 * an R2 upload catalog, and an idempotent D1 import file. This script only prepares
 * artifacts; it never uploads objects or mutates a database by itself.
 *
 * Usage:
 *   node scripts/import-watchless-library.mjs
 *   node scripts/import-watchless-library.mjs --owner-id=<podsum-user-id>
 *   node scripts/import-watchless-library.mjs --root=<watchless-output-root> --output=<directory>
 */

const DEFAULT_ROOT = '/Volumes/1TB/1Tprojects/Watchless/outputs/video-notes';
const DEFAULT_OUTPUT = path.join(process.cwd(), 'output', 'watchless-library-import');
const VIDEO_ID_PATTERN = /[A-Za-z0-9_-]{11}/g;
const SCENE_HEADER_PATTERN = /^##\s+(\d{1,2})\.\s+(.+?)[（(]([^）)]+)[）)]\s*$/gm;
const EXISTING_PODCAST_IDS = new Map([
  ['Vv3CEAS_w34', 'watchless-vv3ceas-w34'],
]);

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function firstFile(directory, predicate) {
  if (!fs.existsSync(directory)) return null;
  const name = fs.readdirSync(directory).sort().find(predicate);
  return name ? path.join(directory, name) : null;
}

function cleanInlineMarkup(value) {
  const normalized = String(value || '')
    .replace(/<span\b[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<u>/gi, '')
    .replace(/<\/u>/gi, '')
    .replace(/<strong>/gi, '**')
    .replace(/<\/strong>/gi, '**')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/\*{4,}/g, '**')
    .replace(/\*\*([^*\n]+?)\s+\*\*/g, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized
    .split('\n')
    .map((line) => ((line.match(/\*\*/g) || []).length % 2 === 0 ? line : line.replace(/\*\*/g, '')))
    .join('\n');
}

function normalizeTranscript(value) {
  return String(value || '')
    .replace(/说话人\d+:\s*/g, '\n\n')
    .replace(/\s+([,.?!;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>#`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function durationLabel(seconds) {
  const totalMinutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`;
  return `${minutes} 分钟`;
}

function parseUploadDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00.000Z`;
}

function inferVideoId(directoryName, manifest, info) {
  const candidates = [info?.id, manifest?.source?.video_id].filter(Boolean);
  for (const candidate of candidates) {
    if (/^[A-Za-z0-9_-]{11}$/.test(String(candidate))) return String(candidate);
  }
  const matches = directoryName.match(VIDEO_ID_PATTERN) || [];
  return matches.find((candidate) => /^[A-Za-z0-9_-]{11}$/.test(candidate)) || null;
}

function englishTranscriptRatio(value) {
  const text = String(value || '');
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latin / Math.max(1, latin + cjk);
}

function highConfidenceTags(title, summary) {
  const source = `${title}\n${summary}`.toLowerCase();
  const tags = [];
  const add = (tag) => { if (!tags.includes(tag)) tags.push(tag); };
  if (/\bai\b|人工智能|大模型|agent|openai|anthropic/.test(source)) add('Artificial Intelligence');
  if (/startup|创业|fde|gtm|hire|yc\b/.test(source)) add('Startups');
  if (/hynix|半导体|存储|memory|dram|hbm|光互连|nvidia|lam research|芯片/.test(source)) add('Semiconductors');
  if (/market|投资|资本|泡沫|估值|周期|stock|美股/.test(source)) add('Investing');
  if (/robot|physical intelligence|机器人/.test(source)) add('Robotics');
  if (/enterprise|software|saas|salesforce|glean|企业软件/.test(source)) add('Enterprise Software');
  return tags.slice(0, 4);
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compactHighlights(article) {
  const sections = article.scenes.map((scene) => {
    const excerpt = scene.articleZh.length > 1_200
      ? `${scene.articleZh.slice(0, 1_200).trim()}…`
      : scene.articleZh;
    return `## ${String(scene.number).padStart(2, '0')}. ${scene.titleZh}（${scene.timeLabel}）\n\n${excerpt}`;
  });
  return `${article.summaryZh}\n\n${sections.join('\n\n')}`.slice(0, 48_000);
}

function wordCount(value, locale) {
  try {
    const segmenter = new Intl.Segmenter(locale || 'zh', { granularity: 'word' });
    return [...segmenter.segment(String(value || ''))].filter((part) => part.isWordLike).length;
  } catch {
    return String(value || '').split(/\s+/).filter(Boolean).length;
  }
}

function parseEntry(root, directoryName, outputDirectory) {
  const entryRoot = path.join(root, directoryName);
  const shareRoot = path.join(entryRoot, 'share');
  const articlePath = firstFile(shareRoot, (name) => name.endsWith('-visual-explainer.md'));
  const pdfPath = firstFile(shareRoot, (name) => name.endsWith('-visual-explainer.pdf'));
  const manifestPath = path.join(entryRoot, 'work', 'scene-manifest.json');
  if (!articlePath || !pdfPath || !fs.existsSync(manifestPath)) return null;

  const infoPath = firstFile(path.join(entryRoot, 'work', 'source'), (name) => name.endsWith('.info.json'));
  const info = infoPath ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const videoId = inferVideoId(directoryName, manifest, info);
  if (!videoId) throw new Error(`Could not determine a YouTube video ID for ${directoryName}`);

  const markdown = fs.readFileSync(articlePath, 'utf8').replace(/^<style>[\s\S]*?<\/style>\s*/i, '');
  const headers = [...markdown.matchAll(SCENE_HEADER_PATTERN)];
  if (headers.length === 0 || headers.length !== manifest.scenes?.length) {
    throw new Error(`Scene count mismatch for ${directoryName}: markdown=${headers.length}, manifest=${manifest.scenes?.length || 0}`);
  }

  const summaryMatch = markdown.match(/## 文章摘要\s*\n([\s\S]*?)\n##\s+0?1\./);
  const summaryZh = cleanInlineMarkup(summaryMatch?.[1] || '');
  if (!summaryZh) throw new Error(`Missing article summary for ${directoryName}`);

  const sourceTitle = String(info?.title || manifest.source?.title || markdown.match(/^#\s+(.+?)(?:\s+-\s+Visual Explainer)?\s*$/m)?.[1] || directoryName).trim();
  const sourceUrl = String(info?.webpage_url || `https://www.youtube.com/watch?v=${videoId}`);
  const podcastId = EXISTING_PODCAST_IDS.get(videoId) || `watchless-${videoId.toLowerCase()}`;
  const transcriptText = manifest.scenes.map((scene) => String(scene.transcript_text || '')).join('\n\n');
  const hasEnglishTranscript = englishTranscriptRatio(transcriptText) >= 0.72;
  const articleKey = `watchless/${videoId}/article.json`;
  const pdfKey = `watchless/${videoId}/article.pdf`;
  const transcriptKey = `watchless/${videoId}/transcript.txt`;

  const scenes = headers.map((header, index) => {
    const manifestScene = manifest.scenes[index];
    const sceneStart = header.index ?? 0;
    const nextStart = headers[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(sceneStart, nextStart);
    const contentMatch = section.match(/### 完整内容\s*\n([\s\S]*?)\n### 画面说明/);
    const visualMatch = section.match(/### 画面说明\s*\n([\s\S]*?)$/);
    const imageMatch = section.match(/!\[[^\]]*\]\(<keyframes\/([^>]+)>\)/)
      || section.match(/!\[[^\]]*\]\(keyframes\/([^)]+)\)/);
    const number = Number(header[1]);
    if (!manifestScene || !contentMatch || !visualMatch || !imageMatch) {
      throw new Error(`Incomplete scene ${number} for ${directoryName}`);
    }
    const sourceFrame = path.join(shareRoot, 'keyframes', imageMatch[1]);
    if (!fs.existsSync(sourceFrame)) throw new Error(`Missing keyframe ${sourceFrame}`);
    return {
      id: `scene-${String(number).padStart(2, '0')}`,
      number,
      titleZh: header[2].trim(),
      timeLabel: header[3].trim(),
      startSec: Number(manifestScene.start_sec),
      endSec: Number(manifestScene.end_sec),
      keyframe: `/api/files/watchless/${videoId}/keyframes/${path.basename(sourceFrame)}`,
      keyframeAlt: `第 ${number} 场景关键帧：${header[2].trim()}`,
      articleZh: cleanInlineMarkup(contentMatch[1]),
      transcriptEn: normalizeTranscript(manifestScene.transcript_text),
      visualDescriptionZh: cleanInlineMarkup(visualMatch[1]),
      boundaryReasonEn: String(manifestScene.boundary_reason || 'Semantic scene boundary.'),
      sourceFrame,
      frameKey: `watchless/${videoId}/keyframes/${path.basename(sourceFrame)}`,
    };
  });

  const durationSec = Number(info?.duration || manifest.source?.duration_sec || scenes.at(-1)?.endSec || 0);
  const publishedAt = parseUploadDate(info?.upload_date);
  const artifactCreatedAt = fs.statSync(articlePath).birthtime.toISOString();
  const sourceName = `${String(info?.channel || info?.uploader || 'YouTube').trim()} · YouTube`;
  const summaryEn = hasEnglishTranscript
    ? String(info?.description || sourceTitle).trim().slice(0, 90_000)
    : sourceTitle;
  const article = {
    id: podcastId,
    videoId,
    title: sourceTitle,
    titleZh: sourceTitle,
    eyebrow: 'Watchless 完整图文',
    author: String(info?.uploader || info?.channel || 'Watchless').trim(),
    sourceName,
    sourceUrl,
    pdfUrl: `/api/files/${pdfKey}`,
    durationSec,
    durationLabel: durationLabel(durationSec),
    publishedLabel: `${scenes.length} 个场景 · 完整时间线`,
    summaryZh,
    summaryEn,
    transcriptLanguage: hasEnglishTranscript ? 'en' : 'zh',
    availableLanguageModes: hasEnglishTranscript ? ['zh', 'en', 'bilingual', 'hint'] : ['zh'],
    scenes: scenes.map((scene) => ({
      id: scene.id,
      number: scene.number,
      titleZh: scene.titleZh,
      timeLabel: scene.timeLabel,
      startSec: scene.startSec,
      endSec: scene.endSec,
      keyframe: scene.keyframe,
      keyframeAlt: scene.keyframeAlt,
      articleZh: scene.articleZh,
      transcriptEn: scene.transcriptEn,
      visualDescriptionZh: scene.visualDescriptionZh,
      boundaryReasonEn: scene.boundaryReasonEn,
    })),
  };

  const articleOutput = path.join(outputDirectory, 'articles', `${videoId}.json`);
  const transcriptOutput = path.join(outputDirectory, 'transcripts', `${videoId}.txt`);
  ensureDirectory(path.dirname(articleOutput));
  ensureDirectory(path.dirname(transcriptOutput));
  fs.writeFileSync(articleOutput, `${JSON.stringify(article, null, 2)}\n`);
  fs.writeFileSync(transcriptOutput, `${transcriptText.trim()}\n`);

  const fullArticleText = article.scenes.map((scene) => scene.articleZh).join('\n\n');
  const tags = highConfidenceTags(sourceTitle, summaryZh);
  return {
    podcastId,
    videoId,
    title: sourceTitle,
    sourceUrl,
    sourceName,
    sourcePublishedAt: publishedAt,
    createdAt: publishedAt || artifactCreatedAt,
    durationSec,
    durationLabel: article.durationLabel,
    sceneCount: scenes.length,
    hasEnglishTranscript,
    summaryZh,
    summaryEn,
    highlights: compactHighlights(article),
    translation: hasEnglishTranscript ? transcriptText.slice(0, 22_000) : sourceTitle,
    wordCount: wordCount(fullArticleText, 'zh'),
    characterCount: fullArticleText.length,
    tags,
    articleKey,
    transcriptKey,
    uploads: [
      { key: articleKey, path: articleOutput, contentType: 'application/json; charset=utf-8' },
      { key: transcriptKey, path: transcriptOutput, contentType: 'text/plain; charset=utf-8' },
      { key: pdfKey, path: pdfPath, contentType: 'application/pdf' },
      ...scenes.map((scene) => ({ key: scene.frameKey, path: scene.sourceFrame, contentType: 'image/jpeg' })),
    ],
  };
}

function buildSql(entries, ownerId) {
  const statements = ['PRAGMA foreign_keys = ON;'];
  for (const entry of entries) {
    const blobUrl = `/api/files/${entry.transcriptKey}`;
    statements.push(`
INSERT INTO podcasts (
  id, title, original_filename, file_size, blob_url, source_reference,
  source_published_at, duration_sec, is_public, user_id, tags_json, created_at
) VALUES (
  ${sqlString(entry.podcastId)}, ${sqlString(entry.title)}, ${sqlString(`${entry.title}.txt`)},
  ${sqlString(`${Buffer.byteLength(entry.translation, 'utf8')} bytes`)}, ${sqlString(blobUrl)},
  ${sqlString(entry.sourceUrl)}, ${sqlString(entry.sourcePublishedAt)}, ${Math.round(entry.durationSec)},
  1, ${sqlString(ownerId)}, ${sqlString(JSON.stringify(entry.tags))}, ${sqlString(entry.createdAt)}
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  source_reference = excluded.source_reference,
  source_published_at = excluded.source_published_at,
  duration_sec = excluded.duration_sec,
  is_public = 1,
  blob_url = excluded.blob_url,
  tags_json = CASE
    WHEN podcasts.tags_json IS NULL OR podcasts.tags_json = '' OR podcasts.tags_json = '[]'
      THEN excluded.tags_json
    ELSE podcasts.tags_json
  END;
`.trim());
    statements.push(`
INSERT INTO analysis_results (
  podcast_id, summary, summary_zh, summary_en, brief_summary, translation, highlights,
  token_count, word_count, character_count, processed_at
) VALUES (
  ${sqlString(entry.podcastId)}, ${sqlString(entry.summaryZh)}, ${sqlString(entry.summaryZh)},
  ${sqlString(entry.summaryEn)}, ${sqlString(stripMarkdown(entry.summaryZh).slice(0, 420))},
  ${sqlString(entry.translation)}, ${sqlString(entry.highlights)}, 0,
  ${entry.wordCount}, ${entry.characterCount}, CURRENT_TIMESTAMP
)
ON CONFLICT(podcast_id) DO NOTHING;
`.trim());
    statements.push(`
INSERT INTO watchless_publications (
  podcast_id, video_id, article_key, scene_count, duration_label,
  has_english_transcript, status, published_at, updated_at
) VALUES (
  ${sqlString(entry.podcastId)}, ${sqlString(entry.videoId)}, ${sqlString(entry.articleKey)},
  ${entry.sceneCount}, ${sqlString(entry.durationLabel)}, ${entry.hasEnglishTranscript ? 1 : 0},
  'published', ${sqlString(entry.sourcePublishedAt || entry.createdAt)}, CURRENT_TIMESTAMP
)
ON CONFLICT(podcast_id) DO UPDATE SET
  video_id = excluded.video_id,
  article_key = excluded.article_key,
  scene_count = excluded.scene_count,
  duration_label = excluded.duration_label,
  has_english_transcript = excluded.has_english_transcript,
  status = 'published',
  published_at = excluded.published_at,
  updated_at = CURRENT_TIMESTAMP;
`.trim());
  }
  return `${statements.join('\n\n')}\n`;
}

const root = path.resolve(readArg('root', DEFAULT_ROOT));
const outputDirectory = path.resolve(readArg('output', DEFAULT_OUTPUT));
const ownerId = readArg('owner-id', '');
if (!fs.existsSync(root)) throw new Error(`Watchless output root does not exist: ${root}`);
ensureDirectory(outputDirectory);

const entries = [];
const skipped = [];
for (const directoryName of fs.readdirSync(root).sort()) {
  if (!fs.statSync(path.join(root, directoryName)).isDirectory()) continue;
  const entry = parseEntry(root, directoryName, outputDirectory);
  if (entry) entries.push(entry);
  else skipped.push(directoryName);
}

const seenVideoIds = new Set();
for (const entry of entries) {
  if (seenVideoIds.has(entry.videoId)) throw new Error(`Duplicate completed Watchless video ID: ${entry.videoId}`);
  seenVideoIds.add(entry.videoId);
}

const catalog = {
  generatedAt: new Date().toISOString(),
  sourceRoot: root,
  completedCount: entries.length,
  skippedCount: skipped.length,
  skipped,
  totalScenes: entries.reduce((sum, entry) => sum + entry.sceneCount, 0),
  totalUploads: entries.reduce((sum, entry) => sum + entry.uploads.length, 0),
  entries: entries.map((entry) => ({
    podcastId: entry.podcastId,
    videoId: entry.videoId,
    title: entry.title,
    sourceUrl: entry.sourceUrl,
    sourceName: entry.sourceName,
    sourcePublishedAt: entry.sourcePublishedAt,
    createdAt: entry.createdAt,
    durationSec: entry.durationSec,
    durationLabel: entry.durationLabel,
    sceneCount: entry.sceneCount,
    hasEnglishTranscript: entry.hasEnglishTranscript,
    summaryZh: entry.summaryZh,
    summaryEn: entry.summaryEn,
    wordCount: entry.wordCount,
    characterCount: entry.characterCount,
    tags: entry.tags,
    articleKey: entry.articleKey,
    transcriptKey: entry.transcriptKey,
    uploads: entry.uploads,
  })),
};
fs.writeFileSync(path.join(outputDirectory, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
if (ownerId) fs.writeFileSync(path.join(outputDirectory, 'import.sql'), buildSql(entries, ownerId));

console.log(JSON.stringify({
  completed: entries.length,
  skipped,
  totalScenes: catalog.totalScenes,
  totalUploads: catalog.totalUploads,
  sqlGenerated: Boolean(ownerId),
  outputDirectory,
}, null, 2));
