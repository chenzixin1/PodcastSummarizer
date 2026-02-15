const accountHintEl = document.getElementById('accountHint');
const versionHintEl = document.getElementById('versionHint');
const errorBoxEl = document.getElementById('errorBox');
const infoBoxEl = document.getElementById('infoBox');
const loginViewEl = document.getElementById('loginView');
const mainViewEl = document.getElementById('mainView');
const loginFormEl = document.getElementById('loginForm');
const emailInputEl = document.getElementById('emailInput');
const passwordInputEl = document.getElementById('passwordInput');
const loginButtonEl = document.getElementById('loginButton');
const addCurrentButtonEl = document.getElementById('addCurrentButton');
const isPublicToggleEl = document.getElementById('isPublicToggle');
const tasksListEl = document.getElementById('tasksList');
const openSiteButtonEl = document.getElementById('openSiteButton');
const logoutButtonEl = document.getElementById('logoutButton');

class PopupError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'PopupError';
    this.code = code;
    this.details = details;
  }
}

function showError(message) {
  errorBoxEl.textContent = message;
  errorBoxEl.classList.remove('hidden');
}

function clearError() {
  errorBoxEl.textContent = '';
  errorBoxEl.classList.add('hidden');
}

function showInfo(message) {
  infoBoxEl.textContent = message;
  infoBoxEl.classList.remove('hidden');
  setTimeout(() => {
    infoBoxEl.classList.add('hidden');
  }, 1800);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp || Date.now()));
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function renderVersionHint() {
  if (!(versionHintEl instanceof HTMLElement)) {
    return;
  }

  const manifest = chrome.runtime.getManifest();
  const version = String(manifest.version || '0.0.0');
  const versionName = String(manifest.version_name || '').trim();
  versionHintEl.textContent = versionName ? `版本 ${version} (${versionName})` : `版本 ${version}`;
}

function taskStatusLabel(task) {
  if (task.statusMessage) {
    return task.statusMessage;
  }

  if (String(task.status || '').startsWith('awaiting_')) {
    return '任务失败，可重试';
  }

  switch (task.status) {
    case 'queued':
      return '等待处理';
    case 'running':
      return '处理中';
    case 'uploaded':
      return '上传完成';
    case 'transcribing':
      return '转写中';
    case 'processing':
      return '分析中';
    case 'completed':
      return '已完成';
    case 'failed':
      return task.errorMessage || '任务失败';
    default:
      return '未知状态';
  }
}

function taskActionsTemplate(task) {
  const actions = [];

  if (task.dashboardUrl) {
    actions.push(`<button type="button" data-action="open" data-url="${escapeHtml(task.dashboardUrl)}">打开结果</button>`);
  }

  if (task.status === 'failed') {
    actions.push(`<button type="button" data-action="retry" data-task-id="${escapeHtml(task.taskId)}">重试</button>`);
  }

  if (task.errorMessage) {
    actions.push(`<button type="button" data-action="error" data-message="${escapeHtml(task.errorMessage)}">查看错误</button>`);
  }

  if (!actions.length) {
    return '';
  }

  return `<div class="rowActions">${actions.join('')}</div>`;
}

function taskTemplate(task) {
  const visibility = task.isPublic ? 'Public' : 'Private';

  return `
    <li class="task">
      <div class="taskTop">
        <p class="taskTitle" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</p>
        <div class="taskTopRight">
          <span class="subtle">${formatTime(task.createdAt)}</span>
          <button
            type="button"
            class="taskDeleteButton"
            data-action="delete"
            data-task-id="${escapeHtml(task.taskId)}"
            aria-label="删除任务"
            title="删除任务"
          >
            ×
          </button>
        </div>
      </div>
      <p class="taskMeta">${escapeHtml(task.videoId)} · ${visibility}</p>
      <div class="statusRow">
        <span class="statusText">${escapeHtml(taskStatusLabel(task))}</span>
      </div>
      ${taskActionsTemplate(task)}
    </li>
  `;
}

function renderTasks(tasks) {
  if (!tasks || !tasks.length) {
    tasksListEl.innerHTML = '<li class="empty">暂无任务，点击“添加当前视频”开始。</li>';
    return;
  }

  tasksListEl.innerHTML = tasks.map((task) => taskTemplate(task)).join('');
}

