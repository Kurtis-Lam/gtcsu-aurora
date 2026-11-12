import { APP_VERSION } from './info.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const root = document.documentElement;

const RIPPLE_SELECTOR = [
  '.nav-btn', '.nav-auth-btn', '.lang-toggle', '.info-toggle', '.info-close', '.cta', '.submit-btn',
  '.identity-toggle', '.support-button', '.read-btn', '.google-btn', '.filter-btn', '.ghost-btn',
  '.download-btn', '.card-download', '.lightbox-close', '.aurora-modal-btn', '.page-btn', '.tab-btn',
  '.btn', '.dest-btn', '.dz-btn', '.expand-btn', '.modal-close-btn'
].join(',');

const el = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const LITE_KEY = 'aurora_fx_lite_v2';

const isLite = () => root.classList.contains('fx-lite');

function enableLite() {
  if (isLite()) return;
  root.classList.add('fx-lite');
  try { sessionStorage.setItem(LITE_KEY, '1'); } catch {}
}

// Decorative effects are switched off only on genuinely weak devices or when the
// visitor asked for reduced data. The background video is never touched.
function detectLowEnd() {
  const nav = navigator;
  const cores = nav.hardwareConcurrency || 8;
  const memory = nav.deviceMemory || 8;
  const saveData = !!(nav.connection && nav.connection.saveData);
  let remembered = false;
  try { remembered = sessionStorage.getItem(LITE_KEY) === '1'; } catch {}
  if (cores <= 2 || memory <= 2 || saveData || remembered) root.classList.add('fx-lite');
}

// Frame times are sampled only while the visitor scrolls or moves the pointer,
// because an idle page always looks smooth. A sustained slow window switches the
// decorative layer off for the rest of the tab session.
function watchPerformance() {
  if (reducedMotion.matches || isLite()) return;

  const WINDOW = 60;
  const SLOW_MS = 24;
  const SETTLE_FRAMES = 20;
  let lastActive = 0;
  let running = false;
  let previous = 0;
  let count = 0;
  let total = 0;
  let settle = SETTLE_FRAMES;

  function tick(now) {
    if (document.hidden || now - lastActive > 600) {
      running = false;
      previous = 0;
      return;
    }
    if (previous) {
      const delta = now - previous;
      if (delta < 250) {
        if (settle > 0) {
          settle -= 1;
        } else {
          total += delta;
          count += 1;
        }
      }
    }
    previous = now;

    if (count >= WINDOW) {
      if (total / count > SLOW_MS) {
        enableLite();
        window.removeEventListener('scroll', wake);
        window.removeEventListener('pointermove', wake);
        running = false;
        return;
      }
      count = 0;
      total = 0;
    }
    requestAnimationFrame(tick);
  }

  function wake() {
    lastActive = performance.now();
    if (running) return;
    running = true;
    previous = 0;
    settle = SETTLE_FRAMES;
    requestAnimationFrame(tick);
  }

  setTimeout(() => {
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('pointermove', wake, { passive: true });
  }, 2600);
}

function injectStyles() {
  if (document.querySelector('link[data-aurora-fx]')) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/aurora-fx.css', import.meta.url).href + '?v=' + encodeURIComponent(APP_VERSION);
  link.dataset.auroraFx = '';
  document.head.appendChild(link);
}

// Stars are plain elements twinkling through a CSS opacity animation, so the
// compositor runs them and the main thread (and the video) never pays for a frame.
function buildStars(layer) {
  const count = Math.max(8, Math.min(14, Math.round((window.innerWidth * window.innerHeight) / 90000)));
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const star = el('i', 'fx-star');
    const size = (0.8 + Math.random() * 1.6).toFixed(1);
    star.style.cssText =
      `left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;` +
      `width:${size}px;height:${size}px;` +
      `--d:${(2.5 + Math.random() * 3.5).toFixed(1)}s;--o:-${(Math.random() * 6).toFixed(1)}s`;
    fragment.appendChild(star);
  }
  layer.appendChild(fragment);
}

