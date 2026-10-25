/*
 * sw.js - service worker: find an UrBackup server and enable the theme for it.
 *
 * manifest.json cannot list an unknown LAN address, and the theme must not read
 * every page a user visits. Detection is therefore declarative:
 *
 *   1. chrome.declarativeContent.PageStateMatcher({ css: [...] }) reacts to the
 *      two marker ids that every UrBackup page carries (#boostrap_container and
 *      #data_div, login page included). CSS matching needs no host permission
 *      and injects nothing.
 *   2. ShowAction() keeps the toolbar icon hidden everywhere except on such a
 *      page - the icon itself is the "this is an UrBackup server" signal.
 *   3. A click asks for that origin only (permissions.request on a subset of
 *      optional_host_permissions shows a per-site prompt), registers the
 *      content scripts for it and injects the same files into the open tab, so
 *      the theme appears without a reload.
 *   4. The same click switches the origin off again: the pause is stored in
 *      chrome.storage.local["ubxPaused"], the runtime registration is dropped
 *      and the open tabs reload into the stock UI. A badge on the icon shows the
 *      state of the tab ("on" / "off"), so the click is never a guess. Removing
 *      the registration alone cannot switch off localhost / 127.0.0.1 - they are
 *      declared in manifest.json - which is what the pause list is for.
 *
 * declarativeContent.RequestContentScript would inject with no click at all,
 * but the API is documented as experimental and unavailable on stable Chrome.
 * Plain <all_urls> host permissions were rejected on purpose: the install
 * warning ("read and change all your data on all websites") is not worth it
 * for a UI theme.
 *
 * Contract : chrome.declarativeContent, chrome.action, chrome.permissions,
 *            chrome.scripting, chrome.storage.local, chrome.tabs;
 *            src/shared/registry.js.
 * Marks    : registered content scripts "ubx-<origin>-bridge" / "-main", a per-tab
 *            badge ("on" / "off"), chrome.storage.local["ubxPaused"].
 * Safety   : every registration goes through safe(), so one missing API cannot
 *            abort the worker and take the listeners registered after it along;
 *            a declined permission only sets a badge.
 */
'use strict';

importScripts('../shared/registry.js');

var registry = self.__ubxRegistry;

var DETECT_RULE_ID = 'ubx-detect';
/* Two ids on purpose: one selector alone also matches unrelated Bootstrap apps,
   both together are UrBackup-specific. Compound selectors only - the API
   rejects combinators. */
var UBX_SELECTORS = ['#boostrap_container', '#data_div'];
var BADGE_MS = 2500;
var injecting = {};

/* A throw at the top level of a service worker silently kills every listener
   registered after it - the worker still looks alive. Everything optional is
   registered through safe(), and the collected messages are returned by the
   message hook, so the smoke suite can assert the log stays empty. */
var swLog = [];
function safe(name, fn) {
  try {
    fn();
  } catch (e) {
    swLog.push(name + ': ' + (e && e.message ? e.message : e));
  }
}

/* ---------- the click ---------- */

/* The icon carries the state of the tab it is showing on: "on" or "off". The
   badge used to be a 2.5 s flash, which told the user nothing about the current
   state (and clicking twice looked like a broken button). */
var LOOK = {
  on: { text: 'on', bg: '#1046ae', ink: '#f4f8ff', title: 'UrBackup Theme+ is on for this server - click to turn it off' },
  off: { text: 'off', bg: '#39424f', ink: '#e6ebf2', title: 'UrBackup Theme+ is off for this server - click to turn it on' }
};

function paintBadge(tabId, on) {
  if (typeof tabId !== 'number') return;
  var look = on ? LOOK.on : LOOK.off;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: look.text });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: look.bg });
    chrome.action.setTitle({ tabId: tabId, title: look.title });
  } catch (e) {
    /* badge is cosmetic */
  }
  try {
    chrome.action.setBadgeTextColor({ tabId: tabId, color: look.ink });
  } catch (e) {
    /* Chrome < 110 */
  }
}

function clearBadge(tabId) {
  if (typeof tabId !== 'number') return;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
  } catch (e) {
    /* tab gone */
  }
}

