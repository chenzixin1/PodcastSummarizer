#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const QUERIES = [
  { q: 'IELTS vocabulary list', level: 'IELTS' },
  { q: 'CET6 word list', level: 'CET6' },
  { q: '考研英语 词汇表', level: 'KAOYAN' },
  { q: 'GMAT vocabulary list', level: 'GMAT' },
];

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/vocab');
const WORDS_PATH = path.join(OUTPUT_DIR, 'advanced-words.json');
const META_PATH = path.join(OUTPUT_DIR, 'advanced-words.meta.json');
const SOURCE_CACHE_PATH = path.resolve(process.cwd(), 'tmp/vocab-source-snapshot.json');

const MAX_SOURCES = Number(process.env.VOCAB_MAX_SOURCES || 24);
const MAX_FETCH_PER_QUERY = Number(process.env.VOCAB_MAX_FETCH_PER_QUERY || 12);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.VOCAB_TRANSLATION_MODEL || 'gpt-4o-mini';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWord(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z'-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/^'+|'+$/g, '')
    .trim();
}

function stripHtml(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function maybeLevel(text) {
  const raw = String(text || '').toLowerCase();
  const levels = [];
  if (raw.includes('ielts')) levels.push('IELTS');
  if (raw.includes('cet6') || raw.includes('cet-6') || raw.includes('六级')) levels.push('CET6');
  if (raw.includes('考研')) levels.push('KAOYAN');
  if (raw.includes('gmat')) levels.push('GMAT');
  return levels;
}

function parseDuckDuckGoLinks(html) {
  const links = [];
  const regex = /<a[^>]+href="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    if (href.startsWith('/l/?uddg=')) {
      const query = href.split('?')[1] || '';
      const params = new URLSearchParams(query);
      const target = params.get('uddg');
      if (target) links.push(decodeURIComponent(target));
      continue;
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      links.push(href);
    }
  }
  return links;
}

function isCandidateSource(url) {
  const lower = String(url || '').toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (lower.includes('duckduckgo.com')) return false;
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return false;
  if (lower.includes('facebook.com') || lower.includes('instagram.com')) return false;
  return true;
}

