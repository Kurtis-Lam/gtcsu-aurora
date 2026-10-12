import { AuroraAuth } from './load-components.js';
import { API_BASE } from './api-config.js';
import { readPhotoCache, readCachedThumb, storeCachedThumb, preloadPhotos } from './preload.js';

const CONSENT_VERSION = '2026-10-v1';

const authContainer = document.getElementById('auth-container');
const galleryContent = document.getElementById('gallery-content');
const gridEl = document.getElementById('photos-grid');
const filtersEl = document.getElementById('folder-filters');
const countEl = document.getElementById('selected-count');
const downloadBtn = document.getElementById('download-zip-btn');
const downloadLabel = document.getElementById('download-btn-label');
const clearBtn = document.getElementById('clear-selection-btn');
const selectAllEl = document.getElementById('select-all-checkbox');
const progressPanel = document.getElementById('progress-panel');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const statusBanner = document.getElementById('status-banner');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');
const lightboxDownloadLabel = document.getElementById('lightbox-download-label');

const consentModal = document.getElementById('consent-modal');
const consentCheckbox = document.getElementById('consent-checkbox');
const consentAccept = document.getElementById('consent-accept');
const consentCancel = document.getElementById('consent-cancel');
const consentCount = document.getElementById('consent-count');

let currentLang = localStorage.getItem('aurora_lang') || 'en';
let busy = false;
let lastMessage = null;
let lastStatus = null;
let pendingDownload = null;
let lightboxImage = null;

const T = {
  en: {
    allPhotos: '✨ All Photos',
    selected: (n) => `${n} selected`,
    downloadSelected: (n) => (n > 1 ? `Download ${n} photos (ZIP)` : n === 1 ? 'Download 1 photo' : 'Download selected'),
    download: 'Download',
    preparing: 'Preparing protected files…',
    progress: (done, total) => `Preparing photo ${Math.min(done + 1, total)} of ${total}`,
    packaging: 'Packaging ZIP file…',
    loading: 'Loading photos gallery...',
    loadFail: 'Failed to load photos. Please refresh and try again.',
    empty: 'No photos available in this folder.',
    untitled: 'Untitled',
    gallery: 'Gallery',
    photo: 'Photo',
    unavailable: 'unavailable',
    downloadPhoto: 'Download this photo',
    consentCount: (n) => (n === 1 ? 'You are about to download 1 photo.' : `You are about to download ${n} photos.`),
    done: (n) => (n === 1 ? 'Your photo has been downloaded.' : `${n} photos have been downloaded.`),
    failed: (m) => `Download failed: ${m}`,
    zipMissing: 'The ZIP component could not be loaded. Please refresh the page.'
  },
  zh: {
    allPhotos: '✨ 全部相片',
    selected: (n) => `已選擇 ${n} 張`,
    downloadSelected: (n) => (n > 1 ? `下載 ${n} 張相片 (ZIP)` : n === 1 ? '下載 1 張相片' : '下載所選相片'),
    download: '下載',
    preparing: '正在準備受保護的檔案…',
    progress: (done, total) => `正在準備第 ${Math.min(done + 1, total)} 張，共 ${total} 張`,
    packaging: '正在壓縮 ZIP 檔案…',
    loading: '正在載入相片庫...',
    loadFail: '載入相片失敗，請重新整理後再試。',
    empty: '此資料夾暫無相片。',
    untitled: '無標題',
    gallery: '相片庫',
    photo: '相片',
    unavailable: '無法顯示',
    downloadPhoto: '下載此相片',
    consentCount: (n) => `你即將下載 ${n} 張相片。`,
    done: (n) => `已下載 ${n} 張相片。`,
    failed: (m) => `下載失敗：${m}`,
    zipMissing: '無法載入壓縮元件，請重新整理頁面。'
  }
};
const t = () => T[currentLang];

let allImages = [];
let allFolders = [];
let activeFolderId = 'all';
let galleryLoaded = false;
const selectedImageIds = new Set();

const escapeHtml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';

document.getElementById('google-signin-btn').addEventListener('click', () => AuroraAuth.signIn());

AuroraAuth.onChange((user) => {
  if (user) {
    authContainer.style.display = 'none';
    galleryContent.style.display = 'block';
    if (!galleryLoaded) initGallery();
  } else {
    galleryContent.style.display = 'none';
    authContainer.style.display = 'block';
    galleryLoaded = false;
    allImages = [];
    allFolders = [];
    selectedImageIds.clear();
    pendingDownload = null;
    lightboxImage = null;
    closeConsent();
    lightbox.classList.remove('active');
    revokeImageObjectUrls();
    hideProgress();
    hideStatus();
    updateToolbar();
  }
});