/* a transient "!" / "x" while something went wrong, then back to the real state */
function flash(tab, text, title) {
  var tabId = tab && tab.id;
  if (typeof tabId !== 'number') return;
  try {
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#e5534b' });
    chrome.action.setBadgeText({ tabId: tabId, text: text });
    chrome.action.setTitle({ tabId: tabId, title: title });
    setTimeout(function () {
      refreshBadge({ id: tabId, url: tab && tab.url });
    }, BADGE_MS);
  } catch (e) {
    /* badge is cosmetic */
  }
}

async function refreshBadge(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  var state = await originState(tab.url);
  if (!state) {
    clearBadge(tab.id);
    return;
  }
  paintBadge(tab.id, state.on);
}

function onActionClick(tab) {
  var pattern = originPatternOf(tab && tab.url);
  if (!pattern) {
    flash(tab, '!', 'UrBackup Theme+ works on http and https pages only');
    return;
  }
  /* permissions.request has to be the first async call: a promise chain instead
     of await keeps the user gesture alive for the prompt. On an origin that is
     already granted it resolves true with no prompt at all (a paused origin
     keeps its grant on purpose), so the same call can serve the toggle. */
  chrome.permissions
    .request({ origins: [pattern] })
    .then(function (granted) {
      if (!granted) {
        flash(tab, 'x', 'Access to ' + pattern + ' was declined - the theme cannot run there');
        return null;
      }
      return toggleFor(tab, pattern);
    })
    .catch(function (e) {
      flash(tab, 'x', 'UrBackup Theme+ could not switch: ' + (e && e.message ? e.message : e));
    });
}

/* ---------- on / off state ---------- */

/* Everything works on origin patterns ("http://host:55414/*"): the message hook
   and the options page only know patterns, the click only knows a URL. */
function urlOf(value) {
  if (typeof value !== 'string' || !value) return '';
  return /\/\*$/.test(value) ? value.replace(/\/\*$/, '/') : value;
}

/* manifest.json declares localhost / 127.0.0.1 statically, so those origins have
   no registered pair to drop and have to count as available. Match patterns
   ignore the port unless it is written down. */
