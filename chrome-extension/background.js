const STORAGE_KEYS = {
  AUTH: 'podsumAuth',
  SETTINGS: 'podsumSettings',
  TASKS: 'podsumTasks',
};

const DEFAULT_BASE_URL = 'https://podsum.cc';
const TASK_LIMIT = 5;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const PATH2_TRANSCRIBE_TIMEOUT_MS = 60 * 60 * 1000;
const PATH2_MAX_DURATION_SEC = 180 * 60;

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const OFFSCREEN_REQUEST_TIMEOUT_MS = 25 * 60 * 1000;

const notificationUrlMap = new Map();
const runningTasks = new Set();
const offscreenPendingRequests = new Map();
const extensionManifest = chrome.runtime.getManifest();
const EXTENSION_BUILD = Object.freeze({
  version: String(extensionManifest.version || '0.0.0'),
  versionName: String(extensionManifest.version_name || ''),
});

class TaskError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.details = details;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeBaseUrl(input) {
  const candidate = String(input || '').trim();
  if (!candidate) {
    return DEFAULT_BASE_URL;
  }

  try {
    const parsed = new URL(candidate);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return DEFAULT_BASE_URL;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function toSafeTaskList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenTaskIds = new Set();
  const normalized = [];

  for (const item of value) {
    const task = normalizeTask(item);
    if (!task) {
      continue;
    }

    if (task.taskId && seenTaskIds.has(task.taskId)) {
      continue;
    }

    if (task.taskId) {
      seenTaskIds.add(task.taskId);
    }

    normalized.push(task);
    if (normalized.length >= TASK_LIMIT) {
      break;
    }
  }

  return normalized;
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const path = raw.path === 'path2' ? 'path2' : 'path1';
  const status = String(raw.status || 'queued');

  return {
    taskId: String(raw.taskId || ''),
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now()),
    videoId: String(raw.videoId || ''),
    title: String(raw.title || raw.videoId || 'Untitled video'),
    youtubeUrl: String(raw.youtubeUrl || ''),
    isPublic: Boolean(raw.isPublic),
    path,
    path2Stack:
      raw.path2Stack === 'youtubejs' || raw.path2Stack === 'local_decsig'
        ? raw.path2Stack
        : undefined,
    transcriptionJobId: raw.transcriptionJobId ? String(raw.transcriptionJobId) : undefined,
    status,
    statusMessage: String(raw.statusMessage || ''),
    steps: {
      subtitle: normalizeStepState(raw.steps?.subtitle),
      download: normalizeStepState(raw.steps?.download),
      upload: normalizeStepState(raw.steps?.upload),
      process: normalizeStepState(raw.steps?.process),
    },
    podcastId: raw.podcastId ? String(raw.podcastId) : undefined,
    dashboardUrl: raw.dashboardUrl ? String(raw.dashboardUrl) : undefined,
    fileName: raw.fileName ? String(raw.fileName) : undefined,
    traceId: raw.traceId ? String(raw.traceId) : undefined,
    errorCode: raw.errorCode ? String(raw.errorCode) : undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
  };
}

function normalizeStepState(value) {
  if (value === 'running' || value === 'success' || value === 'failed') {
    return value;
  }
  return 'idle';
}

function trimTasks(tasks) {
  return tasks.slice(0, TASK_LIMIT);
}

function parseYoutubeVideoId(input) {
  const value = String(input || '').trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    if (!host.includes('youtube.com') && !host.includes('youtu.be')) {
      return null;
    }

    if (host.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (parsed.pathname.startsWith('/watch')) {
      const id = parsed.searchParams.get('v');
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'shorts' && pathParts[1] && /^[A-Za-z0-9_-]{11}$/.test(pathParts[1])) {
      return pathParts[1];
    }
  } catch {
    return null;
  }

  return null;
}

function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function formatTimestampForFile(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function buildFileName(videoId) {
  return `${videoId}-${formatTimestampForFile()}.srt`;
}

function buildTraceId(videoId = '') {
  const seed = Math.random().toString(16).slice(2, 10);
  const suffix = videoId ? `-${String(videoId).slice(0, 11)}` : '';
  return `ext-${Date.now()}-${seed}${suffix}`;
}

function summarizeError(error) {
  if (error instanceof TaskError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || null,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      details: null,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error || 'Unknown error'),
    details: null,
  };
}

function mapTaskStatusToMonitorStatus(status) {
  switch (String(status || '').trim()) {
    case 'queued':
      return 'received';
    case 'running':
    case 'uploaded':
      return 'accepted';
    case 'awaiting_path2_confirm':
    case 'failed':
      return 'failed';
    case 'transcribing':
      return 'transcribing';
    case 'processing':
      return 'processing';
    case 'completed':
      return 'completed';
    default:
      return 'accepted';
  }
}

