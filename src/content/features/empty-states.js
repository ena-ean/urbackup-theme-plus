/*
 * Feature: empty states.
 *
 * Empty DataTables render a bare "No matching records found" cell in the middle
 * of a very wide table, and panels with no content collapse into a thin strip.
 * This marks both cases so the stylesheet can render a calm, readable block.
 *
 * Contract : table.dataTable inside .dataTables_wrapper, .panel-body
 * Marks    : .ubx-empty-table (wrapper), td[data-ubx-empty], .ubx-empty-panel
 * Settings : emptyStates
 * Reset    : removes every marker above
 */
(function () {
  'use strict';

  function markTables(root) {
    var tables = root.querySelectorAll('table.dataTable');
    for (var i = 0; i < tables.length; i++) {
      var wrap = tables[i].closest ? tables[i].closest('.dataTables_wrapper') : null;
      if (!wrap) continue;
      var empty = tables[i].querySelector('tbody td.dataTables_empty');
      wrap.classList.toggle('ubx-empty-table', !!empty);
      if (empty) empty.setAttribute('data-ubx-empty', '');
    }
  }

  function markPanels(root) {
    var bodies = root.querySelectorAll('.panel-body');
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      var inert = !body.textContent.replace(/\s+/g, '') && !body.querySelector('img, canvas, table, input, button, select, textarea, .well');
      body.classList.toggle('ubx-empty-panel', inert);
    }
  }

  function run(ctx) {
    var root = (ctx && ctx.root) || document.getElementById('data_f') || document.body;
    markTables(root);
    markPanels(root);
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'emptyStates',
    onRender: run,
    onView: run,
    reset: function (ctx) {
      var root = (ctx && ctx.root) || document.getElementById('data_f') || document.body;
      var wraps = root.querySelectorAll('.ubx-empty-table');
      for (var i = 0; i < wraps.length; i++) wraps[i].classList.remove('ubx-empty-table');
      var panels = root.querySelectorAll('.ubx-empty-panel');
      for (var j = 0; j < panels.length; j++) panels[j].classList.remove('ubx-empty-panel');
      var cells = root.querySelectorAll('[data-ubx-empty]');
      for (var k = 0; k < cells.length; k++) cells[k].removeAttribute('data-ubx-empty');
    }
  });
})();