function manifestCovers(url) {
  var parsed;
  try {
    parsed = new URL(urlOf(url));
  } catch (e) {
    return false;
  }
  var scripts = [];
  try {
    scripts = chrome.runtime.getManifest().content_scripts || [];
  } catch (e) {
    return false;
  }
  for (var i = 0; i < scripts.length; i++) {
    var patterns = scripts[i].matches || [];
    for (var j = 0; j < patterns.length; j++) {
      var parts = /^(https?):\/\/([^/*]+)\/\*$/.exec(patterns[j]);
      if (!parts || parts[1] !== parsed.protocol.replace(':', '')) continue;
      var host = parts[2];
      var port = '';
      var colon = host.lastIndexOf(':');
      if (colon > 0) {
        port = host.slice(colon + 1);
        host = host.slice(0, colon);
      }
      if (host !== parsed.hostname) continue;
      if (port && port !== parsed.port) continue;
      return true;
    }
  }
  return false;
}

async function originState(urlOrPattern) {
  var url = urlOf(urlOrPattern);
  var pattern = originPatternOf(url);
  if (!pattern) return null;
  var paused = false;
  var registered = false;
  try {
    paused = (await registry.readPaused()).indexOf(pattern) !== -1;
  } catch (e) {
    paused = false;
  }
  try {
    registered = (await registry.registeredOrigins()).indexOf(pattern) !== -1;
  } catch (e) {
    registered = false;
  }
  var declared = manifestCovers(url);
  return {
    pattern: pattern,
    declared: declared,
    registered: registered,
    paused: paused,
    /* available and not paused - the badge and the click both read this */
    on: !paused && (declared || registered)
  };
}

async function tabsFor(pattern) {
  try {
    return await chrome.tabs.query({ url: pattern });
  } catch (e) {
    return [];
  }
}

function reloadTab(tabId) {
  if (typeof tabId !== 'number') return;
  try {
    chrome.tabs.reload(tabId, {}, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    /* the tab is mid-navigation or gone */
  }
}

/* Off: remember the pause (the only switch that exists for a manifest-declared
   origin), drop the runtime registration and reload the open tabs. A themed
   document cannot be cleaned up feature by feature - moved toolbar links,
   injected glyphs, aria marks - and a reload is what makes the stock UI and the
   stock markup agree again. */
async function switchOff(pattern) {
  await registry.setPaused(pattern, true);
  await registry.pauseScripts(pattern);
  var tabs = await tabsFor(pattern);
  for (var i = 0; i < tabs.length; i++) reloadTab(tabs[i].id);
  return { pattern: pattern, on: false, paused: true, tabs: tabs.length };
}

/* On: a first enable has nothing to undo and appears in the open tab without a
   reload (the 0.2.0 behaviour). After a pause the document was loaded while
   paused - the content script booted and stood down - so injecting into it hits
   the boot guard and changes nothing: reload instead. */
async function switchOn(pattern, wasPaused) {
  await registry.setPaused(pattern, false);
  if (!wasPaused) {
    var themed = await enableOrigin(pattern);
    return { pattern: pattern, on: true, paused: false, tabs: themed };
  }
  await registry.registerScripts(pattern);
  var tabs = await tabsFor(pattern);
  for (var i = 0; i < tabs.length; i++) reloadTab(tabs[i].id);
  return { pattern: pattern, on: true, paused: false, tabs: tabs.length };
}

async function toggleOrigin(pattern) {
  var state = await originState(pattern);
  if (!state) throw new Error('not an origin pattern');
  var next = state.on ? await switchOff(pattern) : await switchOn(pattern, state.paused);
  var tabs = await tabsFor(pattern);
  for (var i = 0; i < tabs.length; i++) paintBadge(tabs[i].id, next.on);
  return next;
}

/* the click path: same switch, plus the badge of the clicked tab */
async function toggleFor(tab, pattern) {
  var next = await toggleOrigin(pattern);
  if (tab && typeof tab.id === 'number') paintBadge(tab.id, next.on);
  return next;
}

/* ---------- enabling one origin ---------- */

function originPatternOf(url) {
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin + '/*';
  } catch (e) {
    return null;
  }
}

/* runs in the page: a themed tab must not be injected twice (the feature
   modules push their hooks unconditionally, a second run doubles the
   listeners) */
function pageIsThemed() {
  return document.documentElement.hasAttribute('data-ubx');
}

async function injectInto(tabId) {
  if (typeof tabId !== 'number' || injecting[tabId]) return false;
  injecting[tabId] = true;
  try {
    var probe = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: pageIsThemed });
    if (probe && probe[0] && probe[0].result) return false;
    await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: registry.CONTENT_FILES.css });
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: registry.CONTENT_FILES.bridge,
      world: 'MAIN'
    });
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: registry.CONTENT_FILES.main });
    return true;
  } finally {
    delete injecting[tabId];
  }
}

/* Register for the origin (document_start from now on) and theme the tabs that
   are already open - the page the user clicked on never reloads. */
async function enableOrigin(pattern) {
  await registry.registerScripts(pattern);
  var themed = 0;
  try {
    var tabs = await chrome.tabs.query({ url: pattern });
    for (var i = 0; i < tabs.length; i++) {
      try {
        if (await injectInto(tabs[i].id)) themed += 1;
      } catch (e) {
        /* the tab may be mid-navigation */
      }
    }
  } catch (e) {
    /* no host permission for the pattern: registration alone still works */
  }
  return themed;
}

/* ---------- detection ---------- */

function installDetectRule() {
  var pages = chrome.declarativeContent.onPageChanged;
  /* rules persist across sessions, so the old ones are dropped first */
  pages.removeRules(undefined, function () {
    void chrome.runtime.lastError;
    pages.addRules(
      [
        {
          id: DETECT_RULE_ID,
          conditions: [
            new chrome.declarativeContent.PageStateMatcher({
              pageUrl: { schemes: ['http', 'https'] },
              css: UBX_SELECTORS
            })
          ],
          actions: [new chrome.declarativeContent.ShowAction()]
        }
      ],
      function () {
        void chrome.runtime.lastError;
      }
    );
  });
}

/* the worker is restarted often: the rule has to survive that, and adding it
   again is cheap */
safe('detect', installDetectRule);
safe('detect-install', function () {
  chrome.runtime.onInstalled.addListener(installDetectRule);
});
safe('action', function () {
  chrome.action.onClicked.addListener(onActionClick);
});