function showMessage(key, isError) {
  lastMessage = { key, isError };
  const text = t()[key];
  gridEl.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:${isError ? '#ff6b6b' : 'rgba(223,246,242,0.5)'}; padding:40px;">${escapeHtml(text)}</p>`;
}

function showStatus(kind, text) {
  lastStatus = { kind, text };
  statusBanner.className = `status-banner active ${kind}`;
  statusBanner.textContent = text;
}

function hideStatus() {
  lastStatus = null;
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '';
}

function showProgress(label, ratio) {
  progressPanel.classList.add('active');
  progressLabel.textContent = label;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  progressPercent.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
}

function hideProgress() {
  progressPanel.classList.remove('active');
  progressFill.style.width = '0';
}

const imageObjectUrls = new Set();
let lightboxObjectUrl = null;
let lightboxFetchSequence = 0;

function revokeImageObjectUrls() {
  for (const url of imageObjectUrls) URL.revokeObjectURL(url);
  imageObjectUrls.clear();
  if (lightboxObjectUrl) URL.revokeObjectURL(lightboxObjectUrl);
  lightboxObjectUrl = null;
  lightboxImg.removeAttribute('src');
}

async function fetchProtectedImage(imageId, variant) {
  const token = await AuroraAuth.getIdToken();
  const response = await fetch(`${API_BASE}/api/photo-image?imageId=${encodeURIComponent(imageId)}&variant=${encodeURIComponent(variant)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not load photo (${response.status})`);
  }
  return response.blob();
}

async function loadThumbnail(imageEl) {
  if (imageEl.dataset.loading === 'true' || imageEl.dataset.loaded === 'true') return;
  imageEl.dataset.loading = 'true';
  try {
    const imageId = imageEl.dataset.photoImage;
    let blob = await readCachedThumb(imageId);
    if (!blob) {
      blob = await fetchProtectedImage(imageId, 'thumb');
      storeCachedThumb(imageId, blob);
    }
    const objectUrl = URL.createObjectURL(blob);
    if (!imageEl.isConnected) { URL.revokeObjectURL(objectUrl); return; }
    imageObjectUrls.add(objectUrl);
    imageEl.src = objectUrl;
    imageEl.dataset.loaded = 'true';
  } catch {
    imageEl.alt = `${imageEl.alt} (${t().unavailable})`;
  } finally {
    imageEl.dataset.loading = 'false';
  }
}

const thumbnailObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        thumbnailObserver.unobserve(entry.target);
        loadThumbnail(entry.target);
      }
    }), { rootMargin: '400px' })
  : null;

function observeThumbnails() {
  gridEl.querySelectorAll('img[data-photo-image]').forEach(imageEl => {
    if (thumbnailObserver) thumbnailObserver.observe(imageEl);
    else loadThumbnail(imageEl);
  });
}

async function initGallery() {
  galleryLoaded = true;
  const user = AuroraAuth.getUser();
  const cached = user ? readPhotoCache(user.uid) : null;
  if (cached) {
    allImages = cached.images;
    allFolders = cached.folders;
    renderFilters();
    renderGallery();
  } else {
    showMessage('loading', false);
  }
  try {
    const fresh = await preloadPhotos(user);
    if (!fresh) throw new Error('Could not load photos');
    const changed = !cached || JSON.stringify(cached.images) !== JSON.stringify(fresh.images)
      || JSON.stringify(cached.folders) !== JSON.stringify(fresh.folders);
    allImages = fresh.images;
    allFolders = fresh.folders;
    if (changed) {
      renderFilters();
      renderGallery();
    }
  } catch (err) {
    console.error("Failed to load gallery:", err);
    if (!cached) {
      galleryLoaded = false;
      showMessage('loadFail', true);
    }
  }
}

function renderFilters() {
  let html = `<button class="filter-btn ${activeFolderId === 'all' ? 'active' : ''}" data-folder-id="all">${t().allPhotos}</button>`;
  allFolders.forEach(folder => {
    html += `<button class="filter-btn ${activeFolderId === folder.id ? 'active' : ''}" data-folder-id="${escapeHtml(folder.id)}">📁 ${escapeHtml(folder.name)}</button>`;
  });
  filtersEl.innerHTML = html;

  filtersEl.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFolderId = btn.getAttribute('data-folder-id');
      filtersEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGallery();
    });
  });
}

function visibleImages() {
  return activeFolderId === 'all'
    ? allImages
    : allImages.filter(img => img.folderId === activeFolderId);
}

