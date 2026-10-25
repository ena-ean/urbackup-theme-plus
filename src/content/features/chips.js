/*
 * Feature: status chips.
 *
 * UrBackup paints status cells with Bootstrap contextual classes (success /
 * warning / danger / info) and solid pastel backgrounds. The theme turns those
 * into quiet coloured text; this enhancer wraps the cell content in a pill so
 * the state stays readable at a glance.
 *
 * Cells with interactive content (links, buttons, nested tables, labels) and
 * pure numeric cells are left alone - a pill around "9" adds nothing.
 *
 * Contract : stock td.success / .warning / .danger / .info inside #data_f
 * Marks    : td.ubx-chipped[data-ubx-chip] > span.ubx-chip.ubx-chip--<variant>
 * Settings : chips
 * Reset    : unwrap() puts the original nodes back
 */
(function () {
  'use strict';

  var LEVELS = ['success', 'warning', 'danger', 'info'];
  var VARIANT = { success: 'ok', warning: 'warn', danger: 'danger', info: 'info' };
  var SKIP = 'a, button, input, select, textarea, table, .ubx-chip, .label, .btn, .progress';

  function chipFor(cell, level) {
    if (cell.hasAttribute('data-ubx-chip')) return;
    if (cell.querySelector(SKIP)) return;

    var text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z]/.test(text)) return;

    var chip = document.createElement('span');
    chip.className = 'ubx-chip ubx-chip--' + VARIANT[level];
    while (cell.firstChild) chip.appendChild(cell.firstChild);

    cell.appendChild(chip);
    cell.classList.add('ubx-chipped');
    cell.setAttribute('data-ubx-chip', '1');
  }

  function run() {
    var root = document.getElementById('data_f');
    if (!root) return;

    var cells = root.querySelectorAll('td.success, td.warning, td.danger, td.info');
    for (var i = 0; i < cells.length; i++) {
      for (var j = 0; j < LEVELS.length; j++) {
        if (cells[i].classList.contains(LEVELS[j])) {
          chipFor(cells[i], LEVELS[j]);
          break;
        }
      }
    }
  }

  function unwrap(root) {
    var cells = root.querySelectorAll('td[data-ubx-chip]');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var chip = cell.querySelector('.ubx-chip');
      if (chip && chip.parentNode === cell) {
        while (chip.firstChild) cell.insertBefore(chip.firstChild, chip);
        cell.removeChild(chip);
      }
      cell.classList.remove('ubx-chipped');
      cell.removeAttribute('data-ubx-chip');
    }
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'chips',
    onRender: run,
    onView: run,
    reset: function (ctx) {
      unwrap((ctx && ctx.root) || document.getElementById('data_f') || document.body);
    }
  });
})();
