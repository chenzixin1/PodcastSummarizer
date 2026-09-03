export type WatchlessLanguageMode = 'zh' | 'en' | 'bilingual' | 'hint';
export type WatchlessTranscriptLanguage = 'en' | 'zh' | 'other';
export type WatchlessBodyMode = 'editorial' | 'verbatim';
export type WatchlessChineseContentKind = 'translation' | 'editorial' | 'original';

export interface WatchlessScene {
  id: string;
  number: number;
  titleZh: string;
  timeLabel: string;
  startSec: number;
  endSec: number;
  keyframe: string;
  keyframeAlt: string;
  articleZh: string;
  transcriptEn: string;
  visualDescriptionZh: string;
  boundaryReasonEn: string;
}

export interface WatchlessArticle {
  id: string;
  videoId: string;
  title: string;
  titleZh: string;
  eyebrow: string;
  author: string;
  sourceName: string;
  sourceUrl: string;
  pdfUrl: string;
  durationSec: number;
  durationLabel: string;
  publishedLabel: string;
  summaryZh: string;
  summaryEn: string;
  bodyMode?: WatchlessBodyMode;
  articleZhKind?: WatchlessChineseContentKind;
  transcriptLanguage?: WatchlessTranscriptLanguage;
  availableLanguageModes?: WatchlessLanguageMode[];
  scenes: WatchlessScene[];
}

const MAX_SCENE_COUNT = 80;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const SCENE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
// Accept both Markdown styles found in Watchless history:
//   **Speaker：** utterance
//   **Speaker**：utterance
const BOLD_COLON_LABEL_PATTERN = /\*\*([^*\n]{1,60}?)(?:[：:]\*\*|\*\*[：:])/g;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readString(record: Record<string, unknown>, key: string, maxLength = 20_000): string | null {
  const value = record[key];
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function isSafeResourceUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) {
    return true;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeScene(value: unknown): WatchlessScene | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const scene = value as Record<string, unknown>;
  const id = readString(scene, 'id', 80);
  const titleZh = readString(scene, 'titleZh', 320);
  const timeLabel = readString(scene, 'timeLabel', 80);
  const keyframe = readString(scene, 'keyframe', 2_048);
  const keyframeAlt = readString(scene, 'keyframeAlt', 600);
  const articleZh = readString(scene, 'articleZh', 120_000);
  const transcriptEn = readString(scene, 'transcriptEn', 240_000);
  const visualDescriptionZh = readString(scene, 'visualDescriptionZh', 4_000);
  const boundaryReasonEn = readString(scene, 'boundaryReasonEn', 4_000);

  if (
    !id ||
    !titleZh ||
    !timeLabel ||
    !keyframe ||
    !keyframeAlt ||
    !articleZh ||
    !transcriptEn ||
    !visualDescriptionZh ||
    !boundaryReasonEn ||
    !SCENE_ID_PATTERN.test(id) ||
    !isSafeResourceUrl(keyframe) ||
    !isFiniteNumber(scene.number) ||
    !Number.isInteger(scene.number) ||
    scene.number < 1 ||
    scene.number > 10_000 ||
    !isFiniteNumber(scene.startSec) ||
    !isFiniteNumber(scene.endSec) ||
    scene.startSec < 0 ||
    scene.endSec > MAX_DURATION_SECONDS ||
    scene.endSec <= scene.startSec
  ) {
    return null;
  }

  return {
    id,
    number: Math.max(1, Math.floor(scene.number)),
    titleZh,
    timeLabel,
    startSec: Math.max(0, scene.startSec),
    endSec: scene.endSec,
    keyframe,
    keyframeAlt,
    articleZh,
    transcriptEn,
    visualDescriptionZh,
    boundaryReasonEn,
  };
}

