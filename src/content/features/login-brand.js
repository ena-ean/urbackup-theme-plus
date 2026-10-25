/*
 * login-brand.js - brand logo on the login page.
 *
 * The stock login page is a card without any heading at all - it starts with
 * the USERNAME label - so the page reads as a form without an owner. This
 * module puts the UrBackup mark above the card.
 *
 * The mark is a page-DOM <img> pointing at an extension URL, so it has to be
 * declared in manifest.json -> web_accessible_resources; Chrome exempts the
 * chrome-extension: scheme from the page's own CSP, so a server that only
 * allows same-origin images still renders it.
 *
 * Decorative only: aria-hidden, empty alt, no listeners, silent on every other
 * page.
 *
 * Contract : html[data-ubx-login] (set by ubx.js#markLogin)
 * Marks    : .ubx-login-brand > img.ubx-brand-img
 * Settings : loginBrand
 * Reset    : removes the whole .ubx-login-brand block
 */
(function () {
  'use strict';

  var BLOCK_CLASS = 'ubx-login-brand';
  var LOGO_PATH = 'src/assets/brand/logo.png';
  var LOGO_W = 224;
  var LOGO_H = 231;

  function logoUrl() {
    try {
      return chrome.runtime.getURL(LOGO_PATH);
    } catch (e) {
      return null;
    }
  }

  function build() {
    if (document.querySelector('.' + BLOCK_CLASS)) return;
    /* the login card is <div class="col-sm-6 panel"> itself, so its parent is
       the row - the mark becomes the row's first child, above the card */
    var card = document.querySelector('#data_f .panel');
    var row = card && card.parentElement;
    if (!row) return;
    var src = logoUrl();
    if (!src) return;

    var block = document.createElement('div');
    block.className = BLOCK_CLASS;
    block.setAttribute('aria-hidden', 'true');
    var img = document.createElement('img');
    img.className = 'ubx-brand-img';
    img.src = src;
    img.alt = '';
    img.width = LOGO_W;
    img.height = LOGO_H;
    img.decoding = 'async';
    block.appendChild(img);
    row.insertBefore(block, card);
  }

  function decorate() {
    try {
      if (!document.documentElement.hasAttribute('data-ubx-login')) return;
      build();
    } catch (e) {
      /* a broken brand must never keep the login form from working */
    }
  }

  (window.__ubxFeatureHooks = window.__ubxFeatureHooks || []).push({
    name: 'loginBrand',
    onRender: decorate,
    onView: decorate,
    reset: function () {
      var block = document.querySelector('.' + BLOCK_CLASS);
      if (block && block.parentNode) block.parentNode.removeChild(block);
    }
  });
})();
