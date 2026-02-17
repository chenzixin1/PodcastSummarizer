export interface AdvancedWordEntry {
  zh?: string;
  level?: string[];
  sources?: string[];
}

export type AdvancedWordDict = Record<string, AdvancedWordEntry>;

export interface HintDictionarySense {
  pos: string;
  posLabel: string;
  meaning: string;
}

export interface HintDictionaryCard {
  word: string;
  posSummary: string[];
  senses: HintDictionarySense[];
}

interface TimeLine {
  timestamp: string;
  text: string;
}

export interface HintCandidate {
  word: string;
  context: string;
}

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const PRONOUNCE_HASH_PREFIX = '#pronounce:';
const MIN_HINT_SCORE = 6;
const POS_TOKEN_PATTERN = /\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|aux|modal|int|art|det|abbr)\./gi;
const POS_LABEL_MAP: Record<string, string> = {
  vt: '及物动词',
  vi: '不及物动词',
  v: '动词',
  n: '名词',
  adj: '形容词',
  adv: '副词',
  prep: '介词',
  conj: '连词',
  pron: '代词',
  num: '数词',
  aux: '助动词',
  modal: '情态动词',
  int: '感叹词',
  art: '冠词',
  det: '限定词',
  abbr: '缩写',
};
const ADVANCED_MORPHEME_PATTERN =
  /(tion|sion|tial|cial|ability|ibility|ative|ology|onomy|metry|scope|phobia|phile|soph|terrestrial|deploy|radiat|infrastructure|electrific|bandwidth|architecture|environmental|complementary)/i;
const RARE_PATTERN = /[qxz]|ph|rh|mn|pt|ct|[aeiou]{3}/i;
const SIMPLE_WORDS = new Set([
  'about', 'after', 'again', 'also', 'always', 'among', 'another', 'around', 'because', 'before', 'being',
  'between', 'both', 'build', 'built', 'center', 'centers', 'change', 'company', 'could', 'data', 'deep',
  'does', 'each', 'energy', 'english', 'every', 'first', 'found', 'from', 'full', 'good', 'great', 'group',
  'have', 'into', 'just', 'keep', 'large', 'launch', 'launched', 'less', 'line', 'made', 'make', 'many',
  'maps', 'more', 'most', 'much', 'need', 'new', 'news', 'next', 'open', 'other', 'over', 'part', 'people',
  'point', 'power', 'project', 'quickly', 'really', 'result', 'results', 'search', 'simple', 'small', 'some',
  'space', 'start', 'startup', 'summary', 'takeaway', 'takeaways', 'team', 'teams', 'text', 'than', 'that',
  'their', 'there', 'these', 'they', 'this', 'time', 'today', 'tools', 'under', 'using', 'very', 'video',
  'videos', 'want', 'what', 'when', 'where', 'which', 'while', 'with', 'words', 'work', 'would', 'year', 'years',
  'address', 'growing', 'resource', 'resources', 'constant', 'cooling', 'launched', 'carrying', 'marking',
  'powerful', 'previous', 'computer', 'founded', 'rapidly', 'designed', 'tested', 'process', 'typically',
  'innovation', 'management', 'techniques', 'allow', 'development', 'significant', 'benefits', 'including',
  'lower', 'vision', 'massive', 'potentially', 'capable', 'fitting', 'compete', 'costs', 'focuses', 'providing',
  'broader', 'goal', 'hosting', 'general', 'purpose', 'decreasing', 'driven', 'making', 'economics',
  'increasingly', 'backgrounds', 'experience', 'crucial', 'progress', 'numbers', 'decisions', 'action', 'items',
  'continue', 'leverage', 'expertise', 'launch', 'plan', 'successfully', 'initial', 'model',
]);

interface HintTokenMatch {
  rawWord: string;
  key: string;
  index: number;
  entry: AdvancedWordEntry;
}

function cleanLine(line: string): string {
  return line.replace(/\r/g, '').trim();
}

function normalizeWordToken(word: string): string {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
}

