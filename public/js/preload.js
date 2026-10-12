import { collection, getDocs, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { API_BASE } from './api-config.js';

const NEWS_KEY = 'aurora_news_cache_v1';
const PHOTOS_KEY = 'aurora_photos_cache_v1:';
const THUMB_CACHE = 'aurora-photo-thumbs-v1';
const THUMB_PRELOAD_COUNT = 12;

const ts = value => (value?.toMillis ? value.toMillis() : (Number(value) || 0));

function storage(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- news ----

export function readNewsCache() {
  const store = storage('local');
  if (!store) return null;
  try {
    const parsed = JSON.parse(store.getItem(NEWS_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed.items.map(item => ({
      ...item,
      updatedAt: Timestamp.fromMillis(item.updatedAt || 0),
      publishedAt: item.publishedAt ? Timestamp.fromMillis(item.publishedAt) : null
    }));
  } catch {
    return null;
  }
}

export function writeNewsCache(articles) {
  const store = storage('local');
  if (!store || !Array.isArray(articles)) return;
  try {
    const items = articles.map(article => ({
      id: article.id,
      titleEn: article.titleEn ?? '',
      titleZh: article.titleZh ?? '',
      bodyEn: article.bodyEn ?? '',
      bodyZh: article.bodyZh ?? '',
      revision: Number(article.revision) || 1,
      updatedAt: ts(article.updatedAt),
      publishedAt: ts(article.publishedAt)
    }));
    store.setItem(NEWS_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {}
}

let newsPromise = null;
export function preloadNews() {
  if (!newsPromise) {
    newsPromise = getDocs(query(collection(db, 'news'), where('status', '==', 'published'), where('deleted', '==', false)))
      .then(snapshot => {
        const articles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        writeNewsCache(articles);
        return articles;
      })
      .catch(() => null);
  }
  return newsPromise;
}

// -------------------------------------------------------------- photos ----

export function readPhotoCache(uid) {
  const store = storage('session');
  if (!store || !uid) return null;
  try {
    const parsed = JSON.parse(store.getItem(PHOTOS_KEY + uid) || 'null');
    if (!parsed || !Array.isArray(parsed.images) || !Array.isArray(parsed.folders)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePhotoCache(uid, images, folders) {
  const store = storage('session');
  if (!store || !uid) return;
  try {
    store.setItem(PHOTOS_KEY + uid, JSON.stringify({ savedAt: Date.now(), images, folders }));
  } catch {}
}

export function thumbCacheKey(imageId) {
  return `${API_BASE}/api/photo-image?imageId=${encodeURIComponent(imageId)}&variant=thumb`;
}

export async function readCachedThumb(imageId) {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(THUMB_CACHE);
    const hit = await cache.match(thumbCacheKey(imageId));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function storeCachedThumb(imageId, blob) {
  if (!('caches' in window) || !blob) return;
  try {
    const cache = await caches.open(THUMB_CACHE);
    await cache.put(thumbCacheKey(imageId), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
  } catch {}
}

export async function clearPhotoCaches() {
  try {
    const store = storage('session');
    if (store) {
      for (const key of Object.keys(store)) if (key.startsWith(PHOTOS_KEY)) store.removeItem(key);
    }
    if ('caches' in window) await caches.delete(THUMB_CACHE);
  } catch {}
}

let photoPromiseFor = null;
let photoPromise = null;

export function preloadPhotos(user) {
  if (!user) return Promise.resolve(null);
  if (photoPromiseFor === user.uid && photoPromise) return photoPromise;
  photoPromiseFor = user.uid;
  photoPromise = (async () => {
    try {
      const token = await user.getIdToken();
      const [response, foldersSnap] = await Promise.all([
        fetch(`${API_BASE}/api/list-photos`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        }),
        getDocs(collection(db, 'galleryFolders'))
      ]);
      if (!response.ok) return null;
      const data = await response.json();
      const images = Array.isArray(data.images) ? data.images : [];
      const folders = foldersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      writePhotoCache(user.uid, images, folders);
      warmThumbnails(user, images.slice(0, THUMB_PRELOAD_COUNT));
      return { images, folders };
    } catch {
      return null;
    }
  })().then(result => {
    if (!result) photoPromise = null;
    return result;
  });
  return photoPromise;
}

async function warmThumbnails(user, images) {
  if (!('caches' in window)) return;
  const queue = images.slice();
  const worker = async () => {
    while (queue.length) {
      const image = queue.shift();
      try {
        if (await readCachedThumb(image.id)) continue;
        const token = await user.getIdToken();
        const response = await fetch(thumbCacheKey(image.id), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        });
        if (response.ok) await storeCachedThumb(image.id, await response.blob());
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ------------------------------------------------------------ resources ----

export function hintResources() {
  const add = (rel, href, extra = {}) => {
    if (document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    Object.entries(extra).forEach(([key, value]) => link.setAttribute(key, value));
    document.head.appendChild(link);
  };
  add('modulepreload', 'js/news-page.js');
  add('modulepreload', 'js/photos.js');
  add('preconnect', API_BASE, { crossorigin: '' });
}

export function runWhenIdle(task) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 2500 });
  else setTimeout(task, 400);
}