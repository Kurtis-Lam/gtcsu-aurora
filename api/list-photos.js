import { verifyRequestAppCheck } from './_lib/app-check.js';
import { guard, bearerToken } from './_lib/http.js';
import { authenticateGalleryUser } from './_lib/auth.js';
import { getServices, withTimeout } from './_lib/firebase.js';
import { GALLERY_ID_PATTERN, IMAGE_DOC_ID_PATTERN } from './_lib/photos.js';
import { RATE_LIMITS, takeRateLimit } from './_lib/ratelimit.js';

const LIST_CACHE_MS = 5 * 60 * 1000;
let listCache = null;

function safeString(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function isQuotaError(error) {
  return error?.code === 8
    || error?.code === 'resource-exhausted'
    || /RESOURCE_EXHAUSTED/.test(String(error?.message || ''));
}

async function loadImages(db) {
  const now = Date.now();
  if (listCache && now - listCache.at < LIST_CACHE_MS) return listCache.images;
  try {
    const snapshot = await withTimeout(db.collection('galleryImages').get(), 10000, 'gallery listing');
    const images = snapshot.docs.flatMap((document) => {
      const data = document.data() || {};
      if (!IMAGE_DOC_ID_PATTERN.test(document.id) || typeof data.publicId !== 'string' || !GALLERY_ID_PATTERN.test(data.publicId)) return [];
      return [{
        id: document.id,
        name: safeString(data.name, 200, 'photo'),
        title: safeString(data.title, 200, 'Untitled'),
        folderId: safeString(data.folderId, 128) || null,
        folderPath: safeString(data.folderPath, 300, 'Uncategorized')
      }];
    });
    listCache = { at: now, images };
    return images;
  } catch (error) {
    if (listCache) {
      console.error('list-photos serving stale cache:', error?.code || '', error?.message || error);
      return listCache.images;
    }
    throw error;
  }
}

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;
  if (!(await verifyRequestAppCheck(req, res))) return;

  try {
    const session = await authenticateGalleryUser(bearerToken(req));
    if (!session) return res.status(403).json({ error: 'A verified school account is required.' });

    const { db } = getServices();
    const quota = await takeRateLimit(db, RATE_LIMITS.photoList, String(session.decoded.uid));
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many gallery requests. Try again shortly.' });
    }

    const images = await loadImages(db);

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).json({ images });
  } catch (err) {
    console.error('list-photos error:', err?.code || '', err?.stack || err);
    if (isQuotaError(err)) {
      res.setHeader('Retry-After', '3600');
      return res.status(503).json({ error: 'The gallery database is over its daily quota. Try again later.' });
    }
    if (err.code === 'FIRESTORE_TIMEOUT') return res.status(503).json({ error: 'The gallery database is temporarily unavailable.' });
    return res.status(500).json({ error: 'Could not retrieve gallery photos.' });
  }
}