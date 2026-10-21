/**
 * Script injected into every frame of the in-app browser (iOS runs it in iframes
 * too; Android only in the top frame). It reports back to the app:
 *
 * - `media`: URLs that look like a video file or HLS playlist, seen in network
 *   requests (fetch/XHR), <video> sources, resource timing, or URLs mentioned in
 *   JSON/text responses and inline scripts.
 * - `servers`: (top frame only) embedded players: iframe sources plus the
 *   "select a mirror" dropdowns that anime sites hide as base64-encoded iframes.
 * - `page`: (top frame only) the page title, used to guess show/episode names.
 *
 * Kept as plain ES2017 in a string so it runs unchanged in any WebView.
 */
export const DETECTOR_JS = String.raw`
(function () {
  if (window.__vidstash) return;
  window.__vidstash = true;

  var isTop = false;
  try { isTop = window.top === window; } catch (e) { isTop = false; }

  function post(msg) {
    var s = JSON.stringify(msg);
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(s);
        return;
      }
      // In iframes on iOS the RN shim isn't defined, but the native handler is.
      var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView;
      if (h) h.postMessage(s);
    } catch (e) {}
  }

  var HLS = /\.m3u8(?:$|[?#&])/i;
  var FILE = /\.(?:mp4|m4v|webm|mov|mkv)(?:$|[?#&])/i;
  // Pieces of a stream rather than whole videos.
  var SEGMENT = /(?:\.ts|\.m4s|\.aac|\.vtt)(?:$|[?#])|(?:^|[\/_\-.])(?:seg|segment|chunk|frag|fragment)[\-_]?\d+|\/init[\-_.][^\/]*\.mp4|[?&](?:bytestart|range)=/i;
  // Common non-content videos: ads, previews, thumbnails.
  var JUNK = /(?:^|[\/_\-.?=])(?:ads?|vast|preroll|preview|thumb|thumbnail|sprite|storyboard|trailer|banner|logo|intro-anim)(?:[\/_\-.?=&]|$)/i;

  var seen = {};

  function absolute(u) {
    try { return new URL(u, location.href).href; } catch (e) { return null; }
  }

  function classify(url, contentType) {
    var ct = (contentType || '').toLowerCase();
    // Only the path counts: query strings often echo page titles like "ep 60.mp4".
    var path;
    try { path = new URL(url).pathname; } catch (e) { return null; }
    if (ct.indexOf('mpegurl') >= 0 || HLS.test(path)) return 'hls';
    if (SEGMENT.test(path) || SEGMENT.test(url)) return null;
    if (ct.indexOf('video/') === 0 || FILE.test(path)) return 'file';
    return null;
  }

  function report(raw, via, contentType) {
    if (!raw || typeof raw !== 'string') return;
    if (raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0) return;
    var url = absolute(raw);
    if (!url || !/^https?:/i.test(url)) return;
    var kind = classify(url, contentType);
    if (!kind) return;
    if (JUNK.test(new URL(url).pathname)) return;
    var key = kind + ' ' + url;
    if (seen[key]) return;
    seen[key] = true;
    post({ type: 'media', url: url, kind: kind, via: via, frame: location.href });
  }

  // URLs mentioned inside JSON/JS text, e.g. a player config listing qualities.
  var URL_IN_TEXT = /https?:\\?\/\\?\/[^\s"'<>\\]+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^\s"'<>\\]*)?(?=["'\s<>\\]|$)/gi;
  function scanText(text, via) {
    if (!text || typeof text !== 'string' || text.length > 2000000) return;
    // Undo JSON escaping so URLs come out whole: \/ -> /, \u0026 -> &, &amp; -> &.
    text = text.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
    var m = text.match(URL_IN_TEXT);
    if (!m) return;
    for (var i = 0; i < m.length && i < 50; i++) report(m[i], via);
  }

  function isTextual(ct) {
    ct = (ct || '').toLowerCase();
    // Never live streams (server-sent events, NDJSON feeds): reading them never ends.
    if (ct.indexOf('event-stream') >= 0 || ct.indexOf('ndjson') >= 0 || ct.indexOf('stream+json') >= 0) return false;
    return ct.indexOf('json') >= 0 || ct.indexOf('javascript') >= 0 || ct.indexOf('text/') === 0;
  }

  // fetch
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var reqUrl = typeof input === 'string' ? input : input && input.url;
      report(reqUrl, 'fetch');
      var p = origFetch.apply(this, arguments);
      p.then(function (res) {
        try {
          var ct = res.headers.get('content-type');
          report(res.url || reqUrl, 'fetch', ct);
          if (isTextual(ct) && ct.indexOf('mpegurl') < 0) {
            res.clone().text().then(function (t) { scanText(t, 'response'); }, function () {});
          }
        } catch (e) {}
      }, function () {});
      return p;
    };
  }

  // XMLHttpRequest
  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vsUrl = url;
    report(url, 'xhr');
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener('readystatechange', function () {
      try {
        if (xhr.readyState === 2) {
          report(xhr.responseURL || xhr.__vsUrl, 'xhr', xhr.getResponseHeader('content-type'));
        } else if (xhr.readyState === 4) {
          var ct = xhr.getResponseHeader('content-type');
          if (isTextual(ct) && (xhr.responseType === '' || xhr.responseType === 'text')) scanText(xhr.responseText, 'response');
        }
      } catch (e) {}
    });
    return XS.apply(this, arguments);
  };

  // <video>/<source> elements
  function checkMedia(el) {
    if (!el) return;
    report(el.currentSrc || el.src, 'video');
    if (el.querySelectorAll) {
      var sources = el.querySelectorAll('source');
      for (var i = 0; i < sources.length; i++) report(sources[i].src, 'video');
    }
  }
  ['loadstart', 'loadedmetadata', 'play'].forEach(function (evt) {
    document.addEventListener(evt, function (e) { checkMedia(e.target); }, true);
  });
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) { report(v, 'video'); return desc.set.call(this, v); },
      });
    }
  } catch (e) {}

  // Resource timing catches requests made by native players and other paths we don't hook.
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) { report(entry.name, 'resource'); });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  function decodeBase64(s) {
    try {
      var bin = atob(s);
      try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
    } catch (e) { return null; }
  }

  function srcFromHtml(html) {
    var m = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    return m ? m[1] : null;
  }

  // Link shorteners and ad networks that sit in iframes but never play the episode.
  var NOT_PLAYERS = /(^|\.)(t\.co|bit\.ly|doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|facebook\.com|twitter\.com|x\.com|disqus\.com)$/i;

  function isMirrorPicker(option) {
    var select = option.closest && option.closest('select');
    if (!select) return false;
    var hint = (select.className + ' ' + select.name + ' ' + select.id + ' ' + (select.getAttribute('aria-label') || '')).toLowerCase();
    return /mirror|server|player|source|embed/.test(hint);
  }

  var lastServers = '';
  function collectServers() {
    var servers = [];
    var urls = {};
    function add(label, src) {
      var url = absolute(src);
      if (!url || !/^https?:/i.test(url) || urls[url]) return;
      urls[url] = true;
      servers.push({ label: (label || '').replace(/\s+/g, ' ').trim() || new URL(url).hostname, url: url });
    }
    // Mirror pickers: <option value="base64 of an <iframe> tag">Server name</option>,
    // or (another theme) <select class="mirror"><option value="https://site/episode/v/2/">.
    var options = document.querySelectorAll('option[value]');
    for (var i = 0; i < options.length; i++) {
      var v = options[i].value;
      if (!v || v.length < 20) continue;
      var html = /^[A-Za-z0-9+\/=\s]+$/.test(v) ? decodeBase64(v) : v;
      var src = html && srcFromHtml(html);
      if (src) add(options[i].textContent, src);
      else if (/^https?:\/\//i.test(v) && isMirrorPicker(options[i])) add(options[i].textContent, v);
    }
    // The page's current player: the biggest iframe, if it looks like one.
    var best = null, bestArea = 0;
    var frames = document.querySelectorAll('iframe[src]');
    for (var j = 0; j < frames.length; j++) {
      var r = frames[j].getBoundingClientRect();
      if (r.width < 200 || r.height < 110) continue; // hidden and ad-sized frames
      if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = frames[j]; }
    }
    var bestUrl = best && absolute(best.src);
    if (bestUrl && !NOT_PLAYERS.test(new URL(bestUrl).hostname)) {
      add('Current player · ' + new URL(bestUrl).hostname, best.src);
    }
    var json = JSON.stringify(servers);
    if (json !== lastServers) {
      lastServers = json;
      post({ type: 'servers', servers: servers });
    }
  }

  // Season pages list every episode (".eplister" in the animestream theme); episode pages
  // link to that list ("All Episodes"). Both feed "Download several".
  var lastEpisodes = '';
  function collectEpisodes() {
    var links = document.querySelectorAll('.eplister li a[href], .episodelist li a[href], ul.episodios li a[href]');
    var episodes = [];
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var url = absolute(a.getAttribute('href'));
      if (!url || seen[url]) continue;
      seen[url] = true;
      var num = a.querySelector('.epl-num, .epl-no, .numerando');
      var title = a.querySelector('.epl-title, .playinfo h3, .eptitle, .episodiotitle');
      episodes.push({
        url: url,
        num: ((num && num.textContent) || '').replace(/\s+/g, ' ').trim(),
        title: ((title && title.textContent) || a.textContent || '').replace(/\s+/g, ' ').trim()
      });
    }
    var all = document.querySelector('a[aria-label="All Episodes"], .naveps .nvsc a[href]');
    var heading = document.querySelector('h1.entry-title, .infox h1, h1');
    var msg = {
      type: 'episodes',
      series: ((heading && heading.textContent) || '').replace(/\s+/g, ' ').trim(),
      listUrl: episodes.length >= 2 ? location.href : (all && absolute(all.getAttribute('href'))) || null,
      episodes: episodes.length >= 2 ? episodes : []
    };
    if (!msg.listUrl) return;
    var json = JSON.stringify(msg);
    if (json !== lastEpisodes) {
      lastEpisodes = json;
      post(msg);
    }
  }

  function scanInlineScripts() {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) scanText(scripts[i].textContent, 'page');
    // Players that keep their config in an attribute (ok.ru uses data-options).
    var configs = document.querySelectorAll('[data-options],[data-config],[data-setup],[data-video],[data-module="OKVideo"]');
    for (var j = 0; j < configs.length; j++) {
      var attrs = configs[j].attributes;
      for (var k = 0; k < attrs.length; k++) if (attrs[k].name.indexOf('data-') === 0) scanText(attrs[k].value, 'page');
    }
  }

  var timer = null;
  function onDomChange() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (isTop) {
        collectServers();
        collectEpisodes();
        post({ type: 'page', title: document.title, url: location.href });
      }
      var videos = document.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) checkMedia(videos[i]);
    }, 400);
  }

  function start() {
    scanInlineScripts();
    onDomChange();
    try {
      new MutationObserver(onDomChange).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
true;
`;

