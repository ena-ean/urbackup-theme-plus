/*
 * Feature: pixel icons for the main navigation.
 *
 * The glyphs are drawn on a tiny integer grid (one character = one pixel) and
 * rasterised into a single <path> (one subpath per horizontal run) with
 * shape-rendering: crispEdges, which keeps them sharp at 14px and gives the
 * chunky pixel look of the reference design.
 * Colour comes from currentColor, so the icons follow the link state.
 *
 * The rasteriser is exported as window.__ubxPixelIcon so features/files.js can
 * draw its file-type glyphs with the same code.
 *
 * Contract : #main_nav > li > a (the stock links, href="javascript: show_x1('')")
 * Marks    : svg.ubx-icon inside each link, a[data-ubx-icon="<name>"]
 * Settings : icons
 * Reset    : disconnects both observers and removes the glyphs
 */
(function () {
  'use strict';

  var ICONS = {
    status: [
      '.##...##.',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
      '....#....'
    ],
    activities: [
      '....###.',
      '...###..',
      '..###...',
      '.######.',
      '...###..',
      '..###...',
      '.###....',
      '.##.....'
    ],
    backups: [
      '.########.',
      '##########',
      '#........#',
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '##########'
    ],
    logs: [
      '#########',
      '#.......#',
      '#.#####.#',
      '#.......#',
      '#.#####.#',
      '#.......#',
      '#.#####.#',
      '#.......#',
      '#########'
    ],
    statistics: [
      '..........',
      '.......##.',
      '.......##.',
      '....##.##.',
      '....##.##.',
      '.##.##.##.',
      '.##.##.##.',
      '.##.##.##.'
    ],
    settings: [
      '...####...',
      '..######..',
      '.########.',
      '.###..###.',
      '.###..###.',
      '.########.',
      '..######..',
      '...####...'
    ]
  };

  var VIEWS = [
    ['status', 'show_status1'],
    ['activities', 'show_progress1'],
    ['backups', 'show_backups1'],
    ['logs', 'show_logs1'],
    ['statistics', 'show_statistics1'],
    ['settings', 'show_settings1']
  ];

  /*
   * One <path> per glyph, one subpath per horizontal pixel run, never one <rect>
   * per run: the file browser puts a glyph in every row, so a 6000-row folder
   * used to add ~100k rect elements for the layout engine to chew on. The
   * geometry is identical (the runs are the same rectangles) and crispEdges
   * still snaps them, so the pixels do not change.
   */
  function rasterise(rows, extraClass) {
    var cols = rows[0].length;
    var size = Math.max(cols, rows.length);
    var ox = Math.floor((size - cols) / 2);
    var oy = Math.floor((size - rows.length) / 2);
    var d = '';
    for (var y = 0; y < rows.length; y++) {
      var x = 0;
      while (x < cols) {
        if (rows[y].charAt(x) !== '#') {
          x++;
          continue;
        }
        var start = x;
        while (x < cols && rows[y].charAt(x) === '#') x++;
        var w = x - start;
        d += 'M' + (start + ox) + ' ' + (y + oy) + 'h' + w + 'v1h-' + w + 'z';
      }
    }
    return (
      '<svg class="ubx-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 ' + size + ' ' + size + '"' +
      ' aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path d="' + d + '"/></svg>'
    );
  }

  /* shared with features/files.js */
  window.__ubxPixelIcon = rasterise;

  function mark(link, name) {
    if (!link || !ICONS[name] || link.getAttribute('data-ubx-icon')) return;
    link.insertAdjacentHTML('afterbegin', rasterise(ICONS[name]));
    link.setAttribute('data-ubx-icon', name);
  }

  function run() {
    var links = document.querySelectorAll('#main_nav > li > a');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      for (var j = 0; j < VIEWS.length; j++) {
        if (href.indexOf(VIEWS[j][1]) !== -1) {
          mark(links[i], VIEWS[j][0]);
          break;
        }
      }
    }
  }

  var observer = null;
  var navObserver = null;
  var navEl = null;
  var scheduled = false;
  var off = false;

  /* UrBackup rebuilds the navbar (innerHTML) on every view switch, so the
   * glyphs have to be re-applied after arbitrary DOM changes. The observer
   * stays attached for the lifetime of the page and the work is coalesced. */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      if (!off) run();
    }, 30);
  }

  function watch() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* The navbar itself gets a synchronous re-run: a MutationObserver callback
   * fires before the next paint, so the glyphs are back in the same frame and
   * the row never shows the text-only state. The 30ms fallback above stays for
   * every other rebuild (and for a navbar that is replaced wholesale). */
  function watchNav() {
    var nav = document.getElementById('main_nav');
    if (!nav || nav === navEl || !window.MutationObserver) return;
    if (navObserver) navObserver.disconnect();
    navEl = nav;
    navObserver = new MutationObserver(function () {
      if (!off) run();
    });
    navObserver.observe(nav, { childList: true });
  }

  function ensure() {
    off = false;
    run();
    watch();
    watchNav();
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'icons',
    onInit: ensure,
    onRender: ensure,
    onView: ensure,
    reset: function () {
      off = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (navObserver) {
        navObserver.disconnect();
        navObserver = null;
        navEl = null;
      }
      var marked = document.querySelectorAll('#main_nav a[data-ubx-icon]');
      for (var i = 0; i < marked.length; i++) {
        var svg = marked[i].querySelector('svg.ubx-icon');
        if (svg) svg.parentNode.removeChild(svg);
        marked[i].removeAttribute('data-ubx-icon');
      }
    }
  });
})();

