#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_CHANNEL = 'https://www.youtube.com/@bestpartners';
const DEFAULT_OUTPUT_DIR = 'output/youtube/bestpartners';
const DEFAULT_TABS = ['videos', 'shorts', 'streams'];
const DEFAULT_LANGS = [
  'zh-Hans',
  'zh-CN',
  'zh',
  'zh-Hant',
  'zh-TW',
  'en',
  'en-US',
  'en-GB',
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CAPTION_REQUEST_DELAY_MS = parsePositiveInteger(process.env.YOUTUBE_CAPTION_DELAY_MS, 1500);
const DEFAULT_CAPTION_RETRY_COUNT = parsePositiveInteger(process.env.YOUTUBE_CAPTION_RETRY_COUNT, 4);
const DEFAULT_CAPTION_RETRY_BASE_DELAY_MS = parsePositiveInteger(process.env.YOUTUBE_CAPTION_RETRY_BASE_DELAY_MS, 2500);
const DEFAULT_CAPTION_RATE_LIMIT_COOLDOWN_MS = parsePositiveInteger(process.env.YOUTUBE_CAPTION_RATE_LIMIT_COOLDOWN_MS, 20000);

const captionRateLimitState = {
  nextAllowedAt: 0,
};

function parseArgs(argv) {
  const args = {
    channel: DEFAULT_CHANNEL,
    outputDir: DEFAULT_OUTPUT_DIR,
    tabs: DEFAULT_TABS,
    langs: DEFAULT_LANGS,
    limit: null,
    processLimit: null,
    latestOnly: false,
    refresh: false,
    skipTranscripts: false,
    cookiesFromBrowser: process.env.YOUTUBE_COOKIES_FROM_BROWSER || 'chrome',
    jsRuntime: process.env.YOUTUBE_YTDLP_JS_RUNTIME || 'node',
    captionRequestDelayMs: DEFAULT_CAPTION_REQUEST_DELAY_MS,
    captionRetryCount: DEFAULT_CAPTION_RETRY_COUNT,
    captionRetryBaseDelayMs: DEFAULT_CAPTION_RETRY_BASE_DELAY_MS,
    captionRateLimitCooldownMs: DEFAULT_CAPTION_RATE_LIMIT_COOLDOWN_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--channel' && next) {
      args.channel = next;
      i += 1;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = next;
      i += 1;
    } else if (arg === '--tabs' && next) {
      args.tabs = next.split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--langs' && next) {
      args.langs = next.split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--limit' && next) {
      args.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--process-limit' && next) {
      args.processLimit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--latest-only') {
      args.latestOnly = true;
    } else if (arg === '--refresh') {
      args.refresh = true;
    } else if (arg === '--skip-transcripts') {
      args.skipTranscripts = true;
    } else if (arg === '--cookies-from-browser' && next) {
      args.cookiesFromBrowser = next;
      i += 1;
    } else if (arg === '--no-cookies') {
      args.cookiesFromBrowser = null;
    } else if (arg === '--js-runtime' && next) {
      args.jsRuntime = next;
      i += 1;
    } else if (arg === '--caption-request-delay-ms' && next) {
      args.captionRequestDelayMs = parsePositiveInteger(next, DEFAULT_CAPTION_REQUEST_DELAY_MS);
      i += 1;
    } else if (arg === '--caption-retry-count' && next) {
      args.captionRetryCount = parsePositiveInteger(next, DEFAULT_CAPTION_RETRY_COUNT);
      i += 1;
    } else if (arg === '--caption-retry-base-delay-ms' && next) {
      args.captionRetryBaseDelayMs = parsePositiveInteger(next, DEFAULT_CAPTION_RETRY_BASE_DELAY_MS);
      i += 1;
    } else if (arg === '--caption-rate-limit-cooldown-ms' && next) {
      args.captionRateLimitCooldownMs = parsePositiveInteger(next, DEFAULT_CAPTION_RATE_LIMIT_COOLDOWN_MS);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-youtube-channel-transcripts.mjs [options]

Options:
  --channel <url>       YouTube channel URL. Default: ${DEFAULT_CHANNEL}
  --output-dir <dir>    Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --tabs <list>         Comma-separated channel tabs. Default: ${DEFAULT_TABS.join(',')}
  --langs <list>        Comma-separated subtitle language preference list.
  --limit <n>           Process at most n entries after de-duplication.
  --process-limit <n>   After scanning the channel, fetch transcripts for at most n entries.
  --latest-only         Only fetch transcripts for videos not already indexed.
  --refresh             Re-fetch transcripts even if local files exist.
  --skip-transcripts    Refresh indexes only; do not fetch transcript files.
  --cookies-from-browser <name>
                        Browser cookies for YouTube bot checks. Default: chrome.
  --no-cookies          Do not retry with browser cookies.
  --js-runtime <name>   yt-dlp JavaScript runtime. Default: node.
  --caption-request-delay-ms <n>
                        Delay between successful caption requests. Default: ${DEFAULT_CAPTION_REQUEST_DELAY_MS}
  --caption-retry-count <n>
                        Retry count for caption fetches on 429/5xx. Default: ${DEFAULT_CAPTION_RETRY_COUNT}
  --caption-retry-base-delay-ms <n>
                        Base backoff for caption retry. Default: ${DEFAULT_CAPTION_RETRY_BASE_DELAY_MS}
  --caption-rate-limit-cooldown-ms <n>
                        Minimum cooldown after a 429 response. Default: ${DEFAULT_CAPTION_RATE_LIMIT_COOLDOWN_MS}
`);
}

async function runYtDlp(args, options = {}) {
  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      maxBuffer: options.maxBuffer || 1024 * 1024 * 128,
      timeout: options.timeout || 120000,
    });
    return stdout;
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    throw new Error(`yt-dlp failed: yt-dlp ${args.join(' ')}${stderr}`);
  }
}

async function runYtDlpJsonWithFallback(baseArgs, args, options = {}) {
  const attempts = [
    baseArgs,
  ];

  const richerArgs = [
    ...(args.jsRuntime ? ['--js-runtimes', args.jsRuntime] : []),
    '--ignore-no-formats-error',
    ...(args.cookiesFromBrowser ? ['--cookies-from-browser', args.cookiesFromBrowser] : []),
    ...baseArgs,
  ];

  if (richerArgs.join('\0') !== baseArgs.join('\0')) {
    attempts.push(richerArgs);
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const stdout = await runYtDlp(attempt, options);
      return JSON.parse(stdout);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join('\n--- fallback failed ---\n'));
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(`${filePath}.tmp`, filePath);
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, value, 'utf8');
  await fs.rename(`${filePath}.tmp`, filePath);
}

function normalizeChannelUrl(channel) {
  return channel.replace(/\/+$/, '');
}

function makeTabUrl(channel, tab) {
  return `${normalizeChannelUrl(channel)}/${tab}`;
}

function normalizeVideoEntry(entry, tab) {
  const id = entry.id || extractVideoId(entry.url || '');
  if (!id) return null;
  const url = entry.url?.startsWith('http') ? entry.url : `https://www.youtube.com/watch?v=${id}`;
  return {
    id,
    title: entry.title || '',
    url,
    tab,
    duration: entry.duration ?? null,
    timestamp: entry.timestamp ?? null,
    viewCount: entry.view_count ?? null,
    thumbnails: entry.thumbnails || [],
  };
}

function extractVideoId(input) {
  const match = String(input).match(/[?&]v=([A-Za-z0-9_-]{11})|\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/);
  return match ? match[1] || match[2] || match[3] : null;
}

function pickBestThumbnail(thumbnails = []) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  return [...thumbnails].sort((a, b) => {
    const aPixels = (a.width || 0) * (a.height || 0);
    const bPixels = (b.width || 0) * (b.height || 0);
    return bPixels - aPixels;
  })[0]?.url || null;
}

function placeholderSummaryFromEntry(entry, previous = null) {
  return {
    ...(previous || {}),
    id: entry.id,
    title: previous?.title || entry.title,
    url: entry.url,
    tabs: entry.tabs,
    duration: previous?.duration || entry.duration || null,
    viewCount: previous?.viewCount || entry.viewCount || null,
    thumbnail: previous?.thumbnail || pickBestThumbnail(entry.thumbnails),
    seenInLatestScan: true,
    transcript: previous?.transcript || {
      ok: false,
      reason: 'not-fetched-yet',
    },
  };
}

function transcriptNeedsFetch(summary) {
  if (!summary?.transcript) return true;
  if (summary.transcript.ok) return false;
  return ['not-fetched-yet', 'sync-error', 'empty-caption'].includes(summary.transcript.reason);
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .toLowerCase();
  return slug || fallback;
}

function formatDate(uploadDate) {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hrs, mins, secs]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .filter((part, index) => index > 0 || part !== '0')
    .join(':');
}

