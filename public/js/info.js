export const APP_VERSION = '2.2.3';
export const LAST_UPDATED = '2026-09-29T12:00:21+08:00'; // ISO 8601, Hong Kong time (+08:00)

const currentLang = () => (localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en');

function formatUpdated(lang) {
  const d = new Date(LAST_UPDATED);
  if (isNaN(d)) return LAST_UPDATED;
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-HK' : 'en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZoneName: 'short'
  }).format(d);
}

let root = null;
let lastFocus = null;

// Re-fills the dynamic values (call again whenever the language changes).
export function refreshInfo() {
  if (!root) return;
  root.querySelector('#info-version').textContent = 'v' + APP_VERSION;
  root.querySelector('#info-updated').textContent = formatUpdated(currentLang());
}

export function openInfo() {
  if (!root) return;
  lastFocus = document.activeElement;
  root.classList.add('active');
  root.setAttribute('aria-hidden', 'false');
  root.querySelector('.info-close').focus({ preventScroll: true });
}

export function closeInfo() {
  if (!root) return;
  root.classList.remove('active');
  root.setAttribute('aria-hidden', 'true');
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

// mount = element that already contains info.html's markup; openBtn = the floating ⓘ button.
export function initInfo(mount, openBtn) {
  root = mount.querySelector('#info-popup');
  if (!root) return;

  refreshInfo();
  openBtn?.addEventListener('click', openInfo);

  root.addEventListener('click', (e) => {
    // click on the dark backdrop or on the ✕ button closes it
    if (e.target === root || e.target.closest('.info-close')) closeInfo();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('active')) closeInfo();
  });
}