function startShooter(layer) {
  if (reducedMotion.matches) return;
  const star = el('i', 'fx-shoot');
  layer.appendChild(star);
  star.addEventListener('animationend', () => star.classList.remove('go'));

  const schedule = () => setTimeout(fire, 7000 + Math.random() * 8000);
  function fire() {
    if (document.hidden || isLite()) { schedule(); return; }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const angle = 111 + Math.random() * 29;
    const rad = (angle * Math.PI) / 180;
    const distance = 420 + Math.random() * 260;
    star.style.left = `${(width * (0.15 + Math.random() * 0.8)).toFixed(0)}px`;
    star.style.top = `${(height * Math.random() * 0.35).toFixed(0)}px`;
    star.style.setProperty('--a', `${angle.toFixed(1)}deg`);
    star.style.setProperty('--dx', `${(Math.cos(rad) * distance).toFixed(0)}px`);
    star.style.setProperty('--dy', `${(Math.sin(rad) * distance).toFixed(0)}px`);
    star.classList.remove('go');
    void star.offsetWidth;
    star.classList.add('go');
    schedule();
  }
  schedule();
}

function buildAmbient() {
  if (document.querySelector('.fx-ambient')) return;
  const hasSky = !!document.getElementById('background-container');

  if (hasSky && !isLite()) {
    const ambient = el('div', 'fx-ambient');
    ambient.setAttribute('aria-hidden', 'true');
    ambient.appendChild(el('div', 'fx-aurora'));
    document.body.appendChild(ambient);
    buildStars(ambient);
    startShooter(ambient);
  }

  const progress = el('div', 'fx-progress');
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  if (finePointer.matches) {
    const cursor = el('div', 'fx-cursor');
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
  }
}

// The cursor glow is one element moved with a transform: no per-element hit
// testing, no gradient repaint, no style recalculation of the page.
function wirePointer() {
  const glow = document.querySelector('.fx-cursor');
  if (!glow) return;

  let x = 0;
  let y = 0;
  let queued = false;
  let visible = false;

  const paint = () => {
    queued = false;
    glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (!visible) {
      visible = true;
      glow.classList.add('is-on');
    }
  };

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || isLite() || reducedMotion.matches) return;
    x = event.clientX;
    y = event.clientY;
    if (!queued) {
      queued = true;
      requestAnimationFrame(paint);
    }
  }, { passive: true });

  root.addEventListener('mouseleave', () => {
    visible = false;
    glow.classList.remove('is-on');
  });
}

function wireRipple() {
  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion.matches || isLite() || event.button > 0) return;
    const target = event.target.closest ? event.target.closest(RIPPLE_SELECTOR) : null;
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ripple = el('span', 'fx-ripple');
    ripple.style.cssText =
      `width:${size}px;height:${size}px;left:${(event.clientX - rect.left - size / 2).toFixed(1)}px;` +
      `top:${(event.clientY - rect.top - size / 2).toFixed(1)}px`;
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    setTimeout(() => ripple.remove(), 900);
  }, { passive: true });
}

function wireScroll() {
  let ticking = false;
  let bar = null;
  let scrolled = false;
  let max = 1;

  let measureQueued = false;
  const measure = () => { max = Math.max(1, root.scrollHeight - window.innerHeight); };
  const queueMeasure = () => {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => { measureQueued = false; measure(); schedule(); });
  };

  const update = () => {
    ticking = false;
    if (!bar) bar = document.querySelector('.fx-progress');
    const y = window.scrollY;
    if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, y / max)).toFixed(4)})`;
    const nowScrolled = y > 24;
    if (nowScrolled !== scrolled) {
      scrolled = nowScrolled;
      document.body.classList.toggle('fx-scrolled', scrolled);
    }
  };

  const schedule = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.body);
  measure();
  update();
}

function init() {
  detectLowEnd();
  watchPerformance();
  buildAmbient();
  wirePointer();
  wireRipple();
  wireScroll();
}

injectStyles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}