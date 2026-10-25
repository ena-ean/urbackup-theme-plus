/*
 * registry.js - per-origin content-script registration, shared by the options
 * page and the service worker.
 *
 * Loaded two ways, so it must not touch the DOM:
 *   - <script src="../shared/registry.js"> in src/options/options.html,
 *   - importScripts('../shared/registry.js') in src/background/sw.js.
 *
 * manifest.json only matches localhost / 127.0.0.1 - an extension cannot list
 * an unknown LAN address up front. Every other UrBackup origin is added at
 * runtime: one script pair per origin ("ubx-<origin>-bridge" in the MAIN world,
 * "-main" in the isolated world) plus a host permission. A fixed script id (the
 * 0.1.0 behaviour) made updateContentScripts overwrite the previous server's
 * matches, so adding a second server silently removed the theme from the first.
 * The registered scripts are the source of truth: the stored server list is a
 * cache that lags behind after a crash, an update or a manual removal.
 *
 * Contract : chrome.scripting, chrome.permissions, chrome.storage.local.
 * Exports  : globalThis.__ubxRegistry = { PAUSED_KEY, CONTENT_FILES, serverBase,
 *            scriptIdsFor, scriptDefinitions, registerScripts, unregisterScripts,
 *            pauseScripts, readPaused, setPaused, registeredOrigins }
 * Safety   : registerScripts is idempotent (update when the id exists),
 *            unregisterScripts never throws for an origin that is already gone.
 */
(function (root) {
  'use strict';

  if (root.__ubxRegistry) return;

  /* Same files and order as manifest.json - tests/e2e/smoke.mjs compares the
     two, because a feature module missing here never reaches a runtime-added
     server. */
  var CONTENT_FILES = {
    bridge: ['src/content/bridge.main.js'],
    main: [
      'src/content/features/relayout.js',
      'src/content/features/chips.js',
      'src/content/features/sticky.js',
      'src/content/features/hotkeys.js',
      'src/content/features/empty-states.js',
      'src/content/features/icons.js',
      'src/content/features/files.js',
      'src/content/features/login-brand.js',
      'src/content/decorate.js',
      'src/content/ubx.js'
    ],
    css: ['src/content/tokens.css', 'src/content/theme.css']
  };

  /* "http://192.168.1.5:55414/*" -> "ubx-192-168-1-5-55414" */
  function serverBase(pattern) {
    return (
      'ubx-' +
      pattern
        .replace(/^https?:\/\//i, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/-+$/, '')
    );
  }

  function scriptIdsFor(pattern) {
    var base = serverBase(pattern);
    return { bridge: base + '-bridge', main: base + '-main' };
  }

  function scriptDefinitions(pattern) {
    var ids = scriptIdsFor(pattern);
    return [
      {
        id: ids.bridge,
        matches: [pattern],
        js: CONTENT_FILES.bridge.slice(),
        runAt: 'document_start',
        world: 'MAIN'
      },
      {
        id: ids.main,
        matches: [pattern],
        css: CONTENT_FILES.css.slice(),
        js: CONTENT_FILES.main.slice(),
        runAt: 'document_start'
      }
    ];
  }

  async function registerScripts(pattern) {
    var live = new Set(
      (await chrome.scripting.getRegisteredContentScripts()).map(function (script) {
        return script.id;
      })
    );
    var definitions = scriptDefinitions(pattern);
    for (var i = 0; i < definitions.length; i++) {
      var definition = definitions[i];
      if (live.has(definition.id)) {
        await chrome.scripting.updateContentScripts([definition]);
      } else {
        await chrome.scripting.registerContentScripts([definition]);
      }
    }
  }

  async function unregisterScripts(pattern) {
    var ids = scriptIdsFor(pattern);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [ids.bridge, ids.main] });
    } catch (e) {
      /* already gone - nothing to undo */
    }
    try {
      await chrome.permissions.remove({ origins: [pattern] });
    } catch (e) {
      /* the grant may be covered by a broader host permission */
    }
  }

  /* ---------- paused origins (the toolbar toggle's "off") ---------- */

  /* localhost / 127.0.0.1 are declared in manifest.json, so there is nothing to
     unregister there: the only way to keep the stock UI is a flag the page can
     read by itself. src/content/ubx.js reads chrome.storage.local["ubxPaused"]
     at document_start (that file does not load this one, so the key name is
     repeated there on purpose - tests/e2e/smoke.mjs proves both sides agree). */
  var PAUSED_KEY = 'ubxPaused';

  async function readPaused() {
    var stored = null;
    try {
      stored = await chrome.storage.local.get(PAUSED_KEY);
    } catch (e) {
      return [];
    }
    var list = stored && stored[PAUSED_KEY];
    return Array.isArray(list) ? list.slice() : [];
  }

  async function setPaused(pattern, paused) {
    var list = await readPaused();
    var has = list.indexOf(pattern) !== -1;
    if (!!paused === has) return list;
    if (paused) list.push(pattern);
    else list = list.filter(function (item) { return item !== pattern; });
    var write = {};
    write[PAUSED_KEY] = list;
    try {
      await chrome.storage.local.set(write);
    } catch (e) {
      /* storage is required by manifest.json - nothing left to do here */
    }
    return list;
  }

  /* Off keeps the host grant on purpose: switching back on then needs no second
     permission prompt, and the origin stays visible in the options page. */
  async function pauseScripts(pattern) {
    var ids = scriptIdsFor(pattern);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [ids.bridge, ids.main] });
    } catch (e) {
      /* manifest-declared origin: no registered pair to drop */
    }
  }

  /* Both scripts of a pair share the pattern, so a count of two is what makes
     an origin real; a half-registered origin disappears from the list. */
  async function registeredOrigins() {
    var scripts = await chrome.scripting.getRegisteredContentScripts();
    var counts = new Map();
    for (var i = 0; i < scripts.length; i++) {
      var script = scripts[i];
      if (script.id.indexOf('ubx-') !== 0) continue;
      var matches = script.matches || [];
      for (var j = 0; j < matches.length; j++) {
        counts.set(matches[j], (counts.get(matches[j]) || 0) + 1);
      }
    }
    var origins = [];
    counts.forEach(function (count, pattern) {
      if (count >= 2) origins.push(pattern);
    });
    return origins;
  }

  root.__ubxRegistry = {
    PAUSED_KEY: PAUSED_KEY,
    CONTENT_FILES: CONTENT_FILES,
    serverBase: serverBase,
    scriptIdsFor: scriptIdsFor,
    scriptDefinitions: scriptDefinitions,
    registerScripts: registerScripts,
    unregisterScripts: unregisterScripts,
    pauseScripts: pauseScripts,
    readPaused: readPaused,
    setPaused: setPaused,
    registeredOrigins: registeredOrigins
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
