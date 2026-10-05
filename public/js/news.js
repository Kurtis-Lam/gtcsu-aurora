import { AuroraAuth } from './load-components.js';
import { API_BASE } from './api-config.js';

const authCard = document.getElementById('news-auth-card');
const stateEl = document.getElementById('news-state');
const listEl = document.getElementById('news-list');
const lang = () => localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en';
let activeUser = null;
let articles = [];
let unreadIds = new Set();
let loadingNews = false;
let stateKey = 'loading';
let stateIsError = false;

const TEXT = {
  en: {
    loading: 'Loading news…',
    failed: 'News could not be loaded. Please try again.',
    empty: 'There are no news announcements yet.',
    markRead: 'Mark as read',
    marked: 'Read',
    failedRead: 'Could not mark this news as read. Please try again.',
    retry: 'Retry'
  },
  zh: {
    loading: '正在載入消息…',
    failed: '無法載入消息，請稍後再試。',
    empty: '暫時沒有最新消息。',
    markRead: '標記為已讀',
    marked: '已讀',
    failedRead: '無法將此消息標記為已讀，請重試。',
    retry: '重試'
  }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function showState(message, isError = false, key = 'loading') {
  stateKey = key;
  stateIsError = isError;
  stateEl.textContent = message;
  stateEl.classList.toggle('state-error', isError);
  stateEl.classList.remove('hidden');
  listEl.innerHTML = '';
}

async function apiRequest(method, data, user = activeUser) {
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}/api/news`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data ? { 'Content-Type': 'application/json' } : {})
    },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `News request failed (${response.status})`);
  return payload;
}

function renderNews() {
  const language = lang();
  if (!articles.length) {
    showState(TEXT[language].empty, false, 'empty');
    return;
  }
  stateEl.classList.add('hidden');
  listEl.innerHTML = articles.map((item) => {
    const unread = unreadIds.has(item.id);
    const date = item.updatedAt
      ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-HK' : 'en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(item.updatedAt))
      : '';
    return `
      <article class="news-card ${unread ? 'unread' : ''}">
        <h2>${escapeHtml(item[language === 'zh' ? 'titleZh' : 'titleEn'])}</h2>
        <div class="news-date">${escapeHtml(date)}</div>
        <div class="news-content">${escapeHtml(item[language === 'zh' ? 'bodyZh' : 'bodyEn'])}</div>
        ${unread ? `<div class="news-card-actions"><button class="news-button" type="button" data-read-id="${escapeHtml(item.id)}" data-read-revision="${Number(item.revision)}">${TEXT[language].markRead}</button></div>` : ''}
      </article>`;
  }).join('');
  listEl.querySelectorAll('[data-read-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await apiRequest('POST', {
          action: 'read',
          id: button.dataset.readId,
          revision: Number(button.dataset.readRevision)
        });
        unreadIds.delete(button.dataset.readId);
        renderNews();
        window.dispatchEvent(new Event('aurora:newsread'));
      } catch (error) {
        console.error('Could not mark news as read:', error);
        await loadNews();
        if (!loadingNews) {
          button.disabled = false;
          button.textContent = TEXT[lang()].failedRead;
        }
      }
    });
  });
}

async function loadNews() {
  if (!activeUser || loadingNews) return;
  const requestedUser = activeUser;
  loadingNews = true;
  if (!articles.length) showState(TEXT[lang()].loading, false, 'loading');
  try {
    const data = await apiRequest('GET', null, requestedUser);
    if (requestedUser !== activeUser) return;
    articles = Array.isArray(data.news) ? data.news : [];
    unreadIds = new Set(Array.isArray(data.unreadIds) ? data.unreadIds : []);
    renderNews();
  } catch (error) {
    console.error('Could not load Aurora news:', error);
    showState(TEXT[lang()].failed, true, 'failed');
  } finally {
    loadingNews = false;
    if (activeUser && requestedUser !== activeUser) loadNews();
  }
}

document.getElementById('news-signin-btn').addEventListener('click', () => AuroraAuth.signIn());

AuroraAuth.onChange((user) => {
  activeUser = user;
  articles = [];
  unreadIds = new Set();
  listEl.innerHTML = '';
  if (!user) {
    stateEl.classList.add('hidden');
    authCard.classList.remove('hidden');
    return;
  }
  authCard.classList.add('hidden');
  loadNews();
});
window.addEventListener('focus', loadNews);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadNews();
});
setInterval(() => {
  if (document.visibilityState === 'visible') loadNews();
}, 60000);

window.setLanguage = () => {
  const language = lang();
  document.documentElement.lang = language === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('.i18n').forEach((element) => {
    const text = element.getAttribute(`data-${language}`);
    if (text) element.innerHTML = text;
  });
  if (activeUser) {
    if (articles.length) renderNews();
    else if (!stateEl.classList.contains('hidden')) showState(TEXT[language][stateKey], stateIsError, stateKey);
  }
};
window.setLanguage(lang());
