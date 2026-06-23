(() => {
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
})();
