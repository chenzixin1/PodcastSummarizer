const baseUrlInputEl = document.getElementById('baseUrlInput');
const saveBtnEl = document.getElementById('saveBtn');
const resetBtnEl = document.getElementById('resetBtn');
const messageEl = document.getElementById('message');

const DEFAULT_BASE_URL = 'https://podsum.cc';

function showMessage(message) {
  messageEl.textContent = message;
  setTimeout(() => {
    messageEl.textContent = '';
  }, 1500);
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.success) {
        reject(new Error(response?.error || '请求失败'));
        return;
      }

      resolve(response.data);
    });
  });
}

async function loadSettings() {
  const data = await sendMessage({ type: 'PODSUM_GET_SETTINGS' });
  baseUrlInputEl.value = data?.settings?.baseUrl || DEFAULT_BASE_URL;
}

async function saveSettings() {
  const baseUrl = String(baseUrlInputEl.value || '').trim() || DEFAULT_BASE_URL;
  await sendMessage({ type: 'PODSUM_SAVE_SETTINGS', baseUrl });
  await loadSettings();
  showMessage('设置已保存');
}

async function resetSettings() {
  await sendMessage({ type: 'PODSUM_SAVE_SETTINGS', baseUrl: DEFAULT_BASE_URL });
  await loadSettings();
  showMessage('已恢复默认');
}

saveBtnEl.addEventListener('click', () => {
  saveSettings().catch((error) => {
    showMessage(error instanceof Error ? error.message : String(error));
  });
});

resetBtnEl.addEventListener('click', () => {
  resetSettings().catch((error) => {
    showMessage(error instanceof Error ? error.message : String(error));
  });
});

loadSettings().catch((error) => {
  showMessage(error instanceof Error ? error.message : String(error));
});