/**
 * Switches the page's player to another mirror. It prefers the site's own mirror
 * picker, so the player loads embedded with the referrer it expects; if that
 * doesn't swap the player, it replaces the biggest iframe's src directly.
 */
export function switchServerJs(url: string): string {
  return String.raw`
(function (target) {
  function decode(v) {
    try { var b = atob(v); try { return decodeURIComponent(escape(b)); } catch (e) { return b; } } catch (e) { return v; }
  }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return null; } }
  function srcOf(v) {
    var html = /^[A-Za-z0-9+\/=\s]+$/.test(v) ? decode(v) : v;
    var m = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html || '');
    return m ? abs(m[1]) : null;
  }
  function biggestFrame() {
    var best = null, area = 0;
    document.querySelectorAll('iframe').forEach(function (f) {
      var r = f.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = f; }
    });
    return best;
  }
  var pageLink = false;
  var options = document.querySelectorAll('option[value]');
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    if (opt.value && opt.value.length >= 20 && (srcOf(opt.value) === target || abs(opt.value) === target)) {
      // A plain page link: the site navigates there itself, so there's no iframe to fix up afterwards.
      pageLink = srcOf(opt.value) !== target;
      var select = opt.closest('select');
      if (select) {
        select.value = opt.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;
    }
  }
  setTimeout(function () {
    if (pageLink) return;
    var already = Array.prototype.some.call(document.querySelectorAll('iframe'), function (f) { return abs(f.src) === target; });
    if (!already) {
      var f = biggestFrame();
      if (f) f.src = target;
    }
    var shown = biggestFrame();
    if (shown) shown.scrollIntoView({ block: 'center' });
  }, 800);
  return 'ok';
})(${JSON.stringify(url)});
true;
`;
}

/**
 * For the hidden browser behind season downloads only: nobody is there to press
 * play, and some players (Odysee) don't load their stream until playback
 * starts. Starts any video muted and presses the usual big play buttons, for
 * the first 30 seconds of each frame.
 */
export const AUTOPLAY_JS = String.raw`
(function () {
  if (window.__vsAutoplay) return;
  window.__vsAutoplay = true;
  var BUTTONS = '.vjs-big-play-button, .plyr__control--overlaid, .jw-display-icon-container, .jw-icon-display, ' +
    '.dmp_StartView, .np_ButtonPlay, button[aria-label^="Play"], button[title^="Play"], [class*="play-button"], [class*="PlayButton"]';
  var started = Date.now();
  var timer = setInterval(function () {
    if (Date.now() - started > 30000) return clearInterval(timer);
    try {
      var videos = document.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        v.muted = true;
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      }
      if (videos.length === 0 || videos[0].paused) {
        var b = document.querySelector(BUTTONS);
        if (b) b.click();
      }
    } catch (e) {}
  }, 1500);
})();
true;
`;