function secondsToTimestamp(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hrs = String(Math.floor(safe / 3600)).padStart(2, '0');
  const mins = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
  const secs = String(Math.floor(safe % 60)).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function selectCaptionTrack(metadata, langs) {
  const pools = [
    { kind: 'manual', data: metadata.subtitles || {} },
    { kind: 'auto', data: metadata.automatic_captions || {} },
  ];
  const available = pools.flatMap((pool) => Object.keys(pool.data).map((lang) => ({ kind: pool.kind, lang })));
  const normalizedPreference = langs.map((lang) => lang.toLowerCase());

  for (const pool of pools) {
    for (const preferred of normalizedPreference) {
      const lang = Object.keys(pool.data).find((candidate) => candidate.toLowerCase() === preferred);
      const format = pickCaptionFormat(pool.data[lang]);
      if (lang && format) return { kind: pool.kind, lang, format, available };
    }
  }

  for (const pool of pools) {
    for (const [lang, formats] of Object.entries(pool.data)) {
      const format = pickCaptionFormat(formats);
      if (format) return { kind: pool.kind, lang, format, available };
    }
  }

  return { kind: null, lang: null, format: null, available };
}

function pickCaptionFormat(formats = []) {
  if (!Array.isArray(formats)) return null;
  const preferredExts = ['json3', 'srv3', 'ttml', 'vtt'];
  for (const ext of preferredExts) {
    const match = formats.find((item) => item.ext === ext && item.url);
    if (match) return match;
  }
  return formats.find((item) => item.url) || null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return null;
}

async function waitForCaptionWindow() {
  const waitMs = captionRateLimitState.nextAllowedAt - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function fetchCaption(format, args) {
  let lastError = null;
  for (let attempt = 1; attempt <= args.captionRetryCount; attempt += 1) {
    await waitForCaptionWindow();
    const response = await fetch(format.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    }).catch((error) => {
      lastError = error;
      return null;
    });

    if (response?.ok) {
      captionRateLimitState.nextAllowedAt = Date.now() + args.captionRequestDelayMs;
      return response.text();
    }

    const status = response?.status || 0;
    const statusText = response?.statusText || lastError?.message || 'Unknown Error';
    lastError = new Error(`caption fetch failed: ${status} ${statusText}`);

    const retryable = !response || status === 429 || status >= 500;
    if (!retryable || attempt === args.captionRetryCount) {
      throw lastError;
    }

    const retryAfterMs = parseRetryAfterMs(response?.headers?.get('retry-after'));
    const exponentialBackoffMs = args.captionRetryBaseDelayMs * (2 ** (attempt - 1));
    const jitterMs = Math.floor(Math.random() * 1000);
    const cooldownMs = Math.max(
      retryAfterMs || 0,
      status === 429 ? args.captionRateLimitCooldownMs : 0,
      exponentialBackoffMs + jitterMs,
    );

    captionRateLimitState.nextAllowedAt = Date.now() + cooldownMs;
    console.warn(`[caption retry] status=${status || 'network'} attempt=${attempt}/${args.captionRetryCount} waitMs=${cooldownMs}`);
  }

  throw lastError || new Error('caption fetch failed');
}

function parseCaptionPayload(raw, ext) {
  if (ext === 'json3' || raw.trim().startsWith('{')) {
    return parseJson3(raw);
  }
  if (ext === 'vtt' || raw.trim().startsWith('WEBVTT')) {
    return parseVtt(raw);
  }
  if (ext === 'srv3' || raw.includes('<text')) {
    return parseSrv3(raw);
  }
  return [];
}

function parseJson3(raw) {
  const payload = JSON.parse(raw);
  const events = payload.events || [];
  return events
    .map((event) => {
      const text = (event.segs || []).map((seg) => seg.utf8 || '').join('');
      return {
        startSeconds: (event.tStartMs || 0) / 1000,
        durationSeconds: (event.dDurationMs || 0) / 1000,
        text: cleanText(text),
      };
    })
    .filter((item) => item.text);
}

function parseVtt(raw) {
  const lines = raw.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('-->')) continue;
    const [startRaw, endRaw] = lines[i].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const textLines = [];
    i += 1;
    while (i < lines.length && lines[i].trim()) {
      textLines.push(lines[i].replace(/<[^>]+>/g, ''));
      i += 1;
    }
    const startSeconds = parseTimestamp(startRaw);
    const endSeconds = parseTimestamp(endRaw);
    const text = cleanText(textLines.join(' '));
    if (text) {
      items.push({
        startSeconds,
        durationSeconds: Math.max(0, endSeconds - startSeconds),
        text,
      });
    }
  }
  return items;
}