function renderGallery() {
  revokeImageObjectUrls();
  const filtered = visibleImages();

  if (filtered.length === 0) {
    showMessage('empty', false);
    updateToolbar();
    return;
  }

  gridEl.innerHTML = filtered.map(img => {
    const label = escapeHtml(img.title || img.name || t().photo);
    const checked = selectedImageIds.has(img.id);
    return `
    <div class="photo-card ${checked ? 'selected' : ''}" data-img-id="${escapeHtml(img.id)}" tabindex="0" role="button" aria-label="${label}">
      <input type="checkbox" class="photo-select-checkbox" data-id="${escapeHtml(img.id)}" aria-label="${label}" ${checked ? 'checked' : ''}>
      <button type="button" class="card-download" data-download-id="${escapeHtml(img.id)}" aria-label="${escapeHtml(t().downloadPhoto)}" title="${escapeHtml(t().downloadPhoto)}">${DOWNLOAD_ICON}</button>
      <img data-photo-image="${escapeHtml(img.id)}" alt="${label}" loading="lazy" draggable="false">
      <div class="photo-overlay">
        <span class="photo-title">${escapeHtml(img.title || img.name || t().untitled)}</span>
        <span class="photo-folder">${escapeHtml(img.folderPath || t().gallery)}</span>
      </div>
    </div>`;
  }).join('');

  observeThumbnails();

  gridEl.querySelectorAll('.photo-select-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = cb.getAttribute('data-id');
      if (cb.checked) selectedImageIds.add(id); else selectedImageIds.delete(id);
      cb.closest('.photo-card').classList.toggle('selected', cb.checked);
      updateToolbar();
    });
  });

  gridEl.querySelectorAll('.card-download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = allImages.find(x => x.id === btn.getAttribute('data-download-id'));
      if (img) requestDownload([img]);
    });
  });

  gridEl.querySelectorAll('.photo-card').forEach(card => {
    const open = () => {
      const img = allImages.find(x => x.id === card.getAttribute('data-img-id'));
      if (img) openLightbox(img);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  updateToolbar();
}

function updateToolbar() {
  const count = selectedImageIds.size;
  countEl.textContent = t().selected(count);
  countEl.classList.toggle('has-selection', count > 0);
  downloadLabel.textContent = t().downloadSelected(count);
  downloadBtn.disabled = busy || count === 0;
  clearBtn.disabled = busy || count === 0;
  lightboxDownloadLabel.textContent = t().download;
  lightboxDownloadBtn.disabled = busy;

  const visible = visibleImages();
  const visibleSelected = visible.filter(img => selectedImageIds.has(img.id)).length;
  selectAllEl.disabled = busy || visible.length === 0;
  selectAllEl.checked = visible.length > 0 && visibleSelected === visible.length;
  selectAllEl.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
}

selectAllEl.addEventListener('change', () => {
  const visible = visibleImages();
  if (selectAllEl.checked) visible.forEach(img => selectedImageIds.add(img.id));
  else visible.forEach(img => selectedImageIds.delete(img.id));
  gridEl.querySelectorAll('.photo-card').forEach(card => {
    const checked = selectedImageIds.has(card.getAttribute('data-img-id'));
    card.classList.toggle('selected', checked);
    const cb = card.querySelector('.photo-select-checkbox');
    if (cb) cb.checked = checked;
  });
  updateToolbar();
});

clearBtn.addEventListener('click', () => {
  selectedImageIds.clear();
  gridEl.querySelectorAll('.photo-card').forEach(card => {
    card.classList.remove('selected');
    const cb = card.querySelector('.photo-select-checkbox');
    if (cb) cb.checked = false;
  });
  updateToolbar();
});

async function openLightbox(img) {
  const sequence = ++lightboxFetchSequence;
  lightboxImage = img;
  if (lightboxObjectUrl) URL.revokeObjectURL(lightboxObjectUrl);
  lightboxObjectUrl = null;
  lightboxImg.removeAttribute('src');
  lightboxTitle.textContent = img.title || img.name || '';
  lightbox.classList.add('active');
  updateToolbar();
  try {
    const blob = await fetchProtectedImage(img.id, 'view');
    if (sequence !== lightboxFetchSequence) return;
    lightboxObjectUrl = URL.createObjectURL(blob);
    lightboxImg.src = lightboxObjectUrl;
  } catch {
    if (sequence === lightboxFetchSequence) lightboxTitle.textContent = `${img.title || img.name || t().photo} — ${t().unavailable}`;
  }
}

const closeLightbox = () => {
  lightboxFetchSequence++;
  lightboxImage = null;
  lightbox.classList.remove('active');
  if (lightboxObjectUrl) URL.revokeObjectURL(lightboxObjectUrl);
  lightboxObjectUrl = null;
  lightboxImg.removeAttribute('src');
};
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
lightboxDownloadBtn.addEventListener('click', () => {
  if (lightboxImage) requestDownload([lightboxImage]);
});

// ---- Consent gate: no download starts until the audit notice is accepted ----
function openConsent() {
  consentCheckbox.checked = false;
  consentAccept.disabled = true;
  consentCount.textContent = t().consentCount(pendingDownload ? pendingDownload.length : 0);
  consentModal.classList.add('active');
  setTimeout(() => consentCheckbox.focus(), 50);
}

function closeConsent() {
  consentModal.classList.remove('active');
  consentCheckbox.checked = false;
  consentAccept.disabled = true;
}

function requestDownload(images) {
  if (busy || !Array.isArray(images) || images.length === 0) return;
  pendingDownload = images.slice();
  openConsent();
}

consentCheckbox.addEventListener('change', () => { consentAccept.disabled = !consentCheckbox.checked; });
consentCancel.addEventListener('click', () => { pendingDownload = null; closeConsent(); });
consentModal.addEventListener('click', (e) => {
  if (e.target === consentModal) { pendingDownload = null; closeConsent(); }
});
consentAccept.addEventListener('click', () => {
  if (!consentCheckbox.checked || !pendingDownload) return;
  const images = pendingDownload;
  pendingDownload = null;
  closeConsent();
  runDownload(images);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (consentModal.classList.contains('active')) { pendingDownload = null; closeConsent(); return; }
  closeLightbox();
});

downloadBtn.addEventListener('click', () => {
  if (selectedImageIds.size === 0) return;
  requestDownload(allImages.filter(img => selectedImageIds.has(img.id)));
});

function safeBaseName(name) {
  return String(name || 'photo')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80) || 'photo';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function fetchProtectedDownload(img, batchId) {
  const token = await AuroraAuth.getIdToken();
  const response = await fetch(`${API_BASE}/api/photo-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageId: img.id, batchId, consent: true, consentVersion: CONSENT_VERSION }),
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not download ${img.name || 'photo'} (${response.status})`);
  }
  return response.blob();
}

async function runDownload(images) {
  if (busy) return;
  busy = true;
  hideStatus();
  updateToolbar();
  showProgress(t().preparing, 0);

  const batchId = crypto.randomUUID();
  try {
    if (images.length > 1 && typeof JSZip === 'undefined') throw new Error(t().zipMissing);
    const zip = images.length > 1 ? new JSZip() : null;
    let singleBlob = null;

    for (let i = 0; i < images.length; i++) {
      showProgress(t().progress(i, images.length), i / images.length);
      const blob = await fetchProtectedDownload(images[i], batchId);
      if (zip) zip.file(`${String(i + 1).padStart(3, '0')}-${safeBaseName(images[i].name)}-aurora.jpg`, blob);
      else singleBlob = blob;
    }

    if (zip) {
      showProgress(t().packaging, 0.97);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveBlob(zipBlob, 'aurora-photos.zip');
    } else {
      saveBlob(singleBlob, `${safeBaseName(images[0].name)}-aurora.jpg`);
    }
    showProgress(t().packaging, 1);
    showStatus('success', t().done(images.length));
  } catch (err) {
    showStatus('error', t().failed(err.message));
  } finally {
    busy = false;
    setTimeout(hideProgress, 600);
    updateToolbar();
  }
}

// ---- Language (same mechanism as activities.html) ----
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('aurora_lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';

  document.querySelectorAll('.i18n').forEach(el => {
    const text = el.getAttribute(`data-${lang}`);
    if (text) el.innerHTML = text;
  });

  const langText = document.getElementById('lang-text');
  if (langText) langText.textContent = lang === 'en' ? '繁體中文' : 'English';

  if (pendingDownload) consentCount.textContent = t().consentCount(pendingDownload.length);
  updateToolbar();
  if (allImages.length) {
    renderFilters();
    renderGallery();
  } else {
    filtersEl.innerHTML = `<button class="filter-btn active" data-folder-id="all">${t().allPhotos}</button>`;
    if (lastMessage) showMessage(lastMessage.key, lastMessage.isError);
  }
  if (lastStatus && lastStatus.kind === 'success') hideStatus();
}

window.setLanguage = setLanguage;
setLanguage(currentLang);