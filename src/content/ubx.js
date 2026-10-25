/*
 * ubx.js - theme bootstrap and page shell (isolated world, document_start).
 *
 * Loaded last (see manifest.json): the feature modules have already registered
 * their hooks, decorate.js dispatches them. This file owns everything that is
 * not a single feature:
 *
 *   - activation: sets html[data-ubx] (every CSS rule is scoped to it) and
 *     html[data-ubx-theme="dark"], so the theme never leaks to other sites,
 *   - view detection: writes html[data-ubx-view] ("status", "logs", ...) and
 *     fires ubx:view / ubx:render after UrBackup swaps #data_f,
 *   - the view entrance: a new section is held transparent until its layout
 *     stopped moving (DataTables measures, jqplot re-creates), then faded in,
 *     so a switch never shows the intermediate layout,
 *   - settings: reads chrome.storage.sync["ubxSettings"] and re-broadcasts
 *     changes as ubx:settings (decorate.js re-runs the features),
 *   - the bridge inbox: session / language / getJSON payloads from bridge.main.js,
 *   - the on/off state: chrome.storage.local["ubxPaused"] (written by the
 *     toolbar icon through src/background/sw.js) makes the page stand down,
 *   - the kill switch (?ubx=off and Ctrl+Alt+U).
 *
 * Contract : chrome.storage.sync, chrome.storage.local, chrome.runtime, window
 *            messages from bridge.main.js ({ __ubx: true, source: 'page' }).
 * Marks    : html[data-ubx], [data-ubx-theme], [data-ubx-view], [data-ubx-login],
 *            [data-ubx-lang], [data-ubx-id], [data-ubx-version], .ubx-footer,
 *            #data_f.ubx-view-pending / .ubx-view-enter (the view entrance).
 * Settings : the whole "ubxSettings" record.
 * Safety   : any failure must leave the stock UI usable - every entry point
 *            catches its own errors and deactivate() removes all markers.
 */
