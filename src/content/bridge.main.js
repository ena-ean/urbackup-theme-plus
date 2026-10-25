/*
 * bridge.main.js - page bridge (MAIN world, document_start).
 *
 * UrBackup keeps its session id in window.g.session and sets no cookies at all,
 * so the isolated content script cannot read it. This file runs in the page's
 * own JS world and provides everything the isolated world needs:
 *
 *   1. session / language mirror - postMessage { __ubx: true, source: 'page' },
 *   2. getJSON tap - re-broadcasts every response, so enhancers reuse the data
 *      the UI already fetched instead of issuing duplicate requests,
 *   3. jqplot theming - the charts are painted on a canvas, so they are themed
 *      by wrapping $.jqplot (grid, ticks, legend, pie geometry, data units),
 *   4. view switching - window.__ubx.go(index) plus the ubx:goto relay: the
 *      stock nav uses href="javascript: show_x1('')" and the server CSP blocks
 *      programmatic clicks on those links.
 *
 * Contract : window.g, window.getJSON, jQuery and $.jqplot - all optional.
 *            Every installer polls for a bounded time and then gives up, so a
 *            page without charts or without getJSON still works.
 * Exports  : window.__ubx = { version, session(), lang(), go(index) }.
 * Safety   : never throws into the page; the stock UI works without the bridge.
 */