function parseSrv3(raw) {
  const items = [];
  const regex = /<text[^>]*start="([^"]+)"[^>]*dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(raw))) {
    const text = cleanText(match[3].replace(/<[^>]+>/g, ''));
    if (text) {
      items.push({
        startSeconds: Number.parseFloat(match[1]) || 0,
        durationSeconds: Number.parseFloat(match[2]) || 0,
        text,
      });
    }
  }
  return items;
}

function parseTimestamp(value) {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(value) || 0;
}

function buildMarkdown({ metadata, entry, transcript, selectedCaption }) {
  const title = metadata.title || entry.title || entry.id;
  const uploadDate = formatDate(metadata.upload_date);
  const frontmatter = [
    '---',
    `video_id: ${entry.id}`,
    `title: ${JSON.stringify(title)}`,
    `url: ${JSON.stringify(entry.url)}`,
    `channel: ${JSON.stringify(metadata.channel || metadata.uploader || 'Best Partners TV')}`,
    `upload_date: ${uploadDate || ''}`,
    `duration: ${metadata.duration || entry.duration || ''}`,
    `caption_language: ${selectedCaption.lang || ''}`,
    `caption_kind: ${selectedCaption.kind || ''}`,
    `synced_at: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');

  const body = [
    `# ${title}`,
    '',
    `- Video: ${entry.url}`,
    uploadDate ? `- Published: ${uploadDate}` : null,
    metadata.duration ? `- Duration: ${formatDuration(metadata.duration)}` : null,
    selectedCaption.lang ? `- Captions: ${selectedCaption.lang} (${selectedCaption.kind})` : null,
    metadata.description ? `\n## Description\n\n${metadata.description.trim()}` : null,
    '## Transcript',
    '',
    ...transcript.map((item) => `[${secondsToTimestamp(item.startSeconds)}] ${item.text}`),
    '',
  ].filter(Boolean);

  return `${frontmatter}${body.join('\n')}`;
}

