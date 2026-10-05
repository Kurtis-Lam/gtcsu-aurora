import { auth } from './firebase-config.js';
import { API_BASE } from './api-config.js';

const section = document.getElementById('news-section');
if (section) {
  const form = document.getElementById('news-form');
  const list = document.getElementById('news-admin-list');
  const message = document.getElementById('news-admin-message');
  const logs = document.getElementById('news-admin-logs');
  const languageButton = document.getElementById('news-admin-language');
  let adminLanguage = localStorage.getItem('aurora_lang') === 'zh' ? 'zh' : 'en';
  let newsItems = [];
  let editingId = null;
  let activeLogId = null;
  let busy = false;

  const words = {
    en: {
      loading: 'Loading announcements…', loadError: 'Could not load news.',
      empty: 'No announcements yet.', deleted: 'Deleted', published: 'Published',
      edit: 'Edit', remove: 'Delete', restore: 'Restore', viewLog: 'Activity log',
      publish: 'Publish announcement', save: 'Save changes', publishConfirm: 'Publish this announcement now?',
      editConfirm: 'Save and publish these changes now? Students will see this as unread again.',
      deleteConfirm: 'Move this announcement to the deleted archive?',
      restoreConfirm: 'Restore this announcement? It will be marked unread for students.',
      saved: 'Announcement published.', edited: 'Announcement updated.',
      deletedMessage: 'Announcement moved to the archive.',
      restored: 'Announcement restored and marked unread for students.',
      failed: 'The request could not be completed.', missing: 'Complete both English and Chinese titles and news content.',
      translationConfirm: 'Replace the existing translated fields?',
      translated: 'Translation added. Review it carefully before publishing.',
      translating: 'Translating…', translationFailed: 'Translation failed.',
      noLogs: 'No activity has been recorded yet.', publishedAction: 'Published',
      editedAction: 'Edited', deleteAction: 'Deleted', restoreAction: 'Restored',
      historyLabel: 'News activity log', selectLog: 'Select a news item to view its history.',
      by: 'by', at: 'at', cancel: 'Cancel', newAnnouncement: '+ New announcement'
    },
    zh: {
      loading: '正在載入公告…', loadError: '無法載入消息。',
      empty: '暫時沒有公告。', deleted: '已刪除', published: '已發布',
      edit: '編輯', remove: '刪除', restore: '還原', viewLog: '操作記錄',
      publish: '發布公告', save: '儲存修改', publishConfirm: '確定現在發布此公告嗎？',
      editConfirm: '確定現在儲存並發布修改嗎？學生會再次看到未讀提示。',
      deleteConfirm: '確定將此公告移至已刪除項目嗎？',
      restoreConfirm: '確定還原此公告嗎？學生會再次看到未讀提示。',
      saved: '公告已發布。', edited: '公告已更新。',
      deletedMessage: '公告已移至已刪除項目。',
      restored: '公告已還原，並重新標記為學生未讀。',
      failed: '無法完成此操作。', missing: '請填寫完整的英文及繁體中文標題與內容。',
      translationConfirm: '要取代現有的翻譯內容嗎？',
      translated: '已加入翻譯，發布前請仔細檢查。',
      translating: '正在翻譯…', translationFailed: '翻譯失敗。',
      noLogs: '暫無操作記錄。', publishedAction: '已發布',
      editedAction: '已編輯', deleteAction: '已刪除', restoreAction: '已還原',
      historyLabel: '消息操作記錄', selectLog: '選擇消息以查看其操作記錄。',
      by: '操作人：', at: '時間：', cancel: '取消', newAnnouncement: '+ 新增公告'
    }
  };
  const t = () => words[adminLanguage];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('error', isError);
  }

  async function request(method, payload, query = '') {
    const user = auth.currentUser;
    if (!user) throw new Error(t().failed);
    const token = await user.getIdToken();
    const response = await fetch(`${API_BASE}/api/news${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${t().failed} (${response.status})`);
    return data;
  }

  function setLanguage() {
    section.querySelectorAll('[data-en][data-zh]').forEach((element) => {
      const text = element.getAttribute(`data-${adminLanguage}`);
      if (text) element.textContent = text;
    });
    languageButton.textContent = adminLanguage === 'en' ? '繁體中文' : 'English';
    document.getElementById('news-save-btn').textContent = editingId ? t().save : t().publish;
    document.getElementById('news-cancel-btn').textContent = t().cancel;
    document.getElementById('news-new-btn').textContent = t().newAnnouncement;
    renderList();
    if (activeLogId) loadLogs(activeLogId);
  }

  function renderList() {
    if (!newsItems.length) {
      list.innerHTML = `<p>${escapeHtml(t().empty)}</p>`;
      return;
    }
    list.innerHTML = newsItems.map((item) => {
      const title = adminLanguage === 'zh' ? item.titleZh : item.titleEn;
      const state = item.deleted ? t().deleted : t().published;
      return `<div class="news-admin-row">
        <div class="news-admin-row-title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(state)} · Rev ${Number(item.revision) || 1}</small></div>
        <div class="news-admin-actions">
          ${item.deleted
            ? `<button class="nav-btn" data-action="restore" data-id="${escapeHtml(item.id)}">${escapeHtml(t().restore)}</button>`
            : `<button class="nav-btn" data-action="edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t().edit)}</button><button class="nav-btn nav-btn-danger" data-action="delete" data-id="${escapeHtml(item.id)}">${escapeHtml(t().remove)}</button>`}
          <button class="nav-btn" data-action="logs" data-id="${escapeHtml(item.id)}">${escapeHtml(t().viewLog)}</button>
        </div>
      </div>`;
    }).join('');
  }

  async function loadNews() {
    list.innerHTML = `<p>${escapeHtml(t().loading)}</p>`;
    try {
      const data = await request('GET', null, '?admin=1');
      newsItems = Array.isArray(data.news) ? data.news : [];
      renderList();
    } catch (error) {
      console.error('Could not load admin news:', error);
      list.textContent = t().loadError;
    }
  }

  async function loadLogs(id) {
    activeLogId = id;
    logs.textContent = t().loading;
    const item = newsItems.find((entry) => entry.id === id);
    document.getElementById('news-admin-logs-title').textContent =
      `${t().historyLabel}: ${adminLanguage === 'zh' ? item?.titleZh : item?.titleEn}`;
    try {
      const data = await request('GET', null, `?admin=1&newsId=${encodeURIComponent(id)}`);
      const actionLabels = {
        published: t().publishedAction,
        edited: t().editedAction,
        delete: t().deleteAction,
        restore: t().restoreAction
      };
      logs.innerHTML = data.logs?.length ? data.logs.map((entry) => {
        const actor = entry.actor?.name || entry.actor?.email || entry.actor?.uid || '—';
        const email = entry.actor?.email ? ` (${entry.actor.email})` : '';
        const time = entry.createdAt
          ? new Intl.DateTimeFormat(adminLanguage === 'zh' ? 'zh-HK' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))
          : '—';
        return `<div class="news-admin-log"><strong>${escapeHtml(actionLabels[entry.action] || entry.action)}</strong> · Rev ${Number(entry.revision) || 1}<small>${escapeHtml(t().by)} ${escapeHtml(actor + email)} · ${escapeHtml(t().at)} ${escapeHtml(time)}</small></div>`;
      }).join('') : `<p>${escapeHtml(t().noLogs)}</p>`;
    } catch (error) {
      console.error('Could not load news activity log:', error);
      logs.textContent = t().loadError;
    }
  }

  function clearForm() {
    form.reset();
    editingId = null;
    form.hidden = true;
    document.getElementById('news-save-btn').textContent = t().publish;
    setMessage('');
  }

  document.getElementById('news-new-btn').addEventListener('click', () => {
    clearForm();
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('news-cancel-btn').addEventListener('click', clearForm);

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const item = newsItems.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    const action = button.dataset.action;
    if (action === 'logs') {
      loadLogs(item.id);
      return;
    }
    if (action === 'edit') {
      editingId = item.id;
      document.getElementById('news-title-en').value = item.titleEn;
      document.getElementById('news-title-zh').value = item.titleZh;
      document.getElementById('news-body-en').value = item.bodyEn;
      document.getElementById('news-body-zh').value = item.bodyZh;
      form.hidden = false;
      document.getElementById('news-save-btn').textContent = t().save;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const confirmation = action === 'delete' ? t().deleteConfirm : t().restoreConfirm;
    if (!window.confirm(confirmation)) return;
    busy = true;
    try {
      await request('POST', { action, id: item.id });
      setMessage(action === 'delete' ? t().deletedMessage : t().restored);
      await loadNews();
    } catch (error) {
      console.error(`Could not ${action} news item:`, error);
      setMessage(t().failed, true);
    } finally {
      busy = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const payload = {
      action: editingId ? 'edit' : 'publish',
      ...(editingId ? { id: editingId } : {}),
      titleEn: document.getElementById('news-title-en').value.trim(),
      titleZh: document.getElementById('news-title-zh').value.trim(),
      bodyEn: document.getElementById('news-body-en').value.trim(),
      bodyZh: document.getElementById('news-body-zh').value.trim()
    };
    if (!payload.titleEn || !payload.titleZh || !payload.bodyEn || !payload.bodyZh) {
      setMessage(t().missing, true);
      return;
    }
    if (!window.confirm(editingId ? t().editConfirm : t().publishConfirm)) return;
    busy = true;
    try {
      await request('POST', payload);
      const successMessage = editingId ? t().edited : t().saved;
      clearForm();
      setMessage(successMessage);
      await loadNews();
    } catch (error) {
      console.error('Could not save news item:', error);
      setMessage(t().failed, true);
    } finally {
      busy = false;
    }
  });

  section.querySelectorAll('.news-translate-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      if (busy) return;
      const source = button.dataset.source;
      const target = source === 'en' ? 'zh' : 'en';
      const sourceTitle = document.getElementById(`news-title-${source}`);
      const sourceBody = document.getElementById(`news-body-${source}`);
      const targetTitle = document.getElementById(`news-title-${target}`);
      const targetBody = document.getElementById(`news-body-${target}`);
      if (!sourceTitle.value.trim() || !sourceBody.value.trim()) {
        setMessage(t().missing, true);
        return;
      }
      if ((targetTitle.value.trim() || targetBody.value.trim()) && !window.confirm(t().translationConfirm)) return;
      busy = true;
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = t().translating;
      try {
        const data = await request('POST', {
          action: 'translate',
          sourceLanguage: source,
          targetLanguage: target,
          title: sourceTitle.value,
          content: sourceBody.value
        });
        targetTitle.value = data.translation.title;
        targetBody.value = data.translation.content;
        setMessage(t().translated);
      } catch (error) {
        console.error('Could not translate news:', error);
        setMessage(t().translationFailed, true);
      } finally {
        busy = false;
        button.disabled = false;
        button.textContent = oldText;
      }
    });
  });

  languageButton.addEventListener('click', () => {
    adminLanguage = adminLanguage === 'en' ? 'zh' : 'en';
    localStorage.setItem('aurora_lang', adminLanguage);
    document.documentElement.lang = adminLanguage === 'zh' ? 'zh-Hant' : 'en';
    setLanguage();
  });
  window.addEventListener('aurora:admin-news-show', loadNews);
  window.addEventListener('aurora:langchange', (event) => {
    adminLanguage = event.detail?.lang === 'zh' ? 'zh' : 'en';
    setLanguage();
  });
  setLanguage();
}