function toMonitorPath(path) {
  return path === 'path2' ? 'path2' : 'path1';
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

async function sendMonitorEvent(payload) {
  try {
    const [auth, settings] = await Promise.all([getAuth(), getSettings()]);
    if (!auth?.accessToken) {
      return;
    }

    await fetch(`${settings.baseUrl}/api/extension/monitor-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        ...payload,
        meta: {
          ...asObject(payload?.meta),
          extensionBuild: EXTENSION_BUILD,
        },
      }),
    });
  } catch {
    // Ignore monitor ingestion failures from extension side.
  }
}

async function reportTaskMonitorEvent(taskId, eventPatch = {}) {
  if (!taskId) {
    return;
  }
  const task = await getTask(taskId);
  if (!task) {
    return;
  }

  const taskTraceId = task.traceId || buildTraceId(task.videoId);

  await sendMonitorEvent({
    path: eventPatch.path ? toMonitorPath(eventPatch.path) : toMonitorPath(task.path),
    status: eventPatch.status || mapTaskStatusToMonitorStatus(task.status),
    stage: String(eventPatch.stage || 'client_event'),
    level: eventPatch.level || 'info',
    message: eventPatch.message || null,
    endpoint: eventPatch.endpoint || 'chrome-extension/background',
    httpStatus: typeof eventPatch.httpStatus === 'number' ? eventPatch.httpStatus : null,
    clientTaskId: task.taskId,
    traceId: eventPatch.traceId || taskTraceId,
    sourceReference: task.youtubeUrl || null,
    videoId: task.videoId || null,
    title: task.title || null,
    isPublic: typeof eventPatch.isPublic === 'boolean' ? eventPatch.isPublic : task.isPublic,
    transcriptionJobId: eventPatch.transcriptionJobId || task.transcriptionJobId || null,
    podcastId: eventPatch.podcastId || task.podcastId || null,
    providerTaskId: eventPatch.providerTaskId || null,
    errorCode: eventPatch.errorCode || task.errorCode || null,
    errorMessage: eventPatch.errorMessage || task.errorMessage || null,
    requestBody: eventPatch.requestBody || null,
    responseBody: eventPatch.responseBody || null,
    meta: {
      ...asObject(eventPatch.meta),
      taskStatus: task.status,
      taskPath: task.path,
      steps: task.steps,
    },
  });
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const raw = data[STORAGE_KEYS.SETTINGS] || {};

  return {
    isPublic: Boolean(raw.isPublic),
    baseUrl: sanitizeBaseUrl(raw.baseUrl || DEFAULT_BASE_URL),
  };
}

async function saveSettings(settingsPatch) {
  const current = await getSettings();
  const next = {
    isPublic: typeof settingsPatch.isPublic === 'boolean' ? settingsPatch.isPublic : current.isPublic,
    baseUrl: settingsPatch.baseUrl ? sanitizeBaseUrl(settingsPatch.baseUrl) : current.baseUrl,
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: next,
  });

  return next;
}

async function getAuth() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH);
  const raw = data[STORAGE_KEYS.AUTH];
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return {
    accessToken: String(raw.accessToken || ''),
    expiresAt: Number(raw.expiresAt || 0),
    userId: String(raw.userId || ''),
    email: String(raw.email || ''),
    name: String(raw.name || ''),
  };
}

async function saveAuth(authData) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.AUTH]: authData,
  });
}

async function clearAuth() {
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

async function requireAuth() {
  const auth = await getAuth();
  if (!auth || !auth.accessToken) {
    throw new TaskError('NOT_LOGGED_IN', '请先登录 PodSum 账号。');
  }
  if (auth.expiresAt && auth.expiresAt <= Date.now()) {
    await clearAuth();
    throw new TaskError('TOKEN_EXPIRED', '登录已过期，请重新登录。');
  }
  return auth;
}

async function getTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.TASKS);
  return toSafeTaskList(data[STORAGE_KEYS.TASKS]);
}

async function saveTasks(tasks) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.TASKS]: trimTasks(tasks),
  });
}

async function mutateTasks(mutator) {
  const tasks = await getTasks();
  const next = mutator([...tasks]);
  await saveTasks(next);
  return next;
}

async function getTask(taskId) {
  const tasks = await getTasks();
  return tasks.find((task) => task.taskId === taskId) || null;
}

async function mutateTask(taskId, updater) {
  let updatedTask = null;
  await mutateTasks((tasks) =>
    tasks.map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }
      updatedTask = updater(task);
      return updatedTask;
    }),
  );
  return updatedTask;
}

async function setTaskStep(taskId, step, state, patch = {}) {
  return mutateTask(taskId, (task) => ({
    ...task,
    ...patch,
    updatedAt: Date.now(),
    steps: {
      ...task.steps,
      [step]: state,
    },
  }));
}

async function failTask(taskId, error, stage = 'client_task_failed') {
  const summary = summarizeError(error);
  await mutateTask(taskId, (task) => {
    const nextSteps = { ...task.steps };
    for (const key of Object.keys(nextSteps)) {
      if (nextSteps[key] === 'running') {
        nextSteps[key] = 'failed';
      }
    }

    return {
      ...task,
      updatedAt: Date.now(),
      status: 'failed',
      statusMessage: summary.message,
      errorCode: summary.code,
      errorMessage: summary.message,
      steps: nextSteps,
    };
  });

  await reportTaskMonitorEvent(taskId, {
    stage,
    level: 'error',
    message: summary.message,
    errorCode: summary.code,
    errorMessage: summary.message,
    meta: {
      details: summary.details,
    },
  });
}

async function createTaskFromTab(tab, isPublic) {
  const tabUrl = String(tab?.url || '');
  const videoId = parseYoutubeVideoId(tabUrl);
  if (!videoId) {
    throw new TaskError('INVALID_YOUTUBE_PAGE', '当前页面不是可识别的 YouTube 视频页面。');
  }

  const now = Date.now();
  const taskId = `${videoId}-${now}`;

  return {
    taskId,
    traceId: buildTraceId(videoId),
    createdAt: now,
    updatedAt: now,
    videoId,
    title: String(tab?.title || `YouTube ${videoId}`),
    youtubeUrl: buildWatchUrl(videoId),
    isPublic,
    path: 'path1',
    status: 'queued',
    statusMessage: '等待处理',
    steps: {
      subtitle: 'idle',
      download: 'idle',
      upload: 'idle',
      process: 'idle',
    },
  };
}

async function addTask(task) {
  await mutateTasks((tasks) => {
    const filtered = tasks.filter((item) => item.taskId !== task.taskId);
    return trimTasks([task, ...filtered]);
  });
}

async function getPopupState() {
  const [auth, settings, tasks] = await Promise.all([getAuth(), getSettings(), getTasks()]);

  return {
    auth: auth
      ? {
          email: auth.email,
          name: auth.name,
          userId: auth.userId,
          expiresAt: auth.expiresAt,
        }
      : null,
    settings,
    tasks,
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const rawText = await response.text();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const isExtensionApiUrl = String(url || '').includes('/api/extension/');
    const looksLikeHtml404 = contentType.includes('text/html') && /<html/i.test(rawText || '');

    const code =
      (isExtensionApiUrl && looksLikeHtml404 && (response.status === 404 || response.status === 405))
        ? 'EXTENSION_API_UNAVAILABLE'
        : data?.code || `HTTP_${response.status}`;
    const message =
      (isExtensionApiUrl && looksLikeHtml404 && (response.status === 404 || response.status === 405))
        ? 'PodSum 网站未部署扩展 API。请在扩展选项中检查网站地址，或先部署最新后端。'
        : data?.error || `Request failed (${response.status})`;
    throw new TaskError(code, message, data?.details || rawText || null);
  }

  return data;
}

async function loginToPodsum(email, password) {
  const settings = await getSettings();
  const result = await requestJson(`${settings.baseUrl}/api/extension/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!result?.success || !result?.data?.accessToken) {
    throw new TaskError('LOGIN_FAILED', '登录失败，请检查账号密码。');
  }

  const expiresIn = Number(result.data.expiresIn || 0);
  const auth = {
    accessToken: String(result.data.accessToken),
    expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000,
    userId: String(result.data.user?.id || ''),
    email: String(result.data.user?.email || email),
    name: String(result.data.user?.name || result.data.user?.email || email),
  };

  await saveAuth(auth);
  return auth;
}

function isMissingContentReceiverError(error) {
  const message = String(error instanceof Error ? error.message : error || '').toLowerCase();
  return (
    message.includes('receiving end does not exist') ||
    message.includes('could not establish connection') ||
    message.includes('message port closed')
  );
}

async function injectContentScriptIfNeeded(tabId) {
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  await delay(80);
}

async function sendMessageToContentScript(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!isMissingContentReceiverError(error)) {
      throw error;
    }

    await injectContentScriptIfNeeded(tabId);
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

async function extractSubtitlesFromTab(tabId) {
  try {
    const response = await sendMessageToContentScript(tabId, {
      type: 'PODSUM_EXTRACT_SUBTITLES',
    });

    if (!response?.ok) {
      throw new TaskError(
        response?.code || 'SUBTITLE_UNAVAILABLE',
        response?.error || '当前页面没有可用字幕（路径2尚未启用）。',
      );
    }

    return response.data;
  } catch (error) {
    if (error instanceof TaskError) {
      throw error;
    }

    if (isMissingContentReceiverError(error)) {
      throw new TaskError(
        'SUBTITLE_SCRIPT_UNAVAILABLE',
        '页面脚本未就绪，请刷新当前 YouTube 页面后重试。',
        error instanceof Error ? error.message : String(error),
      );
    }

    throw new TaskError(
      'SUBTITLE_SCRIPT_UNAVAILABLE',
      '无法读取当前页面字幕。请刷新视频页面后重试。',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function extractDownloadContextFromTab(tabId) {
  try {
    const response = await sendMessageToContentScript(tabId, {
      type: 'PODSUM_GET_YT_DOWNLOAD_CONTEXT',
    });

    if (!response?.ok) {
      throw new TaskError(
        response?.code || 'DOWNLOAD_CONTEXT_FAILED',
        response?.error || '无法读取页面音频流信息。',
      );
    }

    return response.data;
  } catch (error) {
    if (error instanceof TaskError) {
      throw error;
    }

    if (isMissingContentReceiverError(error)) {
      throw new TaskError(
        'DOWNLOAD_CONTEXT_FAILED',
        '页面脚本未就绪，请刷新当前 YouTube 页面后重试。',
        error instanceof Error ? error.message : String(error),
      );
    }

    throw new TaskError(
      'DOWNLOAD_CONTEXT_FAILED',
      '无法读取当前页面下载上下文。请刷新视频页面后重试。',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function downloadSrt(videoId, srtContent) {
  const fileName = buildFileName(videoId);
  const dataUrl = `data:application/x-subrip;charset=utf-8,${encodeURIComponent(srtContent)}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: fileName,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  return fileName;
}

async function uploadSrtToPodsum(task, srtContent) {
  const auth = await requireAuth();
  const settings = await getSettings();

  const result = await requestJson(`${settings.baseUrl}/api/extension/upload-srt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({
      sourceReference: task.youtubeUrl,
      fileName: task.fileName || `${task.videoId}.srt`,
      srtContent,
      isPublic: task.isPublic,
      clientTaskId: task.taskId,
      traceId: task.traceId || buildTraceId(task.videoId),
    }),
  });

  if (!result?.success || !result?.data?.podcastId) {
    throw new TaskError('UPLOAD_FAILED', '上传字幕失败，请稍后重试。');
  }

  return result.data;
}

async function fetchTaskStatus(podcastId) {
  const auth = await requireAuth();
  const settings = await getSettings();

  const result = await requestJson(`${settings.baseUrl}/api/extension/status/${encodeURIComponent(podcastId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
  });

  if (!result?.success || !result?.data) {
    throw new TaskError('STATUS_FETCH_FAILED', '无法获取任务状态。');
  }

  return result.data;
}

async function fetchTranscribeStatus(jobId) {
  const auth = await requireAuth();
  const settings = await getSettings();

  const result = await requestJson(
    `${settings.baseUrl}/api/extension/transcribe-status/${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
  );

  if (!result?.success || !result?.data) {
    throw new TaskError('TRANSCRIBE_STATUS_FAILED', '无法获取 Path2 转写状态。');
  }

  return result.data;
}

async function showNotification(title, message, url = null) {
  const id = `podsum-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  if (url) {
    notificationUrlMap.set(id, url);
  }

  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'assets/icons/icon-128.png',
    title,
    message,
    priority: 1,
  });
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.status === 'complete') {
    return;
  }

  await new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      chrome.tabs.onUpdated.removeListener(listener);
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new TaskError('TAB_LOAD_TIMEOUT', '等待 YouTube 页面加载超时。'));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function resolveTabForTask(task, tabIdHint = null) {
  if (tabIdHint) {
    return tabIdHint;
  }

  const tabs = await chrome.tabs.query({
    url: ['https://www.youtube.com/*', 'https://*.youtube.com/*'],
  });

  const matched = tabs.find((tab) => {
    if (!tab?.url) {
      return false;
    }
    const videoId = parseYoutubeVideoId(tab.url);
    return videoId === task.videoId;
  });

  if (!matched?.id) {
    throw new TaskError('VIDEO_TAB_NOT_FOUND', '未找到该视频页面，请先打开对应 YouTube 视频后重试。');
  }

  return matched.id;
}

async function resolveOrOpenTabForTask(task) {
  try {
    const tabId = await resolveTabForTask(task, null);
    return tabId;
  } catch {
    const createdTab = await chrome.tabs.create({ url: task.youtubeUrl, active: false });
    if (!createdTab?.id) {
      throw new TaskError('OPEN_TAB_FAILED', '无法打开 YouTube 页面。');
    }
    return createdTab.id;
  }
}

async function pollProcessing(taskId, podcastId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await delay(POLL_INTERVAL_MS);

    const task = await getTask(taskId);
    if (!task) {
      return;
    }

    const statusData = await fetchTaskStatus(podcastId);
    const nextStatus = statusData.status || 'processing';

    await mutateTask(taskId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      status: nextStatus === 'failed' ? 'failed' : 'processing',
      statusMessage: statusData.statusMessage || '网站分析处理中...',
      dashboardUrl: statusData.dashboardUrl || current.dashboardUrl,
    }));

    if (statusData.status === 'failed') {
      throw new TaskError(
        'PROCESSING_FAILED',
        statusData.lastError || statusData.statusMessage || '网站分析失败。',
      );
    }

    if (statusData.isProcessed || statusData.status === 'completed') {
      await mutateTask(taskId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        status: 'completed',
        statusMessage: '分析已完成',
        dashboardUrl: statusData.dashboardUrl || current.dashboardUrl,
        steps: {
          ...current.steps,
          process: 'success',
        },
      }));

      await showNotification('PodSum 分析完成', '点击打开结果页面。', statusData.dashboardUrl || undefined);
      return;
    }
  }

  throw new TaskError('PROCESS_TIMEOUT', '等待网站分析超时，请稍后在网站查看结果。');
}

async function pollPath2Transcription(taskId, transcriptionJobId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PATH2_TRANSCRIBE_TIMEOUT_MS) {
    await delay(POLL_INTERVAL_MS);

    const task = await getTask(taskId);
    if (!task) {
      return null;
    }

    const statusData = await fetchTranscribeStatus(transcriptionJobId);

    if (statusData.status === 'failed') {
      throw new TaskError(
        'PATH2_TRANSCRIBE_FAILED',
        statusData.lastError || 'Path2 转写失败。',
      );
    }

    if (statusData.status === 'completed' && statusData.podcastId) {
      return {
        podcastId: statusData.podcastId,
        dashboardUrl: statusData.dashboardUrl || undefined,
      };
    }

    await mutateTask(taskId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      status: 'transcribing',
      statusMessage: '音频已上传，等待转写完成...',
      dashboardUrl: statusData.dashboardUrl || current.dashboardUrl,
      steps: {
        ...current.steps,
        process: 'running',
      },
    }));
  }

  throw new TaskError('PATH2_TRANSCRIBE_TIMEOUT', 'Path2 转写超时，请稍后在网站查看。');
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') {
    throw new TaskError('OFFSCREEN_UNSUPPORTED', '当前浏览器不支持 offscreen 文档。');
  }

  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
      });
      if (Array.isArray(contexts) && contexts.length > 0) {
        return;
      }
    }

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['BLOBS'],
      justification: 'Download YouTube audio in browser and upload to PodSum Path2 API.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!message.toLowerCase().includes('already exists')) {
      throw new TaskError('OFFSCREEN_CREATE_FAILED', '无法初始化 Path2 后台工作页。', message);
    }
  }
}

async function sendOffscreenRequest(payload, timeoutMs = OFFSCREEN_REQUEST_TIMEOUT_MS) {
  await ensureOffscreenDocument();
  await delay(120);

  const requestId = `off-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const pendingTaskId = String(payload?.taskId || '');

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      offscreenPendingRequests.delete(requestId);
      if (pendingTaskId) {
        reportTaskMonitorEvent(pendingTaskId, {
          path: 'path2',
          stage: 'client_path2_offscreen_timeout',
          level: 'error',
          message: 'Path2 offscreen timed out.',
          errorCode: 'OFFSCREEN_TIMEOUT',
          errorMessage: 'Path2 后台处理超时。',
        }).catch(() => {
          // Ignore monitor failures.
        });
      }
      reject(new TaskError('OFFSCREEN_TIMEOUT', 'Path2 后台处理超时。'));
    }, timeoutMs);

    offscreenPendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
      taskId: pendingTaskId,
    });

    chrome.runtime.sendMessage(
      {
        type: 'PODSUM_OFFSCREEN_REQUEST',
        requestId,
        payload,
      },
      () => {
        const runtimeError = chrome.runtime.lastError;
        if (!runtimeError) {
          return;
        }

        const runtimeErrorMessage = String(runtimeError.message || '');
        const normalized = runtimeErrorMessage.toLowerCase();
        const benignPortClosed =
          normalized.includes('message port closed before a response was received') ||
          normalized.includes('port closed before a response was received');
        if (benignPortClosed) {
          return;
        }

        const pending = offscreenPendingRequests.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        offscreenPendingRequests.delete(requestId);
        if (pending.taskId) {
          reportTaskMonitorEvent(pending.taskId, {
            path: 'path2',
            stage: 'client_path2_offscreen_message_failed',
            level: 'error',
            message: 'Failed to send message to offscreen page.',
            errorCode: 'OFFSCREEN_MESSAGE_FAILED',
            errorMessage: runtimeErrorMessage,
            meta: {
              runtimeError: runtimeErrorMessage,
            },
          }).catch(() => {
            // Ignore monitor failures.
          });
        }
        reject(
          new TaskError(
            'OFFSCREEN_MESSAGE_FAILED',
            '无法发送 Path2 请求到 offscreen 页面。',
            runtimeErrorMessage,
          ),
        );
      },
    );
  });
}

async function handleOffscreenProgress(message) {
  const taskId = String(message?.taskId || '');
  const stage = String(message?.stage || '');
  const data = message?.data || {};
  if (!taskId || !stage) {
    return;
  }

  if (stage === 'download_start') {
    await setTaskStep(taskId, 'download', 'running', {
      status: 'running',
      statusMessage: 'Path2 下载音频中...',
      path: 'path2',
      path2Stack: 'youtubejs',
    });
    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_download_start',
      level: 'info',
      message: 'Path2 audio download started.',
      status: 'accepted',
      endpoint: 'chrome-extension/offscreen',
      meta: {
        stack: 'youtubejs',
      },
    });
    return;
  }

  if (stage === 'fallback_start') {
    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      path: 'path2',
      path2Stack: 'local_decsig',
      statusMessage: '主栈失败，已切换 Local 解密下载...',
    }));
    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_download_fallback',
      level: 'warn',
      message: 'Fallback to local_decsig stack.',
      endpoint: 'chrome-extension/offscreen',
      meta: {
        from: data?.from || 'youtubejs',
        reason: data?.reason || null,
      },
    });
    return;
  }

  if (stage === 'download_complete') {
    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      path: 'path2',
      path2Stack:
        data?.stack === 'local_decsig' || data?.stack === 'youtubejs' ? data.stack : task.path2Stack,
      fileName: data?.fileName ? String(data.fileName) : task.fileName,
      statusMessage: '音频下载完成，准备上传...',
      steps: {
        ...task.steps,
        download: 'success',
        upload: 'running',
      },
    }));
    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_download_complete',
      level: 'info',
      message: 'Path2 audio download completed.',
      endpoint: 'chrome-extension/offscreen',
      meta: {
        stack: data?.stack || null,
        fileName: data?.fileName || null,
        durationSec: data?.durationSec || null,
      },
    });
    return;
  }

  if (stage === 'upload_start') {
    await setTaskStep(taskId, 'upload', 'running', {
      statusMessage: '上传音频到 PodSum...',
    });
    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_upload_start',
      level: 'info',
      message: 'Path2 upload request started.',
      endpoint: 'chrome-extension/offscreen',
      status: 'accepted',
    });
    return;
  }

  if (stage === 'upload_complete') {
    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      status: 'transcribing',
      transcriptionJobId: data?.transcriptionJobId || task.transcriptionJobId,
      statusMessage: '上传成功，等待火山转写...',
      steps: {
        ...task.steps,
        upload: 'success',
        process: 'running',
      },
    }));
    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_upload_complete',
      level: 'info',
      message: 'Path2 upload request completed.',
      endpoint: 'chrome-extension/offscreen',
      status: 'transcribing',
      transcriptionJobId: data?.transcriptionJobId || null,
      meta: {
        audioBlobUrl: data?.audioBlobUrl || null,
      },
    });
  }
}