async function listChannelEntries(args, outputDir) {
  const snapshots = [];
  const entriesById = new Map();

  for (const tab of args.tabs) {
    const url = makeTabUrl(args.channel, tab);
    const ytArgs = ['--flat-playlist', '--dump-single-json'];
    if (args.limit) {
      ytArgs.push('--playlist-end', String(args.limit));
    }
    ytArgs.push(url);
    console.log(`[list] ${url}`);
    const payload = await runYtDlpJsonWithFallback(ytArgs, args);
    snapshots.push({
      tab,
      id: payload.id,
      channel: payload.channel || payload.uploader,
      channelId: payload.channel_id,
      title: payload.title,
      followerCount: payload.channel_follower_count,
      webpageUrl: payload.webpage_url,
      fetchedAt: new Date().toISOString(),
      entryCount: payload.entries?.length || 0,
    });

    for (const rawEntry of payload.entries || []) {
      const entry = normalizeVideoEntry(rawEntry, tab);
      if (!entry) continue;
      const existing = entriesById.get(entry.id);
      entriesById.set(entry.id, {
        ...existing,
        ...entry,
        tabs: [...new Set([...(existing?.tabs || []), tab])],
      });
    }
  }

  let entries = [...entriesById.values()];
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (args.limit) entries = entries.slice(0, args.limit);
  await writeJson(path.join(outputDir, 'channel-snapshots.json'), snapshots);
  return entries;
}

