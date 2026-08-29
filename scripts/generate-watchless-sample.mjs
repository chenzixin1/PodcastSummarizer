import { basename, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sampleRoot =
  process.env.WATCHLESS_SAMPLE_DIR ||
  '/Volumes/1TB/1Tprojects/Watchless/outputs/video-notes/Sam-Altman-How-to-Start-a-Startup-Vv3CEAS_w34';
const articlePath = join(sampleRoot, 'share', 'Sam Altman - How to Start a Startup-visual-explainer.md');
const manifestPath = join(sampleRoot, 'work', 'scene-manifest.json');
const outputPath = join(process.cwd(), 'lib', 'watchless', 'sampleArticle.json');

const articleMarkdown = readFileSync(articlePath, 'utf8').replace(/^<style>[\s\S]*?<\/style>\s*/i, '');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

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

const sceneHeaderPattern = /^##\s+(\d{2})\.\s+(.+?)（([^）]+)）\s*$/gm;
const headers = [...articleMarkdown.matchAll(sceneHeaderPattern)];
if (headers.length !== 20) {
  throw new Error(`Expected 20 scene headers, received ${headers.length}`);
}

const summaryMatch = articleMarkdown.match(/## 文章摘要\s*\n([\s\S]*?)\n##\s+01\./);
const summary = cleanInlineMarkup(summaryMatch?.[1] || '');

const scenes = headers.map((header, index) => {
  const manifestScene = manifest.scenes[index];
  const sceneStart = header.index ?? 0;
  const nextStart = headers[index + 1]?.index ?? articleMarkdown.length;
  const section = articleMarkdown.slice(sceneStart, nextStart);
  const contentMatch = section.match(/### 完整内容\s*\n([\s\S]*?)\n### 画面说明/);
  const visualMatch = section.match(/### 画面说明\s*\n([\s\S]*?)$/);
  const imageMatch = section.match(/!\[[^\]]*\]\(<keyframes\/([^>]+)>\)/);
  const number = Number(header[1]);

  if (!manifestScene || manifestScene.id !== number || !contentMatch || !visualMatch || !imageMatch) {
    throw new Error(`Incomplete data for scene ${number}`);
  }

  return {
    id: `scene-${String(number).padStart(2, '0')}`,
    number,
    titleZh: header[2].trim(),
    timeLabel: header[3].trim(),
    startSec: manifestScene.start_sec,
    endSec: manifestScene.end_sec,
    keyframe: `/watchless/sam-altman/keyframes/${imageMatch[1]}`,
    keyframeAlt: `第 ${number} 场景关键帧：${header[2].trim()}`,
    articleZh: cleanInlineMarkup(contentMatch[1]),
    transcriptEn: normalizeTranscript(manifestScene.transcript_text),
    visualDescriptionZh: cleanInlineMarkup(visualMatch[1]),
    boundaryReasonEn: manifestScene.boundary_reason,
  };
});

const fixture = {
  id: 'watchless-vv3ceas-w34',
  videoId: 'Vv3CEAS_w34',
  title: 'Sam Altman - How to Start a Startup',
  titleZh: 'Sam Altman：如何创办一家创业公司',
  eyebrow: 'Watchless 完整图文',
  author: 'Watchless',
  sourceName: 'Relentless · YouTube',
  sourceUrl: 'https://www.youtube.com/watch?v=Vv3CEAS_w34',
  pdfUrl: '/watchless/sam-altman/watchless-sam-altman.pdf',
  durationSec: 4177.965,
  durationLabel: '1 小时 09 分',
  publishedLabel: '20 个场景 · 完整时间线',
  summaryZh: summary,
  summaryEn:
    'Sam Altman reflects on how AI changes the startup playbook: smaller teams, faster iteration, trust in exponential progress, working through chaos, abundant intelligence, infrastructure, leadership, risk, design, and the difference between real and fake trends.',
  scenes,
};

mkdirSync(join(process.cwd(), 'lib', 'dev'), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`Scenes: ${scenes.length}`);
console.log(`First frame: ${basename(scenes[0].keyframe)}`);
