import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let initialized = false;
let services;
let newsItems = [];
let drafts = [];
let editor = null;
let editorDirty = false;
let saveTimer = null;
let pendingSave = null;

const $ = id => document.getElementById(id);
const fields = ['titleEn', 'bodyEn', 'titleZh', 'bodyZh'];
const fieldElements = {
  titleEn: 'news-title-en',
  bodyEn: 'news-body-en',
  titleZh: 'news-title-zh',
  bodyZh: 'news-body-zh'
};
const messages = {
  en: {
    loading:'Loading announcements…', loadFailed:'Could not load announcements.',
    empty:'No announcements or drafts yet.', published:'Published', deleted:'Deleted',
    draft:'Draft', edit:'Edit', remove:'Delete', restore:'Restore', logs:'Activity log',
    save:'Saving draft…', saved:'Draft saved automatically.', saveFailed:'Draft could not be saved.',
    publishing:'Publishing…', confirmPublish:'Publish this announcement? Students will be able to read it immediately.',
    missing:'Complete both language titles and announcement texts before publishing.',
    missingEnglish:'Enter an English title and announcement before continuing.',
    missingChinese:'Enter a Traditional Chinese title and announcement before reviewing.',
    confirmDelete:'Move this announcement to deleted items?', confirmRestore:'Restore and republish this announcement?',
    close:'Close', translationEmpty:'Enter the source text before translating.',
    translating:'Translating…', translateFailed:'Translation failed. Check the server translation configuration and try again.',
    pastNews:'Past news', sendEmails:'Send / retry subscriber emails',
    emailResult:(sent,failed,skipped) => `Email delivery: ${sent} sent, ${failed} failed, ${skipped} already sent.`,
    emailFailed:'Could not send news emails. The announcement is published; use Send / retry subscriber emails to try again.',
    eta:(seconds) => `Estimated time left: about ${seconds} seconds`,
    noLogs:'No activity has been recorded.', saveFirst:'Start typing to create an auto-saved draft.'
  },
  zh: {
    loading:'正在載入公告……', loadFailed:'無法載入公告。',
    empty:'尚未有公告或草稿。', published:'已發布', deleted:'已刪除',
    draft:'草稿', edit:'編輯', remove:'刪除', restore:'還原', logs:'操作紀錄',
    save:'正在儲存草稿……', saved:'草稿已自動儲存。', saveFailed:'無法儲存草稿。',
    publishing:'正在發布……', confirmPublish:'要發布此公告嗎？學生將可立即閱讀。',
    missing:'發布前請填寫中英文標題及公告內容。',
    missingEnglish:'請先填寫英文標題及公告內容。',
    missingChinese:'請填寫繁體中文標題及公告內容以檢查版本。',
    confirmDelete:'要將此公告移至已刪除項目嗎？', confirmRestore:'要還原並重新發布此公告嗎？',
    close:'關閉', translationEmpty:'請先輸入要翻譯的內容。',
    translating:'正在翻譯……', translateFailed:'翻譯失敗。請檢查伺服器翻譯設定後再試。',
    pastNews:'過往消息', sendEmails:'發送／重試訂閱者電郵',
    emailResult:(sent,failed,skipped) => `電郵發送：已寄出 ${sent} 封，失敗 ${failed} 封，已發送 ${skipped} 封。`,
    emailFailed:'無法發送消息電郵。公告已發布；請使用「發送／重試訂閱者電郵」再試。',
    eta:(seconds) => `預計剩餘時間：約 ${seconds} 秒`,
    noLogs:'尚未有操作紀錄。', saveFirst:'輸入內容後便會自動建立草稿。'
  }
};

const lang = () => localStorage.getItem('aurora_news_admin_lang') === 'zh' ? 'zh' : 'en';
const t = () => messages[lang()];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const timeMillis = value => value?.toMillis?.() || 0;

function setLanguage(language) {
  localStorage.setItem('aurora_news_admin_lang', language);
  document.querySelectorAll('.news-i18n').forEach(element => {
    const translated = element.getAttribute(`data-${language}`);
    if (translated) element.textContent = translated;
  });
  $('news-language-btn').textContent = language === 'en' ? '繁體中文' : 'English';
  renderNewsList();
}

