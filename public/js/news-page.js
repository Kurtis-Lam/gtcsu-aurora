import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { AuroraAuth } from './load-components.js';
import { db } from './firebase-config.js';
import { getLocalReads, rememberLocalRead, readRevision } from './news-reads.js';

const content = document.getElementById('news-content');
const lang = () => localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en';
let activeUser = null;
let articles = null;
let serverReads = new Map();
let localReads = new Map();
let receiptsReady = false;
let syncedForUid = null;
let newsUnsubscribers = [];
const syncState = new Map();
const revealedIds = new Set();
const text = {
  en: { loading:'Loading news…', empty:'There are no announcements yet.', fail:'Could not load news. Please refresh and try again.', mark:'Mark as read', read:'Read', checking:'Checking…', saving:'Saving…', syncPending:'Saved on this device. Syncing to your account failed; it will retry on your next visit.', date:'Published' },
  zh: { loading:'正在載入消息……', empty:'暫時沒有公告。', fail:'無法載入消息，請重新整理再試。', mark:'標記為已讀', read:'已讀', checking:'檢查中……', saving:'儲存中……', syncPending:'已儲存在此裝置。同步到你的帳戶失敗，下次造訪時會再試。', date:'發布時間' }
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const millis = value => value?.toMillis?.() || 0;
const articleRevision = article => Number(article?.revision) || 1;
const updateLanguage = language => {
  document.documentElement.lang = language === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('.i18n').forEach(el => {
    const translated = el.getAttribute(`data-${language}`);
    if (translated) el.textContent = translated;
  });
  render();
};
window.setLanguage = updateLanguage;

function isRead(article) {
  return readRevision(serverReads, localReads, article.id) >= articleRevision(article);
}

function buttonHtml(article, t) {
  const id = escapeHtml(article.id);
  if (isRead(article)) {
    const saving = syncState.get(article.id) === 'saving';
    return `<button class="read-btn" data-news-id="${id}" disabled>${escapeHtml(saving ? t.saving : t.read)}</button>`;
  }
  if (!receiptsReady) return `<button class="read-btn" data-news-id="${id}" disabled>${escapeHtml(t.checking)}</button>`;
  return `<button class="read-btn" data-news-id="${id}">${escapeHtml(t.mark)}</button>`;
}

function render() {
  const t = text[lang()];
  if (!articles) {
    content.className = 'notice';
    content.textContent = t.loading;
    return;
  }
  if (!articles.length) {
    content.className = 'notice';
    content.textContent = t.empty;
    return;
  }
  content.className = 'news-list';
  content.innerHTML = articles.map((article, index) => {
    const title = lang() === 'zh' ? article.titleZh : article.titleEn;
    const body = lang() === 'zh' ? article.bodyZh : article.bodyEn;
    const publishedAt = article.publishedAt?.toDate?.();
    const date = publishedAt ? new Intl.DateTimeFormat(lang() === 'zh' ? 'zh-HK' : 'en-GB', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Hong_Kong' }).format(publishedAt) : '';
    const seen = revealedIds.has(article.id);
    revealedIds.add(article.id);
    const readButton = activeUser ? buttonHtml(article, t) : '';
    const note = activeUser && syncState.get(article.id) === 'failed' && isRead(article)
      ? `<p class="sync-note">${escapeHtml(t.syncPending)}</p>`
      : '';
    return `<article class="news-card fade-in${seen ? ' is-visible' : ''}"${seen ? '' : ` style="transition-delay:${Math.min(index, 4) * 0.05}s"`}><div class="news-meta">${escapeHtml(t.date)}${date ? ` · ${escapeHtml(date)}` : ''}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${readButton}${note}</article>`;
  }).join('');
  content.querySelectorAll('.news-card.fade-in:not(.is-visible)').forEach(card => window.auroraFade?.(card));
  content.querySelectorAll('[data-news-id]:not([disabled])').forEach(button => button.addEventListener('click', () => markRead(button.dataset.newsId)));
}

async function writeReceipt(user, newsId, revision) {
  await setDoc(doc(db, 'newsReads', `${user.uid}_${newsId}`), { uid:user.uid, newsId, revision, readAt:serverTimestamp() });
}

async function syncPendingReceipts(user) {
  if (!articles || syncedForUid === user.uid) return;
  syncedForUid = user.uid;
  for (const article of articles) {
    const revision = articleRevision(article);
    const local = Number(localReads.get(article.id)) || 0;
    if (local < revision || (Number(serverReads.get(article.id)) || 0) >= revision) continue;
    try {
      await writeReceipt(user, article.id, revision);
      syncState.delete(article.id);
    } catch (error) {
      console.error(`Could not sync the read receipt for news ${article.id}:`, error?.code || '', error);
      syncState.set(article.id, 'failed');
    }
  }
  if (activeUser?.uid === user.uid) render();
}

function loadNews(user) {
  newsUnsubscribers.forEach(unsubscribe => unsubscribe());
  newsUnsubscribers = [];
  activeUser = user;
  content.className = 'notice';
  content.textContent = text[lang()].loading;
  articles = null;
  serverReads = new Map();
  localReads = user ? getLocalReads(user.uid) : new Map();
  receiptsReady = !user;
  syncedForUid = null;
  syncState.clear();

  newsUnsubscribers.push(onSnapshot(query(collection(db, 'news'), where('status', '==', 'published'), where('deleted', '==', false)), snapshot => {
    if (activeUser?.uid !== user?.uid) return;
    articles = snapshot.docs.map(item => ({ id:item.id, ...item.data() }))
      .sort((a,b) => millis(b.updatedAt) - millis(a.updatedAt));
    render();
    if (user && receiptsReady) syncPendingReceipts(user);
  }, error => showLoadError(error)));

  if (user) {
    newsUnsubscribers.push(onSnapshot(query(collection(db, 'newsReads'), where('uid', '==', user.uid)), snapshot => {
      if (activeUser?.uid !== user.uid) return;
      serverReads = new Map(snapshot.docs.map(item => [item.data().newsId, Number(item.data().revision) || 0]));
      receiptsReady = true;
      render();
      syncPendingReceipts(user);
    }, error => {
      console.error('Could not load read receipts:', error?.code || '', error);
      if (activeUser?.uid !== user.uid) return;
      receiptsReady = true;
      render();
    }));
  }
}

function showLoadError(error) {
  console.error('Could not load news:', error);
  content.className = 'notice';
  content.textContent = text[lang()].fail;
}

async function markRead(newsId) {
  const user = activeUser;
  const article = articles?.find(item => item.id === newsId);
  if (!user || !article) return;
  const revision = articleRevision(article);
  rememberLocalRead(user.uid, newsId, revision);
  localReads = getLocalReads(user.uid);
  syncState.set(newsId, 'saving');
  render();
  try {
    await writeReceipt(user, newsId, revision);
    syncState.delete(newsId);
  } catch (error) {
    console.error(`Could not save the read receipt for news ${newsId}:`, error?.code || '', error);
    syncState.set(newsId, 'failed');
  }
  if (activeUser?.uid === user.uid) render();
}

updateLanguage(lang());
AuroraAuth.onChange(loadNews);
window.addEventListener('aurora:langchange', event => updateLanguage(event.detail.lang));
