import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { db, auth } from './firebase-config.js';
import { parseEncryptionKey, importAesKey, decryptField } from './support-crypto.js';

const PAGE_SIZE = 100;
const KEY_IDLE_MS = 15 * 60 * 1000;

const section = document.getElementById('supporters-section');
const keyInput = document.getElementById('sl-key-input');
const showKeyBox = document.getElementById('sl-show-key');
const decryptBtn = document.getElementById('sl-decrypt-btn');
const clearBtn = document.getElementById('sl-clear-btn');
const statusEl = document.getElementById('sl-status');
const filterInput = document.getElementById('sl-filter');
const bodyEl = document.getElementById('sl-body');
const moreBtn = document.getElementById('sl-more-btn');
const countEl = document.getElementById('sl-count');

if (section && keyInput && bodyEl) init();

function init() {
  let user = null;
  let unsubscribe = null;
  let logs = [];
  let limitCount = PAGE_SIZE;
  let cryptoKey = null;
  let keyTimer = null;
  let loadError = null;
  let loading = false;
  let decrypting = Promise.resolve();
  const results = new Map();

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = (value) => (value && typeof value.toDate === 'function' ? value.toDate() : null);

  function formatTime(date) {
    if (!date) return 'N/A';
    return date.toLocaleString('en-GB', {
      timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }) + ' HKT';
  }

  function expiresText(date) {
    if (!date) return '';
    const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
    if (days <= 0) return 'expired';
    return `in ${days}d`;
  }

  function browserName(userAgent) {
    const ua = String(userAgent || '');
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\/|Opera/i.test(ua)) return 'Opera';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Safari\//i.test(ua)) return 'Safari';
    return ua ? 'Other browser' : '';
  }

  function deviceSummary(device) {
    if (!device || typeof device !== 'object') return String(device ?? '');
    const system = [device.model, device.platform, device.platformVersion].filter(Boolean).join(' ');
    const kind = device.mobile === true ? 'Mobile' : device.mobile === false ? 'Desktop' : '';
    return [browserName(device.userAgent), system, kind, device.language].filter(Boolean).join(' · ') || 'Unknown device';
  }

  function setStatus(message, tone) {
    statusEl.textContent = message || '';
    statusEl.dataset.tone = tone || '';
  }

  function resetKeyTimer() {
    clearTimeout(keyTimer);
    keyTimer = cryptoKey ? setTimeout(() => clearKey('Key cleared after 15 minutes of inactivity.'), KEY_IDLE_MS) : null;
  }

  function clearKey(message) {
    cryptoKey = null;
    results.clear();
    keyInput.value = '';
    clearTimeout(keyTimer);
    keyTimer = null;
    setStatus(message || 'Key cleared. Logs are encrypted again.', '');
    render();
  }

  async function decryptRow(log) {
    if (!cryptoKey || results.has(log.id)) return;
    const key = cryptoKey;
    const entry = { ip: null, device: null, error: null };
    try {
      entry.ip = await decryptField(key, log.ipEnc);
      if (log.deviceEnc) {
        const raw = await decryptField(key, log.deviceEnc);
        try { entry.device = JSON.parse(raw); } catch { entry.device = raw; }
      }
    } catch (error) {
      entry.error = error?.name === 'OperationError' ? 'Wrong key for this log' : (error?.message || 'Could not decrypt');
    }
    if (cryptoKey === key) results.set(log.id, entry);
  }

  function decryptAll() {
    decrypting = decrypting.then(async () => {
      for (const log of logs) await decryptRow(log);
      render();
    });
    return decrypting;
  }

  async function applyKey() {
    try {
      const keyBytes = parseEncryptionKey(keyInput.value);
      cryptoKey = await importAesKey(keyBytes);
    } catch (error) {
      cryptoKey = null;
      setStatus(error.message || 'Invalid key.', 'error');
      return;
    }
    results.clear();
    keyInput.value = '';
    keyInput.type = 'password';
    showKeyBox.checked = false;
    await decryptAll();
    resetKeyTimer();
    const ok = [...results.values()].filter((entry) => !entry.error).length;
    if (!logs.length) setStatus('Key accepted. There are no logs to decrypt yet; new votes will decrypt automatically.', 'ok');
    else if (!ok) {
      cryptoKey = null;
      results.clear();
      clearTimeout(keyTimer);
      setStatus('That key could not decrypt any log. Check that it is the current SUPPORT_ENCRYPTION_KEY from Vercel.', 'error');
      render();
    } else if (ok < logs.length) setStatus(`Decrypted ${ok} of ${logs.length} logs. The rest were written with a different key.`, 'warn');
    else setStatus(`Decrypted all ${ok} logs. The key stays in this tab only and is cleared after 15 minutes idle.`, 'ok');
  }

  function rowMatches(log, needle) {
    if (!needle) return true;
    const entry = results.get(log.id);
    const haystack = [
      formatTime(toDate(log.createdAt)), log.email, log.uid, entry?.ip,
      entry ? deviceSummary(entry.device) : ''
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  }

  function render() {
    const needle = filterInput.value.trim().toLowerCase();
    const shown = logs.filter((log) => rowMatches(log, needle));
    countEl.textContent = logs.length ? `${shown.length} of ${logs.length} loaded` : '';
    moreBtn.classList.toggle('hidden', logs.length < limitCount);

    if (loadError) {
      bodyEl.innerHTML = `<tr><td colspan="5" class="sl-empty">${escapeHtml(loadError)}</td></tr>`;
      return;
    }
    if (loading) {
      bodyEl.innerHTML = '<tr><td colspan="5" class="sl-empty">Loading support logs…</td></tr>';
      return;
    }
    if (!logs.length) {
      bodyEl.innerHTML = '<tr><td colspan="5" class="sl-empty">No support logs yet. A log is written for every vote and expires after 90 days.</td></tr>';
      return;
    }
    if (!shown.length) {
      bodyEl.innerHTML = '<tr><td colspan="5" class="sl-empty">No logs match this filter.</td></tr>';
      return;
    }

    bodyEl.innerHTML = shown.map((log) => {
      const entry = results.get(log.id);
      const created = formatTime(toDate(log.createdAt));
      const expires = expiresText(toDate(log.expiresAt));
      const account = log.email
        ? `<div>${escapeHtml(log.email)}</div><div class="sl-muted">${escapeHtml(String(log.uid || '').slice(0, 12))}…</div>`
        : '<div class="sl-muted">Anonymous visitor</div>';

      let ipCell;
      let deviceCell;
      if (entry && entry.error) {
        ipCell = `<span class="sl-bad">⚠ ${escapeHtml(entry.error)}</span>`;
        deviceCell = '<span class="sl-muted">—</span>';
      } else if (entry) {
        ipCell = `<code class="sl-ip">${escapeHtml(entry.ip)}</code>`;
        const raw = typeof entry.device === 'string' ? entry.device : JSON.stringify(entry.device, null, 2);
        deviceCell = entry.device
          ? `<div>${escapeHtml(deviceSummary(entry.device))}</div><details><summary>Raw details</summary><pre>${escapeHtml(raw)}</pre></details>`
          : '<span class="sl-muted">No device data</span>';
      } else {
        ipCell = '<span class="sl-muted">🔒 Encrypted</span>';
        deviceCell = '<span class="sl-muted">🔒 Encrypted</span>';
      }

      return `<tr><td>${escapeHtml(created)}</td><td>${account}</td><td>${ipCell}</td><td>${deviceCell}</td><td class="sl-muted">${escapeHtml(expires)}</td></tr>`;
    }).join('');
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }

  function start() {
    if (!user || unsubscribe) return;
    loading = true;
    loadError = null;
    render();
    unsubscribe = onSnapshot(
      query(collection(db, 'supportLogs'), orderBy('createdAt', 'desc'), limit(limitCount)),
      (snapshot) => {
        loading = false;
        loadError = null;
        logs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        const ids = new Set(logs.map((log) => log.id));
        for (const id of [...results.keys()]) if (!ids.has(id)) results.delete(id);
        render();
        if (cryptoKey) decryptAll();
      },
      (error) => {
        loading = false;
        console.error('Could not load support logs:', error);
        loadError = error?.code === 'permission-denied'
          ? 'Not allowed to read support logs. Deploy the latest firestore.rules and make sure this account has the admin claim.'
          : 'Could not load support logs. Check the console and try again.';
        stop();
        render();
      }
    );
  }

  function sectionVisible() {
    return !section.classList.contains('hidden');
  }

  function maybeStart() {
    if (sectionVisible()) start();
  }

  decryptBtn.addEventListener('click', applyKey);
  keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyKey();
    }
  });
  showKeyBox.addEventListener('change', () => { keyInput.type = showKeyBox.checked ? 'text' : 'password'; });
  clearBtn.addEventListener('click', () => clearKey());
  filterInput.addEventListener('input', render);
  moreBtn.addEventListener('click', () => {
    limitCount += PAGE_SIZE;
    stop();
    start();
  });
  window.addEventListener('pagehide', () => { cryptoKey = null; results.clear(); });

  new MutationObserver(maybeStart).observe(section, { attributes: true, attributeFilter: ['class'] });

  onAuthStateChanged(auth, (nextUser) => {
    user = nextUser;
    stop();
    if (!user) {
      logs = [];
      limitCount = PAGE_SIZE;
      loadError = null;
      clearKey('');
      return;
    }
    maybeStart();
  });

  render();
}