function setEditorStatus(message, isError = false) {
  const status = $('news-editor-status');
  status.textContent = message;
  status.style.color = isError ? 'var(--aurora-red)' : 'var(--aurora-teal)';
}

function editorValues() {
  return Object.fromEntries(fields.map(field => [field, $(fieldElements[field]).value.trim()]));
}

async function showEditor(nextEditor, values = {}) {
  if (editor && editorDirty) {
    clearTimeout(saveTimer);
    if (!(await saveDraft())) return;
    if (editorDirty && !(await saveDraft())) return;
  }
  editor = nextEditor;
  editorDirty = false;
  fields.forEach(field => { $(fieldElements[field]).value = values[field] || ''; });
  $('news-editor').showModal();
  showNewsStep('en');
  setEditorStatus(editor.draftId ? t().saved : t().saveFirst);
  $('news-title-en').focus();
}

function showNewsStep(step) {
  ['en', 'zh', 'review'].forEach(name => {
    $(`news-step-${name}`).classList.toggle('hidden', name !== step);
  });
  $('news-back-btn').classList.toggle('hidden', step !== 'zh');
  $('news-publish-btn').classList.toggle('hidden', step !== 'review');
}

async function closeEditor(savePending = false) {
  clearTimeout(saveTimer);
  if (savePending && editor && editorDirty) {
    if (!(await saveDraft())) return;
    if (editorDirty && !(await saveDraft())) return;
  }
  $('news-editor').close();
  editor = null;
  editorDirty = false;
}

function scheduleSave() {
  if (!editor) return;
  editorDirty = true;
  clearTimeout(saveTimer);
  setEditorStatus(t().save);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDraft();
  }, 700);
}

async function saveDraft() {
  if (!editor) return false;
  if (pendingSave) return pendingSave;
  const targetEditor = editor;
  const values = editorValues();
  const payload = {
    ...values,
    newsId: targetEditor.newsId || null,
    updatedAt: serverTimestamp(),
    updatedBy: services.auth.currentUser?.email || ''
  };
  pendingSave = (async () => {
    try {
      if (targetEditor.draftId) {
        await updateDoc(doc(services.db, 'newsDrafts', targetEditor.draftId), payload);
      } else {
        const draftRef = await addDoc(collection(services.db, 'newsDrafts'), {
          ...payload,
          createdAt:serverTimestamp(),
          createdBy:services.auth.currentUser?.email || ''
        });
        targetEditor.draftId = draftRef.id;
      }
      drafts = await loadDrafts();
      if (editor === targetEditor) {
        editorDirty = fields.some(field => $(fieldElements[field]).value.trim() !== values[field]);
        setEditorStatus(t().saved);
      }
      renderNewsList();
      return true;
    } catch (error) {
      console.error('Could not save news draft:', error);
      if (editor === targetEditor) setEditorStatus(t().saveFailed, true);
      return false;
    } finally {
      pendingSave = null;
    }
  })();
  return pendingSave;
}

async function loadDrafts() {
  const snapshot = await getDocs(collection(services.db, 'newsDrafts'));
  return snapshot.docs.map(item => ({ id:item.id, ...item.data() }));
}

async function loadNewsData() {
  const list = $('news-admin-list');
  list.textContent = t().loading;
  try {
    const [newsSnapshot, draftSnapshot] = await Promise.all([
      getDocs(collection(services.db, 'news')),
      getDocs(collection(services.db, 'newsDrafts'))
    ]);
    newsItems = newsSnapshot.docs.map(item => ({ id:item.id, ...item.data() }));
    drafts = draftSnapshot.docs.map(item => ({ id:item.id, ...item.data() }));
    renderNewsList();
  } catch (error) {
    console.error('Could not load news management data:', error);
    list.textContent = `${t().loadFailed} ${error.message}`;
  }
}

