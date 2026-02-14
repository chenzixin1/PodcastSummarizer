const PREFERRED_LANGS = ['zh-Hans', 'zh-CN', 'zh', 'zh-Hant', 'zh-TW', 'en', 'en-US'];

class ExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

function normalizeLangCode(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace('_', '-');
}

function decodeEntities(input) {
  const text = String(input || '');
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([\da-fA-F]+);/g, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function cuesToSrt(cues) {
  return cues
    .map((cue, index) => {
      const start = formatSrtTime(cue.startSec);
      const end = formatSrtTime(cue.startSec + Math.max(0.2, cue.durationSec));
      return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
    })
    .join('\n\n');
}

function getPlayerResponse() {
  const direct = window.ytInitialPlayerResponse;
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const player = document.getElementById('movie_player');
  if (player && typeof player.getPlayerResponse === 'function') {
    try {
      const response = player.getPlayerResponse();
      if (response && typeof response === 'object') {
        return response;
      }
    } catch {
      // Ignore getPlayerResponse failures.
    }
  }

  return null;
}

function extractJsonObjectFromText(input, startSearchIndex = 0) {
  const source = String(input || '');
  const start = source.indexOf('{', Math.max(0, startSearchIndex));
  if (start < 0) {
    return '';
  }

  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return '';
}

function parsePlayerResponseFromScripts() {
  const scripts = Array.from(document.querySelectorAll('script'));
  const markerPattern = /(?:var\s+)?ytInitialPlayerResponse\s*=/;

  for (const script of scripts) {
    const text = String(script?.textContent || '');
    if (!text || !text.includes('ytInitialPlayerResponse')) {
      continue;
    }

    const marker = markerPattern.exec(text);
    if (!marker || marker.index < 0) {
      continue;
    }

    const objectText = extractJsonObjectFromText(text, marker.index + marker[0].length);
    if (!objectText) {
      continue;
    }

    try {
      const parsed = JSON.parse(objectText);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Try next script.
    }
  }

  return null;
}

function getPlayerResponseWithFallback() {
  const response = getPlayerResponse();
  if (response) {
    return response;
  }
  return parsePlayerResponseFromScripts();
}

function parsePlayerResponseFromHtml(html) {
  const source = String(html || '');
  if (!source || !source.includes('ytInitialPlayerResponse')) {
    return null;
  }

  const markerPattern = /(?:var\s+)?ytInitialPlayerResponse\s*=/;
  const marker = markerPattern.exec(source);
  if (!marker || marker.index < 0) {
    return null;
  }

  const objectText = extractJsonObjectFromText(source, marker.index + marker[0].length);
  if (!objectText) {
    return null;
  }

  try {
    const parsed = JSON.parse(objectText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchPlayerResponseFromWatchHtml(videoId) {
  try {
    const fallbackUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&bpctr=${Date.now()}`;
    const response = await fetch(fallbackUrl, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return parsePlayerResponseFromHtml(html);
  } catch {
    return null;
  }
}

async function getPlayerResponseSmart(videoId) {
  const local = getPlayerResponseWithFallback();
  if (local) {
    return local;
  }

  return fetchPlayerResponseFromWatchHtml(videoId);
}

async function extractCaptionTracks(videoId) {
  const response = await getPlayerResponseSmart(videoId);
  const renderer = response?.captions?.playerCaptionsTracklistRenderer;
  const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const playabilityStatus = String(response?.playabilityStatus?.status || '');
  const playabilityReason = String(
    response?.playabilityStatus?.reason || response?.playabilityStatus?.messages?.[0] || '',
  );

  const dedup = new Set();
  const sanitized = [];

  for (const track of tracks) {
    if (!track?.baseUrl || !track?.languageCode) {
      continue;
    }
    const key = `${track.languageCode}|${track.kind || 'manual'}|${track.baseUrl}`;
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    sanitized.push({
      baseUrl: String(track.baseUrl),
      languageCode: String(track.languageCode),
      kind: String(track.kind || ''),
      name: track.name,
    });
  }

  return {
    tracks: sanitized,
    title: String(response?.videoDetails?.title || ''),
    playabilityStatus,
    playabilityReason,
  };
}

function rankTrack(track, preferredLangs) {
  const trackLang = normalizeLangCode(track.languageCode);
  const isAuto = track.kind === 'asr' ? 1 : 0;

  let bestRank = 9999;
  preferredLangs.forEach((preferred, index) => {
    const normalizedPreferred = normalizeLangCode(preferred);
    const preferredBase = normalizedPreferred.split('-')[0];
    const trackBase = trackLang.split('-')[0];

    if (trackLang === normalizedPreferred) {
      bestRank = Math.min(bestRank, index * 100);
      return;
    }

    if (preferredBase && trackBase && preferredBase === trackBase) {
      bestRank = Math.min(bestRank, index * 100 + 20);
    }
  });

  if (bestRank === 9999) {
    bestRank = 5000;
  }

  return bestRank + isAuto;
}

function preferredTrackOrder(tracks) {
  const langs = [...PREFERRED_LANGS];
  if (navigator.language) {
    langs.unshift(navigator.language);
  }
  return [...tracks].sort((a, b) => rankTrack(a, langs) - rankTrack(b, langs));
}

function toJsonTrackUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set('fmt', 'json3');
  return parsed.toString();
}

function cueTextFromSegs(segs) {
  if (!Array.isArray(segs) || segs.length === 0) {
    return '';
  }

  const raw = segs
    .map((seg) => String(seg?.utf8 || ''))
    .join('')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return decodeEntities(raw);
}

function parseJson3Transcript(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const cues = [];

  for (const event of events) {
    const text = cueTextFromSegs(event?.segs);
    if (!text) {
      continue;
    }

    const startMs = Number(event?.tStartMs || 0);
    const durationMs = Number(event?.dDurationMs || 0);
    const safeDurationMs = durationMs > 0 ? durationMs : 2000;

    cues.push({
      startSec: startMs / 1000,
      durationSec: safeDurationMs / 1000,
      text,
    });
  }

  return cues;
}

async function fetchTrackAsSrt(track) {
  const response = await fetch(toJsonTrackUrl(track.baseUrl), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ExtractionError('CAPTION_FETCH_FAILED', `字幕轨道请求失败 (${response.status})`);
  }

  const json = await response.json();
  const cues = parseJson3Transcript(json);
  if (!cues.length) {
    return '';
  }

  return cuesToSrt(cues);
}

function fallbackTitle(videoId) {
  const raw = (document.title || '').replace(/\s*-\s*YouTube$/i, '').trim();
  return raw || `YouTube ${videoId}`;
}

function parseVideoIdFromLocation() {
  const href = window.location.href;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const pathId = url.pathname.split('/').filter(Boolean)[0];
      if (pathId && /^[A-Za-z0-9_-]{11}$/.test(pathId)) {
        return pathId;
      }
    }

    if (url.pathname.startsWith('/watch')) {
      const videoId = url.searchParams.get('v');
      if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      }
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' && parts[1] && /^[A-Za-z0-9_-]{11}$/.test(parts[1])) {
      return parts[1];
    }
  } catch {
    // Ignore URL parsing failures.
  }

  throw new ExtractionError('INVALID_YOUTUBE_URL', '当前页面不是可识别的 YouTube 视频页面。');
}

async function extractSubtitlePayload() {
  const videoId = parseVideoIdFromLocation();
  const captionData = await extractCaptionTracks(videoId);

  if (captionData.playabilityStatus && captionData.playabilityStatus !== 'OK') {
    const reason = captionData.playabilityReason || captionData.playabilityStatus;
    throw new ExtractionError('VIDEO_UNPLAYABLE', `当前视频不可播放：${reason}`);
  }

  if (!captionData.tracks.length) {
    throw new ExtractionError('PATH2_NOT_ENABLED', '当前视频无可用页面字幕，路径2尚未启用。');
  }

  const orderedTracks = preferredTrackOrder(captionData.tracks);
  for (const track of orderedTracks) {
    try {
      const srtContent = await fetchTrackAsSrt(track);
      if (!srtContent.trim()) {
        continue;
      }

      return {
        videoId,
        title: captionData.title || fallbackTitle(videoId),
        selectedLanguage: `${track.languageCode}${track.kind === 'asr' ? ' (auto)' : ''}`,
        srtContent,
      };
    } catch {
      // Try next track.
    }
  }

  throw new ExtractionError('PATH2_NOT_ENABLED', '字幕轨道存在但无可用内容，路径2尚未启用。');
}

function getPlayerScriptUrl() {
  const ytcfgPlayerUrl =
    window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg.get('PLAYER_JS_URL') : '';
  if (typeof ytcfgPlayerUrl === 'string' && ytcfgPlayerUrl.trim()) {
    return ytcfgPlayerUrl.trim();
  }

  const script = document.querySelector('script[src*="/s/player/"][src*="/base.js"]');
  if (script && typeof script.getAttribute === 'function') {
    const src = script.getAttribute('src') || '';
    if (src.trim()) {
      return src.trim();
    }
  }

  return '';
}

function extractAdaptiveAudioFormats(response) {
  const formats = Array.isArray(response?.streamingData?.adaptiveFormats) ? response.streamingData.adaptiveFormats : [];
  const sanitized = [];

  for (const item of formats) {
    const mimeType = String(item?.mimeType || '');
    if (!mimeType.toLowerCase().startsWith('audio/')) {
      continue;
    }

    sanitized.push({
      itag: Number(item?.itag || 0),
      mimeType,
      bitrate: Number(item?.bitrate || 0),
      contentLength: String(item?.contentLength || ''),
      approxDurationMs: String(item?.approxDurationMs || ''),
      url: item?.url ? String(item.url) : '',
      signatureCipher: item?.signatureCipher ? String(item.signatureCipher) : '',
      cipher: item?.cipher ? String(item.cipher) : '',
    });
  }

  return sanitized;
}

async function extractDownloadContextPayload() {
  const videoId = parseVideoIdFromLocation();
  const playerResponse = await getPlayerResponseSmart(videoId);
  if (!playerResponse) {
    throw new ExtractionError(
      'PLAYER_RESPONSE_NOT_FOUND',
      '无法读取 YouTube 播放器数据。请先进入视频播放页并播放几秒后重试。',
    );
  }

  const playabilityStatus = String(playerResponse?.playabilityStatus?.status || '');
  if (playabilityStatus && playabilityStatus !== 'OK') {
    const reason = String(
      playerResponse?.playabilityStatus?.reason || playerResponse?.playabilityStatus?.messages?.[0] || '',
    );
    throw new ExtractionError('VIDEO_UNPLAYABLE', `当前视频不可播放：${reason || playabilityStatus}`);
  }

  const adaptiveFormats = extractAdaptiveAudioFormats(playerResponse);
  if (!adaptiveFormats.length) {
    throw new ExtractionError('PATH2_AUDIO_UNAVAILABLE', '当前视频没有可用音频流，无法启动 Path2。');
  }

  const title = String(playerResponse?.videoDetails?.title || fallbackTitle(videoId));
  const lengthSeconds = String(playerResponse?.videoDetails?.lengthSeconds || '');
  const playerUrl = getPlayerScriptUrl();

  return {
    videoId,
    title,
    lengthSeconds,
    playerUrl,
    adaptiveFormats,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');

  if (type === 'PODSUM_EXTRACT_SUBTITLES') {
    extractSubtitlePayload()
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        if (error instanceof ExtractionError) {
          sendResponse({ ok: false, code: error.code, error: error.message });
          return;
        }

        sendResponse({
          ok: false,
          code: 'SUBTITLE_EXTRACTION_FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  }

  if (type === 'PODSUM_GET_YT_DOWNLOAD_CONTEXT') {
    extractDownloadContextPayload()
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        if (error instanceof ExtractionError) {
          sendResponse({ ok: false, code: error.code, error: error.message });
          return;
        }

        sendResponse({
          ok: false,
          code: 'DOWNLOAD_CONTEXT_FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  }

  return false;
});
