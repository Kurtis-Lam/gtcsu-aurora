export const NEWS_READ_EVENT = 'aurora:newsreadchange';

const PREFIX = 'aurora_news_reads_v1:';
const MAX_ENTRIES = 300;

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getLocalReads(uid) {
  const reads = new Map();
  const storage = store();
  if (!storage || !uid) return reads;
  try {
    const parsed = JSON.parse(storage.getItem(PREFIX + uid) || '{}');
    for (const [newsId, revision] of Object.entries(parsed)) {
      const value = Number(revision);
      if (newsId && Number.isFinite(value) && value > 0) reads.set(newsId, value);
    }
  } catch {}
  return reads;
}

export function rememberLocalRead(uid, newsId, revision) {
  const storage = store();
  if (!uid || !newsId) return;
  if (storage) {
    try {
      const current = Object.fromEntries(getLocalReads(uid));
      delete current[newsId];
      current[newsId] = Math.max(Number(revision) || 1, 1);
      const keys = Object.keys(current);
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete current[key];
      storage.setItem(PREFIX + uid, JSON.stringify(current));
    } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent(NEWS_READ_EVENT, { detail: { uid, newsId } }));
  } catch {}
}

export function readRevision(serverReads, localReads, newsId) {
  return Math.max(Number(serverReads?.get(newsId)) || 0, Number(localReads?.get(newsId)) || 0);
}
