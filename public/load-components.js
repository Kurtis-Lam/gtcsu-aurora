import { auth, isAllowedEmail, ALLOWED_DOMAIN } from './firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const panelFetchPromise = fetch('panel.html')
  .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
  .catch(err => { console.error('Error loading panel component:', err); return null; });

const backgroundFetchPromise = fetch('background.html')
  .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
  .catch(err => { console.error('Error loading background component:', err); return null; });

// ---- Site-wide auth state, shared with any page via window.AuroraAuth ----
let currentUser = null;
const authListeners = [];

// Separate provider for the public site so the school-domain hint doesn't
// affect the admin page's sign-in.
const siteProvider = new GoogleAuthProvider();
siteProvider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' });

onAuthStateChanged(auth, (user) => {
  // Non-school accounts (e.g. an admin logged in on admin.html with a
  // personal email in the same browser) are treated as "not signed in" on
  // the public site. We deliberately do NOT sign them out here, so the
  // admin session isn't destroyed.
  if (user && !isAllowedEmail(user.email)) user = null;
  currentUser = user;
  authListeners.forEach(cb => { try { cb(user); } catch (e) { console.error(e); } });
  updateNavAuthUI(user);
});

window.AuroraAuth = {
  getUser: () => currentUser,
  onChange: (cb) => { authListeners.push(cb); if (currentUser !== undefined) cb(currentUser); },
  signIn: async () => {
    try {
      const result = await signInWithPopup(auth, siteProvider);
      if (!isAllowedEmail(result.user.email)) {
        await signOut(auth);
        alert(`Please sign in with your school account (@${ALLOWED_DOMAIN}).`);
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error('Sign-in failed:', err);
      }
    }
  },
  signOut: () => signOut(auth)
};

function updateNavAuthUI(user) {
  const signinBtn = document.getElementById('nav-signin-btn');
  const userBox = document.getElementById('nav-user');
  if (!signinBtn || !userBox) return;

  if (user) {
    signinBtn.classList.add('hidden');
    userBox.classList.remove('hidden');
    document.getElementById('nav-user-avatar').src = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.displayName || user.email || '?')}`;
    document.getElementById('nav-user-name').textContent = user.displayName || user.email || 'Signed in';
  } else {
    signinBtn.classList.remove('hidden');
    userBox.classList.add('hidden');
  }
}

// ---- Background video: pause while tab hidden to cut CPU/GPU load ----
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

async function loadPanel() {
  const mountPoint = document.getElementById('panel-container');
  const bgMountPoint = document.getElementById('background-container');

  const [panelHtml, backgroundHtml] = await Promise.all([panelFetchPromise, backgroundFetchPromise]);

  if (mountPoint && panelHtml) {
    mountPoint.innerHTML = panelHtml;

    // Active route matching
    let currentPath = window.location.pathname.split('/').pop();
    if (!currentPath || currentPath === '') currentPath = 'index.html';

    const navLinks = mountPoint.querySelectorAll('.nav-links a[data-page]');
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-page') === currentPath);
    });

    // Re-apply current language preference
    if (typeof setLanguage === 'function') {
      setLanguage(localStorage.getItem('aurora_lang') || 'en');
    }

    // Mobile hamburger drawer
    const hamburger = mountPoint.querySelector('#hamburger-btn');
    const drawer = mountPoint.querySelector('#nav-links');
    const overlay = document.getElementById('nav-overlay');

    function toggleMenu() {
      const isOpen = drawer.classList.toggle('active');
      if (hamburger) hamburger.classList.toggle('open', isOpen);
      if (overlay) overlay.classList.toggle('active', isOpen);
    }
    function closeMenu() {
      if (drawer) drawer.classList.remove('active');
      if (hamburger) hamburger.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
    }

    if (hamburger) hamburger.addEventListener('click', toggleMenu);
    if (overlay) overlay.addEventListener('click', closeMenu);
    navLinks.forEach(link => link.addEventListener('click', closeMenu));

    // Sign-in / sign-out buttons
    document.getElementById('nav-signin-btn')?.addEventListener('click', () => window.AuroraAuth.signIn());
    document.getElementById('nav-signout-btn')?.addEventListener('click', () => window.AuroraAuth.signOut());
    updateNavAuthUI(currentUser);
  }

  if (bgMountPoint && backgroundHtml) {
    bgMountPoint.innerHTML = backgroundHtml;
    wireBackgroundVideo();
  }

  window.dispatchEvent(new Event('componentsLoaded'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPanel);
} else {
  loadPanel();
}