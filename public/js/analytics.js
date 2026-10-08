import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from './firebase-config.js';
import { API_BASE } from './api-config.js';

const VALID_ROUTES = new Set([
  '/', '/aboutus', '/news', '/activities', '/financial', '/schedule',
  '/welfare', '/photos', '/feedbacks', '/admin'
]);

function normalisePath() {
  let path = (window.location.pathname || '/').toLowerCase().replace(/\.html$/, '');
  if (path === '/index' || path === '') path = '/';
  if (path === '/supportus' || path === '/feedback') path = '/feedbacks';
  return VALID_ROUTES.has(path) ? path : null;
}

function randomId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const path = normalisePath();
if (path) {
  const pageviewId = randomId();
  let sessionToken = null;
  let accumulatedMs = 0;
  let engagedSince = document.visibilityState === 'visible' && document.hasFocus() ? Date.now() : null;
  let opened = false;

  function isEngaged() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function flushEngagedTime() {
    if (engagedSince !== null) {
      accumulatedMs += Date.now() - engagedSince;
      engagedSince = null;
    }
  }

  function refreshEngagementState() {
    const engaged = isEngaged();
    if (engaged && engagedSince === null) engagedSince = Date.now();
    else if (!engaged && engagedSince !== null) flushEngagedTime();
  }

  function currentDurationSeconds() {
    const liveMs = accumulatedMs + (engagedSince !== null ? Date.now() - engagedSince : 0);
    return Math.max(1, Math.round(liveMs / 1000));
  }

  async function send(action, useBeacon = false) {
    if (!opened || !sessionToken) return false;
    const body = JSON.stringify({
      action,
      pageviewId,
      path,
      token: sessionToken,
      durationSeconds: currentDurationSeconds()
    });

    if (useBeacon && navigator.sendBeacon) {
      return navigator.sendBeacon(
        `${API_BASE}/api/pageview`,
        new Blob([body], { type: 'application/json' })
      );
    }

    try {
      const response = await fetch(`${API_BASE}/api/pageview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function openSession() {
    try {
      const response = await fetch(`${API_BASE}/api/pageview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', pageviewId, path }),
        keepalive: true
      });
      if (!response.ok) return;
      const result = await response.json();
      sessionToken = typeof result.token === 'string' ? result.token : null;
      opened = !!sessionToken;
    } catch {}
  }

  function updateDuration() {
    if (isEngaged()) return;
    send('update');
  }

  document.addEventListener('visibilitychange', () => {
    refreshEngagementState();
    if (!isEngaged()) updateDuration();
  });
  window.addEventListener('focus', refreshEngagementState);
  window.addEventListener('blur', () => {
    refreshEngagementState();
    updateDuration();
  });

  setInterval(() => {
    if (isEngaged()) send('update');
  }, 15000);

  window.addEventListener('pagehide', () => {
    refreshEngagementState();
    send('exit', true);
  });

  openSession();

  onAuthStateChanged(auth, async user => {
    if (!opened || !user) return;
    try {
      // The API endpoint only accepts controlled analytics fields; identity is
      // attached through Firebase Admin after server-side token verification.
      const token = await user.getIdToken();
      await fetch(`${API_BASE}/api/pageview-identity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ pageviewId, sessionToken }),
        keepalive: true
      });
    } catch {}
  });
}