(function () {
  'use strict';

  if (window.__ubxBridgeInstalled) return;
  window.__ubxBridgeInstalled = true;

  var VERSION = 1;

  function post(type, payload) {
    try {
      window.postMessage({ __ubx: true, source: 'page', bridge: VERSION, type: type, payload: payload }, '*');
    } catch (e) {
      /* ignore */
    }
  }

  /* ---- session / language mirror ---- */
  var lastSession = null;
  var lastLang = null;

  function mirrorState() {
    var g = window.g;
    if (!g) return;
    if (typeof g.session === 'string' && g.session && g.session !== lastSession) {
      lastSession = g.session;
      post('session', lastSession);
    }
    if (typeof g.lang === 'string' && g.lang !== lastLang) {
      lastLang = g.lang;
      post('language', lastLang);
    }
  }

  var stateTimer = setInterval(mirrorState, 500);
  /* the session id is set once during login: after that the cheap 500ms poll is
     wasted work on every tab, so it drops to a slow safety net */
  var slowTimer = setTimeout(function () {
    clearInterval(stateTimer);
    stateTimer = setInterval(mirrorState, 3000);
  }, 10000);
  window.addEventListener('pagehide', function () {
    clearInterval(stateTimer);
    clearTimeout(slowTimer);
  }, { once: true });

  /* ---- getJSON tap ---- */
  var wrapTimer = setInterval(function () {
    var original = window.getJSON;
    if (typeof original !== 'function' || original.__ubxWrapped) return;

    var wrapped = function (action, parameters, callback) {
      var tapped = function (data) {
        try {
          post('data', { action: action, data: data });
        } catch (e) {
          /* ignore */
        }
        return callback.apply(this, arguments);
      };

      try {
        return original.call(this, action, parameters, typeof callback === 'function' ? tapped : callback);
      } catch (e) {
        return original.apply(this, arguments);
      }
    };

    wrapped.__ubxWrapped = true;
    try {
      window.getJSON = wrapped;
      clearInterval(wrapTimer);
      post('ready', { getJSON: true });
    } catch (e) {
      /* ignore, retry on next tick */
    }
  }, 50);

  setTimeout(function () { clearInterval(wrapTimer); }, 30000);

  /* ---- jqplot theming ----
     jqplot paints its grid on a canvas, so the default white background and
     dark text cannot be fixed with CSS alone. Merge the dark defaults into
     every plot the page creates and tidy the data presentation: the canvas
     title duplicates the panel heading, byte ticks collapse into repeated
     "0GB/1GB" labels and pie slices are labelled with raw byte counts. */
  var jqTimer = setInterval(function () {
    var $ = window.jQuery || window.$;
    if (!$ || typeof $.jqplot !== 'function') return;

    var original = $.jqplot;
    if (original.__ubxThemed) {
      clearInterval(jqTimer);
      return;
    }

    /* canvas cannot read a CSS variable, so the logo palette is repeated here -
       keep it in step with tokens.css (text-mute / border / accent / ok / warn) */
    var text = '#b6c0cd';
    var gridLine = 'rgba(255,255,255,0.06)';
    var border = '#232d3a';
    var font = '"Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    /* accent, accent-2, then the status colours, then muted blues - the first two
       are the "alternating bars" of a series */
    var SERIES = ['#4d7fe0', '#7f9ccb', '#3fb950', '#d9a441', '#e5534b', '#1046ae', '#8fb0e8', '#6f8299'];
    /* pie labels are painted with textColor on top of the slice, so the slices
       stay deep enough for a light label to read */
    var PIE = ['#2f5fbf', '#5b7799', '#2f9440', '#a87c2c', '#b8402f', '#173f8f', '#3c6d9e', '#54677f'];

    /* "1.24 GB" instead of a raw byte count or a rounded "1GB" */
    function sizeFormatter(unit) {
      return function (format, value) {
        if (value === null || value === undefined || isNaN(value)) return '';
        var n = Number(value);
        var abs = Math.abs(n);
        var s = abs >= 100 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1) : n.toFixed(2);
        s = s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
        /* non-breaking space: the unit never wraps away from the number */
        return s + '\u00A0' + unit;
      };
    }

    function humaniseAxis(axis) {
      var tick = axis && axis.tickOptions;
      var fmt = tick && tick.formatString;
      var m = typeof fmt === 'string' && fmt.match(/(K?M?G?T?)B$/);
      if (!m) return;
      tick.formatter = sizeFormatter(m[1] ? m[1] + 'B' : 'B');
      if (!axis.numberTicks) axis.numberTicks = 5;
    }

    /* the storage graph asks for "%#d" (day number) and "%y" (two-digit year);
       both are ambiguous without context - widen them */
    function humaniseTimeAxis(axis) {
      var tick = axis && axis.tickOptions;
      if (!tick) return;
      if (tick.formatString === '%#d') tick.formatString = '%b %#d';
      else if (tick.formatString === '%y') tick.formatString = '%Y';
    }

    var themed = function (target, data, options) {
      var plotHeight = 0;
      var pristine = null;
      try {
        var opts = options || {};
        var isPie = !!(opts.seriesDefaults && opts.seriesDefaults.renderer === $.jqplot.PieRenderer);

        /* the panel heading above the canvas already carries the title */
        if (typeof opts.title === 'string') opts.title = '';
        else if (opts.title && typeof opts.title === 'object') opts.title.text = '';

        opts.grid = $.extend(true, {
          background: 'transparent',
          borderColor: border,
          borderWidth: 0,
          drawBorder: false,
          shadow: false,
          gridLineColor: gridLine,
          tickColor: gridLine
        }, opts.grid || {});

        opts.axesDefaults = $.extend(true, {
          tickOptions: { textColor: text, fontFamily: font, fontSize: '11px' },
          labelOptions: { textColor: text, fontFamily: font, fontSize: '11px' }
        }, opts.axesDefaults || {});

        /* byte-based axes ("%dGB") get readable values */
        var axes = opts.axes || {};
        for (var k in axes) {
          if (Object.prototype.hasOwnProperty.call(axes, k)) humaniseAxis(axes[k]);
        }
        if (axes.xaxis) humaniseTimeAxis(axes.xaxis);

        if (!isPie) {
          opts.seriesDefaults = $.extend(true, {
            lineWidth: 2,
            shadow: false,
            markerOptions: { size: 5, shadow: false }
          }, opts.seriesDefaults || {});
        } else if (data && data[0]) {
          /* pie values arrive in bytes; scale them to GB so the slice labels
             stay readable - a uniform factor keeps every angle identical */
          var pts = data[0];
          for (var p = 0; p < pts.length; p++) {
            if (pts[p] && typeof pts[p][1] === 'number') {
              pts[p][1] = Math.round((pts[p][1] / 1073741824) * 100) / 100;
            }
          }
          /* The statistics template hard-codes a 900px column for the pie,
             which is wider than the panel that ends up holding it: the canvas
             overflowed and the clipped disc looked pushed off centre. Reset the
             host and its wrapper to the panel width before measuring. */
          var host = typeof target === 'string' ? document.getElementById(target) : target;
          var hostWrap = host && host.parentElement;
          if (host) {
            host.style.width = '100%';
            host.style.maxWidth = '100%';
          }
          if (hostWrap) {
            hostWrap.style.width = '100%';
            hostWrap.style.maxWidth = '100%';
          }
          var width = (host && host.clientWidth) || 800;
          /* The pie is drawn from the host's left edge and the legend takes the
             right side, so a disc sized to the whole width gets clipped. Leave
             room for the legend while there is some, and move the legend under
             the disc on narrow hosts. */
          var pieLegend =
            width >= 520
              ? { location: 'e', placement: 'insideGrid' }
              : { location: 's', placement: 'outsideGrid', rendererOptions: { numberColumns: 3 } };
          var legendBelow = pieLegend.placement === 'outsideGrid';
          var diameter = legendBelow
            ? Math.min(340, Math.max(150, Math.round(width - 24)))
            : Math.min(340, Math.max(160, Math.round(width - 250)));
          /* the page reserves 430px for the pie, which leaves the disc floating
             in an empty box - shrink the host to the disc (+ the legend when it
             sits below it) */
          plotHeight = Math.round(diameter + (legendBelow ? 130 : 44));
          opts.seriesColors = PIE.slice();
          opts.textColor = '#f2fbff';
          opts.seriesDefaults = $.extend(true, {
            shadow: false,
            rendererOptions: {
              shadow: false,
              shadowDepth: 0,
              padding: 8,
              diameter: diameter,
              dataLabelFormatString: '%.2f GB'
            }
          }, opts.seriesDefaults || {});
        }
        if (!isPie) opts.seriesColors = SERIES.slice();

        opts.legend = $.extend(true, {
          textColor: text,
          background: 'transparent',
          border: 'none',
          fontSize: '12px'
        }, opts.legend || {}, pieLegend || {});

        if (!opts.textColor) opts.textColor = text;
      } catch (e) {
        /* never break the plot */
      }
      /* jqplot mutates the options object in place, so the re-create below needs
         a copy of the themed state as it is right now */
      try {
        pristine = options ? $.extend(true, {}, options) : null;
      } catch (e) {
        pristine = null;
      }
      var plot = original.apply(this, arguments);
      /* jqplot measures the host once, when the plot is created, and the
         statistics page calls it straight from the ajax callback - before the
         theme's grid has narrowed the column. The canvas therefore came out
         ~1350px wide inside a ~640px panel, and the clipped disc looked pushed
         off centre. Fit the height now and re-create the piece once the
         container has settled. */
      var el = typeof target === 'string' ? document.getElementById(target) : target;
      try {
        if (plotHeight && el) {
          el.style.height = plotHeight + 'px';
          var wrap = el.parentElement;
          if (wrap && wrap.clientHeight > plotHeight + 80) {
            wrap.style.height = (plotHeight + 40) + 'px';
          }
        }
      } catch (e) {
        /* keep the original size */
      }
      if (isPie && el) {
        refit(el, plot, target, data, pristine || options, function (again) {
          registerPie(el, again, data, pristine || options);
        });
      }
      return plot;
    };

    /* One deferred check: the statistics page builds the panel, calls jqplot and
       only then lets the theme's grid narrow the column, so the canvas can be
       sized against the full page width. Re-create the plot once the host has
       settled (the diameter is read at init too, so replot() is not enough).
       `done` hands the new plot back, which is how a later relayout knows what
       to destroy. */
    function refit(el, plot, target, data, options, done) {
      var run = function () {
        try {
          var host = typeof target === 'string' ? document.getElementById(target) : target;
          if (!host || !host.clientWidth) return;
          var measured = plot && plot._width;
          var measuredH = plot && plot._height;
          if (measured && measuredH && Math.abs(measured - host.clientWidth) <= 2 && Math.abs(measuredH - host.clientHeight) <= 2) return;
          var width = host.clientWidth;
          var height = host.clientHeight;
          var legendBelow = options && options.legend && options.legend.placement === 'outsideGrid';
          var diameter = legendBelow
            ? Math.min(340, Math.max(150, Math.round(width - 24)))
            : Math.min(340, Math.max(160, Math.round(width - 250)));
          var so = options && options.seriesDefaults;
          if (!so) {
            so = options.seriesDefaults = {};
          }
          so.rendererOptions = $.extend(true, {}, so.rendererOptions || {}, { diameter: diameter });
          if (plot && plot.destroy) plot.destroy();
          var again = original(target, data, options);
          if (host.style.height) host.style.height = height + 'px';
          if (done) {
            try {
              done(again);
            } catch (e) {
              /* a broken callback must not lose the chart */
            }
          }
          return again;
        } catch (e) {
          /* a broken refit must not take the page's chart with it */
        }
      };
      if (window.requestAnimationFrame) {
        requestAnimationFrame(function () {
          setTimeout(run, 60);
        });
      } else {
        setTimeout(run, 120);
      }
    }

    themed.prototype = original.prototype;
    for (var key in original) {
      if (Object.prototype.hasOwnProperty.call(original, key)) themed[key] = original[key];
    }
    themed.__ubxThemed = true;

    try {
      $.jqplot = themed;
      clearInterval(jqTimer);
    } catch (e) {
      /* ignore, retry */
    }
  }, 100);
  setTimeout(function () { clearInterval(jqTimer); }, 60000);

  /* ---- relayout: re-measure what was measured once ---- */
  /* jqplot reads the host size at plot() time and DataTables writes its column
     widths at init(). Both then keep the number they saw, even after the theme
     narrowed the column or the window grew: the table stayed at 836px inside a
     1362px panel and a column wrapped ("Incremental file backup" slid onto a
     second line) until the user resized the window, because DataTables only
     re-measures on its own resize handler. features/relayout.js announces every
     settled viewport change as ubx:relayout; this side does the re-measuring. */
  var livePies = [];
  var fitTimer = null;
  var fitAgain = null;
  /* a table only needs a new measurement when the space it lives in changed:
     columns.adjust() walks every row, and the file browser draws 2000 of them */
  var fittedWidth = typeof WeakMap === 'function' ? new WeakMap() : null;

  function registerPie(el, plot, data, options) {
    for (var i = 0; i < livePies.length; i++) {
      if (livePies[i].el === el) {
        livePies[i].plot = plot;
        livePies[i].data = data;
        livePies[i].options = options;
        return;
      }
    }
    livePies.push({ el: el, plot: plot, data: data, options: options });
  }

  function fitPies() {
    for (var i = 0; i < livePies.length; i++) {
      var pie = livePies[i];
      try {
        if (!pie.el || !pie.el.isConnected || !pie.el.clientWidth) continue;
        refit(pie.el, pie.plot, pie.el, pie.data, pie.options, function (again) {
          registerPie(pie.el, again, pie.data, pie.options);
        });
      } catch (e) {
        /* one broken chart must not stop the others */
      }
    }
  }

  function fitTables() {
    try {
      var $ = window.jQuery;
      if (!$ || !$.fn || !$.fn.dataTable || !$.fn.dataTable.tables) return;
      var tables = $.fn.dataTable.tables(true) || [];
      for (var i = 0; i < tables.length; i++) {
        var node = tables[i];
        try {
          /* the width the table is supposed to fill, as its wrapper sees it */
          var host = node.parentElement || node;
          var width = host.clientWidth;
          if (!width) continue;
          if (fittedWidth && fittedWidth.get(node) === width) continue;
          if (fittedWidth) fittedWidth.set(node, width);
          $(node).DataTable().columns.adjust();
        } catch (e) {
          /* a table without an API left over from an old view */
        }
      }
    } catch (e) {
      /* no DataTables on this page */
    }
  }

  function scheduleFit(withPies) {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      fitTimer = null;
      fitTables();
      if (withPies) fitPies();
      /* a table created by the view's ajax answer can arrive after this pass */
      if (fitAgain) clearTimeout(fitAgain);
      fitAgain = setTimeout(function () {
        fitAgain = null;
        fitTables();
      }, 600);
    }, 120);
  }

  document.addEventListener('ubx:relayout', function () { scheduleFit(true); }, false);
  document.addEventListener('ubx:render', function () { scheduleFit(false); }, false);

  /* ---- public namespace for page-side helpers ---- */
  window.__ubx = window.__ubx || {};
  window.__ubx.version = VERSION;
  window.__ubx.session = function () {
    return (window.g && window.g.session) || null;
  };
  window.__ubx.lang = function () {
    return (window.g && window.g.lang) || 'en';
  };

  /* View switching for the isolated world: the stock nav uses
     href="javascript: show_x1('')" links, which the server's CSP blocks for
     programmatic clicks, so the content script asks us to call the page
     function directly instead. */
  window.__ubx.go = function (index) {
    var links = document.querySelectorAll('#main_nav > li > a');
    var link = links[index];
    if (!link) return false;
    var match = /show_([a-zA-Z]+)1/.exec(link.getAttribute('href') || '');
    if (!match) return false;
    var fn = window['show_' + match[1] + '1'];
    if (typeof fn !== 'function') return false;
    try {
      fn('');
      return true;
    } catch (e) {
      return false;
    }
  };

  /* Relay from the isolated world (same DOM, separate JS worlds). */
  document.addEventListener('ubx:goto', function (event) {
    var index = event && event.detail ? event.detail.index : null;
    if (typeof index === 'number') window.__ubx.go(index);
  }, false);
})();
