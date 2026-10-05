import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { db, auth } from './firebase-config.js';
import { API_BASE } from './api-config.js';

const COOLDOWN_MS = 10 * 60 * 1000;
const btn = document.getElementById('support-btn');
const statusEl = document.getElementById('support-status');
const countEl = document.getElementById('support-count');
const barClicksEl = document.getElementById('bar-clicks');
let countdownTimer = null;

const labels = {
  en: { ready: 'Support Aurora 💙', offline: 'Unavailable' },
  zh: { ready: '支持 Aurora 💙', offline: '暫時無法使用' }
};
btn.textContent = lang() === 'zh' ? '正在檢查狀態…' : 'Checking your status…';
const messages = {
  en: {
    already: "You've already supported recently.",
    thanks: 'Thank you for supporting Aurora! 💙',
    error: 'Something went wrong - please try again.',
    offline: 'Could not reach the server - please try again later.'
  },
  zh: {
    already: '你最近已經支持過了。',
    thanks: '感謝你支持 Aurora！💙',
    error: '發生錯誤，請再試一次。',
    offline: '無法連線至伺服器，請稍後再試。'
  }
};
const lang = () => localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en';
const LOCAL_KEY = 'aurora_local_support_clicks';
const getLocalClickCount = () => Number.parseInt(localStorage.getItem(LOCAL_KEY) || '0', 10);
const updateBottomBar = () => { barClicksEl.textContent = String(getLocalClickCount()); };

function bumpLocalClickCount() {
  localStorage.setItem(LOCAL_KEY, String(getLocalClickCount() + 1));
}

function formatMMSS(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function setReady() {
  clearInterval(countdownTimer);
  btn.disabled = false;
  btn.textContent = labels[lang()].ready;
  statusEl.textContent = '';
}

function startCountdown(remainingMs) {
  clearInterval(countdownTimer);
  const endsAt = Date.now() + remainingMs;
  btn.disabled = true;
  const tick = () => {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return setReady();
    btn.textContent = formatMMSS(remaining);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

const DEVICE_KEY = 'aurora_device_id';
function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getDeviceId() {
  const valid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch {}
  if (!valid(id)) id = readCookie(DEVICE_KEY);
  if (!valid(id)) id = crypto.randomUUID();
  try { localStorage.setItem(DEVICE_KEY, id); } catch {}
  document.cookie = `${DEVICE_KEY}=${encodeURIComponent(id)}; max-age=${60 * 60 * 24 * 365 * 2}; path=/; SameSite=Lax`;
  return id;
}

const apiUrl = `${API_BASE}/api/support?device=${encodeURIComponent(getDeviceId())}`;

async function callSupport(method) {
  const headers = {};
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  const response = await fetch(apiUrl, { method, headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function refreshStatus() {
  try {
    const { status, data } = await callSupport('GET');
    if (status !== 200 || !data.ok) throw new Error(data.error || `Status ${status}`);
    if (data.remainingMs > 0) startCountdown(data.remainingMs);
    else setReady();
  } catch (error) {
    console.error('Support status check failed:', error);
    btn.textContent = labels[lang()].offline;
    statusEl.textContent = messages[lang()].offline;
  }
}

onSnapshot(doc(db, 'counters', 'supportCounter'), (snapshot) => {
  if (snapshot.exists()) countEl.textContent = (snapshot.data().count || 0).toLocaleString();
}, (error) => console.error('Support counter listener failed:', error));
updateBottomBar();
onAuthStateChanged(auth, refreshStatus);
window.addEventListener('aurora:langchange', refreshStatus);

btn.addEventListener('click', async () => {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const { status, data } = await callSupport('POST');
    if (status === 200 && data.ok) {
      bumpLocalClickCount();
      updateBottomBar();
      statusEl.textContent = messages[lang()].thanks;
      startCountdown(data.remainingMs || COOLDOWN_MS);
    } else if (status === 429 || (!data.ok && data.remainingMs > 0)) {
      statusEl.textContent = messages[lang()].already;
      startCountdown(data.remainingMs || COOLDOWN_MS);
    } else {
      throw new Error(data.error || `Status ${status}`);
    }
  } catch (error) {
    console.error('Support click failed:', error);
    setReady();
    statusEl.textContent = messages[lang()].error;
  }
});