function parseLinePair(line) {
  const normalized = line.trim();
  if (!normalized || normalized.length < 4) return null;

  const sepMatched = normalized.match(/^([A-Za-z][A-Za-z' -]{2,40})\s*[-–—:：]\s*(.{2,})$/);
  if (sepMatched) {
    return {
      word: sepMatched[1].trim(),
      definition: sepMatched[2].trim(),
    };
  }

  const tabMatched = normalized.match(/^([A-Za-z][A-Za-z' -]{2,40})\t(.{2,})$/);
  if (tabMatched) {
    return {
      word: tabMatched[1].trim(),
      definition: tabMatched[2].trim(),
    };
  }

  const wordOnly = normalized.match(/^([A-Za-z][A-Za-z' -]{2,40})$/);
  if (wordOnly) {
    return {
      word: wordOnly[1].trim(),
      definition: '',
    };
  }

  return null;
}

function parseTextDictionary(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const result = [];
  let currentWord = '';
  let currentDefs = [];

  const flushCurrent = () => {
    if (!currentWord) return;
    const def = currentDefs.join('；').trim();
    result.push({ word: currentWord, definition: def });
    currentWord = '';
    currentDefs = [];
  };

  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) continue;

    if (/^[—\-]{6,}$/.test(cleaned)) {
      flushCurrent();
      continue;
    }

    const standaloneWord = cleaned.match(/^[A-Za-z][A-Za-z' -]{1,31}$/);
    if (standaloneWord) {
      flushCurrent();
      const normalized = normalizeWord(standaloneWord[0]);
      if (normalized && normalized.length >= 3 && normalized.length <= 32) {
        currentWord = normalized;
      }
      continue;
    }

    if (currentWord) {
      if (hasChinese(cleaned) || /^(adj\.|adv\.|n\.|v\.|vt\.|vi\.|prep\.)/i.test(cleaned)) {
        currentDefs.push(cleaned);
        continue;
      }
    }

    // Format like: "abandon [əˈbændən] v. ...中文..."
    const complexLine = cleaned.match(/^([A-Za-z][A-Za-z' -]{1,31})\s+.*$/);
    if (complexLine) {
      const normalizedWord = normalizeWord(complexLine[1]);
      if (normalizedWord && normalizedWord.length >= 3 && normalizedWord.length <= 32) {
        const firstChineseIndex = cleaned.search(/[\u4e00-\u9fff]/);
        const definition = firstChineseIndex >= 0 ? cleaned.slice(firstChineseIndex).trim() : cleaned.replace(complexLine[1], '').trim();
        result.push({ word: normalizedWord, definition });
        continue;
      }
    }

    const parsed = parseLinePair(line);
    if (!parsed) continue;
    const normalized = normalizeWord(parsed.word);
    if (!normalized || normalized.length < 3) continue;
    if (normalized.length > 32) continue;
    result.push({ word: normalized, definition: parsed.definition });
  }

  flushCurrent();
  return result;
}

function parseCsvDictionary(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const result = [];

  for (const line of lines.slice(0, 50000)) {
    const columns = line.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    if (columns.length < 1) continue;
    const wordCandidate = columns[0];
    const normalized = normalizeWord(wordCandidate);
    if (!normalized || normalized.length < 3) continue;
    const definition = columns.slice(1).join(', ').trim();
    result.push({ word: normalized, definition });
  }

  return result;
}

function parseJsonDictionary(data) {
  const result = [];

  const walk = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node === 'object') {
      const obj = node;
      const wordRaw = obj.word || obj.vocab || obj.term || obj.english || obj.en;
      const defRaw = obj.definition || obj.meaning || obj.chinese || obj.zh || obj.translation || obj.explain;
      if (typeof wordRaw === 'string') {
        const normalized = normalizeWord(wordRaw);
        if (normalized && normalized.length >= 3 && normalized.length <= 32) {
          result.push({ word: normalized, definition: String(defRaw || '').trim() });
        }
      }
      for (const value of Object.values(obj)) walk(value);
    }
  };

  walk(data);
  return result;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodSumVocabBot/1.0; +https://podsum.cc)',
        'Accept': 'text/html,application/json,text/plain,text/csv,*/*',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    return { text, contentType };
  } finally {
    clearTimeout(timer);
  }
}

async function searchSources(query) {
  const candidates = new Set();

  try {
    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { text } = await fetchText(ddgUrl);
    for (const link of parseDuckDuckGoLinks(text)) {
      if (isCandidateSource(link)) {
        candidates.add(link);
      }
    }
  } catch {
    // Continue with fallback search providers.
  }

  try {
    const bingRssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
    const { text } = await fetchText(bingRssUrl);
    const linkPattern = /<link>(https?:\/\/[^<]+)<\/link>/gi;
    let match;
    while ((match = linkPattern.exec(text)) !== null) {
      const url = match[1];
      if (isCandidateSource(url)) {
        candidates.add(url);
      }
    }
  } catch {
    // Ignore and fallback to static seed.
  }

  const staticSeed = [
    'https://raw.githubusercontent.com/mahavivo/english-wordlists/master/COCA_with_translation.txt',
    'https://raw.githubusercontent.com/mahavivo/english-wordlists/master/CET6_edited.txt',
    'https://raw.githubusercontent.com/mahavivo/english-wordlists/master/%E8%8B%B1%E8%AF%AD%E5%85%AD%E7%BA%A7%E8%AF%8D%E6%B1%87%EF%BC%88%E6%98%9F%E6%A0%87%EF%BC%8C1726%EF%BC%89.txt',
    'https://gist.githubusercontent.com/liruqi/f86d61604302dd1c07ff84e9467a6afc/raw/IELTS-new-word.txt',
  ];
  for (const seed of staticSeed) {
    candidates.add(seed);
  }

  return Array.from(candidates).slice(0, MAX_FETCH_PER_QUERY);
}

function mergeEntry(map, word, definition, sourceUrl, levels) {
  if (!map.has(word)) {
    map.set(word, {
      defsEn: new Set(),
      defsZh: new Set(),
      sources: new Set(),
      levels: new Set(),
    });
  }

  const record = map.get(word);
  if (definition) {
    if (hasChinese(definition)) {
      record.defsZh.add(definition.slice(0, 120));
    } else {
      record.defsEn.add(definition.slice(0, 200));
    }
  }
  record.sources.add(sourceUrl);
  for (const lvl of levels) {
    record.levels.add(lvl);
  }
}

async function translateDefinitions(rows) {
  if (!OPENAI_API_KEY || rows.length === 0) {
    return new Map();
  }

  const payloadRows = rows.slice(0, 1200);
  const prompt = payloadRows
    .map((row, idx) => `${idx + 1}. ${row.word}\t${row.definition}`)
    .join('\n');

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: 'Translate English vocabulary definitions into concise Chinese gloss. Return JSON object only: {"word":"中文释义"}.',
      },
      {
        role: 'user',
        content: `Translate the following list to Chinese:\n${prompt}`,
      },
    ],
    response_format: { type: 'json_object' },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Translation API failed (${response.status})`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  const out = new Map();

  for (const [word, zh] of Object.entries(parsed)) {
    if (typeof zh === 'string' && zh.trim()) {
      out.set(normalizeWord(word), zh.trim().slice(0, 120));
    }
  }

  return out;
}

async function main() {
  console.log('[vocab] build started');

  const sourceItems = [];
  for (const item of QUERIES) {
    try {
      const links = await searchSources(item.q);
      for (const link of links) {
        sourceItems.push({
          query: item.q,
          level: item.level,
          url: link,
        });
      }
      await sleep(400);
    } catch (error) {
      console.warn(`[vocab] search failed for query=${item.q}:`, error.message || String(error));
    }
  }

  const uniqueSourceMap = new Map();
  for (const source of sourceItems) {
    if (!uniqueSourceMap.has(source.url)) {
      uniqueSourceMap.set(source.url, {
        ...source,
        levels: new Set([source.level]),
      });
      continue;
    }
    uniqueSourceMap.get(source.url).levels.add(source.level);
  }
  const pickedSources = Array.from(uniqueSourceMap.values()).slice(0, MAX_SOURCES);

  const wordMap = new Map();
  let rawEntries = 0;
  const visitedSources = [];

  for (const source of pickedSources) {
    try {
      const { text, contentType } = await fetchText(source.url);
      let pairs = [];

      if (contentType.includes('application/json') || source.url.toLowerCase().endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          pairs = parseJsonDictionary(parsed);
        } catch {
          pairs = [];
        }
      } else if (contentType.includes('text/csv') || source.url.toLowerCase().endsWith('.csv')) {
        pairs = parseCsvDictionary(text);
      } else {
        const content = contentType.includes('text/html') ? stripHtml(text).replace(/\s+/g, '\n') : text;
        pairs = parseTextDictionary(content);
      }

      if (pairs.length === 0) {
        continue;
      }

      const inferredLevels = new Set([
        ...(source.levels ? Array.from(source.levels) : [source.level]),
        ...maybeLevel(source.url),
        ...maybeLevel(source.query),
      ]);

      for (const pair of pairs) {
        rawEntries += 1;
        mergeEntry(wordMap, pair.word, pair.definition, source.url, Array.from(inferredLevels));
      }

      visitedSources.push({
        url: source.url,
        query: source.query,
        level: source.level,
        levels: Array.from(inferredLevels),
        parsedEntries: pairs.length,
      });

      await sleep(250);
    } catch (error) {
      console.warn(`[vocab] source fetch failed: ${source.url} -> ${error.message || String(error)}`);
    }
  }

  const translateQueue = [];
  for (const [word, record] of wordMap.entries()) {
    if (record.defsZh.size > 0) continue;
    const en = Array.from(record.defsEn)[0] || '';
    if (!en) continue;
    translateQueue.push({ word, definition: en });
  }

  let translatedCount = 0;
  let translatedMap = new Map();
  if (translateQueue.length > 0) {
    try {
      translatedMap = await translateDefinitions(translateQueue);
      translatedCount = translatedMap.size;
    } catch (error) {
      console.warn('[vocab] translation failed, fallback to english gloss:', error.message || String(error));
    }
  }

  const output = {};
  let withZhDefinition = 0;

  for (const [word, record] of wordMap.entries()) {
    let zh = Array.from(record.defsZh)[0] || '';
    if (!zh) {
      zh = translatedMap.get(word) || '';
    }
    if (!zh) {
      zh = Array.from(record.defsEn)[0] || '';
    }

    if (!zh) {
      continue;
    }

    if (hasChinese(zh)) {
      withZhDefinition += 1;
    }

    output[word] = {
      zh,
      level: Array.from(record.levels),
      sources: Array.from(record.sources).slice(0, 6),
    };
  }

  const dedupedWords = wordMap.size;
  const finalWords = Object.keys(output).length;

  const meta = {
    generatedAt: new Date().toISOString(),
    totalWords: finalWords,
    fromSources: visitedSources.length,
    withZhDefinition,
    translatedCount,
    rawEntries,
    dedupedWords,
    queries: QUERIES.map((item) => item.q),
    notes: 'For internal learning use only. One-time snapshot without auto update.',
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(path.dirname(SOURCE_CACHE_PATH), { recursive: true });
  await fs.writeFile(WORDS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fs.writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  await fs.writeFile(SOURCE_CACHE_PATH, `${JSON.stringify(visitedSources, null, 2)}\n`, 'utf8');

  console.log(`[vocab] 抓取源总数: ${visitedSources.length}`);
  console.log(`[vocab] 原始词条总数: ${rawEntries}`);
  console.log(`[vocab] 去重后总词数: ${dedupedWords}`);
  console.log(`[vocab] 翻译补全数量: ${translatedCount}`);
  console.log(`[vocab] 最终可用词数: ${finalWords}`);
  console.log(`[vocab] written: ${WORDS_PATH}`);
  console.log(`[vocab] written: ${META_PATH}`);
}

main().catch((error) => {
  console.error('[vocab] fatal error:', error);
  process.exitCode = 1;
});
