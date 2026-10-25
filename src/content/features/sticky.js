/*
 * Feature: sticky navigation.
 *
 * Settings has two levels of navigation (#nav_pos with the General/Mail/...
 * tabs and #settings_tabber with the per-area pills). Both are plain static
 * markup, so they scroll out of view on long settings pages. Marking them lets
 * the stylesheet pin them right below the fixed navbar.
 *
 * Contract : the stock ids #nav_pos and #settings_tabber
 * Marks    : .ubx-sticky (#nav_pos), .ubx-sticky-tabs (#settings_tabber)
 * Settings : sticky
 * Reset    : removes both marker classes
 */
(function () {
  'use strict';

  var MARKERS = [
    ['nav_pos', 'ubx-sticky'],
    ['settings_tabber', 'ubx-sticky-tabs']
  ];

  function run() {
    for (var i = 0; i < MARKERS.length; i++) {
      var node = document.getElementById(MARKERS[i][0]);
      if (node) node.classList.add(MARKERS[i][1]);
    }
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'sticky',
    onRender: run,
    onView: run,
    reset: function () {
      for (var i = 0; i < MARKERS.length; i++) {
        var node = document.getElementById(MARKERS[i][0]);
        if (node) node.classList.remove(MARKERS[i][1]);
      }
    }
  });
})();
