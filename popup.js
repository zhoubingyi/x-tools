const DEFAULTS = {
  trendingThreshold: 1000,
  viralThreshold: 10000,
  leaderboardEnabled: true,
  leaderboardCount: 10,
  showBookmarkCount: true,
  copyMarkdownEnabled: true,
  imageViewerEnabled: true,
  mediaDownloadEnabled: true,
  mediaFilenamePattern: 'twitter_{user-name}(@{user-id})_{date-time}_{status-id}_{file-type}',
  mediaSaveHistory: true,
};
const STORAGE_KEY = 'xtSettings';
const DOWNLOAD_HISTORY_KEY = 'xtDownloadHistory';
let current = { ...DEFAULTS };

// Tab switching
document.querySelectorAll('.xt-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    document.querySelectorAll('.xt-tab-btn').forEach((b) => b.setAttribute('aria-selected', 'false'));
    btn.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.xt-panel').forEach((p) => p.setAttribute('data-active', '0'));
    document.querySelector(`.xt-panel[data-panel="${tabName}"]`).setAttribute('data-active', '1');
  });
});

function load() {
  chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS }, (items) => {
    current = { ...DEFAULTS, ...(items[STORAGE_KEY] || {}) };
    syncForm();
  });
}

function syncForm() {
  for (const input of document.querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    if (input.type === 'checkbox') input.checked = current[key] === true;
    else input.value = current[key];
  }
}

function save(patch) {
  current = { ...current, ...patch };
  chrome.storage.sync.set({ [STORAGE_KEY]: current }, () => {
    const status = document.querySelector('#status');
    status.textContent = '已保存';
    setTimeout(() => { status.textContent = ''; }, 900);
  });
}

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-key]');
  if (!input) return;
  const key = input.dataset.key;
  const value = input.type === 'checkbox'
    ? input.checked
    : input.type === 'number'
      ? Number(input.value)
      : input.value;
  save({ [key]: value });
});

document.querySelector('#reset').addEventListener('click', () => {
  current = { ...DEFAULTS };
  chrome.storage.sync.set({ [STORAGE_KEY]: current }, syncForm);
});

document.querySelector('#clear-history')?.addEventListener('click', () => {
  chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: [] }, () => {
    const status = document.querySelector('#status');
    status.textContent = '下载记录已清除';
    setTimeout(() => { status.textContent = ''; }, 900);
  });
});

document.querySelector('#export-history')?.addEventListener('click', () => {
  chrome.storage.local.get({ [DOWNLOAD_HISTORY_KEY]: [] }, (items) => {
    const history = Array.isArray(items[DOWNLOAD_HISTORY_KEY]) ? items[DOWNLOAD_HISTORY_KEY] : [];
    const markdown = '# X Tools Media Download History\n\n'
      + history.map((id) => `- [Tweet ${id}](https://x.com/i/web/status/${id})`).join('\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    chrome.downloads.download({
      url,
      filename: `x-tools-download-history-${history.length}.md`,
      conflictAction: 'uniquify',
      saveAs: false,
    }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  });
});

load();