function renderState(state) {
  const auth = state?.auth || null;
  const settings = state?.settings || { isPublic: false };
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];

  if (!auth) {
    accountHintEl.textContent = '未登录';
    loginViewEl.classList.remove('hidden');
    mainViewEl.classList.add('hidden');
    return;
  }

  accountHintEl.textContent = `已登录：${auth.email}`;
  loginViewEl.classList.add('hidden');
  mainViewEl.classList.remove('hidden');
  isPublicToggleEl.checked = Boolean(settings.isPublic);
  renderTasks(tasks);
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new PopupError('RUNTIME_ERROR', chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new PopupError('NO_RESPONSE', '扩展后台未返回结果。'));
        return;
      }

      if (!response.success) {
        reject(new PopupError(response.code || 'REQUEST_FAILED', response.error || '请求失败', response.details));
        return;
      }

      resolve(response.data);
    });
  });
}

async function refreshState() {
  const state = await sendMessage({ type: 'PODSUM_GET_STATE' });
  renderState(state);
}

async function onLoginSubmit(event) {
  event.preventDefault();
  clearError();

  const email = String(emailInputEl.value || '').trim();
  const password = String(passwordInputEl.value || '');

  if (!email || !password) {
    showError('请输入邮箱和密码。');
    return;
  }

  loginButtonEl.disabled = true;
  loginButtonEl.textContent = '登录中...';

  try {
    await sendMessage({
      type: 'PODSUM_LOGIN',
      email,
      password,
    });

    passwordInputEl.value = '';
    showInfo('登录成功');
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    loginButtonEl.disabled = false;
    loginButtonEl.textContent = '登录';
  }
}

async function onAddCurrent() {
  clearError();
  addCurrentButtonEl.disabled = true;
  addCurrentButtonEl.textContent = '添加中...';

  try {
    await sendMessage({ type: 'PODSUM_ADD_CURRENT_VIDEO' });
    showInfo('任务已添加');
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    addCurrentButtonEl.disabled = false;
    addCurrentButtonEl.textContent = '添加当前视频';
  }
}

async function onTogglePublic() {
  clearError();
  try {
    await sendMessage({
      type: 'PODSUM_SET_IS_PUBLIC',
      isPublic: isPublicToggleEl.checked,
    });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function onLogout() {
  clearError();
  try {
    await sendMessage({ type: 'PODSUM_LOGOUT' });
    showInfo('已退出登录');
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function onOpenSite() {
  try {
    await sendMessage({ type: 'PODSUM_OPEN_SITE' });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function onTaskAction(event) {
  const origin = event.target;
  if (!(origin instanceof Element)) {
    return;
  }

  const target = origin.closest('button[data-action]');
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  if (!action) {
    return;
  }

  clearError();
  const shouldLockButton =
    action === 'retry' ||
    action === 'delete';
  const originalText = target.textContent;
  if (shouldLockButton) {
    target.disabled = true;
    if (action !== 'delete') {
      target.textContent = '处理中...';
    }
  }

  try {
    if (action === 'open') {
      await sendMessage({ type: 'PODSUM_OPEN_DASHBOARD', url: target.dataset.url || '' });
      return;
    }

    if (action === 'retry') {
      const taskId = target.dataset.taskId || '';
      await sendMessage({ type: 'PODSUM_RETRY_TASK', taskId });
      showInfo('已重新发起任务');
      await refreshState();
      return;
    }

    if (action === 'error') {
      const message = target.dataset.message || '未知错误';
      showError(message);
      return;
    }

    if (action === 'delete') {
      const taskId = target.dataset.taskId || '';
      await sendMessage({ type: 'PODSUM_DELETE_TASK', taskId });
      showInfo('任务已删除');
      await refreshState();
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (shouldLockButton) {
      target.disabled = false;
      if (action !== 'delete') {
        target.textContent = originalText;
      }
    }
  }
}

function onStorageChange(changes, areaName) {
  if (areaName !== 'local') {
    return;
  }

  if (!changes.podsumTasks && !changes.podsumAuth && !changes.podsumSettings) {
    return;
  }

  refreshState().catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
}

function init() {
  renderVersionHint();
  loginFormEl.addEventListener('submit', onLoginSubmit);
  addCurrentButtonEl.addEventListener('click', onAddCurrent);
  isPublicToggleEl.addEventListener('change', onTogglePublic);
  logoutButtonEl.addEventListener('click', onLogout);
  openSiteButtonEl.addEventListener('click', onOpenSite);
  tasksListEl.addEventListener('click', onTaskAction);
  chrome.storage.onChanged.addListener(onStorageChange);

  refreshState().catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
}

init();