export function normalizeWatchlessArticle(value: unknown): WatchlessArticle | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const article = value as Record<string, unknown>;
  const scenesRaw = Array.isArray(article.scenes) ? article.scenes : [];
  if (scenesRaw.length === 0 || scenesRaw.length > MAX_SCENE_COUNT) {
    return null;
  }
  const scenes = scenesRaw.map(normalizeScene).filter((scene): scene is WatchlessScene => Boolean(scene));
  const id = readString(article, 'id', 120);
  const videoId = readString(article, 'videoId', 11);
  const title = readString(article, 'title', 500);
  const titleZh = readString(article, 'titleZh', 500);
  const eyebrow = readString(article, 'eyebrow', 120);
  const author = readString(article, 'author', 200);
  const sourceName = readString(article, 'sourceName', 240);
  const sourceUrl = readString(article, 'sourceUrl', 2_048);
  const pdfUrl = readString(article, 'pdfUrl', 2_048);
  const durationLabel = readString(article, 'durationLabel', 80);
  const publishedLabel = readString(article, 'publishedLabel', 240);
  const summaryZh = readString(article, 'summaryZh', 100_000);
  const summaryEn = readString(article, 'summaryEn', 100_000);
  const bodyModeRaw = readString(article, 'bodyMode', 16);
  const bodyMode: WatchlessBodyMode = bodyModeRaw === 'verbatim' ? 'verbatim' : 'editorial';
  const articleZhKindRaw = readString(article, 'articleZhKind', 16);
  const transcriptLanguageRaw = readString(article, 'transcriptLanguage', 16);
  const transcriptLanguage: WatchlessTranscriptLanguage =
    transcriptLanguageRaw === 'zh' || transcriptLanguageRaw === 'other' ? transcriptLanguageRaw : 'en';
  const articleZhKind: WatchlessChineseContentKind =
    articleZhKindRaw === 'translation' || articleZhKindRaw === 'original' || articleZhKindRaw === 'editorial'
      ? articleZhKindRaw
      : bodyMode === 'editorial'
        ? 'editorial'
        : transcriptLanguage === 'en'
          ? 'translation'
          : 'original';
  const availableLanguageModesRaw = Array.isArray(article.availableLanguageModes)
    ? article.availableLanguageModes
    : ['zh', 'en', 'bilingual', 'hint'];
  const availableLanguageModes = availableLanguageModesRaw.filter(
    (mode): mode is WatchlessLanguageMode => (
      mode === 'zh' || mode === 'en' || mode === 'bilingual' || mode === 'hint'
    ),
  );
  const availableModeSet = new Set(availableLanguageModes);
  const hasInvalidLanguageContract =
    (articleZhKind === 'translation' && transcriptLanguage !== 'en') ||
    (availableModeSet.has('bilingual') && (!availableModeSet.has('zh') || !availableModeSet.has('en'))) ||
    (availableModeSet.has('hint') && !availableModeSet.has('en'));

  const sceneIds = new Set<string>();
  const sceneNumbers = new Set<number>();
  let previousStart = -1;
  let previousNumber = 0;
  const hasInvalidTimeline = scenes.some((scene) => {
    const invalid =
      sceneIds.has(scene.id) ||
      sceneNumbers.has(scene.number) ||
      scene.startSec < previousStart ||
      scene.number <= previousNumber ||
      (isFiniteNumber(article.durationSec) && scene.endSec > article.durationSec + 1);
    sceneIds.add(scene.id);
    sceneNumbers.add(scene.number);
    previousStart = scene.startSec;
    previousNumber = scene.number;
    return invalid;
  });

  if (
    !id ||
    !videoId ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ||
    !title ||
    !titleZh ||
    !eyebrow ||
    !author ||
    !sourceName ||
    !sourceUrl ||
    !isSafeResourceUrl(sourceUrl) ||
    !pdfUrl ||
    !isSafeResourceUrl(pdfUrl) ||
    !durationLabel ||
    !publishedLabel ||
    !summaryZh ||
    !summaryEn ||
    availableLanguageModes.length === 0 ||
    new Set(availableLanguageModes).size !== availableLanguageModes.length ||
    hasInvalidLanguageContract ||
    !isFiniteNumber(article.durationSec) ||
    article.durationSec <= 0 ||
    article.durationSec > MAX_DURATION_SECONDS ||
    scenes.length !== scenesRaw.length ||
    hasInvalidTimeline
  ) {
    return null;
  }

  return {
    id,
    videoId,
    title,
    titleZh,
    eyebrow,
    author,
    sourceName,
    sourceUrl,
    pdfUrl,
    durationSec: article.durationSec,
    durationLabel,
    publishedLabel,
    summaryZh,
    summaryEn,
    bodyMode,
    articleZhKind,
    transcriptLanguage,
    availableLanguageModes,
    scenes,
  };
}

export function formatSceneTimestamp(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function youtubeAtTimeUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}

export function extractDialogueSpeakerLabels(markdowns: string[]): string[] {
  const counts = new Map<string, number>();

  for (const markdown of markdowns) {
    for (const match of markdown.matchAll(BOLD_COLON_LABEL_PATTERN)) {
      const label = match[1].trim();
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([label]) => label)
    .sort((left, right) => right.length - left.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatDialogueTurns(markdown: string, speakerLabels: string[]): string {
  if (speakerLabels.length === 0) {
    return markdown;
  }

  const labelPattern = speakerLabels.map(escapeRegExp).join('|');
  const speakerPattern = new RegExp(`\\*\\*(${labelPattern})(?:[：:]\\*\\*|\\*\\*[：:])`, 'g');

  return markdown.replace(speakerPattern, (_label, speaker: string, offset: number) => {
    const canonicalLabel = `**${speaker}：**`;
    if (offset === 0 || markdown.slice(0, offset).endsWith('\n\n')) {
      return canonicalLabel;
    }
    return `\n\n${canonicalLabel}`;
  });
}