function handleOffscreenResponse(message) {
  const requestId = String(message?.requestId || '');
  if (!requestId) {
    return;
  }

  const pending = offscreenPendingRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  offscreenPendingRequests.delete(requestId);
  const taskId = String(message?.taskId || pending.taskId || '');

  if (message?.ok) {
    pending.resolve(message.data || {});
    return;
  }

  const err = message?.error || {};
  if (taskId) {
    reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_offscreen_failed',
      level: 'error',
      message: String(err.message || 'Path2 offscreen failed.'),
      errorCode: String(err.code || 'OFFSCREEN_FAILED'),
      errorMessage: String(err.message || 'Path2 offscreen failed.'),
      endpoint: 'chrome-extension/offscreen',
      meta: {
        details: err.details || null,
      },
    }).catch(() => {
      // Ignore monitor failures.
    });
  }
  pending.reject(
    new TaskError(
      String(err.code || 'OFFSCREEN_FAILED'),
      String(err.message || 'Path2 offscreen 处理失败。'),
      err.details || null,
    ),
  );
}

async function runPath2DownloadAndUpload(task, tabId) {
  const [settings, auth] = await Promise.all([getSettings(), requireAuth()]);
  const downloadContext = await extractDownloadContextFromTab(tabId);
  const durationSec = Number(downloadContext?.lengthSeconds || 0);
  if (Number.isFinite(durationSec) && durationSec > PATH2_MAX_DURATION_SEC) {
    throw new TaskError(
      'VIDEO_TOO_LONG',
      `Path2 仅支持 ${PATH2_MAX_DURATION_SEC / 60} 分钟内视频，当前约 ${Math.ceil(durationSec / 60)} 分钟。`,
    );
  }

  return sendOffscreenRequest({
    action: 'PATH2_DOWNLOAD_AND_UPLOAD',
    taskId: task.taskId,
    traceId: task.traceId || buildTraceId(task.videoId),
    videoId: task.videoId,
    title: task.title,
    youtubeUrl: task.youtubeUrl,
    isPublic: task.isPublic,
    accessToken: auth.accessToken,
    baseUrl: settings.baseUrl,
    maxDurationSec: PATH2_MAX_DURATION_SEC,
    downloadContext,
  });
}

