// background.js — Service worker for chrome.downloads
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'XT_DOWNLOAD') {
    chrome.downloads.download(
      { url: msg.url, filename: msg.filename, saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ downloadId });
        }
      }
    );
    return true; // keep channel open for async sendResponse
  }
});