async function syncVideo(entry, args, outputDir, previousIndex) {
  const itemDir = path.join(outputDir, 'items', entry.id);
  const transcriptMdPath = path.join(itemDir, 'transcript.md');
  const transcriptTxtPath = path.join(itemDir, 'transcript.txt');
  const metaPath = path.join(itemDir, 'meta.json');
  const captionRawPath = path.join(itemDir, 'caption.raw');
  const previous = previousIndex?.videos?.find((item) => item.id === entry.id);

  if (args.skipTranscripts) {
    return placeholderSummaryFromEntry(entry, previous);
  }

  if (!args.refresh) {
    try {
      await fs.access(transcriptMdPath);
      if (previous?.transcript?.ok) {
        return { ...previous, tabs: entry.tabs, seenInLatestScan: true, skipped: true };
      }
    } catch {
      // Missing transcript; fetch below.
    }
  }

  const metadata = await runYtDlpJsonWithFallback(['--dump-single-json', '--skip-download', entry.url], args, {
    timeout: 180000,
  });
  await writeJson(metaPath, metadata);

  const baseSummary = {
    id: entry.id,
    title: metadata.title || entry.title,
    url: entry.url,
    tabs: entry.tabs,
    uploadDate: formatDate(metadata.upload_date),
    duration: metadata.duration || entry.duration || null,
    viewCount: metadata.view_count || entry.viewCount || null,
    thumbnail: pickBestThumbnail(metadata.thumbnails || entry.thumbnails),
    metaPath: path.relative(outputDir, metaPath),
    seenInLatestScan: true,
  };

  const selectedCaption = selectCaptionTrack(metadata, args.langs);
  if (!selectedCaption.format) {
    return {
      ...baseSummary,
      transcript: {
        ok: false,
        reason: 'no-caption',
        available: selectedCaption.available,
      },
    };
  }

  const rawCaption = await fetchCaption(selectedCaption.format, args);
  await writeText(captionRawPath, rawCaption);
  const transcript = parseCaptionPayload(rawCaption, selectedCaption.format.ext);
  if (transcript.length === 0) {
    return {
      ...baseSummary,
      transcript: {
        ok: false,
        reason: 'empty-caption',
        language: selectedCaption.lang,
        kind: selectedCaption.kind,
      },
    };
  }

  const markdown = buildMarkdown({ metadata, entry, transcript, selectedCaption });
  const plainText = `${metadata.title || entry.title}\n${entry.url}\n\n${transcript.map((item) => item.text).join('\n')}\n`;
  await writeText(transcriptMdPath, markdown);
  await writeText(transcriptTxtPath, plainText);
  await writeJson(path.join(itemDir, 'transcript.json'), {
    videoId: entry.id,
    language: selectedCaption.lang,
    kind: selectedCaption.kind,
    format: selectedCaption.format.ext,
    fetchedAt: new Date().toISOString(),
    items: transcript,
  });

  return {
    ...baseSummary,
    transcript: {
      ok: true,
      language: selectedCaption.lang,
      kind: selectedCaption.kind,
      itemCount: transcript.length,
      markdownPath: path.relative(outputDir, transcriptMdPath),
      textPath: path.relative(outputDir, transcriptTxtPath),
      jsonPath: path.relative(outputDir, path.join(itemDir, 'transcript.json')),
    },
  };
}

