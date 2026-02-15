const STORAGE_KEYS = {
  AUTH: 'podsumAuth',
  SETTINGS: 'podsumSettings',
  TASKS: 'podsumTasks',
};

const DEFAULT_BASE_URL = 'https://podsum.cc';
const TASK_LIMIT = 5;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

const notificationUrlMap = new Map();
const runningTasks = new Set();
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

  const rawStatus = String(raw.status || 'queued');
  const status = rawStatus.startsWith('awaiting_') ? 'failed' : rawStatus;

  return {
    taskId: String(raw.taskId || ''),
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now()),
    videoId: String(raw.videoId || ''),
    title: String(raw.title || raw.videoId || 'Untitled video'),
    youtubeUrl: String(raw.youtubeUrl || ''),
    isPublic: Boolean(raw.isPublic),
    path: 'path1',
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
    case 'transcribing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'processing':
      return 'processing';
    case 'completed':
      return 'completed';
    default:
      return 'accepted';
  }
}

function toMonitorPath() {
  return 'path1';
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
    path: toMonitorPath(),
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

async function uploadYoutubeUrlToPodsum(task) {
  const auth = await requireAuth();
  const settings = await getSettings();

  const result = await requestJson(`${settings.baseUrl}/api/extension/upload-youtube`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({
      youtubeUrl: task.youtubeUrl,
      sourceReference: task.youtubeUrl,
      isPublic: task.isPublic,
      clientTaskId: task.taskId,
      traceId: task.traceId || buildTraceId(task.videoId),
    }),
  });

  if (!result?.success || !result?.data?.podcastId) {
    throw new TaskError(
      result?.code || 'REMOTE_TRANSCRIPT_FAILED',
      result?.error || '服务端抓取字幕失败，请稍后重试。',
      result?.details || null,
    );
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

async function processTask(taskId) {
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
      steps: {
        subtitle: 'idle',
        download: 'idle',
        upload: 'idle',
        process: 'idle',
      },
    }));

    await reportTaskMonitorEvent(taskId, {
      stage: 'client_transcript_started',
      level: 'info',
      message: 'Single-path transcript ingestion started from extension.',
      status: 'accepted',
    });

    const taskForUpload = await getTask(taskId);
    if (!taskForUpload) {
      throw new TaskError('TASK_NOT_FOUND', '任务不存在。');
    }

    await mutateTask(taskId, (task) => ({
      ...task,
      updatedAt: Date.now(),
      status: 'running',
      statusMessage: '服务端抓取字幕中...',
    }));

    const uploadData = await uploadYoutubeUrlToPodsum(taskForUpload);

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
      '字幕已抓取并上传成功',
      `${taskForUpload.title || taskForUpload.videoId} (${taskForUpload.isPublic ? 'Public' : 'Private'})`,
      uploadData.dashboardUrl,
    );

    await reportTaskMonitorEvent(taskId, {
      stage: 'client_transcript_upload_accepted',
      level: 'info',
      message: 'Single-path transcript ingestion accepted.',
      status: 'processing',
      meta: {
        podcastId: uploadData.podcastId,
        monitorTaskId: uploadData.monitorTaskId || null,
        source: uploadData.youtubeIngest?.source || null,
      },
    });

    await pollProcessing(taskId, uploadData.podcastId);
  } catch (error) {
    await failTask(taskId, error, 'client_transcript_failed');
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
  processTask(task.taskId);
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

  processTask(taskId);
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