(function () {
  'use strict';

  var html = document.documentElement;
  /* Two entry points can load this file on the same page: the registered
     content script at document_start and a late scripting.executeScript from
     the service worker (first visit on a newly enabled server). The feature
     modules push their hooks unconditionally, so a second run would double every
     listener - boot once per document. */
  if (window.__ubxBooted) return;
  window.__ubxBooted = true;
  var STORAGE_KEY = 'ubxSettings';
  var DEFAULTS = {
    features: {
      chips: true,
      sticky: true,
      hotkeys: true,
      emptyStates: true,
      icons: true,
      files: true,
      loginBrand: true
    }
  };

  var state = {
    settings: DEFAULTS,
    session: null,
    lang: null,
    lastData: null
  };

  window.__ubxState = state;

  function isUrBackupPage() {
    return document.title.indexOf('UrBackup') !== -1 || !!document.getElementById('data_div');
  }

  function killed() {
    try {
      return new URLSearchParams(location.search).get('ubx') === 'off' || sessionStorage.getItem('ubx-off') === '1';
    } catch (e) {
      return false;
    }
  }

  /* The theme is dark only. data-ubx-theme stays as a marker for CSS rules and
     for the test harness; ?ubx-theme=... is intentionally ignored. */
  function applyTheme() {
    html.setAttribute('data-ubx-theme', 'dark');
  }

  /* UrBackup listens on 55414 by default. On that port the theme is applied
     before the first paint (no light flash); on any other port the page is
     checked first, because the content script also runs on unrelated apps
     served from localhost and must not restyle them. */
  function onDefaultPort() {
    try {
      return location.port === '55414';
    } catch (e) {
      return false;
    }
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function markActive() {
    html.setAttribute('data-ubx', '1');
    html.setAttribute('data-ubx-version', chrome.runtime.getManifest().version);
    try {
      /* lets the smoke suite open chrome-extension://<id>/... pages */
      html.setAttribute('data-ubx-id', chrome.runtime.id);
    } catch (e) {
      /* runtime unavailable - not fatal */
    }
    applyTheme();
    start();
  }

  function activate() {
    if (killed()) return;
    whenPaused(function (paused) {
      if (paused) return;
      if (onDefaultPort()) {
        markActive();
        /* a page on the default port that is not UrBackup still has to be undone */
        whenReady(function () {
          if (!isUrBackupPage()) deactivate();
        });
        return;
      }
      whenReady(function () {
        if (killed()) return;
        if (isUrBackupPage()) markActive();
      });
    });
  }

  /* The toolbar icon switches the theme per origin and the state lives in
     chrome.storage.local (src/shared/registry.js owns the key, the worker writes
     it). localhost / 127.0.0.1 are declared in manifest.json and cannot be
     unregistered, so the page itself has to stand down. The read is async, but
     it resolves at document_start long before the first paint, and data-ubx -
     the attribute every CSS rule hangs on - is only set afterwards, so a paused
     origin never flashes the theme. */
  var PAUSED_KEY = 'ubxPaused';

  function originPattern() {
    try {
      return location.origin + '/*';
    } catch (e) {
      return '';
    }
  }

  function whenPaused(cb) {
    var done = false;
    function finish(paused) {
      if (done) return;
      done = true;
      cb(paused);
    }
    try {
      chrome.storage.local.get(PAUSED_KEY, function (res) {
        var list = (res && res[PAUSED_KEY]) || [];
        finish(Array.isArray(list) && list.indexOf(originPattern()) !== -1);
      });
    } catch (e) {
      finish(false);
    }
    /* a storage hiccup must not leave the page unthemed for good */
    setTimeout(function () {
      finish(false);
    }, 700);
  }

  function deactivate() {
    html.removeAttribute('data-ubx');
    html.removeAttribute('data-ubx-theme');
    html.removeAttribute('data-ubx-view');
    html.removeAttribute('data-ubx-login');
    html.removeAttribute('data-ubx-id');
    html.removeAttribute('data-ubx-version');
    html.removeAttribute('data-ubx-lang');
    enterView = null;
    if (gateTimer) clearTimeout(gateTimer);
    gateTimer = null;
    var data = document.getElementById('data_f');
    if (data) {
      data.classList.remove('ubx-view-enter');
      data.classList.remove('ubx-view-pending');
    }
    var links = document.querySelectorAll('#main_nav a[aria-current]');
    for (var i = 0; i < links.length; i++) links[i].removeAttribute('aria-current');
  }

  /* ---- settings ---- */
  function readSettings(stored) {
    return {
      features: Object.assign({}, DEFAULTS.features, (stored && stored.features) || {})
    };
  }

  function announceSettings() {
    document.dispatchEvent(new CustomEvent('ubx:settings', { detail: state.settings }));
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(STORAGE_KEY, function (res) {
        state.settings = readSettings(res && res[STORAGE_KEY]);
        announceSettings();
      });
    } catch (e) {
      /* storage unavailable - keep defaults */
    }
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      var next = changes[STORAGE_KEY].newValue;
      if (!next) return;
      state.settings = readSettings(next);
      announceSettings();
    });
  } catch (e) {
    /* ignore */
  }

  /* ---- bridge messages ---- */
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var msg = event.data;
    if (!msg || msg.__ubx !== true || msg.source !== 'page') return;

    if (msg.type === 'session') {
      state.session = msg.payload;
    } else if (msg.type === 'language') {
      state.lang = msg.payload;
      html.setAttribute('data-ubx-lang', msg.payload);
    } else if (msg.type === 'data') {
      state.lastData = msg.payload;
      document.dispatchEvent(new CustomEvent('ubx:data', { detail: msg.payload }));
    }
  });

  /* ---- page chrome ---- */
  /* The footer is a body-level div with an inline `position: relative;
     margin-top: -4em; height: 4em`. Find it through the language selector it
     contains (#change_lang_select) - that is stable across server builds, the
     inline style string is not - and fall back to the style scan. Note that the
     inline `position` needs an !important in theme.css to be overridden. */
  function markFooter() {
    var anchor = document.getElementById('change_lang_select');
    var node = anchor;
    while (node && node.parentNode && node.parentNode !== document.body) node = node.parentNode;
    if (node && node !== document.body) {
      node.classList.add('ubx-footer');
      return;
    }
    var nodes = document.querySelectorAll('body > div');
    for (var i = 0; i < nodes.length; i++) {
      var style = (nodes[i].getAttribute('style') || '').replace(/\s+/g, ' ');
      if (style.indexOf('height: 4em') !== -1 || style.indexOf('height:4em') !== -1) {
        nodes[i].classList.add('ubx-footer');
        return;
      }
    }
  }

  /* The tab bar is eight items long and is rebuilt on every view switch, so a
     keyboard user would walk it again and again. One link at the top of the
     body jumps straight to the content; #data_f becomes the focus target
     (tabindex -1) so the jump also moves the caret, not just the scroll. */
  function markSkipLink() {
    try {
      if (document.querySelector('.ubx-skip')) return;
      var data = document.getElementById('data_f');
      if (!data) return;
      if (!data.getAttribute('tabindex')) data.setAttribute('tabindex', '-1');
      var link = document.createElement('a');
      link.className = 'ubx-skip';
      link.href = '#data_f';
      link.textContent = 'Skip to content';
      document.body.insertBefore(link, document.body.firstChild);
    } catch (e) {
      /* the page keeps working without the shortcut */
    }
  }

  /* ---- view detection ---- */
  var VIEWS = {
    status: 'status',
    progress: 'activities',
    backups: 'backups',
    logs: 'logs',
    statistics: 'statistics',
    settings: 'settings'
  };

  function detectView() {
    var link = document.querySelector('#main_nav li.active > a');
    var href = link ? link.getAttribute('href') || '' : '';
    var match = /show_([a-z]+)1/.exec(href);
    var view = match ? VIEWS[match[1]] : null;
    /* The navbar is rebuilt on every view switch, which wipes any injected
       attribute, so the marker is re-applied on every call - not only when the
       view changes (a rebuild with the same view used to lose it). */
    var links = document.querySelectorAll('#main_nav a[aria-current]');
    for (var i = 0; i < links.length; i++) links[i].removeAttribute('aria-current');
    if (link && view) link.setAttribute('aria-current', 'page');
    /* login is ajax (login3() -> build_main_nav() + show_status1()), so the
       login marker has to go as soon as a section exists - otherwise the
       centred login layout would stay on the app. A rendered login form wins:
       the old session's navbar can still be in the DOM when it appears. */
    if (view && html.getAttribute('data-ubx-login') === '1' && !hasLoginForm()) html.removeAttribute('data-ubx-login');
    if (!view || view === html.getAttribute('data-ubx-view')) return;
    html.setAttribute('data-ubx-view', view);
    /* hold the new view before its content is painted (this runs in a rAF
       callback, i.e. before the frame is drawn) */
    holdView();
    document.dispatchEvent(new CustomEvent('ubx:view', { detail: { view: view } }));
  }

  /* ---- observers ---- */
  var timers = new WeakMap();
  function debounce(fn, delay) {
    return function () {
      clearTimeout(timers.get(fn));
      timers.set(fn, setTimeout(fn, delay));
    };
  }

  /* ---- view entrance ---- */
  /* A section switch is painted in pieces: the server swaps #data_f, DataTables
     then measures its columns and jqplot re-creates the pie a frame or two later.
     Fading in that first paint put the layout jump *inside* the fade - measured
     with scratch/probe-view-flash.mjs: three different layouts in the first
     200ms (statistics moved 450px), the fade only started at 240ms, i.e. it
     faded in a page that had already snapped into place, which reads as a flash.
     So a new view is held transparent until its geometry has been stable for a
     few samples, and only the settled block fades in. */
  var enterView = null; /* view that has been held and released already */
  var gateTimer = null;
  var GATE_STEP = 40; /* ms between two geometry samples */
  var GATE_QUIET = 2; /* identical samples in a row before the fade may start */
  var GATE_MIN = 120; /* the swap of #data_f is only the first of several writes */
  var GATE_MAX = 800; /* a view that never settles (live log) still has to show */

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  /* Cheap geometry fingerprint: the container height, the first panels and the
     table widths. Those are the numbers that move - DataTables writes its column
     widths at init(), jqplot sets the plot height after it measured the host. */
  function contentSignature(data) {
    var parts = [data.childElementCount, data.scrollHeight];
    var panels = data.querySelectorAll('.panel');
    for (var i = 0; i < panels.length && i < 3; i++) {
      parts.push(Math.round(panels[i].offsetTop), Math.round(panels[i].offsetHeight));
    }
    var tables = data.querySelectorAll('table');
    for (var t = 0; t < tables.length && t < 3; t++) parts.push(Math.round(tables[t].offsetWidth));
    return parts.join(',');
  }

  function releaseView(data) {
    data.classList.remove('ubx-view-pending');
    /* force a style flush so re-adding the class restarts the animation */
    void data.offsetWidth;
    data.classList.add('ubx-view-enter');
  }

  /* Called when data-ubx-view changes: blank the container at once (a microtask
     before the next paint, so the wrong first layout is never painted), then
     release it once it stopped moving. */
  function holdView() {
    var view = html.getAttribute('data-ubx-view');
    var data = document.getElementById('data_f');
    if (!view || !data || enterView === view) return;
    enterView = view;
    data.classList.remove('ubx-view-enter');
    /* the login card is not a view: blanking it would hide the form */
    if (hasLoginForm()) return;
    if (gateTimer) clearTimeout(gateTimer);
    if (reducedMotion()) {
      releaseView(data);
      return;
    }
    data.classList.add('ubx-view-pending');
    var started = Date.now();
    var last = contentSignature(data);
    var stable = 0;
    var sample = function () {
      if (!data.classList.contains('ubx-view-pending')) return;
      var sig = contentSignature(data);
      stable = sig === last && data.firstElementChild ? stable + 1 : 0;
      last = sig;
      var waited = Date.now() - started;
      if ((stable >= GATE_QUIET && waited >= GATE_MIN) || waited >= GATE_MAX) {
        releaseView(data);
        return;
      }
      gateTimer = setTimeout(sample, GATE_STEP);
    };
    gateTimer = setTimeout(sample, GATE_STEP);
  }

  function onRender() {
    detectView();
    markLogin();
    document.dispatchEvent(new CustomEvent('ubx:render'));
  }

  var watched = new WeakSet();

  /* One call per frame. The navbar observer must not wait: an 80ms delay left
     the new view's markup under the previous view's CSS, and that is what made
     the sections look like they shrink and snap back. */
  function coalesce(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      var run = function () {
        queued = false;
        fn();
      };
      if (window.requestAnimationFrame) requestAnimationFrame(run);
      else setTimeout(run, 16);
    };
  }

  function watch(node, options, handler, delay) {
    if (!node || watched.has(node)) return;
    watched.add(node);
    var wrapped = delay === 0 ? coalesce(handler) : debounce(handler, delay || 80);
    new MutationObserver(wrapped).observe(node, options);
  }

  /* the login form is rendered by the page's own scripts, so it is the only
     reliable signal that this is the login page */
  function hasLoginForm() {
    return !!(document.getElementById('username') || document.querySelector('form[name="login1"]'));
  }

  /* Password managers (and Chrome's own autofill) only fill a form whose fields
     declare what they are; the stock login form ships without any hint, so the
     user had to type the password on every login. */
  function markLoginFields() {
    try {
      var user = document.getElementById('username');
      var pass = document.getElementById('password');
      if (user && !user.getAttribute('autocomplete')) {
        user.setAttribute('autocomplete', 'username');
        user.setAttribute('spellcheck', 'false');
        user.setAttribute('autocapitalize', 'none');
      }
      if (pass && !pass.getAttribute('autocomplete')) {
        pass.setAttribute('autocomplete', 'current-password');
      }
    } catch (e) {
      /* an attribute is a bonus, never a precondition */
    }
  }

  /* The login page renders the same shell (navbar with only the brand, #data_f
     with the form) but never gets a content view. Marking it lets the login
     styles and the pixel scene hook on; the caller dispatches ubx:render. */
  function markLogin() {
    if (!hasLoginForm()) return false;
    markLoginFields();
    if (html.getAttribute('data-ubx-login') === '1') return true;
    html.setAttribute('data-ubx-login', '1');
    return true;
  }

  /* The login layout is a page-wide flex with one 420px card. It must not
     outlive the login form by even a frame: onRender is debounced 80ms and
     every #data_f write during the login ajax pushes that debounce back, so the
     app used to be painted for ~100ms inside the centred login column
     ("everything gathered in the middle, then it snaps"). This observer runs as
     a microtask, i.e. before the next paint, and only does the cheap check. */
  var loginExit = null;
  function watchLoginExit(data) {
    if (loginExit) return;
    loginExit = new MutationObserver(function () {
      if (html.getAttribute('data-ubx-login') !== '1' || hasLoginForm()) return;
      html.removeAttribute('data-ubx-login');
      document.dispatchEvent(new CustomEvent('ubx:render'));
    });
    loginExit.observe(data, { childList: true, subtree: true });
  }

  function boot() {
    var nav = document.getElementById('main_nav');
    var data = document.getElementById('data_f');
    if (!nav || !data) {
      /* the shell is injected late; give up after ~30s instead of polling
         forever on a page that will never have it */
      if (bootTries++ < 120) setTimeout(boot, 250);
      return;
    }
    markFooter();
    markSkipLink();
    watch(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, detectView, 0);
    watch(data, { childList: true, subtree: true }, onRender);
    watchLoginExit(data);
    detectView();
    markLogin();
    document.dispatchEvent(new CustomEvent('ubx:render'));
  }

  var bootTries = 0;

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  /* ---- kill switch hotkey ---- */
  document.addEventListener(
    'keydown',
    function (event) {
      if (!event.ctrlKey || !event.altKey || (event.key !== 'u' && event.key !== 'U')) return;
      event.preventDefault();
      if (html.hasAttribute('data-ubx')) {
        try { sessionStorage.setItem('ubx-off', '1'); } catch (e) { /* ignore */ }
        deactivate();
      } else {
        try { sessionStorage.removeItem('ubx-off'); } catch (e) { /* ignore */ }
        activate();
      }
    },
    true
  );

  /* ---- start ---- */
  activate();
  loadSettings();
})();

