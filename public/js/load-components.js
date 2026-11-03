import { APP_VERSION, initInfo, refreshInfo } from './info.js';
import { freezeBackgroundVideo } from './fx.js';
import { NEWS_READ_EVENT, getLocalReads, readRevision } from './news-reads.js';
import { API_BASE } from './api-config.js';

const FIREBASE_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
const FIREBASE_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Firebase is large, so it is loaded on demand and never blocks the page shell
// (navigation, background and floating buttons mount without waiting for it).
let fb = null;
let firebasePromise = null;
let siteProvider = null;

function loadFirebase() {
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import('./firebase-config.js'),
      import(FIREBASE_AUTH_URL),
      import(FIREBASE_FIRESTORE_URL),
      import('./preload.js')
    ]).then(([config, authApi, firestoreApi, preload]) => {
      fb = { config, authApi, firestoreApi, preload };
      siteProvider = new authApi.GoogleAuthProvider();
      siteProvider.setCustomParameters({ hd: config.ALLOWED_DOMAIN, prompt: 'select_account' });
      startAuthWatch();
      return fb;
    }).catch(error => {
      firebasePromise = null;
      console.error('Could not load Firebase:', error);
      throw error;
    });
  }
  return firebasePromise;
}

function runWhenIdle(task, timeout = 3000) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout });
  else setTimeout(task, 400);
}

function afterPageLoad(task) {
  if (document.readyState === 'complete') task();
  else window.addEventListener('load', task, { once: true });
}

function canPrefetch() {
  if (document.documentElement.classList.contains('fx-lite')) return false;
  const connection = navigator.connection;
  if (!connection) return true;
  return !connection.saveData && !/(^|-)2g$/.test(connection.effectiveType || '');
}

// Shared components are cached per release: returning visits paint the navigation
// instantly from the cache while a fresh copy is fetched in the background.
function fetchComponent(file) {
  const key = `aurora_component:${APP_VERSION}:${file}`;
  let cached = null;
  try { cached = localStorage.getItem(key); } catch {}

  const network = fetch(file)
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
    .then(text => {
      try { localStorage.setItem(key, text); } catch {}
      return text;
    })
    .catch(err => { console.error(`Error loading ${file} component:`, err); return null; });

  return cached ? Promise.resolve(cached) : network;
}

const panelFetchPromise = fetchComponent('panel.html');
const backgroundFetchPromise = fetchComponent('background.html');
const infoFetchPromise = fetchComponent('info.html');

