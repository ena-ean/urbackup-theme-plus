/*
 * relayout.js - keep the measured chrome in sync with the window.
 *
 * Two numbers the stylesheet cannot know: the real height of the fixed navbar
 * (it grows when the collapsed menu opens) and of the fixed footer. Both feed
 * CSS variables that the body offset and every sticky bar read, so a wrong
 * value hides content under the bar. This module is also the single place that
 * announces a viewport change: a chart or a DataTable measured once keeps the
 * stale width forever, and only a re-measure puts it back - which is why
 * "an element slid below, a window resize fixed it" was reproducible.
 *
 * Contract : document events ubx:render / ubx:view (dispatcher), window resize
 * Emits    : ubx:relayout on document - debounced, one per settled change;
 *            src/content/bridge.main.js listens in the MAIN world and
 *            re-measures the charts and the DataTables there
 * Marks    : none (writes --ubx-navbar-h / --ubx-footer-h on <html>)
 * Settings : none - infrastructure, not a user-facing toggle
 * Reset    : drops the inline variables, the stylesheet default applies again
 */
(function () {
  'use strict';

  var DEBOUNCE = 120;
  var timer = null;
  var boxTimer = null;
  var lastWidth = 0;
  var lastBarHeight = 0;

  function px(value) {
    return Math.round(value) + 'px';
  }

  function setVar(name, value) {
    var root = document.documentElement;
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }

  /* the menu that is open right now is not the offset the page needs - its
     height is a transient state, the collapsed bar is the real one */
  function menuOpen() {
    return !!document.querySelector('.navbar-collapse.in');
  }

  function syncChrome() {
    var navbar = document.querySelector('.navbar-fixed-top');
    var footer = document.querySelector('.ubx-footer');
    if (navbar && !menuOpen()) {
      var height = Math.round(navbar.getBoundingClientRect().height);
      /* a bar taller than a third of the window is a broken layout, not an
         offset - never hand that number to the page */
      if (height > 0 && height <= Math.max(120, window.innerHeight / 3)) {
        lastBarHeight = height;
        setVar('--ubx-navbar-offset', px(height));
      }
    }
    if (footer) {
      var footerHeight = Math.round(footer.getBoundingClientRect().height);
      if (footerHeight > 0) setVar('--ubx-footer-h', px(footerHeight));
    }
  }

  function announce() {
    syncChrome();
    try {
      document.dispatchEvent(new CustomEvent('ubx:relayout'));
    } catch (e) {
      /* a page without CustomEvent support keeps its current layout */
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      announce();
    }, DEBOUNCE);
  }

  function watch() {
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });

    if (typeof ResizeObserver === 'function') {
      try {
        /* width only: the container's height changes on every view switch, and
           reacting to that would re-measure the tables for nothing */
        var host = document.getElementById('boostrap_container');
        if (host) {
          new ResizeObserver(function (entries) {
            var width = Math.round(entries[entries.length - 1].contentRect.width);
            if (Math.abs(width - lastWidth) <= 1) return;
            lastWidth = width;
            schedule();
          }).observe(host);
        }
        /* height only: the bar wraps or the mobile menu opens */
        var bar = document.querySelector('.navbar-fixed-top');
        if (bar) {
          new ResizeObserver(function (entries) {
            var height = Math.round(entries[entries.length - 1].contentRect.height);
            if (Math.abs(height - lastBarHeight) <= 1) return;
            lastBarHeight = height;
            if (boxTimer) clearTimeout(boxTimer);
            boxTimer = setTimeout(function () {
              boxTimer = null;
              if (!menuOpen()) schedule();
            }, 180);
          }).observe(bar);
        }
      } catch (e) {
        /* no observer: resize still covers the viewport case */
      }
    }
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'relayout',
    onInit: function () {
      watch();
      syncChrome();
    },
    /* NOT on every render: reading a rect right after the content changed forces
       a full layout, and on a 2000-row folder that is ~350ms (measured by the
       file-browser check). The bar cannot change height from a content swap -
       it changes when the view changes or the window does. */
    onView: syncChrome,
    reset: function () {
      var root = document.documentElement;
      root.style.removeProperty('--ubx-navbar-offset');
      root.style.removeProperty('--ubx-footer-h');
    }
  });
})();
