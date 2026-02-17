#!/usr/bin/env node
import { put } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const VOCAB_PATH = path.join(ROOT_DIR, 'public', 'vocab', 'advanced-words.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'vocab', 'pronunciation', 'en-us');
const OUTPUT_CHUNKS_DIR = path.join(OUTPUT_DIR, 'chunks');
const META_PATH = path.join(OUTPUT_DIR, 'index.meta.json');

const ACCENT = 'en-US';
const CONCURRENCY = Number.parseInt(process.env.PRONUNCIATION_BUILD_CONCURRENCY || '6', 10);

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

const ADVANCED_MORPHEME_PATTERN =
  /(tion|sion|tial|cial|ability|ibility|ative|ology|onomy|metry|scope|phobia|phile|soph|terrestrial|deploy|radiat|infrastructure|electrific|bandwidth|architecture|environmental|complementary)/i;
const RARE_PATTERN = /[qxz]|ph|rh|mn|pt|ct|[aeiou]{3}/i;

function normalizeWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z'-]+$/g, '')
    .trim();
}

function shouldSkipHintWord(word) {
  if (!word || word.length < 8) {
    return true;
  }
  if (SIMPLE_WORDS.has(word)) {
    return true;
  }
  if (/^(?:[a-z]{1,6})(?:ing|ed|ly|er|est|ness|less|ful)$/.test(word)) {
    return true;
  }
  return false;
}

function scoreHintWord(word) {
  let score = 0;
  if (word.length >= 12) {
    score += 4;
  } else if (word.length >= 10) {
    score += 3;
  } else if (word.length >= 8) {
    score += 2;
  }
  if (ADVANCED_MORPHEME_PATTERN.test(word)) {
    score += 3;
  }
  if (RARE_PATTERN.test(word)) {
    score += 1;
  }
  if (word.includes('-')) {
    score += 2;
  }
  return score;
}

function isHardHintWord(word) {
  return scoreHintWord(word) >= 6;
}

function selectTargetWords(dict) {
  const words = Object.keys(dict || {});
  return words
    .map((word) => normalizeWord(word))
    .filter((word) => Boolean(word))
    .filter((word) => !shouldSkipHintWord(word))
    .filter((word) => isHardHintWord(word))
    .sort();
}

async function fetchDictionaryAudioUrl(word) {
  const endpoint = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return null;
  }

  const candidates = [];
  for (const entry of payload) {
    const phonetics = Array.isArray(entry?.phonetics) ? entry.phonetics : [];
    for (const phonetic of phonetics) {
      const rawAudio = String(phonetic?.audio || '').trim();
      if (!rawAudio) {
        continue;
      }
      const audio = rawAudio.startsWith('//') ? `https:${rawAudio}` : rawAudio;
      if (!/^https?:\/\//i.test(audio)) {
        continue;
      }
      const marker = `${String(phonetic?.text || '')} ${audio}`.toLowerCase();
      const usScore =
        /en-us|american|usa|\/us\//i.test(marker) ? 2 : 0;
      candidates.push({ audio, usScore });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.usScore - a.usScore);
  return candidates[0].audio;
}

function detectExtension(contentType, sourceUrl) {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('mpeg') || lowerType.includes('mp3')) {
    return 'mp3';
  }
  if (lowerType.includes('wav')) {
    return 'wav';
  }
  if (lowerType.includes('ogg')) {
    return 'ogg';
  }
  if (lowerType.includes('aac')) {
    return 'aac';
  }

  const pathname = new URL(sourceUrl).pathname.toLowerCase();
  const matched = pathname.match(/\.(mp3|wav|ogg|aac|m4a)$/);
  if (matched?.[1]) {
    return matched[1];
  }
  return 'mp3';
}

function bucketFromWord(word) {
  const first = word.charAt(0);
  return /^[a-z]$/.test(first) ? first : '_';
}

async function processWord(word) {
  const audioUrl = await fetchDictionaryAudioUrl(word);
  if (!audioUrl) {
    return { word, ok: false, reason: 'missing-audio-url' };
  }

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    return { word, ok: false, reason: `download-failed-${audioResponse.status}` };
  }

  const arrayBuffer = await audioResponse.arrayBuffer();
  const contentType = audioResponse.headers.get('content-type') || 'audio/mpeg';
  const extension = detectExtension(contentType, audioUrl);
  const blobPath = `pronunciation/en-us/${word}.${extension}`;

  const uploaded = await put(blobPath, Buffer.from(arrayBuffer), {
    access: 'public',
    contentType,
  });

  return {
    word,
    ok: true,
    blobUrl: uploaded.url,
  };
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      try {
        const output = await worker(current);
        results.push(output);
      } catch (error) {
        results.push({
          word: current,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  await Promise.all(workers);
  return results;
}

async function writeIndexFiles(indexByWord, meta) {
  await fs.mkdir(OUTPUT_CHUNKS_DIR, { recursive: true });

  const buckets = {};
  for (const letter of 'abcdefghijklmnopqrstuvwxyz_') {
    buckets[letter] = {};
  }

  for (const [word, url] of Object.entries(indexByWord)) {
    buckets[bucketFromWord(word)][word] = url;
  }

  for (const [bucket, payload] of Object.entries(buckets)) {
    const filePath = path.join(OUTPUT_CHUNKS_DIR, `${bucket}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  await fs.writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for pronunciation build.');
  }

  const vocabRaw = await fs.readFile(VOCAB_PATH, 'utf8');
  const vocab = JSON.parse(vocabRaw);
  const targets = selectTargetWords(vocab);

  let downloadSuccess = 0;
  let uploadSuccess = 0;
  let missingCount = 0;

  const results = await runPool(targets, async (word) => {
    const result = await processWord(word);
    if (result.ok) {
      downloadSuccess += 1;
      uploadSuccess += 1;
    } else {
      missingCount += 1;
    }
    return result;
  }, CONCURRENCY);

  const indexByWord = {};
  for (const result of results) {
    if (result.ok && result.blobUrl) {
      indexByWord[result.word] = result.blobUrl;
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    accent: ACCENT,
    storage: 'vercel-blob',
    totalTargetWords: targets.length,
    withAudio: Object.keys(indexByWord).length,
    missing: missingCount,
    concurrency: CONCURRENCY,
  };

  await writeIndexFiles(indexByWord, meta);

  console.log(`目标词总数: ${targets.length}`);
  console.log(`成功下载数: ${downloadSuccess}`);
  console.log(`上传成功数: ${uploadSuccess}`);
  console.log(`缺失数: ${missingCount}`);
  console.log(`最终可用发音词数: ${Object.keys(indexByWord).length}`);
}

main().catch((error) => {
  console.error('[pronunciation:build] failed:', error);
  process.exitCode = 1;
});

