/*
 * Feature: keyboard shortcuts + dirty form markers.
 *
 *   1-6        switch views (Status, Activities, Backups, Logs, Statistics, Settings)
 *   /          focus the first search field on the page
 *   Escape     leave the field without changing the page
 *
 * Typing inside inputs, textareas, selects or contenteditable is never
 * intercepted, and shortcuts are ignored while a modifier key is held.
 *
 * The dirty markers are the second half of the module: an edited settings field
 * gets .ubx-dirty (amber accent) and the marker is cleared by a real save
 * round-trip (any getJSON action matching SAVE_ACTION, tapped by the bridge) or a
 * native form submit - never by matching a localised button label.
 *
 * Contract : #main_nav links, ubx:goto (bridge.main.js calls the page function),
 *            ubx:data (getJSON responses)
 * Marks    : .ubx-dirty on the closest .form-group
 * Settings : hotkeys (also gates the dirty markers)
 * Reset    : none - listeners stay, they check the setting on every call
 */
(function () {
  'use strict';

  var TYPING = /^(input|textarea|select|option)$/i;

  function enabledNow() {
    var state = window.__ubxState;
    var features = (state && state.settings && state.settings.features) || {};
    return features.hotkeys !== false;
  }

  function isTyping(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    return TYPING.test(el.tagName);
  }

  function navLink(index) {
    var links = document.querySelectorAll('#main_nav > li > a');
    return links[index] || null;
  }

  function firstSearch() {
    var root = document.getElementById('data_f') || document;
    return (
      root.querySelector('.dataTables_filter input') ||
      root.querySelector('input[type="search"]') ||
      root.querySelector('input[name="filter"]') ||
      root.querySelector('input[name="search"]')
    );
  }

  function onKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!enabledNow()) return;

    if (event.key === 'Escape') {
      if (isTyping(event) && event.target.blur) event.target.blur();
      return;
    }

    if (isTyping(event)) return;

    if (event.key === '/' || event.key === 'F2') {
      var input = firstSearch();
      if (!input) return;
      event.preventDefault();
      input.focus();
      if (input.select) input.select();
      return;
    }

    if (/^[1-6]$/.test(event.key)) {
      var index = Number(event.key) - 1;
      if (!navLink(index)) return;
      event.preventDefault();
      /* the nav links are javascript: URLs, blocked by the server CSP when
         clicked programmatically - the MAIN-world bridge calls the page
         function for us */
      document.dispatchEvent(new CustomEvent('ubx:goto', { detail: { index: index } }));
    }
  }

  /* --- dirty form markers (unsaved edits get a subtle accent) ---
     Cleared on a real save round-trip (the bridge taps every getJSON response)
     and on a native form submit, never by matching a localised button label. */
  var SAVE_ACTION = /^(save|set|add|remove|delete|update)_/i;

  function markDirty(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || !TYPING.test(el.tagName)) return;
    if (!enabledNow()) return;
    if (!el.closest || !el.closest('#data_f')) return;
    var group = el.closest('.form-group');
    if (group) group.classList.add('ubx-dirty');
  }

  function clearDirty() {
    var groups = document.querySelectorAll('.ubx-dirty');
    for (var i = 0; i < groups.length; i++) groups[i].classList.remove('ubx-dirty');
  }

  function onSaveAction(event) {
    var action = event && event.detail ? event.detail.action : '';
    if (typeof action === 'string' && SAVE_ACTION.test(action)) clearDirty();
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'hotkeys',
    onInit: function () {
      /* document-level: UrBackup may replace the #data_f subtree on render */
      document.addEventListener('keydown', onKey, false);
      document.addEventListener('input', markDirty, true);
      document.addEventListener('change', markDirty, true);
      document.addEventListener('ubx:data', onSaveAction, false);
      document.addEventListener('submit', function () { window.setTimeout(clearDirty, 600); }, true);
    }
  });
})();
