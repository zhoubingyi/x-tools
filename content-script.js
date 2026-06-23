// content-script.js — ISOLATED world: UI rendering, dashboard, leaderboard
(() => {
  "use strict";

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
  let dashboardEl = null;

  // Drag / resize state for leaderboard
  let lbDragState = null;
  let lbResizeState = null;
  let lbResizeVState = null;

  // ── Storage (chrome.storage.sync wrappers) ────────────────────

  function readSettings() {
    chrome.storage.sync.get({ [STORAGE_KEY]: null }, (result) => {
      settings = { ...DEFAULTS, ...(result[STORAGE_KEY] || {}) };
      scheduleRender();
    });
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      settings = { ...DEFAULTS, ...(changes[STORAGE_KEY].newValue || {}) };
      scheduleRender();
    }
  });

  // ── Tweet data from hook (postMessage) ────────────────────────

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
          chrome.runtime.sendMessage(
            { type: 'XT_DOWNLOAD', url: task.url, filename: task.filename },
            (response) => {
              if (response?.error) reject(new Error(response.error));
              else resolve();
            }
          );
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
      chrome.storage.sync.get({ [DOWNLOAD_HISTORY_KEY]: [] }, (result) => {
        resolve(Array.isArray(result[DOWNLOAD_HISTORY_KEY]) ? result[DOWNLOAD_HISTORY_KEY] : []);
      });
    });
  }

  function setDownloadHistory(history) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [DOWNLOAD_HISTORY_KEY]: history }, resolve);
    });
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
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
              <div class="tier"><span class="icon">\u{1F331}</span><span class="label">普通</span><span class="range">&lt; 流速阈值</span></div>
              <div class="tier"><span class="icon">\u{1F680}</span><span class="label">热门</span><span class="range">≥ trending /h</span></div>
              <div class="tier"><span class="icon">\u{1F525}</span><span class="label">爆帖</span><span class="range">≥ viral /h</span></div>
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

  try {
    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('popstate', () => { if (deleteX.el.usernameDiv) deleteX.refreshUsername(); });

    readSettings();
    createDashboardToggleButton();
  } catch (err) {
    console.error('[X Tools] init error:', err);
  }
})();
