/*
 * Options page (src/options/options.html).
 *
 * Two jobs:
 *   1. persist the feature toggles in chrome.storage.sync under "ubxSettings"
 *      (ubx.js reads the same key and re-renders open tabs immediately),
 *   2. show and manage the additionally enabled UrBackup servers. The
 *      registration itself lives in src/shared/registry.js - the service worker
 *      (src/background/sw.js) loads the same file when the toolbar icon is
 *      clicked. The server list is rebuilt from the registered scripts, so an
 *      update cannot leave a half-registered origin behind. A server switched
 *      off with the toolbar icon shows up as "off" (the pause lives in
 *      chrome.storage.local) and is never silently registered again.
 *
 * Adding a feature toggle takes three edits:
 *   - append the key to FEATURES below,
 *   - add <input type="checkbox" id="<key>"> in options.html,
 *   - register the module under the same name in its __ubxFeatureHooks entry.
 */
'use strict';

const STORAGE_KEY = 'ubxSettings';

/* Checkbox id, settings key and feature-hook name are the same string. */
const FEATURES = ['chips', 'sticky', 'hotkeys', 'emptyStates', 'icons', 'files', 'loginBrand'];

const DEFAULTS = {
  servers: [],
  features: defaultFeatures()
};

function defaultFeatures() {
  const features = {};
  for (const name of FEATURES) features[name] = true;
  return features;
}

/* Single source of truth for the file list: src/shared/registry.js is also
   loaded by the service worker, which injects the same set into a just-enabled
   tab. Keep it in sync with manifest.json - the smoke suite compares them. */
const registry = window.__ubxRegistry;
const CONTENT_FILES = registry.CONTENT_FILES;

const $ = (id) => document.getElementById(id);

/* The two lists this page draws: the servers it knows about, and the ones the
   toolbar icon switched off (kept in chrome.storage.local by shared/registry.js). */
let servers = [];
let pausedOrigins = [];

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function normalizeOrigin(input) {
  const url = new URL(input);
  return url.origin + '/*';
}

/* "http://192.168.1.5:55414/*" -> "ubx-192-168-1-5-55414" (shared/registry.js) */
const serverBase = registry.serverBase;
const scriptIdsFor = registry.scriptIdsFor;
const readPaused = registry.readPaused;
const setPaused = registry.setPaused;

function readForm() {
  const features = {};
  for (const name of FEATURES) features[name] = !!$(name).checked;
  return { servers: servers.slice(), features };
}

function fillForm(settings) {
  const s = settings || DEFAULTS;
  const stored = s.features || {};
  for (const name of FEATURES) $(name).checked = stored[name] !== false;
  servers = Array.isArray(s.servers) ? s.servers.slice() : [];
  renderServers();
}

/* A server switched off with the toolbar icon stays in this list (its host grant
   is kept on purpose) and is marked "off" here - turning it back on goes through
   the worker, because only the worker can reload the open tabs of that origin. */
function renderServers() {
  const list = $('servers');
  list.textContent = '';
  if (!servers.length && !pausedOrigins.length) {
    const li = document.createElement('li');
    li.textContent =
      'No extra server yet. Open your UrBackup server - the extension icon appears in the toolbar on its pages - and click it once. Click it again to switch the theme off for that server.';
    list.appendChild(li);
    return;
  }
  const rows = [...new Set([...servers, ...pausedOrigins])];
  for (const server of rows) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = server;
    const actions = document.createElement('span');
    actions.className = 'server-actions';
    if (pausedOrigins.includes(server)) {
      const state = document.createElement('span');
      state.className = 'state off';
      state.textContent = 'off';
      const turnOn = document.createElement('button');
      turnOn.textContent = 'Turn on';
      turnOn.addEventListener('click', () => { enableServer(server); });
      actions.append(state, turnOn);
    } else {
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => { removeServer(server); });
      actions.appendChild(remove);
    }
    li.append(name, actions);
    list.appendChild(li);
  }
}

/* Re-enables a paused server: the worker clears the pause, re-registers and
   reloads its open tabs (a document loaded while paused cannot be themed in
   place). */