async function markAwaitingPath2(taskId, error) {
  const summary = summarizeError(error);
  await mutateTask(taskId, (task) => ({
    ...task,
    updatedAt: Date.now(),
    path: 'path1',
    status: 'awaiting_path2_confirm',
    statusMessage: '页面无可用字幕，可启动 Path2。',
    errorCode: summary.code,
    errorMessage: summary.message,
    steps: {
      ...task.steps,
      subtitle: 'failed',
      download: 'idle',
      upload: 'idle',
      process: 'idle',
    },
  }));

  await reportTaskMonitorEvent(taskId, {
    stage: 'client_path1_subtitle_unavailable',
    level: 'warn',
    message: summary.message,
    errorCode: summary.code,
    errorMessage: summary.message,
    status: 'failed',
  });
}

async function processTask(taskId, tabIdHint = null) {
  if (runningTasks.has(taskId)) {
    return;
  }
  runningTasks.add(taskId);

  try {
    await requireAuth();

    const startTask = await getTask(taskId);
    if (!startTask) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      traceId: task.traceId || buildTraceId(task.videoId),
      path: 'path1',
      status: 'running',
      statusMessage: '开始处理...',
      errorCode: undefined,
      errorMessage: undefined,
      path2Stack: undefined,
      transcriptionJobId: undefined,
      steps: {
        subtitle: 'idle',
        download: 'idle',
        upload: 'idle',
        process: 'idle',
      },
    }));

    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_started',
      level: 'info',
      message: 'Path2 started from extension.',
      status: 'accepted',
    });

    await reportTaskMonitorEvent(taskId, {
      stage: 'client_path1_started',
      level: 'info',
      message: 'Path1 started from extension.',
      status: 'accepted',
    });

    await setTaskStep(taskId, 'subtitle', 'running', {
      status: 'running',
      statusMessage: '获取页面字幕...',
    });

    const taskForSubtitles = await getTask(taskId);
    if (!taskForSubtitles) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    const tabId = await resolveTabForTask(taskForSubtitles, tabIdHint);
    await waitForTabComplete(tabId, 20000);

    const subtitleData = await extractSubtitlesFromTab(tabId);
    const srtContent = String(subtitleData?.srtContent || '').trim();

    if (!srtContent) {
      throw new TaskError('PATH2_NOT_ENABLED', '当前视频无可用页面字幕，路径2尚未启用。');
    }

    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      title: subtitleData.title || task.title,
      statusMessage: '字幕获取成功',
      steps: {
        ...task.steps,
        subtitle: 'success',
      },
    }));

    await reportTaskMonitorEvent(taskId, {
      stage: 'client_path1_subtitle_success',
      level: 'info',
      message: 'Subtitle extracted successfully from page.',
      status: 'accepted',
    });

    await setTaskStep(taskId, 'download', 'running', {
      statusMessage: '保存本地字幕文件...',
    });

    const fileName = await downloadSrt(taskForSubtitles.videoId, srtContent);

    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      fileName,
      statusMessage: '本地下载完成',
      steps: {
        ...task.steps,
        download: 'success',
      },
    }));

    await setTaskStep(taskId, 'upload', 'running', {
      statusMessage: '上传到 PodSum...',
    });

    const latestTask = await getTask(taskId);
    if (!latestTask) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    const uploadData = await uploadSrtToPodsum(latestTask, srtContent);

    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      podcastId: uploadData.podcastId,
      dashboardUrl: uploadData.dashboardUrl,
      status: 'processing',
      statusMessage: '上传成功，等待网站分析...',
      steps: {
        ...task.steps,
        upload: 'success',
        process: 'running',
      },
    }));

    await showNotification(
      '字幕已下载并上传成功',
      `${latestTask.title || latestTask.videoId} (${latestTask.isPublic ? 'Public' : 'Private'})`,
      uploadData.dashboardUrl,
    );

    await pollProcessing(taskId, uploadData.podcastId);
  } catch (error) {
    if (error instanceof TaskError && error.code === 'PATH2_NOT_ENABLED') {
      await markAwaitingPath2(taskId, error);
      return;
    }

    await failTask(taskId, error, 'client_path1_failed');
  } finally {
    runningTasks.delete(taskId);
  }
}

