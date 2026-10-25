/*
 * decorate.js - feature dispatcher (isolated world).
 *
 * Every feature module (features/*.js, loaded before this file) registers an
 * object in window.__ubxFeatureHooks. This dispatcher turns the theme's events
 * into feature calls, so a feature never has to listen to the page itself.
 *
 * Hook contract - a module only implements what it needs:
 *   name        settings key and identity (see options.js FEATURES)
 *   onInit(ctx) once, before the first onRender that has a hook registered
 *   onRender(ctx) after UrBackup swapped the contents of #data_f
 *   onView(ctx)   when the active view changed (html[data-ubx-view])
 *   reset(ctx)    when the toggle is switched off at runtime
 *   ctx         { root: #data_f (or body), view: current view name }
 *
 * A feature that throws is skipped for that call only: one broken enhancer must
 * never break the page or the other features.
 */
(function () {
  'use strict';

  var hooks = window.__ubxFeatureHooks || [];
  var started = {};

  function settings() {
    var state = window.__ubxState;
    return (state && state.settings) || { features: {} };
  }

  function enabled(name) {
    var features = settings().features || {};
    return features[name] !== false;
  }

  function root() {
    return document.getElementById('data_f') || document.body;
  }

  function call(hook, kind, ctx) {
    try {
      if (typeof hook[kind] === 'function') hook[kind](ctx);
    } catch (e) {
      /* isolate: a failed enhancer is skipped, the rest keeps working */
    }
  }

  function dispatch(kind, live) {
    if (!document.documentElement.hasAttribute('data-ubx')) return;
    var ctx = { root: root(), view: document.documentElement.getAttribute('data-ubx-view') };
    for (var i = 0; i < hooks.length; i++) {
      var hook = hooks[i];
      if (!enabled(hook.name)) {
        /* settings arrived live: undo whatever the feature already marked */
        if (live) call(hook, 'reset', ctx);
        continue;
      }
      if (kind === 'onRender' && !started[hook.name] && typeof hook.onInit === 'function') {
        started[hook.name] = true;
        call(hook, 'onInit', ctx);
      }
      call(hook, kind, ctx);
    }
  }

  document.addEventListener('ubx:render', function () { dispatch('onRender'); }, false);
  document.addEventListener('ubx:view', function () { dispatch('onView'); }, false);
  document.addEventListener('ubx:settings', function () { dispatch('onRender', true); }, false);
})();