function buildMarkdownIndex(index) {
  const lines = [
    '# Best Partners TV Content Index',
    '',
    `- Channel: ${index.channelUrl}`,
    `- Last synced: ${index.lastSyncedAt}`,
    `- Total discovered: ${index.totalVideos}`,
    `- Transcripts available: ${index.transcriptOkCount}`,
    `- Transcripts pending: ${index.transcriptPendingCount}`,
    `- Transcript failures: ${index.transcriptFailedCount}`,
    '',
    '## Videos',
    '',
    '| Published | Type | Title | Duration | Transcript |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const video of index.videos) {
    const transcriptLink = video.transcript?.ok
      ? `[md](${video.transcript.markdownPath}) / [txt](${video.transcript.textPath})`
      : `missing: ${video.transcript?.reason || 'unknown'}`;
    const title = `[${String(video.title || video.id).replace(/\|/g, '\\|')}](${video.url})`;
    lines.push([
      video.uploadDate || '',
      (video.tabs || []).join(', '),
      title,
      formatDuration(video.duration || 0),
      transcriptLink,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const previousIndex = await readJsonIfExists(path.join(outputDir, 'index.json'), { videos: [] });
  const entries = await listChannelEntries(args, outputDir);
  const previousById = new Map((previousIndex.videos || []).map((item) => [item.id, item]));
  const newEntries = entries.filter((entry) => !previousById.has(entry.id));
  const toProcessAll = args.latestOnly
    ? newEntries
    : entries.filter((entry) => args.refresh || transcriptNeedsFetch(previousById.get(entry.id)));
  const toProcess = args.processLimit ? toProcessAll.slice(0, args.processLimit) : toProcessAll;

  console.log(`[scan] discovered=${entries.length} new=${newEntries.length} process=${toProcess.length}`);

  const scannedIds = new Set(entries.map((entry) => entry.id));
  const untouchedPrevious = (previousIndex.videos || [])
    .filter((item) => !scannedIds.has(item.id))
    .map((item) => ({ ...item, seenInLatestScan: false }));
  const summaries = [];

  for (let i = 0; i < toProcess.length; i += 1) {
    const entry = toProcess[i];
    try {
      console.log(`[video ${i + 1}/${toProcess.length}] ${entry.id} ${entry.title}`);
      summaries.push(await syncVideo(entry, args, outputDir, previousIndex));
    } catch (error) {
      console.error(`[error] ${entry.id}: ${error.message}`);
      const previous = previousById.get(entry.id);
      summaries.push({
        ...(previous || entry),
        id: entry.id,
        title: entry.title,
        url: entry.url,
        tabs: entry.tabs,
        seenInLatestScan: true,
        transcript: {
          ok: false,
          reason: 'sync-error',
          message: error.message,
        },
      });
    }
  }

  const processedIds = new Set(summaries.map((item) => item.id));
  for (const entry of entries) {
    if (!processedIds.has(entry.id)) {
      summaries.push(placeholderSummaryFromEntry(entry, previousById.get(entry.id)));
    }
  }

  if (args.latestOnly) {
    for (const entry of entries) {
      if (!newEntries.some((item) => item.id === entry.id) && previousById.has(entry.id)) {
        const previous = previousById.get(entry.id);
        summaries.push({ ...previous, tabs: entry.tabs, seenInLatestScan: true });
      }
    }
  }

  const byId = new Map();
  for (const item of [...summaries, ...untouchedPrevious]) {
    byId.set(item.id, item);
  }

  const videos = [...byId.values()].sort((a, b) => {
    const aDate = a.uploadDate || '';
    const bDate = b.uploadDate || '';
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  const index = {
    channelUrl: normalizeChannelUrl(args.channel),
    outputDir,
    lastSyncedAt: new Date().toISOString(),
    totalVideos: videos.length,
    latestScanVideoCount: entries.length,
    newVideoCount: newEntries.length,
    transcriptOkCount: videos.filter((item) => item.transcript?.ok).length,
    transcriptPendingCount: videos.filter((item) => item.transcript?.reason === 'not-fetched-yet').length,
    transcriptFailedCount: videos.filter((item) => item.transcript && !item.transcript.ok && item.transcript.reason !== 'not-fetched-yet').length,
    videos,
  };

  await writeJson(path.join(outputDir, 'index.json'), index);
  await writeText(path.join(outputDir, 'index.md'), buildMarkdownIndex(index));

  console.log(`[done] index=${path.join(outputDir, 'index.md')}`);
  console.log(`[done] transcripts=${index.transcriptOkCount}/${index.totalVideos}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