async function startPath2Task(taskId, tabIdHint = null) {
  if (runningTasks.has(taskId)) {
    return;
  }
  runningTasks.add(taskId);

  try {
    await requireAuth();

    const task = await getTask(taskId);
    if (!task) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    await mutateTask(taskId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      traceId: current.traceId || buildTraceId(current.videoId),
      path: 'path2',
      path2Stack: undefined,
      transcriptionJobId: undefined,
      status: 'running',
      statusMessage: '准备启动 Path2...',
      errorCode: undefined,
      errorMessage: undefined,
      steps: {
        subtitle: current.steps.subtitle === 'success' ? 'success' : 'failed',
        download: 'idle',
        upload: 'idle',
        process: 'idle',
      },
    }));

    const latestTask = await getTask(taskId);
    if (!latestTask) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    const tabId = tabIdHint || (await resolveOrOpenTabForTask(latestTask));
    await waitForTabComplete(tabId, 25000);

    await setTaskStep(taskId, 'download', 'running', {
      statusMessage: 'Path2 下载音频中...',
      path2Stack: 'youtubejs',
    });

    const path2Data = await runPath2DownloadAndUpload(latestTask, tabId);

    await mutateTask(taskId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      path: 'path2',
      path2Stack: path2Data.stack || current.path2Stack,
      fileName: path2Data.fileName || current.fileName,
      transcriptionJobId: path2Data.transcriptionJobId,
      status: 'transcribing',
      statusMessage: '上传成功，等待火山转写...',
      steps: {
        ...current.steps,
        download: 'success',
        upload: 'success',
        process: 'running',
      },
    }));

    await reportTaskMonitorEvent(taskId, {
      path: 'path2',
      stage: 'client_path2_upload_accepted',
      level: 'info',
      message: 'Path2 upload accepted and waiting transcription.',
      status: 'transcribing',
    });

    await showNotification(
      'Path2 上传成功',
      `${latestTask.title || latestTask.videoId} (${latestTask.isPublic ? 'Public' : 'Private'})`,
      undefined,
    );

    if (!path2Data.transcriptionJobId) {
      throw new TaskError('PATH2_TRANSCRIPTION_JOB_MISSING', 'Path2 未返回转写任务 ID。');
    }

    const transcribed = await pollPath2Transcription(taskId, path2Data.transcriptionJobId);
    if (!transcribed?.podcastId) {
      throw new TaskError('PATH2_PODCAST_MISSING', 'Path2 转写未返回 podcastId。');
    }

    await mutateTask(taskId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      podcastId: transcribed.podcastId,
      dashboardUrl: transcribed.dashboardUrl || current.dashboardUrl,
      status: 'processing',
      statusMessage: '音频转写完成，等待网站分析...',
      steps: {
        ...current.steps,
        process: 'running',
      },
    }));

    await pollProcessing(taskId, transcribed.podcastId);
  } catch (error) {
    await failTask(taskId, error, 'client_path2_failed');
  } finally {
    runningTasks.delete(taskId);
  }
}

