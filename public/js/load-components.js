import { auth, db, isSchoolUser, ALLOWED_DOMAIN } from './firebase-config.js';
import { initInfo, refreshInfo } from './info.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Start fetching shared components immediately; they are mounted once the DOM is ready.
const panelFetchPromise = fetch('panel.html')
  .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
  .catch(err => { console.error('Error loading panel component:', err); return null; });

const backgroundFetchPromise = fetch('background.html')
  .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
  .catch(err => { console.error('Error loading background component:', err); return null; });

const infoFetchPromise = fetch('info.html')
  .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
  .catch(err => { console.error('Error loading info component:', err); return null; });

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
      padding:20px; background:rgba(5,11,18,0.82); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
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

function showSchoolEmailModal(attemptedEmail) {
  const t = MODAL_TEXT[currentLang()];
  const el = ensureModal();
  el.querySelector('.aurora-modal-title').textContent = t.title;
  el.querySelector('.aurora-modal-body').textContent = t.body(ALLOWED_DOMAIN);
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

function watchUnreadNews(user) {
  newsUnsubscribers.forEach(unsubscribe => unsubscribe());
  newsUnsubscribers = [];
  const badge = document.querySelector('.news-unread-dot');
  if (!badge) return;
  badge.classList.remove('visible');
  if (!user) return;

  let news = [];
  let reads = [];
  const render = () => {
    const readByNewsId = new Map(reads.map(item => [item.newsId, Number(item.revision) || 0]));
    const unread = news.some(item => (Number(item.revision) || 1) > (readByNewsId.get(item.id) || 0));
    badge.classList.toggle('visible', unread);
  };

  newsUnsubscribers = [
    onSnapshot(query(collection(db, 'news'), where('status', '==', 'published'), where('deleted', '==', false)), snapshot => {
      news = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      render();
    }, error => console.error('Could not watch news updates:', error)),
    onSnapshot(query(collection(db, 'newsReads'), where('uid', '==', user.uid)), snapshot => {
      reads = snapshot.docs.map(item => item.data());
      render();
    }, error => console.error('Could not watch news read status:', error))
  ];
}

const siteProvider = new GoogleAuthProvider();
siteProvider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' });

onAuthStateChanged(auth, (user) => {
  currentUser = isSchoolUser(user) ? user : null;
  authResolved = true;
  authListeners.forEach(cb => { try { cb(currentUser); } catch (e) { console.error(e); } });
  updateNavAuthUI(currentUser);
  watchUnreadNews(currentUser);
});

export const AuroraAuth = {
  getUser: () => currentUser,
  getIdToken: () => (currentUser ? currentUser.getIdToken() : Promise.resolve(null)),
  // Calls back once auth state is known, then on every change. Returns an unsubscribe fn.
  onChange(cb) {
    authListeners.add(cb);
    if (authResolved) cb(currentUser);
    return () => authListeners.delete(cb);
  },
  async signIn() {
    try {
      const { user } = await signInWithPopup(auth, siteProvider);
      if (!isSchoolUser(user)) {
        const attempted = user.email || '';
        await signOut(auth);
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
  signOut: () => signOut(auth),
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
let isSwitching = false;

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
  if (isSwitching) return;
  isSwitching = true;
  document.body.classList.remove('is-loaded');
  setTimeout(() => {
    applyLanguageEverywhere(currentLang() === 'en' ? 'zh' : 'en');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('is-loaded');
      setTimeout(() => { isSwitching = false; }, 1200);
    }));
  }, 350);
}

// ---------------------------------------------------------------------------
// Background video: pause while the tab is hidden to cut CPU/GPU load
// ---------------------------------------------------------------------------
function wireBackgroundVideo() {
  const video = document.getElementById('bg-video');
  if (!video) return;

  const tryPlay = () => { if (document.visibilityState === 'visible') video.play().catch(() => {}); };

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
async function loadPanel() {
  const mountPoint = document.getElementById('panel-container');
  const bgMountPoint = document.getElementById('background-container');

  const [panelHtml, backgroundHtml, infoHtml] = await Promise.all([panelFetchPromise, backgroundFetchPromise, infoFetchPromise]);

  if (mountPoint && panelHtml) {
    mountPoint.innerHTML = panelHtml;
    applyLanguage(mountPoint);

    // Highlight the active route
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = mountPoint.querySelectorAll('.nav-links a[data-page]');
    navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-page') === currentPath));
    const dropdown = mountPoint.querySelector('#info-dropdown');
    const dropdownToggle = mountPoint.querySelector('#info-dropdown-toggle');
    if (navLinks.length && [...navLinks].some(link => link.classList.contains('active'))) dropdown?.classList.add('open');
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
    document.getElementById('nav-signin-btn')?.addEventListener('click', () => AuroraAuth.signIn());
    document.getElementById('nav-signout-btn')?.addEventListener('click', () => AuroraAuth.signOut());
    updateNavAuthUI(currentUser);
    watchUnreadNews(currentUser);

    // Language toggle
    document.getElementById('lang-btn')?.addEventListener('click', switchLanguage);
    syncLangButton();
  }

  if (infoHtml) {
    const infoMount = document.createElement('div');
    infoMount.id = 'info-container';
    infoMount.innerHTML = infoHtml;
    document.body.appendChild(infoMount);
    applyLanguage(infoMount);
    initInfo(infoMount, document.getElementById('info-btn'));
  }

  if (bgMountPoint && backgroundHtml) {
    bgMountPoint.innerHTML = backgroundHtml;
    wireBackgroundVideo();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPanel);
} else {
  loadPanel();
}