/* The icon shows the state of the tab it appears on - "on" or "off" - instead of
   a flash that leaves nothing behind. tab.url is visible on exactly the origins
   this extension was granted, which are the ones that can be toggled. */
safe('badge', function () {
  chrome.tabs.onActivated.addListener(function (info) {
    chrome.tabs.get(info.tabId, function (tab) {
      void chrome.runtime.lastError;
      refreshBadge(tab);
    });
  });
  chrome.tabs.onUpdated.addListener(function (tabId, change, tab) {
    if (change.url || change.status === 'complete') refreshBadge(tab || { id: tabId });
  });
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    void chrome.runtime.lastError;
    if (tabs && tabs[0]) refreshBadge(tabs[0]);
  });
});

/* ---------- keeping the list honest ---------- */

/* a registered origin whose grant was revoked (site access set to "on click",
   profile sync) would stay in the options list and never inject again */
async function pruneOrphans() {
  var origins;
  try {
    origins = await registry.registeredOrigins();
  } catch (e) {
    return;
  }
  for (var i = 0; i < origins.length; i++) {
    var granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: [origins[i]] });
    } catch (e) {
      granted = false;
    }
    if (granted) continue;
    try {
      await registry.unregisterScripts(origins[i]);
    } catch (e) {
      /* ignore */
    }
  }
}

safe('grants', function () {
  chrome.permissions.onRemoved.addListener(function (removed) {
    var origins = (removed && removed.origins) || [];
    for (var i = 0; i < origins.length; i++) {
      if (!/^https?:\/\//i.test(origins[i])) continue;
      registry.unregisterScripts(origins[i]).catch(function () {});
      /* the grant is gone, so the origin cannot be toggled back on from the icon:
         drop the pause instead of leaving a stale "off" behind */
      registry.setPaused(origins[i], false).catch(function () {});
    }
  });
});
safe('startup', function () {
  chrome.runtime.onStartup.addListener(function () {
    pruneOrphans();
  });
});
safe('install', function () {
  chrome.runtime.onInstalled.addListener(function () {
    pruneOrphans();
  });
});

/* ---------- message hook ---------- */

function msgOf(e) {
  return e && e.message ? e.message : String(e);
}

function validPattern(value) {
  return typeof value === 'string' && /^https?:\/\/[^/]+\/\*$/i.test(value);
}

/* The options page drives "Add a server" and "turn it back on" through here, and
   the smoke suite toggles an origin without a real click. ubx:state is read-only
   (the smoke check for the badge and the options list). */
safe('messages', function () {
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    var type = message && message.type;
    if (type !== 'ubx:enable' && type !== 'ubx:toggle' && type !== 'ubx:state') return false;
    var pattern = validPattern(message.origin) ? message.origin : '';
    if (!pattern) {
      sendResponse({ ok: false, error: 'not an origin pattern', log: swLog });
      return false;
    }
    if (type === 'ubx:state') {
      originState(pattern)
        .then(function (state) {
          sendResponse({ ok: true, origin: pattern, state: state, log: swLog });
        })
        .catch(function (e) {
          sendResponse({ ok: false, error: msgOf(e), log: swLog });
        });
      return true;
    }
    if (type === 'ubx:toggle') {
      toggleOrigin(pattern)
        .then(function (next) {
          sendResponse({
            ok: true,
            origin: pattern,
            on: next.on,
            paused: next.paused,
            tabs: next.tabs || 0,
            log: swLog
          });
        })
        .catch(function (e) {
          sendResponse({ ok: false, error: msgOf(e), log: swLog });
        });
      return true;
    }
    /* ubx:enable - "Add" in the options page, or turning a paused origin back on.
       A paused origin reloads its tabs: its document booted while paused, so a
       late injection cannot re-run the theme. */
    registry
      .readPaused()
      .then(function (paused) {
        if (paused.indexOf(pattern) !== -1) return switchOn(pattern, true);
        return enableOrigin(pattern).then(function (themed) {
          return { on: true, paused: false, tabs: themed };
        });
      })
      .then(function (next) {
        sendResponse({
          ok: true,
          origin: pattern,
          on: next.on,
          paused: next.paused,
          tabs: next.tabs || 0,
          log: swLog
        });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: msgOf(e), log: swLog });
      });
    return true;
  });
});