async function enableServer(originPattern) {
  setStatus('');
  try {
    const answer = await chrome.runtime.sendMessage({ type: 'ubx:enable', origin: originPattern });
    if (answer && answer.ok === false) throw new Error(answer.error || 'the extension worker refused');
  } catch (e) {
    setStatus('Could not switch the theme on: ' + e.message, true);
    return;
  }
  pausedOrigins = pausedOrigins.filter((origin) => origin !== originPattern);
  if (!servers.includes(originPattern)) servers.push(originPattern);
  renderServers();
  setStatus('Theme switched on for ' + originPattern + '.');
}

/* Registration, unregistration and the origin list live in shared/registry.js -
   the service worker needs exactly the same code. The names stay local so
   window.__ubxOptions (the smoke suite drives it) is unchanged. */
const registerScripts = registry.registerScripts;
const unregisterScripts = registry.unregisterScripts;
const registeredOrigins = registry.registeredOrigins;

async function persist() {
  await chrome.storage.sync.set({ [STORAGE_KEY]: readForm() });
}

async function addServer() {
  const raw = $('server').value.trim();
  if (!raw) {
    setStatus('Enter a server URL first.', true);
    return;
  }

  let originPattern;
  try {
    originPattern = normalizeOrigin(raw);
  } catch (e) {
    setStatus('That does not look like a valid URL.', true);
    return;
  }

  try {
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      setStatus('Permission for that server was not granted.', true);
      return;
    }
    await registerScripts(originPattern);
    /* the service worker injects the same files into open tabs of that origin,
       so the page the user is looking at does not have to be reloaded */
    let themed = 0;
    try {
      const answer = await chrome.runtime.sendMessage({ type: 'ubx:enable', origin: originPattern });
      themed = answer && answer.tabs ? answer.tabs : 0;
    } catch (e) {
      /* no worker answer - the registered scripts still apply on the next load */
    }
    if (!servers.includes(originPattern)) servers.push(originPattern);
    renderServers();
    await persist();
    $('server').value = '';
    setStatus(themed ? 'Server added. ' + themed + ' open tab(s) themed.' : 'Server added. Open it in a tab to see the theme.');
  } catch (e) {
    setStatus('Could not add the server: ' + e.message, true);
  }
}

async function removeServer(originPattern) {
  setStatus('');
  try {
    await unregisterScripts(originPattern);
    /* a removed server must not come back as a stale "off" row */
    await setPaused(originPattern, false);
  } catch (e) {
    setStatus('Could not remove the server: ' + e.message, true);
    return;
  }
  servers = servers.filter((s) => s !== originPattern);
  pausedOrigins = pausedOrigins.filter((s) => s !== originPattern);
  renderServers();
  await persist();
  setStatus('Server removed.');
}

async function init() {
  const stored = (await chrome.storage.sync.get(STORAGE_KEY))[STORAGE_KEY];
  fillForm(stored);
  /* merge what is actually registered, and re-register anything the stored
     list knows about but the browser does not have any more */
  try {
    pausedOrigins = await readPaused();
    const live = await registeredOrigins();
    const known = [...new Set([...servers, ...live, ...pausedOrigins])];
    for (const origin of known) {
      if (live.includes(origin)) continue;
      /* switched off with the toolbar icon: that is a decision, not drift */
      if (pausedOrigins.includes(origin)) continue;
      try {
        await registerScripts(origin);
      } catch (e) {
        /* permission revoked - drop it from the list below */
      }
    }
    const after = await registeredOrigins();
    servers = known.filter((origin) => after.includes(origin) || pausedOrigins.includes(origin));
    renderServers();
  } catch (e) {
    /* scripting API unavailable - keep the stored list */
  }
  if (!stored) await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULTS });
}

$('addServer').addEventListener('click', addServer);
$('save').addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: readForm() });
    setStatus('Saved.');
  } catch (e) {
    setStatus('Could not save: ' + e.message, true);
  }
});
$('reset').addEventListener('click', async () => {
  fillForm(DEFAULTS);
  await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULTS });
  setStatus('Defaults restored.');
});

init().catch((e) => setStatus('Init failed: ' + e.message, true));

/* Test handle: the smoke suite drives script registration through these
   functions instead of waiting for a permission prompt. */
window.__ubxOptions = {
  registerScripts,
  unregisterScripts,
  registeredOrigins,
  readPaused,
  setPaused,
  serverBase,
  scriptIdsFor,
  CONTENT_FILES,
  registry
};
