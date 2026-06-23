// ==UserScript==
// @name         X Tools
// @namespace    https://github.com/zhoubingyi
// @version      1.1.0
// @description  实时流速徽章、热帖排行榜、批量删除推文、媒体下载、书签数和 Markdown 复制
// @author       zhoubingyi
// @match        https://*.x.com/*
// @match        https://pro.x.com/*
// @match        https://pbs.twimg.com/*
// @match        https://video.twimg.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_download
// @run-at       document-start
// @homepageURL  https://github.com/zhoubingyi/x-tools
// @updateURL    https://raw.githubusercontent.com/zhoubingyi/x-tools/main/x-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/zhoubingyi/x-tools/main/x-tools.user.js
// ==/UserScript==

(() => {
  "use strict";

  // ─ Inject page-world hook code (intercepts fetch / XHR) ──────

  const HOOK_SOURCE = function xToolsHook() {
    if (window.__xToolsHookInstalled) return;
    window.__xToolsHookInstalled = true;

    const GRAPHQL_RE = /\/i\/api\/graphql\//;

    function postTweetsFromPayload(payload) {
      const tweets = [];
      scan(payload, tweets);
      if (tweets.length) {
        window.postMessage({ type: 'XT_TWEETS', tweets }, '*');
      }
    }

    function scan(value, out) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item) => scan(item, out));
        return;
      }

      const result = value.tweet_results?.result || value.tweetResult?.result;
      if (result) {
        const tweet = normalizeTweet(result);
        if (tweet) out.push(tweet);
      }

      for (const [key, child] of Object.entries(value)) {
        if (key === 'tweet_results' || key === 'tweetResult') continue;
        if (child && typeof child === 'object') scan(child, out);
      }
    }

    function normalizeTweet(result) {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;
      if (!legacy) return null;

      const retweeted = legacy.retweeted_status_result?.result;
      if (retweeted) return normalizeTweet(retweeted);

      const views = Number.parseInt(tweet.views?.count, 10);
      if (!Number.isFinite(views) || views <= 0) return null;
      if (tweet.promotedMetadata || tweet.promoted_metadata || legacy.promotedMetadata) return null;

      const user = tweet.core?.user_results?.result || tweet.user_results?.result || {};
      const userLegacy = user.legacy || {};
      const note = tweet.note_tweet?.note_tweet_results?.result;
      const article = tweet.article?.article_results?.result;
      const text = article?.preview_text || note?.text || legacy.full_text || legacy.text || '';
      const screenName = userLegacy.screen_name || user.core?.screen_name || '';
      const media = normalizeMedia(legacy.extended_entities?.media || legacy.entities?.media || []);

      return {
        id: legacy.id_str || tweet.rest_id,
        views,
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        createdAt: legacy.created_at || '',
        text,
        screenName,
        name: userLegacy.name || user.core?.name || '',
        media,
        isLong: Boolean(article || note?.text?.length > 600 || text.length > 600),
      };
    }

    function normalizeMedia(items) {
      if (!Array.isArray(items)) return [];
      return items.map((item, index) => {
        const type = item.type === 'animated_gif' ? 'gif' : item.type;
        const photoUrl = item.media_url_https ? `${item.media_url_https}:orig` : '';
        const videoUrl = item.video_info?.variants
          ?.filter((variant) => variant.content_type === 'video/mp4' && variant.url)
          ?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url || '';
        const url = type === 'photo' ? photoUrl : videoUrl;
        if (!url) return null;
        return {
          url,
          type,
          index,
          originalName: url.split('/').pop().split(/[:?]/)[0] || `media-${index + 1}`,
        };
      }).filter(Boolean);
    }

    const originalFetch = window.fetch;
    window.fetch = async function xToolsFetch(input, init) {
      const response = await originalFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (GRAPHQL_RE.test(url)) {
          response.clone().json().then(postTweetsFromPayload).catch(() => {});
        }
      } catch (_) {}
      return response;
    };

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function XToolsXHR() {
      const xhr = new OriginalXHR();
      let url = '';
      const open = xhr.open;
      xhr.open = function patchedOpen(method, requestUrl) {
        url = String(requestUrl || '');
        return open.apply(xhr, arguments);
      };
      xhr.addEventListener('load', () => {
        if (!GRAPHQL_RE.test(url)) return;
        try {
          postTweetsFromPayload(JSON.parse(xhr.responseText));
        } catch (_) {}
      });
      return xhr;
    };
  };

  // Inject hook as a real <script> so it runs in page context
  const hookScript = document.createElement('script');
  hookScript.textContent = `(${HOOK_SOURCE})();`;
  (document.head || document.documentElement).appendChild(hookScript);
  hookScript.remove();

  // ── CSS (injected via GM_addStyle) ────────────────────────────

  GM_addStyle(`
/* === Badge: pill-solid (default) === */
.xt-badge {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  height: fit-content;
  color: #fff;
  vertical-align: middle;
  cursor: default;
  user-select: none;
  white-space: nowrap;
}

.xt-badge:not([data-prefix]),
.xt-badge:not([data-velocity]),
.xt-badge[data-prefix=""],
.xt-badge[data-velocity=""] {
  display: none !important;
}

.xt-badge::before { content: attr(data-prefix); }
.xt-badge::after { content: attr(data-velocity) "/h"; }

.xt-badge--green { color: #15803d; background: rgba(22, 163, 74, 0.25); }
.xt-badge--orange { color: #c2410c; background: rgba(234, 88, 12, 0.25); }
.xt-badge--red { color: #b91c1c; background: rgba(220, 38, 38, 0.25); }

/* === Tooltip === */
.xt-tooltip {
  display: none;
  position: fixed;
  z-index: 2147483647;
  background: rgb(15, 20, 26);
  color: rgb(231, 233, 234);
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  white-space: pre-line;
  line-height: 1.6;
  min-width: 160px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

/* === Rate filter hide === */
html[data-xt-rate-filter-on] article[data-xt-rate-hidden] {
  display: none !important;
}

/* === Leaderboard === */
.xt-lb {
  display: none;
  position: fixed;
  right: 16px;
  top: 72px;
  width: 280px;
  background: #fffcf6;
  color: #24180f;
  border: 1px solid rgba(86, 60, 34, 0.18);
  border-radius: 14px;
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 10px 28px rgba(36, 24, 15, 0.22), 0 2px 6px rgba(36, 24, 15, 0.08);
  z-index: 2147483646;
  overflow: hidden;
}
.xt-lb.xt-lb-dragging {
  box-shadow: 0 16px 36px rgba(36, 24, 15, 0.32), 0 2px 6px rgba(36, 24, 15, 0.12);
  opacity: 0.96;
}

.xt-lb-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px 6px;
  border-bottom: 1px solid rgba(86, 60, 34, 0.14);
  background: linear-gradient(180deg, rgba(191, 90, 42, 0.06), rgba(191, 90, 42, 0));
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.xt-lb-head:active,
.xt-lb.xt-lb-dragging .xt-lb-head { cursor: grabbing; }
.xt-lb-grip {
  font-size: 10px;
  color: #9b877a;
  letter-spacing: -1px;
}
.xt-lb-title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  color: #6e5b4d;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.xt-lb-controls {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.xt-lb-action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8f3d17;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, transform 0.12s;
}
.xt-lb-action:hover {
  background: rgba(191, 90, 42, 0.14);
  color: #6f2f11;
}
.xt-lb-action:active {
  transform: translateY(1px);
}
.xt-lb-action svg {
  display: block;
  width: 16px;
  height: 16px;
}

.xt-lb-list {
  list-style: none;
  margin: 0;
  padding: 2px 0;
  height: 300px;
  min-height: 120px;
  max-height: 300px;
  overflow-y: auto;
}
.xt-lb-list::-webkit-scrollbar { width: 5px; }
.xt-lb-list::-webkit-scrollbar-thumb {
  background: rgba(86, 60, 34, 0.2);
  border-radius: 2px;
}

/* Resize handles */
.xt-lb-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 12px;
  height: 100%;
  cursor: ew-resize;
  touch-action: none;
}
.xt-lb-resize::before {
  content: "";
  position: absolute;
  top: 50%;
  right: 3px;
  width: 3px;
  height: 28px;
  border-radius: 999px;
  background: rgba(110, 91, 77, 0.22);
  transform: translateY(-50%);
  transition: background 0.12s;
}
.xt-lb:hover .xt-lb-resize::before {
  background: rgba(191, 90, 42, 0.35);
}

.xt-lb-resize-v {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 12px;
  cursor: ns-resize;
  touch-action: none;
}
.xt-lb-resize-v::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 28px;
  height: 3px;
  border-radius: 999px;
  background: rgba(110, 91, 77, 0.22);
  transform: translateX(-50%);
  transition: background 0.12s;
}
.xt-lb:hover .xt-lb-resize-v::before {
  background: rgba(191, 90, 42, 0.35);
}

@media (max-width: 640px) {
  .xt-lb {
    right: 8px;
    top: 64px;
    max-width: calc(100vw - 16px);
  }
}

.xt-lb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  height: 24px;
  user-select: none;
  transition: background 0.12s;
}
.xt-lb-item:hover { background: rgba(191, 90, 42, 0.10); }
.xt-lb-rank {
  width: 14px;
  text-align: center;
  color: #9b877a;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 600;
}
.xt-lb-icon { flex-shrink: 0; }
.xt-lb-preview {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #3a2b1f;
  font-size: 11.5px;
}
.xt-lb-vel {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.xt-lb-green .xt-lb-vel { color: #3b8a3f; }
.xt-lb-orange .xt-lb-vel { color: #bf5a2a; }
.xt-lb-red .xt-lb-vel { color: #c23c1c; }

article[data-testid="tweet"].xt-article-linked {
  outline: 2px solid #bf5a2a;
  outline-offset: -1px;
  border-radius: 12px;
  transition: outline-color 0.18s;
}

/* === Toast === */
.xt-copy,
.xt-media-download {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  margin-left: 8px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: rgba(191, 90, 42, 0.12);
  color: #bf5a2a;
  cursor: pointer;
  transition: background 120ms, color 120ms, transform 120ms;
}
.xt-copy {
  font: 700 11px/1 "Inter", "Avenir Next", "PingFang SC", sans-serif;
}
.xt-media-download svg { display: block; }
.xt-copy:hover,
.xt-media-download:hover {
  background: rgba(191, 90, 42, 0.22);
  color: #8f3d17;
}
.xt-copy:active,
.xt-media-download:active { transform: translateY(1px); }
.xt-media-download--loading {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.18);
  animation: xt-spin-pulse 900ms linear infinite;
}
.xt-media-download--done {
  color: #15803d;
  background: rgba(22, 163, 74, 0.18);
}
.xt-media-download--failed {
  color: #b91c1c;
  background: rgba(220, 38, 38, 0.18);
}
@keyframes xt-spin-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.xt-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translate(-50%, 12px);
  background: rgba(15, 20, 25, 0.92);
  color: #fff;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding: 10px 16px;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity 180ms ease, transform 180ms ease;
  z-index: 2147483646;
  pointer-events: none;
}
.xt-toast--show {
  opacity: 1;
  transform: translate(-50%, 0);
}
.xt-toast--success {
  background: rgba(22, 163, 74, 0.96);
  color: #fff;
  border: 1.5px solid rgba(134, 239, 172, 0.5);
  font-weight: 600;
  font-size: 15px;
  padding: 12px 20px;
}

/* === Hot-only toggle === */
.xt-lb-hot {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}
.xt-lb-hot-label {
  font-size: 10.5px;
  font-weight: 500;
  color: #6e5b4d;
  white-space: nowrap;
}
.xt-lb-hot-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex: 0 0 36px;
}
.xt-lb-hot-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}
.xt-lb-hot-slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  background: rgba(110, 91, 77, 0.30);
  border-radius: 999px;
  transition: 200ms;
}
.xt-lb-hot-slider::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: 200ms;
}
.xt-lb-hot-switch input:checked + .xt-lb-hot-slider { background: #bf5a2a; }
.xt-lb-hot-switch input:checked + .xt-lb-hot-slider::before { transform: translateX(16px); }

/* === Dashboard Modal === */
.xt-dashboard {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  max-height: 100vh;
  background: #fffcf6;
  color: #24180f;
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: -4px 0 24px rgba(36, 24, 15, 0.18);
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: xt-dash-slide-in 0.2s ease-out;
}
@keyframes xt-dash-slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

.xt-dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(86, 60, 34, 0.14);
  flex-shrink: 0;
}
.xt-dashboard-title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #24180f;
}
.xt-dashboard-subtitle {
  font-size: 11px;
  color: #6e5b4d;
  margin-top: 2px;
  display: block;
}
.xt-dashboard-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: rgba(86, 60, 34, 0.08);
  color: #6e5b4d;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  line-height: 1;
}
.xt-dashboard-close:hover {
  background: rgba(86, 60, 34, 0.16);
  color: #24180f;
}

.xt-dashboard-tabs {
  display: flex;
  border-bottom: 1px solid rgba(86, 60, 34, 0.14);
  padding: 0 12px;
  flex-shrink: 0;
}
.xt-dashboard-tab-btn {
  flex: 1;
  padding: 10px 4px;
  background: none;
  border: none;
  color: #6e5b4d;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  transition: color 0.12s;
  font-family: inherit;
}
.xt-dashboard-tab-btn:hover { color: #24180f; }
.xt-dashboard-tab-btn.active {
  color: #24180f;
  font-weight: 700;
}
.xt-dashboard-tab-btn.active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 3px;
  background: #bf5a2a;
  border-radius: 2px;
}

.xt-dashboard-panels {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.xt-dashboard-panels::-webkit-scrollbar { width: 5px; }
.xt-dashboard-panels::-webkit-scrollbar-thumb {
  background: rgba(86, 60, 34, 0.2);
  border-radius: 2px;
}
.xt-dashboard-panel { display: none; }
.xt-dashboard-panel.active { display: block; }

.xt-dashboard-card {
  background: #fff;
  border: 1px solid rgba(86, 60, 34, 0.12);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 10px;
}
.xt-dashboard-card h4 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  color: #4a3a2e;
  letter-spacing: 0.02em;
}

.xt-dashboard-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 8px 0;
  font-size: 13px;
  color: #24180f;
}
.xt-dashboard-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex: 0 0 40px;
}
.xt-dashboard-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.xt-dashboard-switch .slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  background: rgba(86, 60, 34, 0.2);
  border-radius: 999px;
  transition: 0.2s;
}
.xt-dashboard-switch .slider::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: 0.2s;
}
.xt-dashboard-switch input:checked + .slider { background: #bf5a2a; }
.xt-dashboard-switch input:checked + .slider::before { transform: translateX(18px); }

.xt-dashboard-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
  font-size: 12px;
  color: #4a3a2e;
}
.xt-dashboard-field label { font-weight: 500; }
.xt-dashboard-field input[type="number"],
.xt-dashboard-field textarea {
  padding: 8px 10px;
  border: 1px solid rgba(86, 60, 34, 0.22);
  border-radius: 8px;
  background: #f9f3ea;
  color: #24180f;
  font: inherit;
  font-size: 13px;
}
.xt-dashboard-field textarea {
  min-height: 60px;
  resize: vertical;
  line-height: 1.45;
}
.xt-dashboard-field input:focus,
.xt-dashboard-field textarea:focus {
  outline: 2px solid #bf5a2a;
  outline-offset: -1px;
  border-color: transparent;
}

.xt-dashboard-info-box {
  background: #f5ede1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  color: #4a3a2e;
  margin: 8px 0;
}
.xt-dashboard-info-box .tier {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 3px 0;
}
.xt-dashboard-info-box .tier .icon { width: 18px; }
.xt-dashboard-info-box .tier .label { flex: 1; }
.xt-dashboard-info-box .tier .range {
  color: #6e5b4d;
  font-variant-numeric: tabular-nums;
}

.xt-dashboard-about-text {
  font-size: 12px;
  color: #4a3a2e;
  line-height: 1.7;
  margin: 0;
}

.xt-dashboard-toggle-btn {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 2147483645;
  padding: 7px 11px;
  background: #bf5a2a;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font: 700 13px/1 "Avenir Next", "PingFang SC", sans-serif;
  letter-spacing: 0.04em;
  box-shadow: 0 2px 8px rgba(191, 90, 42, 0.35);
  transition: background 0.12s, transform 0.12s, box-shadow 0.12s;
}
.xt-dashboard-toggle-btn:hover {
  background: #d97540;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(191, 90, 42, 0.4);
}
.xt-dashboard-toggle-btn:active { transform: translateY(0); }

/* === Delete Panel === */
.xt-btn-danger {
  background: #dc2626 !important;
  color: #fff !important;
  border-color: #dc2626 !important;
}
.xt-btn-danger:hover:not(:disabled) {
  background: #b91c1c !important;
  border-color: #b91c1c !important;
}
.xt-btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.xt-delete-start:disabled + .xt-delete-stop,
.xt-delete-stop:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Dashboard Ranked List */
.xt-dashboard-ranked {
  max-height: 360px;
  overflow-y: auto;
  margin: 0 -4px;
}
.xt-dashboard-ranked::-webkit-scrollbar { width: 5px; }
.xt-dashboard-ranked::-webkit-scrollbar-thumb {
  background: rgba(86, 60, 34, 0.2);
  border-radius: 2px;
}
.xt-dashboard-ranked-empty {
  text-align: center;
  color: #6e5b4d;
  font-size: 12px;
  padding: 24px 12px;
}
.xt-dashboard-ranked-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.xt-dashboard-ranked-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}
.xt-dashboard-ranked-row:hover {
  background: rgba(191, 90, 42, 0.08);
}
.xt-dashboard-ranked-num {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgba(86, 60, 34, 0.10);
  color: #6e5b4d;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.xt-dashboard-ranked-badge {
  font-size: 14px;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}
.xt-dashboard-ranked-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.xt-dashboard-ranked-text {
  font-size: 12px;
  color: #24180f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.xt-dashboard-ranked-meta {
  display: flex;
  gap: 8px;
  font-size: 10.5px;
  color: #6e5b4d;
}
.xt-dashboard-ranked-meta span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.xt-dashboard-ranked-vel {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  white-space: nowrap;
}
.xt-dashboard-ranked--green  .xt-dashboard-ranked-vel { color: #3b8a3f; }
.xt-dashboard-ranked--orange .xt-dashboard-ranked-vel { color: #bf5a2a; }
.xt-dashboard-ranked--red    .xt-dashboard-ranked-vel { color: #c23c1c; }
.xt-dashboard-ranked-row:nth-child(1) .xt-dashboard-ranked-num {
  background: #c23c1c;
  color: #fff;
}
.xt-dashboard-ranked-row:nth-child(2) .xt-dashboard-ranked-num {
  background: #bf5a2a;
  color: #fff;
}
.xt-dashboard-ranked-row:nth-child(3) .xt-dashboard-ranked-num {
  background: #d97540;
  color: #fff;
}

/* === Dark theme === */
@media (prefers-color-scheme: dark) {
  .xt-lb {
    background: #0f172a;
    color: #f8fafc;
    border-color: #334155;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.32);
  }
  .xt-lb-head {
    background: linear-gradient(180deg, rgba(6, 182, 212, 0.10), rgba(6, 182, 212, 0));
    border-bottom-color: rgba(148, 163, 184, 0.18);
  }
  .xt-lb-grip,
  .xt-lb-title { color: #f8fafc; }
  .xt-lb-action { color: #cbd5e1; }
  .xt-lb-action:hover { background: rgba(6, 182, 212, 0.16); color: #f8fafc; }
  .xt-lb-list li { color: #cbd5e1; }
  .xt-lb-rank { color: #94a3b8; }
  .xt-lb-preview { color: #cbd5e1; }
  .xt-lb-green .xt-lb-vel { color: #4ade80; }
  .xt-lb-orange .xt-lb-vel { color: #fb923c; }
  .xt-lb-red .xt-lb-vel { color: #ff6b4a; }
  .xt-lb-hot-label { color: #cbd5e1; }
  .xt-lb-hot-slider { background: #334155; }
  .xt-lb-hot-switch input:checked + .xt-lb-hot-slider { background: #06b6d4; }

  .xt-dashboard {
    background: #0f172a;
    color: #f8fafc;
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
  }
  .xt-dashboard-header { border-bottom-color: #334155; }
  .xt-dashboard-title h3 { color: #f8fafc; }
  .xt-dashboard-subtitle { color: #94a3b8; }
  .xt-dashboard-close {
    background: rgba(148, 163, 184, 0.12);
    color: #94a3b8;
  }
  .xt-dashboard-close:hover {
    background: rgba(148, 163, 184, 0.2);
    color: #f8fafc;
  }
  .xt-dashboard-tabs { border-bottom-color: #334155; }
  .xt-dashboard-tab-btn { color: #94a3b8; }
  .xt-dashboard-tab-btn:hover { color: #f8fafc; }
  .xt-dashboard-tab-btn.active { color: #f8fafc; }
  .xt-dashboard-tab-btn.active::after { background: #06b6d4; }
  .xt-dashboard-card {
    background: #1e293b;
    border-color: #334155;
  }
  .xt-dashboard-card h4 { color: #cbd5e1; }
  .xt-dashboard-toggle { color: #e2e8f0; }
  .xt-dashboard-switch .slider { background: #334155; }
  .xt-dashboard-switch input:checked + .slider { background: #06b6d4; }
  .xt-dashboard-field { color: #cbd5e1; }
  .xt-dashboard-field label { color: #94a3b8; }
  .xt-dashboard-field input[type="number"],
  .xt-dashboard-field textarea {
    background: #0f172a;
    border-color: #334155;
    color: #f8fafc;
  }
  .xt-dashboard-info-box { background: #1e293b; color: #94a3b8; }
  .xt-dashboard-info-box .tier .range { color: #64748b; }
  .xt-dashboard-about-text { color: #94a3b8; }
  .xt-dashboard-toggle-btn {
    background: #06b6d4;
    box-shadow: 0 2px 8px rgba(6, 182, 212, 0.35);
  }
  .xt-dashboard-toggle-btn:hover {
    background: #22d3ee;
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.4);
  }
  .xt-delete-status {
    background: #0f172a !important;
    color: #94a3b8 !important;
    border-color: #334155 !important;
  }
  .xt-delete-username { color: #e2e8f0 !important; }
  .xt-dashboard-ranked-text { color: #e2e8f0; }
  .xt-dashboard-ranked-meta { color: #64748b; }
  .xt-dashboard-ranked-num {
    background: rgba(148, 163, 184, 0.16);
    color: #94a3b8;
  }
  .xt-dashboard-ranked-row:hover { background: rgba(6, 182, 212, 0.12); }
  .xt-dashboard-ranked-empty { color: #64748b; }
  .xt-dashboard-ranked--green  .xt-dashboard-ranked-vel { color: #4ade80; }
  .xt-dashboard-ranked--orange .xt-dashboard-ranked-vel { color: #fb923c; }
  .xt-dashboard-ranked--red    .xt-dashboard-ranked-vel { color: #ff6b4a; }
}
`);

  // ── Constants & State ─────────────────────────────────────────

  const DEFAULTS = {
    trendingThreshold: 1000,
    viralThreshold: 10000,
    leaderboardEnabled: true,
    leaderboardCount: 10,
    showBookmarkCount: true,
    hotOnlyEnabled: false,
    hotOnlyRate: 1000,
    hotOnlyViews: 10000,
    copyMarkdownEnabled: true,
    imageViewerEnabled: true,
    mediaDownloadEnabled: true,
    mediaFilenamePattern: 'twitter_{user-name}(@{user-id})_{date-time}_{status-id}_{file-type}',
    mediaSaveHistory: true,
  };
  const STORAGE_KEY = 'xtSettings';
  const DOWNLOAD_HISTORY_KEY = 'xtDownloadHistory';
  const tweetStore = new Map();
  let settings = { ...DEFAULTS };
  let renderTimer = 0;
  let leaderboardEl = null;
  let tooltipEl = null;
  let lightbox = null;

  // Drag / resize state for leaderboard
  let lbDragState = null;
  let lbResizeState = null;
  let lbResizeVState = null;

  // ── Storage (GM_* wrappers) ──────────────────────────────────

  function readSettings() {
    settings = { ...DEFAULTS, ...(GM_getValue(STORAGE_KEY) || {}) };
    scheduleRender();
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    GM_setValue(STORAGE_KEY, settings);
  }

  GM_addValueChangeListener(STORAGE_KEY, (_name, _oldVal, newVal) => {
    settings = { ...DEFAULTS, ...(newVal || {}) };
    scheduleRender();
  });

  // ── Tweet data from injected hook (postMessage) ──────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'XT_TWEETS') return;
    for (const tweet of event.data.tweets || []) {
      if (!tweet?.id) continue;
      tweetStore.set(String(tweet.id), tweet);
    }
    scheduleRender();
  });

  // ── Render scheduling ─────────────────────────────────────────

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = 0;
      renderAll();
    }, 80);
  }

  function renderAll() {
    if (settings.hotOnlyEnabled) {
      document.documentElement.setAttribute('data-xt-rate-filter-on', '');
    } else {
      document.documentElement.removeAttribute('data-xt-rate-filter-on');
    }
    renderTweets();
    renderLeaderboard();
    renderDashboardLeaderboard();
    installImageViewer();
  }

  // ── Tweet rendering ───────────────────────────────────────────

  function renderTweets() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const id = getTweetId(article);
      if (!id) continue;
      const data = tweetStore.get(id);
      if (!data) {
        applyDomFallback(article, id);
        continue;
      }
      renderBadge(article, data);
      renderBookmarkCount(article, data);
      renderCopyButton(article, data);
      renderMediaDownloadButton(article, data);
      applyHotOnly(article, data);
    }
  }

  function applyDomFallback(article, id) {
    if (tweetStore.has(id)) return;
    const text = getArticleText(article);
    if (!text) return;
    const time = article.querySelector('time')?.getAttribute('datetime') || '';
    tweetStore.set(id, {
      id,
      views: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      bookmarks: 0,
      createdAt: time,
      text,
      screenName: getHandle(article),
      name: '',
      isLong: text.length > 600,
      domOnly: true,
    });
  }

  function renderBadge(article, data) {
    if (data.domOnly || article.querySelector('.xt-badge')) return;
    const headerRow = findHeaderRow(article);
    if (!headerRow) return;
    const score = computeScore(data);
    const badge = document.createElement('span');
    badge.className = `xt-badge xt-badge--${score.tier}`;
    badge.setAttribute('data-prefix', score.icon + ' ');
    badge.setAttribute('data-velocity', formatRate(score.velocity));
    badge.addEventListener('mouseenter', () => showTooltip(badge, tooltipText(data, score)));
    badge.addEventListener('mouseleave', hideTooltip);
    headerRow.insertBefore(badge, headerRow.lastElementChild);
  }

  function findHeaderRow(article) {
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) return null;
    let el = caret.parentElement;
    while (el && el !== article) {
      const cs = getComputedStyle(el);
      if (cs.display === 'flex' && cs.flexDirection === 'row'
        && el.querySelector('[data-testid="User-Name"]')) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function renderBookmarkCount(article, data) {
    if (!settings.showBookmarkCount || !data.bookmarks || article.querySelector('.xt-bookmarks')) return;
    const bookmark = article.querySelector('[data-testid="bookmark"], [aria-label*="Bookmark"], [aria-label*="书签"]');
    const group = bookmark?.closest('[role="group"]') || article.querySelector('[role="group"]');
    if (!group) return;
    const pill = document.createElement('span');
    pill.className = 'xt-bookmarks';
    pill.textContent = ` ${formatCompact(data.bookmarks)}`;
    group.appendChild(pill);
  }

  function renderCopyButton(article, data) {
    if (!settings.copyMarkdownEnabled || article.querySelector('.xt-copy')) return;
    const group = article.querySelector('[role="group"]');
    if (!group) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xt-copy';
    btn.title = 'Copy as Markdown';
    btn.textContent = 'MD';
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await navigator.clipboard.writeText(buildMarkdown(article, data));
      showToast('✓ 已复制 Markdown', 'success');
    });
    group.appendChild(btn);
  }

  function renderMediaDownloadButton(article, data) {
    if (!settings.mediaDownloadEnabled || article.querySelector('.xt-media-download')) return;
    if (!Array.isArray(data.media) || !data.media.length) return;
    const group = article.querySelector('[role="group"]');
    if (!group) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xt-media-download';
    btn.title = '下载媒体';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await downloadTweetMedia(btn, data);
    });
    group.appendChild(btn);
  }

  async function downloadTweetMedia(btn, data) {
    if (btn.classList.contains('xt-media-download--loading')) return;
    setMediaDownloadStatus(btn, 'loading', '下载中…');
    try {
      const history = await getDownloadHistory();
      const alreadySaved = history.includes(data.id);
      const tasks = data.media.map((media, index) => ({
        url: media.url,
        filename: buildMediaFilename(data, media, index),
      }));
      if (!tasks.length) throw new Error('未找到可下载媒体');
      for (const task of tasks) {
        await new Promise((resolve, reject) => {
          GM_download({
            url: task.url,
            name: task.filename,
            onload: () => resolve(),
            onerror: (err) => reject(new Error(err.error || '下载失败')),
          });
        });
      }
      if (settings.mediaSaveHistory && !alreadySaved) {
        await setDownloadHistory([...history, data.id]);
      }
      setMediaDownloadStatus(btn, 'done', '下载完成');
      showToast(`✓ 已开始下载 ${tasks.length} 个媒体`, 'success');
    } catch (error) {
      setMediaDownloadStatus(btn, 'failed', error.message || '下载失败');
      showToast(`下载失败：${error.message || '未知错误'}`);
    }
  }

  function setMediaDownloadStatus(btn, status, title) {
    btn.classList.remove('xt-media-download--loading', 'xt-media-download--done', 'xt-media-download--failed');
    if (status) btn.classList.add(`xt-media-download--${status}`);
    if (title) btn.title = title;
  }

  function getDownloadHistory() {
    return new Promise((resolve) => {
      resolve(Array.isArray(GM_getValue(DOWNLOAD_HISTORY_KEY)) ? GM_getValue(DOWNLOAD_HISTORY_KEY) : []);
    });
  }

  function setDownloadHistory(history) {
    GM_setValue(DOWNLOAD_HISTORY_KEY, history);
    return Promise.resolve();
  }

  function showToast(message, variant) {
    let toast = document.querySelector('.xt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'xt-toast';
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `xt-toast xt-toast--show${variant === 'success' ? ' xt-toast--success' : ''}`;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.className = 'xt-toast';
    }, 1600);
  }

  function applyHotOnly(article, data) {
    const score = computeScore(data);
    const keep = score.velocity >= settings.hotOnlyRate || data.views >= settings.hotOnlyViews;
    if (settings.hotOnlyEnabled && !keep) {
      article.setAttribute('data-xt-rate-hidden', '');
    } else {
      article.removeAttribute('data-xt-rate-hidden');
    }
  }

  // ── Scoring ───────────────────────────────────────────────────

  function computeScore(data) {
    const created = new Date(data.createdAt).getTime();
    const hours = Number.isFinite(created) ? Math.max((Date.now() - created) / 3600000, 0.1) : 1;
    const velocity = data.views / hours;
    const engagements = data.likes + data.retweets + data.replies;
    const engagementRate = data.views > 0 ? engagements / data.views : 0;
    const rtRatio = data.likes > 0 ? data.retweets / data.likes : 0;
    const bmRatio = data.likes > 0 ? data.bookmarks / data.likes : 0;
    const value = Math.round(
      Math.min(velocity / 50000, 1) * 40
      + Math.min(engagementRate / 0.1, 1) * 25
      + Math.min(rtRatio / 0.5, 1) * 20
      + Math.min(bmRatio / 0.3, 1) * 15
    );
    const tier = velocity >= settings.viralThreshold ? 'red' : velocity >= settings.trendingThreshold ? 'orange' : 'green';
    return { velocity, value, tier, icon: tier === 'red' ? '\u{1F525}' : tier === 'orange' ? '\u{1F680}' : '\u{1F331}' };
  }

  // ── Leaderboard (floating panel) ──────────────────────────────

  function ensureLeaderboard() {
    if (leaderboardEl) return leaderboardEl;
    const el = document.createElement('aside');
    el.className = 'xt-lb';
    el.innerHTML = `
      <div class="xt-lb-head">
        <span class="xt-lb-grip">⋮⋮</span>
        <strong class="xt-lb-title">X Tools</strong>
        <div class="xt-lb-controls">
          <label class="xt-lb-hot">
            <span class="xt-lb-hot-label">只看热帖</span>
            <span class="xt-lb-hot-switch">
              <input type="checkbox"${settings.hotOnlyEnabled ? ' checked' : ''}>
              <span class="xt-lb-hot-slider"></span>
            </span>
          </label>
          <button type="button" class="xt-lb-action xt-lb-action-back" title="设置" aria-label="设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
      </div>
      <ul class="xt-lb-list"></ul>
      <div class="xt-lb-resize"></div>
      <div class="xt-lb-resize-v"></div>
    `;
    document.documentElement.appendChild(el);
    leaderboardEl = el;

    el.querySelector('.xt-lb-hot-switch input').addEventListener('change', (e) => {
      settings.hotOnlyEnabled = e.target.checked;
      saveSettings({});
      scheduleRender();
    });

    el.querySelector('.xt-lb-action-back').addEventListener('click', () => {
      const dash = createDashboard();
      const settingsBtn = dash.querySelector('.xt-dashboard-tab-btn[data-tab="settings"]');
      if (settingsBtn) settingsBtn.click();
    });

    // Drag
    const head = el.querySelector('.xt-lb-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.xt-lb-controls') || e.target.closest('.xt-lb-hot')) return;
      e.preventDefault();
      el.classList.add('xt-lb-dragging');
      const rect = el.getBoundingClientRect();
      lbDragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
      };
      el.style.left = rect.left + 'px';
      el.style.right = 'auto';
    });

    // Resize horizontal
    const resizeH = el.querySelector('.xt-lb-resize');
    resizeH.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lbResizeState = { startX: e.clientX, startWidth: el.offsetWidth };
    });

    // Resize vertical
    const resizeV = el.querySelector('.xt-lb-resize-v');
    resizeV.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lbResizeVState = { startY: e.clientY, startHeight: el.querySelector('.xt-lb-list').offsetHeight };
    });

    return el;
  }

  function renderLeaderboard() {
    if (!settings.leaderboardEnabled) {
      if (leaderboardEl) leaderboardEl.style.display = 'none';
      return;
    }
    const el = ensureLeaderboard();
    el.style.display = '';

    const list = el.querySelector('.xt-lb-list');
    const ranked = collectRanked().slice(0, settings.leaderboardCount);

    list.innerHTML = ranked.length
      ? ranked.map((item, index) => leaderboardRow(item, index)).join('')
      : '<li class="xt-lb-empty">等待推文数据…</li>';

    for (const row of list.querySelectorAll('[data-id]')) {
      row.addEventListener('click', () => {
        const target = findArticle(row.dataset.id);
        if (target) {
          target.classList.add('xt-article-linked');
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => target.classList.remove('xt-article-linked'), 2500);
        }
      });
    }
  }

  function collectRanked() {
    const seen = new Set();
    const out = [];
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.hasAttribute('data-xt-rate-hidden')) continue;
      const id = getTweetId(article);
      const data = id && tweetStore.get(id);
      if (!data || data.domOnly || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        data,
        score: computeScore(data),
        label: getDisplayName(article) || data.screenName || data.text,
        preview: (data.text || '').replace(/\s+/g, ' ').slice(0, 30),
      });
    }
    return out.sort((a, b) => b.score.velocity - a.score.velocity);
  }

  function leaderboardRow(item, index) {
    return `<li class="xt-lb-item xt-lb-${item.score.tier}" data-id="${escapeHtml(item.id)}">
      <span class="xt-lb-rank">${index + 1}</span>
      <span class="xt-lb-icon">${item.score.icon}</span>
      <span class="xt-lb-preview">${escapeHtml(item.preview)}</span>
      <span class="xt-lb-vel">${formatRate(item.score.velocity)}/h</span>
    </li>`;
  }

  // ── Dashboard Leaderboard ────────────────────────────────────

  function renderDashboardLeaderboard() {
    if (!dashboardEl || !document.contains(dashboardEl)) return;
    const container = dashboardEl.querySelector('[data-ranked-list]');
    if (!container) return;

    const ranked = collectRanked();

    if (!ranked.length) {
      container.innerHTML = '<div class="xt-dashboard-ranked-empty">等待推文数据…</div>';
      return;
    }

    container.innerHTML = '<ul class="xt-dashboard-ranked-list">'
      + ranked.map((item, i) => {
        const tierClass = `xt-dashboard-ranked--${item.score.tier}`;
        return `<li class="xt-dashboard-ranked-row ${tierClass}" data-id="${escapeHtml(item.id)}">
          <span class="xt-dashboard-ranked-num">${i + 1}</span>
          <span class="xt-dashboard-ranked-badge">${item.score.icon}</span>
          <div class="xt-dashboard-ranked-info">
            <div class="xt-dashboard-ranked-text">${escapeHtml(item.preview || item.label)}</div>
            <div class="xt-dashboard-ranked-meta">
              <span>${escapeHtml(item.label)}</span>
              <span>${formatCompact(item.data.views)} views</span>
            </div>
          </div>
          <span class="xt-dashboard-ranked-vel">${formatRate(item.score.velocity)}/h</span>
        </li>`;
      }).join('')
      + '</ul>';

    for (const row of container.querySelectorAll('[data-id]')) {
      row.addEventListener('click', () => {
        const target = findArticle(row.dataset.id);
        if (target) {
          target.classList.add('xt-article-linked');
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => target.classList.remove('xt-article-linked'), 2500);
          dashboardEl.remove();
          dashboardEl = null;
        }
      });
    }
  }

  // Global pointer/move handlers for drag and resize
  document.addEventListener('pointermove', (e) => {
    if (lbDragState) {
      const dx = e.clientX - lbDragState.startX;
      const dy = e.clientY - lbDragState.startY;
      leaderboardEl.style.left = (lbDragState.origLeft + dx) + 'px';
      leaderboardEl.style.top = (lbDragState.origTop + dy) + 'px';
    }
    if (lbResizeState) {
      const dx = e.clientX - lbResizeState.startX;
      const newW = Math.max(220, Math.min(600, lbResizeState.startWidth + dx));
      leaderboardEl.style.width = newW + 'px';
    }
    if (lbResizeVState) {
      const dy = e.clientY - lbResizeVState.startY;
      const list = leaderboardEl.querySelector('.xt-lb-list');
      const newH = Math.max(120, Math.min(600, lbResizeVState.startHeight + dy));
      list.style.height = newH + 'px';
      list.style.maxHeight = newH + 'px';
    }
  }, true);

  document.addEventListener('pointerup', () => {
    if (lbDragState && leaderboardEl) {
      leaderboardEl.classList.remove('xt-lb-dragging');
      lbDragState = null;
    }
    lbResizeState = null;
    lbResizeVState = null;
  }, true);

  // ── Image viewer ──────────────────────────────────────────────

  function installImageViewer() {
    if (!settings.imageViewerEnabled || document.documentElement.hasAttribute('data-xt-image-viewer')) return;
    document.documentElement.setAttribute('data-xt-image-viewer', '1');
    document.addEventListener('dblclick', (event) => {
      const img = event.target?.closest?.('img[src*="twimg.com/media"]');
      if (!img) return;
      event.preventDefault();
      openImage(img.src.replace(/&name=\w+/, '&name=orig'));
    }, true);
  }

  function openImage(src) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'xt-lightbox';
      lightbox.innerHTML = '<img alt=""><button type="button">×</button>';
      lightbox.querySelector('button').addEventListener('click', () => lightbox.classList.remove('xt-lightbox--open'));
      lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox) lightbox.classList.remove('xt-lightbox--open');
      });
      document.documentElement.appendChild(lightbox);
    }
    lightbox.querySelector('img').src = src;
    lightbox.classList.add('xt-lightbox--open');
  }

  // ── Dashboard ─────────────────────────────────────────────────

  let dashboardEl = null;

  function createDashboard() {
    if (dashboardEl) return dashboardEl;

    dashboardEl = document.createElement('div');
    dashboardEl.className = 'xt-dashboard';
    dashboardEl.innerHTML = `
      <div class="xt-dashboard-header">
        <div class="xt-dashboard-title">
          <h3>X Tools</h3>
          <span class="xt-dashboard-subtitle">实时流速 · 热帖排行</span>
        </div>
        <button class="xt-dashboard-close" type="button" title="关闭" aria-label="关闭">×</button>
      </div>

      <div class="xt-dashboard-tabs">
        <button class="xt-dashboard-tab-btn active" data-tab="leaderboard">排行榜</button>
        <button class="xt-dashboard-tab-btn" data-tab="delete">删除</button>
        <button class="xt-dashboard-tab-btn" data-tab="settings">设置</button>
        <button class="xt-dashboard-tab-btn" data-tab="about">关于</button>
      </div>

      <div class="xt-dashboard-panels">
        <div class="xt-dashboard-panel active" data-panel="leaderboard">
          <div class="xt-dashboard-card">
            <h4>流速排行榜</h4>
            <div class="xt-dashboard-ranked" data-ranked-list></div>
          </div>
          <div class="xt-dashboard-card">
            <h4>设置</h4>
            <div class="xt-dashboard-field">
              <label>显示条数</label>
              <input type="number" data-key="leaderboardCount" min="3" max="30" step="1" value="${settings.leaderboardCount}">
            </div>
            <div class="xt-dashboard-info-box">
              <div class="tier"><span class="icon">🌱</span><span class="label">普通</span><span class="range">&lt; 流速阈值</span></div>
              <div class="tier"><span class="icon">🚀</span><span class="label">热门</span><span class="range">≥ trending /h</span></div>
              <div class="tier"><span class="icon">🔥</span><span class="label">爆帖</span><span class="range">≥ viral /h</span></div>
            </div>
            <div class="xt-dashboard-field">
              <label>热门阈值 / h</label>
              <input type="number" data-key="trendingThreshold" min="1" step="100" value="${settings.trendingThreshold}">
            </div>
            <div class="xt-dashboard-field">
              <label>爆帖阈值 / h</label>
              <input type="number" data-key="viralThreshold" min="1" step="100" value="${settings.viralThreshold}">
            </div>
          </div>
        </div>

        <div class="xt-dashboard-panel" data-panel="settings">
          <div class="xt-dashboard-card">
            <h4>附加功能</h4>
            <div class="xt-dashboard-toggle">
              <span>显示排行榜</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="leaderboardEnabled"${settings.leaderboardEnabled ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-toggle">
              <span>显示书签数</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="showBookmarkCount"${settings.showBookmarkCount ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-toggle">
              <span>Markdown 复制</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="copyMarkdownEnabled"${settings.copyMarkdownEnabled ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-toggle">
              <span>双击图片查看原图</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="imageViewerEnabled"${settings.imageViewerEnabled ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-toggle">
              <span>媒体下载按钮</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="mediaDownloadEnabled"${settings.mediaDownloadEnabled ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-toggle">
              <span>保存下载记录</span>
              <label class="xt-dashboard-switch">
                <input type="checkbox" data-key="mediaSaveHistory"${settings.mediaSaveHistory ? ' checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="xt-dashboard-field">
              <label>媒体文件名模板</label>
              <textarea data-key="mediaFilenamePattern" rows="3">${escapeHtml(settings.mediaFilenamePattern)}</textarea>
            </div>
          </div>
        </div>

        <div class="xt-dashboard-panel" data-panel="delete">
          <div class="xt-dashboard-card">
            <h4>批量删除推文</h4>
            <div class="xt-dashboard-info-box" style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.2);color:#b91c1c;">
              删除操作不可恢复，请谨慎使用。仅在个人主页或 Replies 页面执行。
            </div>
            <div class="xt-dashboard-field" style="margin-top:10px;">
              <label>当前用户名</label>
              <div class="xt-delete-username" style="font-size:13px;color:#24180f;padding:6px 0;">未识别</div>
            </div>
            <div class="xt-dashboard-field">
              <label>删除状态</label>
              <pre class="xt-delete-status" style="white-space:pre-wrap;word-break:break-word;min-height:48px;max-height:140px;overflow:auto;margin:0;padding:8px;background:#f9f3ea;border-radius:8px;font:12px/1.45 inherit;color:#4a3a2e;">等待开始。请先进入个人主页或 Replies 页面。</pre>
            </div>
            <div class="xt-dashboard-field">
              <label>操作</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <button type="button" class="xt-btn xt-btn-danger xt-delete-start" disabled>开始删除</button>
                <button type="button" class="xt-btn xt-delete-stop" disabled>停止</button>
              </div>
            </div>
          </div>
        </div>

        <div class="xt-dashboard-panel" data-panel="about">
          <div class="xt-dashboard-card">
            <h4>X Tools</h4>
            <p class="xt-dashboard-about-text">
              实时流速徽章、热帖排行榜、媒体下载、书签数和 Markdown 复制。<br>
              本地运行，无需登录或 license。
            </p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dashboardEl);

    dashboardEl.querySelectorAll('.xt-dashboard-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        dashboardEl.querySelectorAll('.xt-dashboard-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dashboardEl.querySelectorAll('.xt-dashboard-panel').forEach(p => p.classList.remove('active'));
        dashboardEl.querySelector(`.xt-dashboard-panel[data-panel="${tabName}"]`).classList.add('active');
      });
    });

    dashboardEl.querySelector('.xt-dashboard-close').addEventListener('click', () => {
      dashboardEl.remove();
      dashboardEl = null;
    });

    dashboardEl.addEventListener('input', (event) => {
      const input = event.target.closest('[data-key]');
      if (!input) return;
      const key = input.dataset.key;
      const value = input.type === 'checkbox'
        ? input.checked
        : input.type === 'number'
          ? Number(input.value)
          : input.value;
      saveSettings({ [key]: value });
      scheduleRender();
    });

    wireDeleteTab(dashboardEl);
    return dashboardEl;
  }

  function createDashboardToggleButton() {
    if (document.querySelector('.xt-dashboard-toggle-btn')) return;
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'xt-dashboard-toggle-btn';
    toggleBtn.textContent = 'XT';
    toggleBtn.title = 'X Tools 设置';
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createDashboard();
    });

    (function appendWhenReady() {
      if (document.body) {
        document.body.appendChild(toggleBtn);
      } else {
        requestAnimationFrame(appendWhenReady);
      }
    })();
  }

  // ── Delete X (bulk tweet deleter) ────────────────────────────

  const deleteX = {
    config: {
      maxLoops: 100,
      menuTimeout: 2500,
      confirmTimeout: 3000,
      pageLoadDelay: 1800,
      betweenActionsDelay: 250,
      afterDeleteDelay: 900,
      stuckLimit: 4,
    },
    state: {
      running: false,
      stop: false,
      deleted: 0,
      skipped: 0,
      failures: 0,
      seenTweets: new WeakSet(),
      attempts: new WeakMap(),
      targetUsername: null,
    },
    el: {
      startBtn: null,
      stopBtn: null,
      statusPre: null,
      usernameDiv: null,
    },

    delay(ms) { return new Promise(r => setTimeout(r, ms)); },

    normalizeText(v) { return (v || '').replace(/\s+/g, ' ').trim().toLowerCase(); },

    isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    },

    getTargetUsername() {
      const reserved = new Set(['compose','explore','home','i','messages','notifications','search','settings']);
      const u = location.pathname.split('/').filter(Boolean)[0];
      return (!u || reserved.has(u.toLowerCase())) ? null : u.toLowerCase();
    },

    getTweetUsername(tweet) {
      const block = tweet.querySelector('[data-testid="User-Name"]');
      const link = block?.querySelector('a[href^="/"]:not([href*="/status/"])');
      const u = link?.getAttribute('href')?.split('/').filter(Boolean)[0];
      return u ? u.toLowerCase() : null;
    },

    isTargetTweet(tweet) {
      return deleteX.state.targetUsername && deleteX.getTweetUsername(tweet) === deleteX.state.targetUsername;
    },

    dispatchEscape() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    },

    safeClick(el) {
      if (!el) return;
      const win = el.ownerDocument?.defaultView;
      const Ctor = win?.MouseEvent || MouseEvent;
      for (const ev of ['mouseover', 'mousedown', 'mouseup']) {
        try { el.dispatchEvent(new Ctor(ev, { bubbles: true, cancelable: true, view: win })); }
        catch (_) { el.dispatchEvent(new Ctor(ev, { bubbles: true, cancelable: true })); }
      }
      el.click();
    },

    async waitFor(fn, timeout = 1500, interval = 80) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const r = fn();
        if (r) return r;
        await deleteX.delay(interval);
      }
      return null;
    },

    getVisibleTweets() {
      return [...document.querySelectorAll('article[data-testid="tweet"]')].filter(t => deleteX.isVisible(t) && deleteX.isTargetTweet(t));
    },

    findMenuButton(tweet) {
      const buttons = [...tweet.querySelectorAll('button[data-testid="caret"],button[aria-haspopup="menu"],button[aria-label="More"],button[aria-label="更多"],button[aria-label="More options"]')];
      return buttons.find(b => {
        const label = deleteX.normalizeText(b.getAttribute('aria-label'));
        const tid = b.getAttribute('data-testid');
        const expanded = b.getAttribute('aria-expanded');
        return (tid === 'caret' || label.includes('more') || label.includes('更多')) && expanded !== 'true' && deleteX.isVisible(b);
      });
    },

    getOpenMenu() {
      const menus = [...document.querySelectorAll('div[role="menu"]')].filter(deleteX.isVisible);
      return menus[menus.length - 1] || null;
    },

    findDeleteItem(menu) {
      const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(deleteX.isVisible);
      return items.find(i => {
        const text = deleteX.normalizeText(i.innerText || i.textContent);
        return text.includes('delete') || text.includes('删除');
      });
    },

    findConfirmButton() {
      return ['[data-testid="confirmationSheetConfirm"]','[data-testid="tweetButton"]','button[role="button"]']
        .flatMap(s => [...document.querySelectorAll(s)])
        .find(b => {
          const text = deleteX.normalizeText(b.innerText || b.textContent);
          const tid = b.getAttribute('data-testid');
          return deleteX.isVisible(b) && (tid === 'confirmationSheetConfirm' || text === 'delete' || text === '删除');
        });
    },

    async openMenu(tweet, btn) {
      tweet.scrollIntoView({ behavior: 'instant', block: 'center' });
      await deleteX.delay(deleteX.config.betweenActionsDelay);
      deleteX.safeClick(btn);
      let menu = await deleteX.waitFor(deleteX.getOpenMenu, deleteX.config.menuTimeout);
      if (menu) return menu;
      deleteX.dispatchEscape();
      await deleteX.delay(deleteX.config.betweenActionsDelay);
      deleteX.safeClick(btn);
      return deleteX.waitFor(deleteX.getOpenMenu, deleteX.config.menuTimeout);
    },

    async deleteTweet(tweet) {
      const { state } = deleteX;
      if (state.seenTweets.has(tweet)) return 'seen';
      const attempts = state.attempts.get(tweet) || 0;
      if (attempts >= 3) { state.seenTweets.add(tweet); return 'max-attempts'; }
      state.attempts.set(tweet, attempts + 1);

      const btn = deleteX.findMenuButton(tweet);
      if (!btn) { state.seenTweets.add(tweet); return 'no-menu'; }

      const menu = await deleteX.openMenu(tweet, btn);
      if (!menu) return 'menu-fail';

      const delItem = await deleteX.waitFor(() => deleteX.findDeleteItem(menu), deleteX.config.menuTimeout);
      if (!delItem) { deleteX.dispatchEscape(); return 'no-delete-option'; }
      deleteX.safeClick(delItem);

      const confirmBtn = await deleteX.waitFor(deleteX.findConfirmButton, deleteX.config.confirmTimeout);
      if (!confirmBtn) { deleteX.dispatchEscape(); return 'no-confirm'; }
      deleteX.safeClick(confirmBtn);
      await deleteX.waitFor(() => !document.body.contains(tweet) || !deleteX.isVisible(tweet), 2500);
      await deleteX.delay(deleteX.config.afterDeleteDelay);

      state.deleted++;
      state.seenTweets.add(tweet);
      return 'deleted';
    },

    async processTweets() {
      const tweets = deleteX.getVisibleTweets();
      let pass = 0;
      deleteX.updateStatus(`找到 ${tweets.length} 条可见推文`);
      for (const tweet of tweets) {
        if (deleteX.state.stop) break;
        try {
          const r = await deleteX.deleteTweet(tweet);
          if (r === 'deleted') { pass++; deleteX.updateStatus(`已删除第 ${deleteX.state.deleted} 条`); }
          else if (r !== 'seen') { deleteX.state.skipped++; deleteX.updateStatus(`跳过：${r}`); }
        } catch (err) {
          deleteX.state.failures++;
          deleteX.updateStatus(`删除失败：${err.message}`);
          deleteX.dispatchEscape();
          await deleteX.delay(deleteX.config.afterDeleteDelay);
        }
      }
      return pass;
    },

    scrollMore(i) {
      const base = Math.max(window.innerHeight * 0.9, 700);
      const boost = Math.floor(deleteX.state.deleted / 5) * 300 + Math.min(i * 80, 800);
      window.scrollBy({ top: base + boost, behavior: 'smooth' });
    },

    updateStatus(msg) {
      if (!deleteX.el.statusPre) return;
      const s = deleteX.state;
      deleteX.el.statusPre.textContent = `${msg}\n已删除: ${s.deleted} | 跳过: ${s.skipped} | 失败: ${s.failures}`;
    },

    updateButtons() {
      const { startBtn, stopBtn } = deleteX.el;
      if (!startBtn || !stopBtn) return;
      const running = deleteX.state.running;
      startBtn.disabled = running;
      stopBtn.disabled = !running;
      startBtn.textContent = running ? '运行中…' : '开始删除';
    },

    refreshUsername() {
      if (!deleteX.el.usernameDiv) return;
      deleteX.state.targetUsername = deleteX.getTargetUsername();
      deleteX.el.usernameDiv.textContent = deleteX.state.targetUsername ? `@${deleteX.state.targetUsername}` : '未识别（请进入个人主页或 Replies 页面）';
      deleteX.el.startBtn.disabled = !deleteX.state.targetUsername || deleteX.state.running;
    },

    async start() {
      if (deleteX.state.running) return;
      const ok = window.confirm('即将开始删除当前页面可见的推文/回复。\n\n删除不可恢复。确认要开始吗？');
      if (!ok) return;

      deleteX.state.stop = false;
      deleteX.state.deleted = 0;
      deleteX.state.skipped = 0;
      deleteX.state.failures = 0;
      deleteX.state.seenTweets = new WeakSet();
      deleteX.state.attempts = new WeakMap();
      deleteX.refreshUsername();
      if (!deleteX.state.targetUsername) {
        deleteX.updateStatus('无法识别用户名，请进入个人主页或 Replies 页面');
        return;
      }

      deleteX.state.running = true;
      deleteX.updateButtons();
      deleteX.updateStatus(`开始执行，目标：@${deleteX.state.targetUsername}`);

      let stuck = 0, prevH = document.body.scrollHeight;
      try {
        for (let i = 0; i < deleteX.config.maxLoops && !deleteX.state.stop; i++) {
          const pass = await deleteX.processTweets();
          const curH = document.body.scrollHeight;
          stuck = (pass === 0 && curH <= prevH) ? stuck + 1 : 0;
          if (stuck >= deleteX.config.stuckLimit) { deleteX.updateStatus('连续无进展，已自动停止'); break; }
          prevH = curH;
          deleteX.scrollMore(i);
          await deleteX.delay(deleteX.config.pageLoadDelay);
        }
        deleteX.updateStatus(`完成：已删除 ${deleteX.state.deleted} 条，跳过 ${deleteX.state.skipped} 条，失败 ${deleteX.state.failures} 次`);
      } finally {
        deleteX.state.running = false;
        deleteX.state.stop = false;
        deleteX.updateButtons();
      }
    },

    stop() {
      deleteX.state.stop = true;
      deleteX.dispatchEscape();
      deleteX.updateStatus('收到停止信号，正在结束…');
    },
  };

  // ── Wire up delete tab UI ────────────────────────────────────

  function wireDeleteTab(dash) {
    const startBtn = dash.querySelector('.xt-delete-start');
    const stopBtn = dash.querySelector('.xt-delete-stop');
    const statusPre = dash.querySelector('.xt-delete-status');
    const usernameDiv = dash.querySelector('.xt-delete-username');
    deleteX.el = { startBtn, stopBtn, statusPre, usernameDiv };

    startBtn.addEventListener('click', () => deleteX.start());
    stopBtn.addEventListener('click', () => deleteX.stop());

    deleteX.refreshUsername();
    deleteX.updateButtons();
  }

  // ─ Helpers ───────────────────────────────────────────────────

  function getTweetId(article) {
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return '';
  }

  function findArticle(id) {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].find((article) => getTweetId(article) === id);
  }

  function getDisplayName(article) {
    return article.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || '';
  }

  function getHandle(article) {
    const text = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
    return text.match(/@([A-Za-z0-9_]+)/)?.[1] || '';
  }

  function getArticleText(article) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')].map((el) => el.innerText).join('\n').trim();
  }

  function buildMarkdown(article, data) {
    const handle = data.screenName || getHandle(article);
    const url = handle && data.id ? `https://x.com/${handle}/status/${data.id}` : location.href;
    return `> ${data.text || getArticleText(article)}\n\n- ${handle ? `@${handle}` : 'X'}\n- ${formatCompact(data.views)} views, ${formatCompact(data.likes)} likes, ${formatCompact(data.retweets)} reposts, ${formatCompact(data.bookmarks)} bookmarks\n- ${url}`;
  }

  function buildMediaFilename(data, media, index) {
    const pattern = String(settings.mediaFilenamePattern || DEFAULTS.mediaFilenamePattern).replace(/\s+/g, ' ').trim();
    const originalName = media.originalName || media.url.split('/').pop().split(/[:?]/)[0] || `media-${index + 1}`;
    const ext = originalName.includes('.') ? originalName.split('.').pop() : (media.type === 'photo' ? 'jpg' : 'mp4');
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const replacements = {
      'status-id': data.id,
      'user-name': sanitizeFilenamePart(data.name || data.screenName || 'x'),
      'user-id': sanitizeFilenamePart(data.screenName || 'unknown'),
      'date-time': formatDateToken(data.createdAt, 'YYYYMMDD-hhmmss'),
      'date-time-local': formatDateToken(data.createdAt, 'YYYYMMDD-hhmmss', true),
      'full-text': sanitizeFilenamePart((data.text || '').replace(/\s*https:\/\/t\.co\/\w+/g, '').slice(0, 80)),
      'file-type': media.type || 'media',
      'file-name': sanitizeFilenamePart(baseName),
      'file-ext': ext,
    };
    let filename = pattern.replace(/\{date-time(?:-local)?:([^{}]+)\}/g, (match, format) => {
      const isLocal = match.startsWith('{date-time-local');
      return formatDateToken(data.createdAt, sanitizeFilenamePart(format), isLocal);
    });
    filename = filename.replace(/\{([^{}:]+)(:[^{}]+)?\}/g, (_match, name) => replacements[name] ?? '');
    if (data.media.length > 1 && !pattern.includes('{file-name}')) filename += `-${index + 1}`;
    filename = `${sanitizeFilenamePart(filename.replace(new RegExp(`\\.?${ext}$`, 'i'), ''))}.${ext}`;
    return filename;
  }

  function sanitizeFilenamePart(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]/g, (char) => ({ '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' }[char]))
      .replace(/[​-‍⁠﻿]/g, '')
      .trim() || 'untitled';
  }

  function formatDateToken(input, format, local = false) {
    const date = input ? new Date(input) : new Date();
    if (!Number.isFinite(date.getTime())) return formatDateToken(new Date().toISOString(), format, local);
    const d = local ? new Date(date.getTime() - date.getTimezoneOffset() * 60000) : date;
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const values = {
      YYYY: String(d.getUTCFullYear()),
      YY: String(d.getUTCFullYear()).slice(-2),
      MM: String(d.getUTCMonth() + 1).padStart(2, '0'),
      MMM: months[d.getUTCMonth()],
      DD: String(d.getUTCDate()).padStart(2, '0'),
      hh: String(d.getUTCHours()).padStart(2, '0'),
      mm: String(d.getUTCMinutes()).padStart(2, '0'),
      ss: String(d.getUTCSeconds()).padStart(2, '0'),
      h2: String(d.getUTCHours() % 12 || 12).padStart(2, '0'),
      ap: d.getUTCHours() < 12 ? 'AM' : 'PM',
    };
    return format.replace(/YYYY|YY|MMM|MM|DD|hh|mm|ss|h2|ap/g, (token) => values[token]);
  }

  function tooltipText(data, score) {
    return [
      `Views: ${formatCompact(data.views)}`,
      `Likes: ${formatCompact(data.likes)}`,
      `Reposts: ${formatCompact(data.retweets)}`,
      `Replies: ${formatCompact(data.replies)}`,
      `Bookmarks: ${formatCompact(data.bookmarks)}`,
      `Velocity: ${formatRate(score.velocity)}/h`,
      `Viral score: ${score.value}/100`,
    ].join('\n');
  }

  function showTooltip(anchor, text) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'xt-tooltip';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
    const rect = anchor.getBoundingClientRect();
    tooltipEl.style.left = `${Math.max(8, rect.left)}px`;
    tooltipEl.style.top = `${rect.bottom + 8}px`;
    tooltipEl.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function formatRate(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(Math.round(value));
  }

  function formatCompact(value) {
    return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─ Init ──────────────────────────────────────────────────────

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', scheduleRender, { passive: true });
  window.addEventListener('popstate', () => { if (deleteX.el.usernameDiv) deleteX.refreshUsername(); });

  readSettings();
  createDashboardToggleButton();
})();