const currentLang = () => (localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en');

function applyLanguage(root) {
  const lang = currentLang();
  root.querySelectorAll('.i18n').forEach(el => {
    const text = el.getAttribute(`data-${lang}`);
    if (text) el.innerHTML = text;
  });
}

// ---------------------------------------------------------------------------
// "School email required" popup
// ---------------------------------------------------------------------------
const MODAL_TEXT = {
  en: {
    title: 'School email required',
    body: (domain) => `Please sign in with your school Google account (@${domain}). Personal accounts such as Gmail can't be used here.`,
    attempted: 'You tried:',
    retry: 'Use school account',
    close: 'Close'
  },
  zh: {
    title: '需要使用學校電郵',
    body: (domain) => `請使用學校 Google 帳戶（@${domain}）登入。個人帳戶（例如 Gmail）無法使用。`,
    attempted: '你嘗試使用：',
    retry: '使用學校帳戶',
    close: '關閉'
  }
};

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;

  const style = document.createElement('style');
  style.textContent = `
    .aurora-modal { position:fixed; inset:0; z-index:5000; display:flex; align-items:center; justify-content:center;
      padding:20px; background:rgba(5,11,18,0.82);
      opacity:0; visibility:hidden; transition:opacity .25s ease, visibility .25s ease; }
    .aurora-modal.active { opacity:1; visibility:visible; }
    .aurora-modal-card { width:100%; max-width:420px; text-align:center; padding:28px 26px;
      background:rgba(10,26,32,0.96); border:1px solid rgba(127,233,240,0.35); border-radius:16px;
      box-shadow:0 12px 40px rgba(0,0,0,0.5); font-family:'Manrope',sans-serif; color:#dff6f2; }
    .aurora-modal-icon { font-size:2rem; margin-bottom:8px; }
    .aurora-modal-title { font-family:'Cinzel',serif; font-size:1.25rem; color:#eafffb; margin-bottom:10px; }
    .aurora-modal-body { font-size:0.92rem; line-height:1.6; color:rgba(223,246,242,0.85); }
    .aurora-modal-attempt { margin-top:10px; font-size:0.8rem; color:rgba(223,246,242,0.55); word-break:break-all; }
    .aurora-modal-actions { display:flex; gap:10px; justify-content:center; margin-top:20px; flex-wrap:wrap; }
    .aurora-modal-btn { font-family:inherit; font-size:0.88rem; padding:9px 20px; border-radius:999px; cursor:pointer;
      border:1px solid rgba(127,233,240,0.4); background:transparent; color:#eafffb; transition:all .25s ease; }
    .aurora-modal-btn:hover { background:rgba(127,233,240,0.15); border-color:rgba(127,233,240,0.8); }
    .aurora-modal-btn.primary { background:rgba(46,230,184,0.18); border-color:rgba(46,230,184,0.6); }
  `;
  document.head.appendChild(style);

  modalEl = document.createElement('div');
  modalEl.className = 'aurora-modal';
  modalEl.setAttribute('role', 'alertdialog');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.innerHTML = `
    <div class="aurora-modal-card">
      <div class="aurora-modal-icon">🎓</div>
      <h3 class="aurora-modal-title"></h3>
      <p class="aurora-modal-body"></p>
      <p class="aurora-modal-attempt"></p>
      <div class="aurora-modal-actions">
        <button type="button" class="aurora-modal-btn primary" data-act="retry"></button>
        <button type="button" class="aurora-modal-btn" data-act="close"></button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  const close = () => modalEl.classList.remove('active');
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl || e.target.dataset.act === 'close') close();
    if (e.target.dataset.act === 'retry') { close(); AuroraAuth.signIn(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return modalEl;
}

async function showSchoolEmailModal(attemptedEmail) {
  const { config } = fb || await loadFirebase();
  const t = MODAL_TEXT[currentLang()];
  const el = ensureModal();
  el.querySelector('.aurora-modal-title').textContent = t.title;
  el.querySelector('.aurora-modal-body').textContent = t.body(config.ALLOWED_DOMAIN);
  el.querySelector('.aurora-modal-attempt').textContent = attemptedEmail ? `${t.attempted} ${attemptedEmail}` : '';
  el.querySelector('[data-act="retry"]').textContent = t.retry;
  el.querySelector('[data-act="close"]').textContent = t.close;
  el.classList.add('active');
}

// ---------------------------------------------------------------------------
// Site-wide auth, exported for pages (import { AuroraAuth } from './load-components.js')
// Only school accounts count as "signed in" on the public site. Other accounts
// (e.g. an admin's personal Gmail in the same browser) are ignored, not signed
// out, so an admin session in another tab isn't destroyed.
// ---------------------------------------------------------------------------
let currentUser = null;
let authResolved = false;
const authListeners = new Set();
let newsUnsubscribers = [];
let stopLocalReadWatch = null;

function watchUnreadNews(user) {
  newsUnsubscribers.forEach(unsubscribe => unsubscribe());
  newsUnsubscribers = [];
  if (stopLocalReadWatch) {
    stopLocalReadWatch();
    stopLocalReadWatch = null;
  }
  const badge = document.querySelector('.news-unread-dot');
  if (!badge) return;
  badge.classList.remove('visible');
  if (!user || !fb) return;

  let news = [];
  let reads = new Map();
  let localReads = getLocalReads(user.uid);
  let newsReady = false;
  let readsReady = false;
  let failed = false;

  // Only decide once BOTH snapshots have arrived. Otherwise the news list can
  // load before the read receipts and the dot flashes on every page load.
  const render = () => {
    if (failed || !newsReady || !readsReady) {
      badge.classList.remove('visible');
      return;
    }
    const unread = news.some(item => (Number(item.revision) || 1) > readRevision(reads, localReads, item.id));
    badge.classList.toggle('visible', unread);
  };

  const onLocalRead = event => {
    if (event.detail?.uid && event.detail.uid !== user.uid) return;
    localReads = getLocalReads(user.uid);
    render();
  };
  window.addEventListener(NEWS_READ_EVENT, onLocalRead);
  stopLocalReadWatch = () => window.removeEventListener(NEWS_READ_EVENT, onLocalRead);

  const { collection, onSnapshot, query, where } = fb.firestoreApi;
  const { db } = fb.config;

  newsUnsubscribers = [
    onSnapshot(query(collection(db, 'news'), where('status', '==', 'published'), where('deleted', '==', false)), snapshot => {
      news = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      newsReady = true;
      render();
    }, error => {
      failed = true;
      console.error('Could not watch news updates:', error);
      render();
    }),
    onSnapshot(query(collection(db, 'newsReads'), where('uid', '==', user.uid)), snapshot => {
      reads = new Map(snapshot.docs.map(item => [item.data().newsId, Number(item.data().revision) || 0]));
      readsReady = true;
      render();
    }, error => {
      console.error('Could not watch news read status:', error);
      readsReady = true;
      render();
    })
  ];
}

async function createNewsSubscription(user) {
  const { doc, getDoc, serverTimestamp, setDoc } = fb.firestoreApi;
  const subscriptionRef = doc(fb.config.db, 'newsSubscriptions', user.uid);
  try {
    const existing = await getDoc(subscriptionRef);
    if (existing.exists()) return;
    await setDoc(subscriptionRef, {
      uid: user.uid,
      email: user.email,
      language: currentLang(),
      subscribed: true,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Could not subscribe to Aurora news:', error);
  }
}

function startAuthWatch() {
  const { auth, isSchoolUser } = fb.config;
  fb.authApi.onAuthStateChanged(auth, (user) => {
    currentUser = isSchoolUser(user) ? user : null;
    authResolved = true;
    authListeners.forEach(cb => { try { cb(currentUser); } catch (e) { console.error(e); } });
    updateNavAuthUI(currentUser);
    watchUnreadNews(currentUser);
    if (currentUser) createNewsSubscription(currentUser);
    else fb.preload.clearPhotoCaches();
    if (canPrefetch()) {
      runWhenIdle(() => {
        fb.preload.preloadNews();
        if (currentUser) fb.preload.preloadPhotos(currentUser);
      }, 4000);
    }
  });
}

export const AuroraAuth = {
  getUser: () => currentUser,
  getIdToken: () => (currentUser ? currentUser.getIdToken() : Promise.resolve(null)),
  // Calls back once auth state is known, then on every change. Returns an unsubscribe fn.
  onChange(cb) {
    authListeners.add(cb);
    if (authResolved) cb(currentUser);
    loadFirebase().catch(() => {});
    return () => authListeners.delete(cb);
  },
  async signIn() {
    try {
      // When Firebase is already loaded there is no await before the popup,
      // so the browser still treats it as a direct result of the click.
      const loaded = fb || await loadFirebase();
      const { auth, isSchoolUser } = loaded.config;
      const { user } = await loaded.authApi.signInWithPopup(auth, siteProvider);
      if (!isSchoolUser(user)) {
        const attempted = user.email || '';
        await loaded.authApi.signOut(auth);
        showSchoolEmailModal(attempted);
        return null;
      }
      return user;
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error('Sign-in failed:', err);
      }
      return null;
    }
  },
  async signOut() {
    const loaded = fb || await loadFirebase();
    return loaded.authApi.signOut(loaded.config.auth);
  },
  showSchoolEmailModal
};

function initialsAvatar(name) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const safe = letter.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0a1a20"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#7fe9f0">${safe}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function updateNavAuthUI(user) {
  const signinBtn = document.getElementById('nav-signin-btn');
  const userBox = document.getElementById('nav-user');
  if (!signinBtn || !userBox) return;

  signinBtn.classList.toggle('hidden', !!user);
  userBox.classList.toggle('hidden', !user);
  if (!user) return;

  const name = user.displayName || user.email || 'Signed in';
  const avatar = document.getElementById('nav-user-avatar');
  avatar.referrerPolicy = 'no-referrer';
  avatar.src = user.photoURL || initialsAvatar(name);
  document.getElementById('nav-user-name').textContent = name;
}


// ---------------------------------------------------------------------------
// Language toggle (button lives in panel.html). Pages don't need any code for it.
// A page may define window.setLanguage(lang) to re-render its own dynamic
// content; it is called if present. A 'aurora:langchange' event is also fired.
// ---------------------------------------------------------------------------
function syncLangButton() {
  const langText = document.getElementById('lang-text');
  if (langText) langText.textContent = currentLang() === 'en' ? '繁體中文' : 'English';
}

function applyLanguageEverywhere(lang) {
  localStorage.setItem('aurora_lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  if (typeof window.setLanguage === 'function') window.setLanguage(lang);
  applyLanguage(document); // covers pages without their own setLanguage + the popups
  syncLangButton();
  refreshInfo();
  window.dispatchEvent(new CustomEvent('aurora:langchange', { detail: { lang } }));
}

function switchLanguage() {
  applyLanguageEverywhere(currentLang() === 'en' ? 'zh' : 'en');
}

// ---------------------------------------------------------------------------
// Background video: pause while the tab is hidden to cut CPU/GPU load
// ---------------------------------------------------------------------------
function wireBackgroundVideo() {
  const video = document.getElementById('bg-video');
  if (!video) return;

  // A previous page already measured this device as too slow for live video:
  // keep the poster, skip the download and never start playback.
  if (document.documentElement.classList.contains('fx-still')) {
    freezeBackgroundVideo();
    video.preload = 'none';
    video.load();
    return;
  }

  const tryPlay = () => {
    if (document.visibilityState !== 'visible') return;
    if (document.documentElement.classList.contains('fx-still')) return;
    video.play().catch(() => {});
  };

  tryPlay();
  ['stalled', 'suspend', 'waiting', 'error'].forEach(evt => video.addEventListener(evt, tryPlay));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryPlay();
    else video.pause();
  });
}

// ---------------------------------------------------------------------------
// Mount navigation panel + background
// ---------------------------------------------------------------------------
async function mountPanel() {
  const mountPoint = document.getElementById('panel-container');
  const panelHtml = await panelFetchPromise;
  if (!mountPoint || !panelHtml) return;

  mountPoint.innerHTML = panelHtml;
  applyLanguage(mountPoint);

  // Highlight the active route
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = mountPoint.querySelectorAll('.nav-links a[data-page]');
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-page') === currentPath));
  const dropdown = mountPoint.querySelector('#info-dropdown');
  const dropdownToggle = mountPoint.querySelector('#info-dropdown-toggle');
  // In the mobile drawer, start expanded when the current page lives under "Info".
  // On desktop the menu is a floating panel, so it only opens on hover/click.
  if (dropdown?.querySelector('a.active') && window.matchMedia('(max-width: 768px)').matches) dropdown.classList.add('open');
  dropdownToggle?.addEventListener('click', () => {
    const open = dropdown.classList.toggle('open');
    dropdownToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (!dropdown?.contains(event.target)) {
      dropdown?.classList.remove('open');
      dropdownToggle?.setAttribute('aria-expanded', 'false');
    }
  });
  dropdown?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      dropdown.classList.remove('open');
      dropdownToggle?.setAttribute('aria-expanded', 'false');
      dropdownToggle?.focus();
    }
  });

  // Mobile hamburger drawer
  const hamburger = mountPoint.querySelector('#hamburger-btn');
  const drawer = mountPoint.querySelector('#nav-links');
  const overlay = mountPoint.querySelector('#nav-overlay');

  const setMenu = (open) => {
    drawer?.classList.toggle('active', open);
    hamburger?.classList.toggle('open', open);
    overlay?.classList.toggle('active', open);
  };
  hamburger?.addEventListener('click', () => setMenu(!drawer.classList.contains('active')));
  overlay?.addEventListener('click', () => setMenu(false));
  navLinks.forEach(link => link.addEventListener('click', () => setMenu(false)));

  // Sign-in / sign-out
  const signInButton = document.getElementById('nav-signin-btn');
  signInButton?.addEventListener('click', () => AuroraAuth.signIn());
  ['pointerenter', 'touchstart', 'focus'].forEach(type => signInButton?.addEventListener(type, () => { loadFirebase().catch(() => {}); }, { once: true, passive: true }));
  document.getElementById('nav-signout-btn')?.addEventListener('click', () => AuroraAuth.signOut());
  updateNavAuthUI(currentUser);
  watchUnreadNews(currentUser);

  // Language toggle
  document.getElementById('lang-btn')?.addEventListener('click', switchLanguage);
  syncLangButton();
}

async function mountInfo() {
  const infoHtml = await infoFetchPromise;
  if (!infoHtml) return;
  const infoMount = document.createElement('div');
  infoMount.id = 'info-container';
  infoMount.innerHTML = infoHtml;
  document.body.appendChild(infoMount);
  applyLanguage(infoMount);
  // The floating info button comes from panel.html, so wait for it to be mounted.
  await panelFetchPromise;
  initInfo(infoMount, document.getElementById('info-btn'));
}

async function mountBackground() {
  const bgMountPoint = document.getElementById('background-container');
  const backgroundHtml = await backgroundFetchPromise;
  if (!bgMountPoint || !backgroundHtml) return;
  bgMountPoint.innerHTML = backgroundHtml;
  wireBackgroundVideo();
}

function loadPanel() {
  mountPanel();
  mountBackground();
  mountInfo();
}

// Cheap hint, safe to run immediately: the API host is contacted by analytics on every page.
function preconnectApi() {
  if (document.head.querySelector('link[rel="preconnect"][href="' + API_BASE + '"]')) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = API_BASE;
  link.crossOrigin = '';
  document.head.appendChild(link);
}

// Everything below is optional warm-up and only runs once the page is idle.
function warmUp() {
  if (canPrefetch()) {
    ['js/news-page.js', 'js/photos.js'].forEach(href => {
      if (document.head.querySelector('link[rel="modulepreload"][href="' + href + '"]')) return;
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = href;
      document.head.appendChild(link);
    });
  }
  runWhenIdle(() => { loadFirebase().catch(() => {}); }, 1500);
}

preconnectApi();
afterPageLoad(() => runWhenIdle(warmUp, 2000));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPanel);
} else {
  loadPanel();
}