async function enqueueCurrentVideoTask() {
  await requireAuth();
  const settings = await getSettings();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    throw new TaskError('NO_ACTIVE_TAB', '无法获取当前页面，请稍后重试。');
  }

  const task = await createTaskFromTab(tab, settings.isPublic);
  await addTask(task);
  await reportTaskMonitorEvent(task.taskId, {
    stage: 'client_task_created',
    level: 'info',
    message: 'Task created from current tab.',
    endpoint: 'chrome-extension/popup',
    status: 'received',
  });
  processTask(task.taskId, tab.id);
  return task;
}

async function retryTask(taskId) {
  const task = await getTask(taskId);
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
  }

  await reportTaskMonitorEvent(taskId, {
    stage: 'client_retry_clicked',
    level: 'info',
    message: 'User clicked retry.',
    endpoint: 'chrome-extension/popup',
  });

  if (task.path === 'path2') {
    const tabId = await resolveOrOpenTabForTask(task);
    startPath2Task(taskId, tabId);
    return { taskId };
  }

  const createdTab = await chrome.tabs.create({ url: task.youtubeUrl, active: true });
  if (!createdTab?.id) {
    throw new TaskError('OPEN_TAB_FAILED', '无法打开 YouTube 页面进行重试。');
  }

  processTask(taskId, createdTab.id);
  return { taskId };
}