export function stripPronunciationLinks(markdown: string): string {
  return String(markdown || '')
    .replace(/\[([^\]]+)\]\(pronounce:\/\/[^)\s]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(#pronounce:[^)\s]+\)/g, '$1');
}

function splitHintBlocks(markdown: string, options?: { segmentByLine?: boolean }): string[] {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  const segmentByLine = options?.segmentByLine ?? false;

  const pushCurrent = () => {
    const value = current.join('\n').trim();
    if (value) {
      blocks.push(value);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pushCurrent();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) || /^\s*[-*+]\s+/.test(trimmed) || /^\s*\d+\.\s+/.test(trimmed)) {
      pushCurrent();
      blocks.push(line);
      continue;
    }
    if (segmentByLine) {
      pushCurrent();
      blocks.push(line);
      continue;
    }
    current.push(line);
  }

  pushCurrent();
  return blocks;
}

function chooseText(value: string, fallback: string): string {
  const normalized = cleanLine(value);
  return normalized || fallback;
}

function stripMarkdownMarkers(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^#+\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

function extractBulletsBySection(markdown: string): Array<{ section: string; items: string[] }> {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ section: string; items: string[] }> = [];
  let currentSection = 'Main';
  let currentItems: string[] = [];

  const pushSection = () => {
    if (currentItems.length > 0) {
      sections.push({ section: currentSection, items: currentItems });
      currentItems = [];
    }
  };

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      pushSection();
      currentSection = stripMarkdownMarkers(line) || 'Main';
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const item = stripMarkdownMarkers(line);
      if (item) {
        currentItems.push(item);
      }
      continue;
    }

    const normalized = stripMarkdownMarkers(line);
    if (normalized) {
      currentItems.push(normalized);
    }
  }

  pushSection();

  if (sections.length === 0) {
    const fallback = lines
      .map((line) => stripMarkdownMarkers(line))
      .filter(Boolean);
    if (fallback.length > 0) {
      sections.push({ section: 'Main', items: fallback });
    }
  }

  return sections;
}

export function buildSummaryBilingualMarkdown(summaryEn: string, summaryZh: string): string {
  const enSections = extractBulletsBySection(summaryEn);
  const zhSections = extractBulletsBySection(summaryZh);
  const length = Math.max(enSections.length, zhSections.length);
  const blocks: string[] = [];

  for (let i = 0; i < length; i += 1) {
    const enSection = enSections[i];
    const zhSection = zhSections[i];
    const title = chooseText(enSection?.section || '', zhSection?.section || `Section ${i + 1}`);
    const enItems = enSection?.items || [];
    const zhItems = zhSection?.items || [];
    const itemCount = Math.max(enItems.length, zhItems.length);

    blocks.push(`## ${title}`);
    for (let j = 0; j < itemCount; j += 1) {
      const en = chooseText(enItems[j] || '', '(Not matched)');
      const zh = chooseText(zhItems[j] || '', '（未匹配内容）');
      blocks.push(`${en}  `);
      blocks.push(zh);
      blocks.push('');
      blocks.push('---');
      blocks.push('');
    }
  }

  return blocks.join('\n').trim();
}

function parseTimestampLines(markdown: string): TimeLine[] {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const result: TimeLine[] = [];

  for (const line of lines) {
    const matched = line.match(/^\*\*\[(\d{2}:\d{2}:\d{2})\]\*\*\s*(.+)$/) || line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
    if (matched) {
      result.push({ timestamp: matched[1], text: stripMarkdownMarkers(matched[2]) });
      continue;
    }

    const fallback = stripMarkdownMarkers(line);
    if (fallback) {
      result.push({ timestamp: '', text: fallback });
    }
  }

  return result;
}

export function buildFullTextBilingualMarkdown(fullTextEn: string, fullTextZh: string): string {
  const enLines = parseTimestampLines(fullTextEn);
  const zhLines = parseTimestampLines(fullTextZh);

  const zhByTs = new Map<string, string[]>();
  const zhNoTs: string[] = [];

  for (const line of zhLines) {
    if (line.timestamp) {
      const list = zhByTs.get(line.timestamp) || [];
      list.push(line.text);
      zhByTs.set(line.timestamp, list);
    } else {
      zhNoTs.push(line.text);
    }
  }

  const output: string[] = [];
  let fallbackIndex = 0;

  for (let i = 0; i < enLines.length; i += 1) {
    const en = enLines[i];
    let zh = '（未匹配内容）';

    if (en.timestamp && zhByTs.has(en.timestamp)) {
      const list = zhByTs.get(en.timestamp) || [];
      if (list.length > 0) {
        zh = list.shift() || zh;
      }
      if (list.length === 0) {
        zhByTs.delete(en.timestamp);
      } else {
        zhByTs.set(en.timestamp, list);
      }
    } else if (fallbackIndex < zhNoTs.length) {
      zh = zhNoTs[fallbackIndex];
      fallbackIndex += 1;
    } else if (i < zhLines.length) {
      zh = zhLines[i].text;
    }

    const prefix = en.timestamp ? `**[${en.timestamp}]** ` : '';
    output.push(`${prefix}${en.text}  `);
    output.push(zh);
    output.push('');
    output.push('---');
    output.push('');
  }

  if (output.length === 0) {
    return '';
  }

  return output.join('\n').trim();
}

