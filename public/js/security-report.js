(function () {
  'use strict';

  var STORAGE_KEY = 'aurora-report-lang';

  var TITLES = {
    en: 'Aurora — Security & System Assurance Report',
    zh: 'Aurora — 保安與系統保證報告'
  };

  var BRAND = {
    en: 'Security Report',
    zh: '保安報告'
  };

  var BUTTON_LABEL = {
    en: '中文',
    zh: 'English'
  };

  var BUTTON_ARIA = {
    en: '切換至中文',
    zh: 'Switch to English'
  };

  var current = 'en';

  function $(id) {
    return document.getElementById(id);
  }

  /* Show / hide a section using BOTH the [hidden] attribute and a
     class, so no stylesheet rule can accidentally override it. */
  function setVisible(el, visible) {
    if (!el) return;
    if (visible) {
      el.removeAttribute('hidden');
      el.classList.remove('is-hidden');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.setAttribute('hidden', '');
      el.classList.add('is-hidden');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function applyLang(lang) {
    current = (lang === 'zh') ? 'zh' : 'en';
    var isZh = (current === 'zh');

    setVisible($('report-en'), !isZh);
    setVisible($('report-zh'), isZh);

    var label = $('langToggleLabel');
    if (label) label.textContent = BUTTON_LABEL[current];

    var brand = $('brandLabel');
    if (brand) brand.textContent = BRAND[current];

    var btn = $('langToggle');
    if (btn) btn.setAttribute('aria-label', BUTTON_ARIA[current]);

    document.documentElement.lang = isZh ? 'zh-Hant' : 'en';
    document.title = TITLES[current];

    try { localStorage.setItem(STORAGE_KEY, current); } catch (err) {}
  }

  function toggle() {
    applyLang(current === 'zh' ? 'en' : 'zh');
  }

  /* Delegated click handling.
     Works even when the click lands on the inner <svg> or <span>,
     and does not depend on a listener being bound to the button. */
  document.addEventListener('click', function (ev) {
    var node = ev.target;
    while (node && node !== document) {
      if (node.id === 'langToggle') {
        ev.preventDefault();
        toggle();
        return;
      }
      node = node.parentNode;
    }
  });

  function init() {
    var saved = 'en';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'en'; } catch (err) {}
    applyLang(saved === 'zh' ? 'zh' : 'en');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();