async function startPath2(taskId) {
  const task = await getTask(taskId);
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
  }

  await reportTaskMonitorEvent(taskId, {
    path: 'path2',
    stage: 'client_path2_start_clicked',
    level: 'info',
    message: 'User clicked start Path2.',
    endpoint: 'chrome-extension/popup',
    status: 'accepted',
  });

  const tabId = await resolveOrOpenTabForTask(task);
  startPath2Task(taskId, tabId);
  return { taskId };
}

async function retryPath2(taskId) {
  const task = await getTask(taskId);
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
  }

  await reportTaskMonitorEvent(taskId, {
    path: 'path2',
    stage: 'client_path2_retry_clicked',
    level: 'info',
    message: 'User clicked retry Path2.',
    endpoint: 'chrome-extension/popup',
    status: 'accepted',
  });

  const tabId = await resolveOrOpenTabForTask(task);
  startPath2Task(taskId, tabId);
  return { taskId };
}

async function deleteTask(taskId) {
  const task = await getTask(taskId);
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
  }

  await mutateTasks((tasks) => tasks.filter((item) => item.taskId !== taskId));
  return { taskId };
}

async function getTaskDetail(taskId) {
  const task = await getTask(taskId);
  if (!task) {
    throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
  }
  return task;
}

async function openDashboard(url) {
  if (!url) {
    throw new TaskError('MISSING_URL', '缺少可打开的链接。');
  }
  await chrome.tabs.create({ url, active: true });
}