function renderNewsList() {
  const list = $('news-admin-list');
  if (!list) return;
  const sortedNews = [...newsItems].sort((a,b) => timeMillis(b.updatedAt) - timeMillis(a.updatedAt));
  const sortedDrafts = [...drafts].sort((a,b) => timeMillis(b.updatedAt) - timeMillis(a.updatedAt));
  if (!sortedNews.length && !sortedDrafts.length) {
    list.textContent = t().empty;
    return;
  }

  const draftCards = sortedDrafts.map(draft => `
    <article class="news-admin-card">
      <strong>${escapeHtml(t().draft)}</strong>
      <h3>${escapeHtml(draft.titleEn || draft.titleZh || (lang() === 'zh' ? '未命名草稿' : 'Untitled draft'))}</h3>
      <div>${escapeHtml(draft.newsId ? (lang() === 'zh' ? '編輯中的公告' : 'Editing an announcement') : (lang() === 'zh' ? '新公告草稿' : 'New announcement draft'))}</div>
      <div class="news-admin-actions"><button class="nav-btn" data-edit-draft="${escapeHtml(draft.id)}">${escapeHtml(t().edit)}</button><button class="nav-btn nav-btn-danger" data-delete-draft="${escapeHtml(draft.id)}">${escapeHtml(t().remove)}</button></div>
    </article>`).join('');

  const articleCards = sortedNews.map(item => {
    const removed = item.deleted === true;
    return `<article class="news-admin-card" data-article="${escapeHtml(item.id)}">
      <strong>${escapeHtml(removed ? t().deleted : t().published)}</strong>
      <h3>${escapeHtml(item.titleEn || item.titleZh || '')}</h3>
      <div>${escapeHtml(item.titleZh || '')}</div>
      <div class="news-admin-actions">
        <button class="nav-btn" data-edit-news="${escapeHtml(item.id)}">${escapeHtml(t().edit)}</button>
        ${removed
          ? `<button class="nav-btn" data-restore-news="${escapeHtml(item.id)}">${escapeHtml(t().restore)}</button>`
          : `<button class="nav-btn nav-btn-danger" data-delete-news="${escapeHtml(item.id)}">${escapeHtml(t().remove)}</button><button class="nav-btn" data-email-news="${escapeHtml(item.id)}">${escapeHtml(t().sendEmails)}</button>`}
        <button class="nav-btn" data-show-logs="${escapeHtml(item.id)}">${escapeHtml(t().logs)}</button>
      </div>
      <ol class="news-log-list hidden" data-log-list="${escapeHtml(item.id)}"></ol>
    </article>`;
  }).join('');
  list.innerHTML = `${draftCards}${articleCards ? `<h3 class="news-step-title">${escapeHtml(t().pastNews)}</h3>${articleCards}` : ''}`;
  list.querySelectorAll('[data-edit-draft]').forEach(button => button.addEventListener('click', () => editDraft(button.dataset.editDraft)));
  list.querySelectorAll('[data-delete-draft]').forEach(button => button.addEventListener('click', () => removeDraft(button.dataset.deleteDraft)));
  list.querySelectorAll('[data-edit-news]').forEach(button => button.addEventListener('click', () => editNews(button.dataset.editNews)));
  list.querySelectorAll('[data-delete-news]').forEach(button => button.addEventListener('click', () => setDeleted(button.dataset.deleteNews, true)));
  list.querySelectorAll('[data-restore-news]').forEach(button => button.addEventListener('click', () => setDeleted(button.dataset.restoreNews, false)));
  list.querySelectorAll('[data-show-logs]').forEach(button => button.addEventListener('click', () => showLogs(button.dataset.showLogs)));
  list.querySelectorAll('[data-email-news]').forEach(button => button.addEventListener('click', () => retryNewsEmails(button)));
}

function startNewDraft() {
  showEditor({ newsId:null, draftId:null });
}

function continueToChinese() {
  const values = editorValues();
  if (!values.titleEn || !values.bodyEn) {
    setEditorStatus(t().missingEnglish, true);
    return;
  }
  showNewsStep('zh');
  $('news-title-zh').focus();
}

function reviewDraft() {
  const values = editorValues();
  if (!values.titleZh || !values.bodyZh) {
    setEditorStatus(t().missingChinese, true);
    return;
  }
  $('news-review-title-en').textContent = values.titleEn;
  $('news-review-body-en').textContent = values.bodyEn;
  $('news-review-title-zh').textContent = values.titleZh;
  $('news-review-body-zh').textContent = values.bodyZh;
  showNewsStep('review');
}

function editDraft(draftId) {
  const draft = drafts.find(item => item.id === draftId);
  if (draft) showEditor({ newsId:draft.newsId || null, draftId:draft.id }, draft);
}

