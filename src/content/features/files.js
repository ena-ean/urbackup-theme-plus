/*
 * Feature: file browser (Clients > client > backup > folder).
 *
 * The stock file list is a bare table: an empty 25px icon column, three
 * equally loud date columns and a "List"/"Restore" button pair on every row.
 * This decorator adds file-type glyphs, marks folders/sizes/dates for CSS and
 * lifts the folder-level actions above the table.
 *
 * Detection is by handler, never by text (the UI is localised):
 *   #data_f a[onclick*="downloadZIP"]        -> the folder view
 *   td[onclick*="tabMouseClickFiles"]         -> the per-file version list
 *
 * Contract : __ubxPixelIcon (icons.js), the handler-based selectors above
 * Marks    : table.ubx-files, tr[data-ubx-kind], .ubx-file-size, .ubx-file-date,
 *            .ubx-file-action, .ubx-files-toolbar, .ubx-files-crumb
 * Settings : files
 * Reset    : restores the original cells and moves the buttons back
 */
(function () {
  'use strict';

  var px = window.__ubxPixelIcon;

  var ICONS = {
    folder: [
      '.####.....',
      '######....',
      '##########',
      '##########',
      '##########',
      '##########'
    ],
    file: [
      '.#######..',
      '.#.....##.',
      '.#......#.',
      '.#......#.',
      '.#......#.',
      '.#......#.',
      '.#......#.',
      '.#########'
    ],
    doc: [
      '########..',
      '..........',
      '########..',
      '..........',
      '########..',
      '..........',
      '########..'
    ],
    image: [
      '##########',
      '#........#',
      '#..#.....#',
      '#........#',
      '#....##..#',
      '#...####.#',
      '#........#',
      '##########'
    ],
    archive: [
      '##########',
      '#...##...#',
      '#...##...#',
      '#...##...#',
      '#...##...#',
      '#...##...#',
      '##########'
    ]
  };

  var EXT = {
    image: 'jpg jpeg png gif bmp webp svg ico tif tiff heic psd raw',
    archive: 'zip rar 7z tar gz bz2 xz iso cab',
    doc: 'txt md pdf doc docx odt rtf xls xlsx ods csv ppt pptx odp json xml html htm log ini cfg'
  };

  function iconFor(name, isFolder) {
    if (isFolder) return 'folder';
    var dot = name.lastIndexOf('.');
    if (dot === -1) return 'file';
    var ext = name.slice(dot + 1).toLowerCase();
    for (var key in EXT) {
      if (EXT.hasOwnProperty(key) && (' ' + EXT[key] + ' ').indexOf(' ' + ext + ' ') !== -1) return key;
    }
    return 'file';
  }

  /*
   * Column roles are derived from the row structure, never from header text
   * (the UI is localised): the name cell is the one carrying the file handler,
   * the cell before it is the stock empty glyph slot, and everything between
   * the name and the action cell is size + dates. Cached per table.
   */
  function columnsFor(table, row) {
    if (table.__ubxCols) return table.__ubxCols;

    var cells = row.cells;
    var name = -1;
    var lastHandler = -1;
    for (var i = 0; i < cells.length; i++) {
      if ((cells[i].getAttribute('onclick') || '').indexOf('tabMouseClickFiles') === -1) continue;
      /* the stock glyph slot carries the same handler but is empty: the name
         cell is the first non-blank handler cell */
      lastHandler = i;
      if (cells[i].textContent.trim()) {
        name = i;
        break;
      }
    }
    if (name === -1) name = lastHandler;
    if (name === -1) return null;

    var icon = -1;
    var before = cells[name - 1];
    if (before && !before.textContent.trim() && !before.querySelector('svg')) icon = name - 1;

    var end = cells.length;
    for (var c = name + 1; c < cells.length; c++) {
      if (cells[c].querySelector('a, button, input, select')) {
        end = c;
        break;
      }
    }

    var dates = [];
    for (var d = name + 2; d < end; d++) dates.push(d);

    var cols = { name: name, icon: icon, size: name + 1 < end ? name + 1 : -1, dates: dates };
    table.__ubxCols = cols;
    return cols;
  }

  /* UrBackup renders some drill-down tables with the header row inside the
     tbody; move it to a real thead so the shared table styling applies. */
  function promoteHeaderRow() {
    var table = document.querySelector('#data_f table');
    if (!table || table.tHead) return;
    var body = table.tBodies[0];
    var first = body && body.rows[0];
    if (!first || first.querySelector('td')) return;
    if (!first.querySelector('th')) return;
    var thead = document.createElement('thead');
    thead.appendChild(first);
    table.insertBefore(thead, table.firstChild);
  }

  /* rasterised glyphs are reused as clones: building the svg markup per row is
     the difference between a fast and an unusable list on large folders */
  var glyphCache = {};

  function glyph(type) {
    if (glyphCache[type]) return glyphCache[type].cloneNode(true);
    var host = document.createElement('div');
    host.innerHTML = px(ICONS[type] || ICONS.file);
    var node = host.firstChild;
    if (!node) return null;
    glyphCache[type] = node;
    return node.cloneNode(true);
  }

  function decorate() {
    promoteHeaderRow();
    if (!px) return;
    var root = document.getElementById('data_f');
    var table = root && root.querySelector('table');
    if (!table) return;
    var marked = table.classList.contains('ubx-files');
    if (marked && !table.querySelector('tbody > tr:not([data-ubx-kind])')) return;

    /* the file browser always offers a folder ZIP download; the per-file
       version list is recognised by its own row handlers */
    var isBrowser = !!root.querySelector('a[onclick*="downloadZIP"]');
    if (!isBrowser && !table.querySelector('td[onclick*="tabMouseClickFiles"]')) return;

    /* paging and sorting re-render rows: only touch the new ones */
    var rows = table.querySelectorAll('tbody > tr:not([data-ubx-kind])');

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var cols = columnsFor(table, tr);
      if (!cols) continue;
      var name = tr.cells[cols.name];
      if (!name) continue;
      var handler = name.getAttribute('onclick') || '';
      if (handler.indexOf('tabMouseClickFiles') === -1) continue;

      /* tabMouseClickFilesDL = a file, tabMouseClickFiles = a folder */
      var isFolder = handler.indexOf('tabMouseClickFilesDL') === -1;
      var type = iconFor(name.textContent.trim(), isFolder);
      tr.setAttribute('data-ubx-kind', isFolder ? 'folder' : 'file');
      tr.setAttribute('data-ubx-type', type);
      tr.classList.add('ubx-file-row');

      var iconCell = cols.icon === -1 ? null : tr.cells[cols.icon];
      if (iconCell && !iconCell.querySelector('svg')) {
        var node = glyph(type);
        if (node) iconCell.appendChild(node);
      }

      if (cols.size !== -1 && tr.cells[cols.size]) tr.cells[cols.size].classList.add('ubx-file-size');
      for (var d = 0; d < cols.dates.length; d++) {
        if (tr.cells[cols.dates[d]]) tr.cells[cols.dates[d]].classList.add('ubx-file-date');
      }

      var actions = tr.querySelectorAll('a.btn');
      for (var a = 0; a < actions.length; a++) actions[a].classList.add('ubx-file-action');
    }

    table.classList.add('ubx-files');

    /* folder-level actions live in the panel heading, next to the breadcrumb */
    var body = table.parentNode;
    if (body && !body.querySelector('.ubx-files-toolbar')) {
      var toolbar = document.createElement('div');
      toolbar.className = 'ubx-files-toolbar';
      var links = body.querySelectorAll('a.btn');
      for (var l = 0; l < links.length; l++) {
        if (table.contains(links[l])) continue;
        toolbar.appendChild(links[l]);
      }
      if (!toolbar.childNodes.length) return;
      var panel = body.parentNode;
      var heading = panel && panel.querySelector('.panel-heading');
      if (heading) {
        /* wrap the breadcrumb so the heading can lay it and the actions out */
        var crumb = document.createElement('span');
        crumb.className = 'ubx-files-crumb';
        while (heading.firstChild) crumb.appendChild(heading.firstChild);
        heading.appendChild(crumb);
        heading.appendChild(toolbar);
      } else {
        body.insertBefore(toolbar, table);
      }
    }
  }

  /* Undo everything this feature injected: the toggle can be switched off
     while a file list is open and the stock markup must come back. */
  function reset() {
    var root = document.getElementById('data_f');
    if (!root) return;

    var glyphs = root.querySelectorAll('table.ubx-files td > svg.ubx-icon');
    for (var g = 0; g < glyphs.length; g++) glyphs[g].parentNode.textContent = '\u00a0';

    var tables = root.querySelectorAll('table.ubx-files');
    for (var t = 0; t < tables.length; t++) {
      tables[t].classList.remove('ubx-files');
      try {
        delete tables[t].__ubxCols;
      } catch (e) {
        tables[t].__ubxCols = null;
      }
    }

    var rows = root.querySelectorAll('[data-ubx-kind]');
    for (var r = 0; r < rows.length; r++) {
      rows[r].removeAttribute('data-ubx-kind');
      rows[r].removeAttribute('data-ubx-type');
      rows[r].classList.remove('ubx-file-row');
    }

    var marked = root.querySelectorAll('.ubx-file-size, .ubx-file-date, .ubx-file-action, .ubx-files-toolbar, .ubx-files-crumb');
    for (var m = 0; m < marked.length; m++) {
      marked[m].classList.remove('ubx-file-size');
      marked[m].classList.remove('ubx-file-date');
      marked[m].classList.remove('ubx-file-action');
    }

    var toolbar = root.querySelector('.ubx-files-toolbar');
    var table = root.querySelector('table');
    if (toolbar) {
      var anchor = table ? table.nextSibling : null;
      var host = (table && table.parentNode) || toolbar.parentNode;
      while (toolbar.firstChild) host.insertBefore(toolbar.firstChild, anchor);
      if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    }

    var crumb = root.querySelector('.ubx-files-crumb');
    if (crumb && crumb.parentNode) {
      var heading = crumb.parentNode;
      while (crumb.firstChild) heading.insertBefore(crumb.firstChild, crumb);
      heading.removeChild(crumb);
    }
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'files',
    onInit: decorate,
    onRender: decorate,
    onView: decorate,
    reset: reset
  });
})();
