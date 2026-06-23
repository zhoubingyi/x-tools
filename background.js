chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'XT_DOWNLOAD') return false;

  chrome.downloads.download({
    url: message.url,
    filename: message.filename,
    conflictAction: 'uniquify',
    saveAs: false,
  }, (downloadId) => {
    const error = chrome.runtime.lastError;
    sendResponse(error ? { ok: false, error: error.message } : { ok: true, downloadId });
  });

  return true;
});
