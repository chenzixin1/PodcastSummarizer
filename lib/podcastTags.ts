const MAX_TAGS = 10;

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

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTag(value: string): string {
  const trimmed = cleanWhitespace(value).replace(/^#+/, '').replace(/[.,;:!?/\\|()[\]{}'"`]+$/g, '');
  return trimmed;
}

function upsertScore(target: Map<string, number>, tag: string, score: number): void {
  const normalized = normalizeTag(tag);
  if (!isUsefulTag(normalized)) {
    return;
  }
  const key = normalized.toLowerCase();
  target.set(key, (target.get(key) || 0) + score);
}

function isUsefulTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('youtube-') ||
    BLOCKED_TAGS.has(lower) ||
    EN_STOPWORDS.has(lower) ||
    ZH_STOPWORDS.has(normalized)
  ) {
    return false;
  }
  return true;
}

function collectEnglishTerms(
  target: Map<string, number>,
  text: string,
  score: number,
  displayMap?: Map<string, string>,
): void {
  const matches = text.match(/[A-Za-z][A-Za-z0-9+.-]{1,28}/g) || [];
  const runs: string[][] = [];
  let currentRun: string[] = [];

  for (const item of matches) {
    const token = normalizeTag(item);
    const lower = token.toLowerCase();
    if (token.length < 2 || EN_STOPWORDS.has(lower) || /^\d+$/.test(token)) {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
      continue;
    }
    currentRun.push(token);
    upsertScore(target, token, score);
    if (displayMap && !displayMap.has(lower)) {
      displayMap.set(lower, token);
    }
  }

  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  for (const run of runs) {
    for (let size = Math.min(3, run.length); size >= 2; size -= 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const phrase = run.slice(index, index + size).join(' ');
        upsertScore(target, phrase, score + size + 1);
        const key = phrase.toLowerCase();
        if (displayMap && !displayMap.has(key)) {
          displayMap.set(key, phrase);
        }
      }
    }
  }
}

function collectChinesePhrases(
  target: Map<string, number>,
  text: string,
  score: number,
  displayMap?: Map<string, string>,
): void {
  const matches = text.match(/[\u4e00-\u9fff]{2,10}/g) || [];
  for (const phrase of matches) {
    const normalized = normalizeTag(phrase);
    if (normalized.length < 2 || ZH_STOPWORDS.has(normalized)) {
      continue;
    }
    upsertScore(target, normalized, score);
    const key = normalized.toLowerCase();
    if (displayMap && !displayMap.has(key)) {
      displayMap.set(key, normalized);
    }
  }
}

function detectSourceTag(sourceReference?: string | null): string[] {
  const source = String(sourceReference || '').toLowerCase();
  const tags: string[] = [];
  if (source.includes('bilibili.com')) {
    tags.push('Bilibili');
  }
  if (source.includes('x.com') || source.includes('twitter.com')) {
    tags.push('X');
  }
  return tags;
}

function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\r\n/g, '\n');
}

export function extractPodcastTags(input: {
  title?: string | null;
  summary?: string | null;
  sourceReference?: string | null;
  fallbackName?: string | null;
}): string[] {
  const title = cleanWhitespace(String(input.title || input.fallbackName || ''));
  const summary = cleanWhitespace(stripMarkdown(String(input.summary || '')));

  const scoreMap = new Map<string, number>();
  const displayMap = new Map<string, string>();
  const remember = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!isUsefulTag(normalized)) return;
    const key = normalized.toLowerCase();
    if (!displayMap.has(key)) {
      displayMap.set(key, normalized);
    }
  };

  for (const sourceTag of detectSourceTag(input.sourceReference)) {
    upsertScore(scoreMap, sourceTag, 8);
    remember(sourceTag);
  }

  if (title) {
    collectEnglishTerms(scoreMap, title, 5, displayMap);
    collectChinesePhrases(scoreMap, title, 5, displayMap);
  }

  if (summary) {
    collectEnglishTerms(scoreMap, summary, 1, displayMap);
    collectChinesePhrases(scoreMap, summary, 1, displayMap);
  }

  const sorted = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAGS)
    .map(([key]) => displayMap.get(key) || key)
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const tag of sorted) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(tag);
  }
  return deduped;
}

export function normalizeDbTags(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return raw.split(',').map((part) => part.trim()).filter(Boolean);
          }
        })()
      : [];

  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of source) {
    const tag = normalizeTag(String(value || ''));
    if (!isUsefulTag(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= MAX_TAGS) {
      break;
    }
  }
  return result;
}
