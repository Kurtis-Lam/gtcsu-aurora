import { APP_VERSION } from './info.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

const CARD_SELECTOR = [
  '.glass-card', '.act-card', '.offer-card', '.month-card', '.news-card', '.notice',
  '.glass-panel', '.faq-item', '.auth-card', '.notice-card', '.photo-card', '.consent-card',
  '.modal-card', '.aurora-modal-card', '.kpi-card', '.chart-card', '.card', '.news-admin-card',
  '.sl-panel', '.supporters-table-wrap', '.info-sheet'
].join(',');

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

function injectStyles() {
  if (document.querySelector('link[data-aurora-fx]')) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/aurora-fx.css', import.meta.url).href + '?v=' + encodeURIComponent(APP_VERSION);
  link.dataset.auroraFx = '';
  document.head.appendChild(link);
}

function startStars(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let stars = [];
  let shooter = null;
  let nextShooter = performance.now() + 4500;
  let frameId = 0;
  let lastFrame = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  let targetX = 0;
  let targetY = 0;

  const random = (min, max) => min + Math.random() * (max - min);

  function resize() {
    const ratio = 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(80, Math.round((width * height) / 18000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: random(0.3, 1.4),
      phase: random(0, Math.PI * 2),
      speed: random(0.5, 1.8),
      depth: random(0.2, 1),
      color: Math.random() < 0.3 ? 'hsl(165 90% 86%)' : 'hsl(190 90% 86%)'
    }));
  }

  function spawnShooter(now) {
    const startX = random(width * 0.15, width * 0.95);
    const startY = random(0, height * 0.35);
    const angle = random(Math.PI * 0.62, Math.PI * 0.78);
    const speed = random(0.9, 1.4);
    shooter = { x: startX, y: startY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, life: 900 };
    nextShooter = now + random(7000, 15000);
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    parallaxX += (targetX - parallaxX) * 0.05;
    parallaxY += (targetY - parallaxY) * 0.05;

    for (const star of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin((now / 1000) * star.speed + star.phase);
      ctx.globalAlpha = 0.18 + 0.8 * twinkle;
      ctx.fillStyle = star.color;
      const size = star.radius * 2;
      ctx.fillRect(star.x + parallaxX * star.depth * 14 - star.radius, star.y + parallaxY * star.depth * 14 - star.radius, size, size);
    }

    if (!shooter && now > nextShooter) spawnShooter(now);
    if (shooter) {
      const age = now - shooter.born;
      if (age > shooter.life) {
        shooter = null;
      } else {
        const headX = shooter.x + shooter.vx * age * 0.55;
        const headY = shooter.y + shooter.vy * age * 0.55;
        const tail = 140;
        const mag = Math.hypot(shooter.vx, shooter.vy);
        const tailX = headX - (shooter.vx / mag) * tail;
        const tailY = headY - (shooter.vy / mag) * tail;
        const fade = 1 - age / shooter.life;
        const gradient = ctx.createLinearGradient(tailX, tailY, headX, headY);
        gradient.addColorStop(0, 'rgba(127,233,240,0)');
        gradient.addColorStop(1, 'rgba(234,255,251,0.95)');
        ctx.globalAlpha = fade;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(headX, headY);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    if (now - lastFrame < 50) return;
    lastFrame = now;
    draw(now);
  }

  function start() {
    if (frameId || reducedMotion.matches || document.hidden) return;
    frameId = requestAnimationFrame(frame);
  }

  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  resize();
  draw(performance.now());
  start();

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); draw(performance.now()); }, 150);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reducedMotion.addEventListener?.('change', () => (reducedMotion.matches ? stop() : start()));
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    targetX = event.clientX / window.innerWidth - 0.5;
    targetY = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });
}

function buildAmbient() {
  if (document.querySelector('.fx-ambient')) return;
  const hasSky = !!document.getElementById('background-container');

  if (hasSky) {
    const ambient = el('div', 'fx-ambient');
    ambient.setAttribute('aria-hidden', 'true');
    const aurora = el('div', 'fx-aurora');
    const canvas = el('canvas', 'fx-stars');
    ambient.append(aurora, canvas);
    document.body.appendChild(ambient);
    startStars(canvas);
  }

  const veil = el('div', 'fx-veil');
  veil.setAttribute('aria-hidden', 'true');
  const progress = el('div', 'fx-progress');
  progress.setAttribute('aria-hidden', 'true');
  document.body.append(veil, progress);

  if (finePointer.matches) {
    const cursor = el('div', 'fx-cursor');
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
  }
}

function wirePointer() {
  const root = document.documentElement;
  let pending = null;

  const flush = () => {
    const event = pending;
    pending = null;
    if (!event) return;

    const glow = document.querySelector('.fx-cursor');
    if (glow) {
      glow.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      glow.classList.add('is-on');
    }

    root.style.setProperty('--fx-px', ((event.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
    root.style.setProperty('--fx-py', ((event.clientY / window.innerHeight - 0.5) * 2).toFixed(3));

    const card = event.target.closest ? event.target.closest(CARD_SELECTOR) : null;
    if (card) {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (event.clientX - rect.left).toFixed(1) + 'px');
      card.style.setProperty('--my', (event.clientY - rect.top).toFixed(1) + 'px');
    }
  };

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || reducedMotion.matches) return;
    if (!pending) requestAnimationFrame(flush);
    pending = event;
  }, { passive: true });

  document.addEventListener('pointerleave', () => {
    document.querySelector('.fx-cursor')?.classList.remove('is-on');
  });
  document.documentElement.addEventListener('mouseleave', () => {
    document.querySelector('.fx-cursor')?.classList.remove('is-on');
  });
}

function wireRipple() {
  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion.matches || event.button > 0) return;
    const target = event.target.closest ? event.target.closest(RIPPLE_SELECTOR) : null;
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ripple = el('span', 'fx-ripple');
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    setTimeout(() => ripple.remove(), 1200);
  }, { passive: true });
}

function wireScroll() {
  const root = document.documentElement;
  let ticking = false;

  const update = () => {
    ticking = false;
    const max = Math.max(1, root.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / max));
    root.style.setProperty('--fx-progress', progress.toFixed(4));
    document.body.classList.toggle('fx-scrolled', window.scrollY > 24);
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

function wirePageTransitions() {
  const root = document.documentElement;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (reducedMotion.matches) return;
    const link = event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;

    let url;
    try { url = new URL(link.href, window.location.href); } catch { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    if (/\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return;

    event.preventDefault();
    root.classList.add('fx-leaving');
    setTimeout(() => { window.location.href = url.href; }, 280);
  });

  window.addEventListener('pageshow', () => root.classList.remove('fx-leaving'));
}

function markBooted() {
  const root = document.documentElement;
  const done = () => setTimeout(() => root.classList.add('fx-booted'), 1800);
  if (document.body.classList.contains('is-loaded')) return done();
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('is-loaded')) {
      observer.disconnect();
      done();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

function init() {
  markBooted();
  buildAmbient();
  wirePointer();
  wireRipple();
  wireScroll();
  wirePageTransitions();
}

injectStyles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}