function editNews(newsId) {
  const article = newsItems.find(item => item.id === newsId);
  if (!article) return;
  const existingDraft = drafts.find(item => item.newsId === newsId);
  showEditor(
    { newsId, draftId:existingDraft?.id || null },
    existingDraft || article
  );
}

async function actorDetails() {
  const user = services.auth.currentUser;
  return { actorName:user?.displayName || user?.email || 'Admin', actorEmail:user?.email || '' };
}

async function publishDraft() {
  if (!editor) return;
  const values = editorValues();
  if (fields.some(field => !values[field])) {
    setEditorStatus(t().missing, true);
    return;
  }
  if (!window.confirm(t().confirmPublish)) return;
  $('news-publish-btn').disabled = true;
  setEditorStatus(t().publishing);
  try {
    if (!(await saveDraft())) throw new Error(t().saveFailed);
    const { actorName, actorEmail } = await actorDetails();
    const batch = writeBatch(services.db);
    const articleRef = editor.newsId ? doc(services.db, 'news', editor.newsId) : doc(collection(services.db, 'news'));
    const existing = editor.newsId ? newsItems.find(item => item.id === editor.newsId) : null;
    const content = {
      ...values,
      status:'published',
      deleted:false,
      revision:(Number(existing?.revision) || 0) + 1,
      updatedAt:serverTimestamp(),
      ...(existing ? {} : { createdAt:serverTimestamp(), publishedAt:serverTimestamp() })
    };
    if (existing) batch.update(articleRef, content);
    else batch.set(articleRef, content);
    const logRef = doc(collection(articleRef, 'logs'));
    batch.set(logRef, {
      action:existing ? 'edited' : 'announced',
      actorName,
      actorEmail,
      timestamp:serverTimestamp()
    });
    if (editor.draftId) batch.delete(doc(services.db, 'newsDrafts', editor.draftId));
    await batch.commit();
    try {
      const delivery = await sendNewsEmails(articleRef.id, false);
      if (delivery.failed) window.alert(t().emailResult(delivery.sent, delivery.failed, delivery.skipped));
    } catch (error) {
      console.error('Announcement published, but subscriber emails could not be delivered:', error);
      window.alert(t().emailFailed);
    }
    await closeEditor();
    await loadNewsData();
  } catch (error) {
    console.error('Could not publish news:', error);
    setEditorStatus(error.message || t().loadFailed, true);
  } finally {
    $('news-publish-btn').disabled = false;
  }
}

async function removeDraft(draftId) {
  const question = lang() === 'zh' ? '要永久刪除此草稿嗎？' : 'Permanently delete this draft?';
  if (!window.confirm(question)) return;
  try {
    await deleteDoc(doc(services.db, 'newsDrafts', draftId));
    drafts = drafts.filter(item => item.id !== draftId);
    if (editor?.draftId === draftId) await closeEditor();
    renderNewsList();
  } catch (error) {
    console.error('Could not delete draft:', error);
    window.alert(error.message);
  }
}

async function setDeleted(newsId, deleted) {
  const prompt = deleted ? t().confirmDelete : t().confirmRestore;
  if (!window.confirm(prompt)) return;
  try {
    const { actorName, actorEmail } = await actorDetails();
    const articleRef = doc(services.db, 'news', newsId);
    const batch = writeBatch(services.db);
    const article = newsItems.find(item => item.id === newsId);
    batch.update(articleRef, { deleted, revision:(Number(article?.revision) || 0) + 1, updatedAt:serverTimestamp() });
    batch.set(doc(collection(articleRef, 'logs')), {
      action:deleted ? 'deleted' : 'restored',
      actorName,
      actorEmail,
      timestamp:serverTimestamp()
    });
    await batch.commit();
    await loadNewsData();
  } catch (error) {
    console.error('Could not update news visibility:', error);
    window.alert(error.message);
  }
}