function sanitizeGloss(gloss: string): string {
  return gloss.replace(/[()（）]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function normalizeDictionaryText(raw: string): string {
  return String(raw || '')
    .replace(URL_PATTERN, ' ')
    .replace(/&#\d+;?/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDictionaryNoise(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }
  if (!/[\u4E00-\u9FFF]/.test(normalized)) {
    return true;
  }
  if (/^(全部|搜尋|图片|影片|地圖|更多|新闻|航班|旅遊|工具|日期|约有|个结果)$/.test(normalized)) {
    return true;
  }
  if (/知乎|打开链接|new tab|search|http/i.test(normalized)) {
    return true;
  }
  return false;
}

function formatPosTag(rawPos: string): { pos: string; posLabel: string } {
  const key = String(rawPos || '').toLowerCase().replace(/\./g, '');
  return {
    pos: key ? `${key}.` : '未标注',
    posLabel: POS_LABEL_MAP[key] || '未标注',
  };
}

export function buildHintDictionaryCard(word: string, entry?: AdvancedWordEntry | null): HintDictionaryCard | null {
  const normalizedWord = String(word || '').trim();
  const rawZh = normalizeDictionaryText(entry?.zh || '');
  if (!normalizedWord || !rawZh) {
    return null;
  }

  const markers: Array<{ index: number; rawPos: string; length: number }> = [];
  let matched: RegExpExecArray | null;
  POS_TOKEN_PATTERN.lastIndex = 0;
  while ((matched = POS_TOKEN_PATTERN.exec(rawZh)) !== null) {
    markers.push({
      index: matched.index,
      rawPos: matched[1] || '',
      length: matched[0]?.length || 0,
    });
  }

  const senses: HintDictionarySense[] = [];
  if (markers.length > 0) {
    for (let i = 0; i < markers.length; i += 1) {
      const current = markers[i];
      const next = markers[i + 1];
      const chunk = rawZh
        .slice(current.index + current.length, next ? next.index : rawZh.length)
        .replace(/^[\s,，;；:：]+/, '')
        .trim();
      if (!chunk) {
        continue;
      }
      const normalizedChunks = chunk
        .split(/[；;]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      const posMeta = formatPosTag(current.rawPos);
      for (const item of normalizedChunks) {
        if (isDictionaryNoise(item)) {
          continue;
        }
        senses.push({
          pos: posMeta.pos,
          posLabel: posMeta.posLabel,
          meaning: item.slice(0, 120),
        });
      }
    }
  } else {
    const fallbackChunks = rawZh
      .split(/[；;]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    for (const item of fallbackChunks) {
      if (isDictionaryNoise(item)) {
        continue;
      }
      senses.push({
        pos: '未标注',
        posLabel: '未标注',
        meaning: item.slice(0, 120),
      });
    }
  }

  const deduped: HintDictionarySense[] = [];
  const seen = new Set<string>();
  for (const sense of senses) {
    const key = `${sense.pos}|${sense.meaning}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(sense);
    if (deduped.length >= 8) {
      break;
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  const posSummary = Array.from(
    new Set(
      deduped
        .map((sense) => `${sense.pos} ${sense.posLabel}`.trim())
        .filter((item) => item.length > 0 && !item.startsWith('未标注'))
    )
  );

  return {
    word: normalizedWord,
    posSummary: posSummary.length > 0 ? posSummary : ['未标注'],
    senses: deduped,
  };
}

function shouldSkipHintWord(wordKey: string, entry?: AdvancedWordEntry): boolean {
  if (!wordKey || wordKey.length < 8) {
    return true;
  }
  if (SIMPLE_WORDS.has(wordKey)) {
    return true;
  }
  if (/^(?:[a-z]{1,6})(?:ing|ed|ly|er|est|ness|less|ful)$/.test(wordKey)) {
    return true;
  }
  const levels = entry?.level || [];
  if (levels.length > 0 && levels.every((item) => /cet4|basic|elementary/i.test(item))) {
    return true;
  }
  return false;
}

function scoreHintWord(wordKey: string, entry: AdvancedWordEntry): number {
  void entry;
  let score = 0;
  if (wordKey.length >= 12) {
    score += 4;
  } else if (wordKey.length >= 10) {
    score += 3;
  } else if (wordKey.length >= 8) {
    score += 2;
  }
  if (ADVANCED_MORPHEME_PATTERN.test(wordKey)) {
    score += 3;
  }
  if (RARE_PATTERN.test(wordKey)) {
    score += 1;
  }
  if (wordKey.includes('-')) {
    score += 2;
  }
  return score;
}

function isHardHintWord(wordKey: string, entry: AdvancedWordEntry): boolean {
  return scoreHintWord(wordKey, entry) >= MIN_HINT_SCORE;
}

function findWordContext(text: string, rawWord: string, index: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const fallback = text.trim().slice(0, 220);
  if (sentences.length === 0) {
    return fallback;
  }
  let cursor = 0;
  for (const sentence of sentences) {
    const start = cursor;
    const end = start + sentence.length;
    cursor = end + 1;
    if (index >= start && index <= end && new RegExp(`\\b${rawWord}\\b`, 'i').test(sentence)) {
      return sentence.trim().slice(0, 220);
    }
  }
  return fallback;
}

export function extractHintCandidates(
  markdown: string,
  dict: AdvancedWordDict,
  options?: { maxHintsPerParagraph?: number; maxCandidates?: number; segmentByLine?: boolean }
): HintCandidate[] {
  const maxHintsPerParagraph = options?.maxHintsPerParagraph ?? 5;
  const maxCandidates = options?.maxCandidates ?? 48;
  const segmentByLine = options?.segmentByLine ?? false;
  const normalized = String(markdown || '');
  if (!normalized.trim()) {
    return [];
  }

  const codeBlocks = normalized.match(CODE_BLOCK_PATTERN) || [];
  const placeholder = '__CODE_BLOCK_PLACEHOLDER__';
  let blockIndex = 0;
  const stripped = normalized.replace(CODE_BLOCK_PATTERN, () => `${placeholder}${blockIndex++}__`);
  const paragraphs = splitHintBlocks(stripped, { segmentByLine });
  const candidates: HintCandidate[] = [];
  const globalUsed = new Set<string>();

  for (const paragraph of paragraphs) {
    if (candidates.length >= maxCandidates) {
      break;
    }
    if (!paragraph.trim() || /^\s*#{1,6}\s+/.test(paragraph.trim())) {
      continue;
    }

    let safeText = paragraph;
    safeText = safeText.replace(URL_PATTERN, (url) => `__URL_${url.length}__`);
    const tokenPattern = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
    const localCandidates: HintTokenMatch[] = [];
    const localUsed = new Set<string>();

    let matched: RegExpExecArray | null;
    while ((matched = tokenPattern.exec(safeText)) !== null) {
      if (candidates.length >= maxCandidates) {
        break;
      }
      const rawWord = matched[0];
      const key = normalizeWordToken(rawWord);
      if (!key || globalUsed.has(key) || localUsed.has(key)) {
        continue;
      }
      const entry = dict[key];
      if (!entry || shouldSkipHintWord(key, entry)) {
        continue;
      }
      if (!isHardHintWord(key, entry)) {
        continue;
      }
      const tail = safeText.slice(matched.index + rawWord.length, matched.index + rawWord.length + 2);
      if (tail.startsWith('（') || tail.startsWith('(')) {
        continue;
      }

      localCandidates.push({ rawWord, key, index: matched.index, entry });
      localUsed.add(key);
    }

    const picked = localCandidates
      .sort((a, b) => scoreHintWord(b.key, b.entry) - scoreHintWord(a.key, a.entry))
      .slice(0, maxHintsPerParagraph);

    for (const item of picked) {
      const context = findWordContext(safeText, item.rawWord, item.index);
      candidates.push({ word: item.key, context });
      globalUsed.add(item.key);
      if (candidates.length >= maxCandidates) {
        break;
      }
    }
  }

  return candidates.filter((item) => !codeBlocks.some((block) => block.includes(item.word)));
}

function annotateParagraph(
  paragraph: string,
  dict: AdvancedWordDict,
  maxHintsPerParagraph: number,
  generatedHints: Record<string, string>,
  requireGeneratedHints: boolean,
  interactionMode: 'plain' | 'pronounceLink'
): string {
  if (!paragraph.trim()) {
    return paragraph;
  }

  let safeText = paragraph;
  const urls: string[] = [];
  safeText = safeText.replace(URL_PATTERN, (url) => {
    const key = `__URL_${urls.length}__`;
    urls.push(url);
    return key;
  });

  const tokenPattern = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
  const used = new Set<string>();
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  let hintCount = 0;

  let matched: RegExpExecArray | null;
  while ((matched = tokenPattern.exec(safeText)) !== null) {
    if (hintCount >= maxHintsPerParagraph) {
      break;
    }

    const rawWord = matched[0];
    const key = normalizeWordToken(rawWord);
    if (!key || used.has(key)) {
      continue;
    }

    const entry = dict[key];
    if (!entry || shouldSkipHintWord(key, entry)) {
      continue;
    }
    if (!isHardHintWord(key, entry)) {
      continue;
    }
    const dictionaryCard = buildHintDictionaryCard(rawWord, entry);
    if (interactionMode === 'pronounceLink' && !dictionaryCard) {
      continue;
    }
    const modelGloss = sanitizeGloss(generatedHints[key] || '');
    const fallbackGloss = sanitizeGloss((entry?.zh || '').split(/[；;，,。/]/)[0] || '');
    const zh = modelGloss || (requireGeneratedHints ? '' : fallbackGloss);
    if (interactionMode === 'plain' && !zh) {
      continue;
    }

    const tail = safeText.slice(matched.index + rawWord.length, matched.index + rawWord.length + 2);
    if (tail.startsWith('（') || tail.startsWith('(')) {
      continue;
    }

    used.add(key);
    hintCount += 1;
    const displayText = interactionMode === 'plain' ? `${rawWord}（${zh}）` : rawWord;
    const replacement =
      interactionMode === 'pronounceLink'
        ? `[${displayText}](${PRONOUNCE_HASH_PREFIX}${encodeURIComponent(key)})`
        : displayText;
    replacements.push({
      start: matched.index,
      end: matched.index + rawWord.length,
      replacement,
    });
  }

  if (replacements.length === 0) {
    return paragraph;
  }

  let output = '';
  let cursor = 0;
  for (const item of replacements) {
    output += safeText.slice(cursor, item.start);
    output += item.replacement;
    cursor = item.end;
  }
  output += safeText.slice(cursor);

  output = output.replace(/__URL_(\d+)__/g, (_, idx: string) => urls[Number(idx)] || '');
  return output;
}

export function annotateEnglishWithHints(
  markdown: string,
  dict: AdvancedWordDict,
  options?: {
    maxHintsPerParagraph?: number;
    generatedHints?: Record<string, string>;
    requireGeneratedHints?: boolean;
    segmentByLine?: boolean;
    interactionMode?: 'plain' | 'pronounceLink';
  }
): string {
  const maxHintsPerParagraph = options?.maxHintsPerParagraph ?? 8;
  const generatedHints = options?.generatedHints || {};
  const requireGeneratedHints = options?.requireGeneratedHints ?? false;
  const segmentByLine = options?.segmentByLine ?? false;
  const interactionMode = options?.interactionMode ?? 'plain';
  const normalized = String(markdown || '');
  if (!normalized.trim()) {
    return normalized;
  }

  const codeBlocks = normalized.match(CODE_BLOCK_PATTERN) || [];
  const placeholder = '__CODE_BLOCK_PLACEHOLDER__';
  let index = 0;
  const stripped = normalized.replace(CODE_BLOCK_PATTERN, () => `${placeholder}${index++}__`);

  const paragraphs = splitHintBlocks(stripped, { segmentByLine });
  const annotated = paragraphs.map((paragraph) =>
    annotateParagraph(
      paragraph,
      dict,
      maxHintsPerParagraph,
      generatedHints,
      requireGeneratedHints,
      interactionMode
    )
  );
  let merged = annotated.join('\n\n');

  merged = merged.replace(/__CODE_BLOCK_PLACEHOLDER__(\d+)__/g, (_, idx: string) => {
    const picked = codeBlocks[Number(idx)];
    return picked || '';
  });

  return merged;
}