async function openPodsumSite() {
  const settings = await getSettings();
  await chrome.tabs.create({ url: settings.baseUrl, active: true });
}

function handleMessage(handler, sendResponse) {
  Promise.resolve()
    .then(handler)
    .then((data) => {
      sendResponse({ success: true, data });
    })
    .catch((error) => {
      const summary = summarizeError(error);
      sendResponse({
        success: false,
        code: summary.code,
        error: summary.message,
        details: summary.details,
      });
    });
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');

  if (type === 'PODSUM_OFFSCREEN_PROGRESS') {
    handleOffscreenProgress(message).catch(() => {
      // Ignore progress update failures.
    });
    return false;
  }

  if (type === 'PODSUM_OFFSCREEN_RESPONSE') {
    handleOffscreenResponse(message);
    return false;
  }

  if (type === 'PODSUM_GET_STATE') {
    handleMessage(() => getPopupState(), sendResponse);
    return true;
  }

  if (type === 'PODSUM_LOGIN') {
    handleMessage(async () => {
      const email = String(message?.email || '').trim();
      const password = String(message?.password || '');
      if (!email || !password) {
        throw new TaskError('INVALID_CREDENTIALS', '请输入邮箱和密码。');
      }
      await loginToPodsum(email, password);
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_LOGOUT') {
    handleMessage(async () => {
      await clearAuth();
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_ADD_CURRENT_VIDEO') {
    handleMessage(async () => {
      await enqueueCurrentVideoTask();
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_SET_IS_PUBLIC') {
    handleMessage(async () => {
      await saveSettings({ isPublic: Boolean(message?.isPublic) });
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_RETRY_TASK') {
    handleMessage(async () => {
      const taskId = String(message?.taskId || '');
      if (!taskId) {
        throw new TaskError('MISSING_TASK_ID', '缺少任务 ID。');
      }
      await retryTask(taskId);
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_START_PATH2') {
    handleMessage(async () => {
      const taskId = String(message?.taskId || '');
      if (!taskId) {
        throw new TaskError('MISSING_TASK_ID', '缺少任务 ID。');
      }
      await startPath2(taskId);
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_RETRY_PATH2') {
    handleMessage(async () => {
      const taskId = String(message?.taskId || '');
      if (!taskId) {
        throw new TaskError('MISSING_TASK_ID', '缺少任务 ID。');
      }
      await retryPath2(taskId);
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_DELETE_TASK') {
    handleMessage(async () => {
      const taskId = String(message?.taskId || '');
      if (!taskId) {
        throw new TaskError('MISSING_TASK_ID', '缺少任务 ID。');
      }
      await deleteTask(taskId);
      return getPopupState();
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_GET_TASK_DETAIL') {
    handleMessage(async () => {
      const taskId = String(message?.taskId || '');
      if (!taskId) {
        throw new TaskError('MISSING_TASK_ID', '缺少任务 ID。');
      }
      return getTaskDetail(taskId);
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_OPEN_DASHBOARD') {
    handleMessage(async () => {
      await openDashboard(String(message?.url || ''));
      return { opened: true };
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_OPEN_SITE') {
    handleMessage(async () => {
      await openPodsumSite();
      return { opened: true };
    }, sendResponse);
    return true;
  }

  if (type === 'PODSUM_GET_SETTINGS') {
    handleMessage(async () => ({ settings: await getSettings() }), sendResponse);
    return true;
  }

  if (type === 'PODSUM_SAVE_SETTINGS') {
    handleMessage(async () => ({ settings: await saveSettings({ baseUrl: message?.baseUrl }) }), sendResponse);
    return true;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const url = notificationUrlMap.get(notificationId);
  if (url) {
    await chrome.tabs.create({ url, active: true });
    notificationUrlMap.delete(notificationId);
  }
  chrome.notifications.clear(notificationId);
});