async function showLogs(newsId) {
  const logList = document.querySelector(`[data-log-list="${CSS.escape(newsId)}"]`);
  if (!logList) return;
  if (!logList.classList.contains('hidden')) {
    logList.classList.add('hidden');
    return;
  }
  logList.classList.remove('hidden');
  logList.textContent = t().loading;
  try {
    const snapshot = await getDocs(collection(services.db, 'news', newsId, 'logs'));
    const logs = snapshot.docs.map(item => item.data()).sort((a,b) => timeMillis(b.timestamp) - timeMillis(a.timestamp));
    logList.innerHTML = logs.length ? logs.map(entry => {
      const action = ({ announced:{en:'announced',zh:'發布'}, edited:{en:'edited',zh:'編輯'}, deleted:{en:'deleted',zh:'刪除'}, restored:{en:'restored',zh:'還原'} })[entry.action]?.[lang()] || entry.action;
      const date = entry.timestamp?.toDate?.();
      const dateText = date ? new Intl.DateTimeFormat(lang() === 'zh' ? 'zh-HK' : 'en-GB', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Hong_Kong' }).format(date) : '';
      return `<li>${escapeHtml(action)} — ${escapeHtml(entry.actorName || entry.actorEmail)} ${entry.actorEmail ? `(${escapeHtml(entry.actorEmail)})` : ''} ${dateText ? `· ${escapeHtml(dateText)} HKT` : ''}</li>`;
    }).join('') : `<li>${escapeHtml(t().noLogs)}</li>`;
  } catch (error) {
    console.error('Could not load news audit log:', error);
    logList.textContent = error.message;
  }
}

async function translateText(text) {
  const token = await services.auth.currentUser.getIdToken();
  const response = await fetch(`${services.apiBase}/api/translate-news`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify({ text, targetLanguage:'zh' })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.translation) throw new Error(result.error || t().translateFailed);
  return result.translation;
}

async function translateChinese() {
  const title = $('news-title-en').value.trim();
  const body = $('news-body-en').value.trim();
  if (!title || !body) {
    setEditorStatus(t().translationEmpty, true);
    return;
  }
  const button = $('news-translate-zh-btn');
  const dialog = $('news-translation-dialog');
  const status = $('news-translation-status');
  const progress = $('news-translation-progress');
  const duration = 12;
  let seconds = duration;
  button.disabled = true;
  setEditorStatus(t().translating);
  status.textContent = t().eta(seconds);
  progress.value = 0;
  dialog.showModal();
  const timer = setInterval(() => {
    seconds = Math.max(1, seconds - 1);
    status.textContent = t().eta(seconds);
    progress.value = duration - seconds;
  }, 1000);
  try {
    const [translatedTitle, translatedBody] = await Promise.all([
      translateText(title),
      translateText(body)
    ]);
    $('news-title-zh').value = translatedTitle;
    $('news-body-zh').value = translatedBody;
    scheduleSave();
  } catch (error) {
    console.error('Could not translate news:', error);
    setEditorStatus(error.message || t().translateFailed, true);
  } finally {
    clearInterval(timer);
    dialog.close();
    button.disabled = false;
  }
}

async function sendNewsEmails(newsId, report = true) {
  const token = await services.auth.currentUser.getIdToken();
  const response = await fetch(`${services.apiBase}/api/publish-news`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify({ newsId })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || t().emailFailed);
  if (report) {
    window.alert(t().emailResult(result.sent || 0, result.failed || 0, result.skipped || 0));
  }
  return result;
}

async function retryNewsEmails(button) {
  button.disabled = true;
  try {
    await sendNewsEmails(button.dataset.emailNews, true);
  } catch (error) {
    console.error('Could not retry news email delivery:', error);
    window.alert(error.message || t().emailFailed);
  } finally {
    button.disabled = false;
  }
}

export function initAdminNews(options) {
  services = options;
  if (!initialized) {
    initialized = true;
    setLanguage(lang());
    $('news-language-btn').addEventListener('click', () => setLanguage(lang() === 'en' ? 'zh' : 'en'));
    $('news-new-btn').addEventListener('click', startNewDraft);
    $('news-cancel-btn').addEventListener('click', () => closeEditor(true));
    $('news-editor').addEventListener('cancel', event => {
      event.preventDefault();
      closeEditor(true);
    });
    $('news-publish-btn').addEventListener('click', publishDraft);
    $('news-next-btn').addEventListener('click', continueToChinese);
    $('news-back-btn').addEventListener('click', () => showNewsStep('en'));
    $('news-review-btn').addEventListener('click', reviewDraft);
    $('news-review-back-btn').addEventListener('click', () => showNewsStep('zh'));
    $('news-translate-zh-btn').addEventListener('click', translateChinese);
    fields.forEach(field => $(fieldElements[field]).addEventListener('input', scheduleSave));
  }
  return loadNewsData();
}
