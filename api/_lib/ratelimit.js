import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { withTimeout } from './firebase.js';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_LIMITS = {
  photoDownload: { scope: 'photo-download', limit: 10, windowMs: HOUR_MS },
  feedback: { scope: 'feedback', limit: 3, windowMs: DAY_MS },
  pageviewOpen: { scope: 'pageview-open', limit: 1200, windowMs: 10 * MINUTE_MS, memory: true },
  pageviewWrite: { scope: 'pageview-write', limit: 40, windowMs: MINUTE_MS, memory: true },
  photoImage: { scope: 'photo-image', limit: 120, windowMs: MINUTE_MS, memory: true },
  photoList: { scope: 'photo-list', limit: 60, windowMs: MINUTE_MS, memory: true },
  signUpload: { scope: 'sign-upload', limit: 60, windowMs: MINUTE_MS },
  deletePhoto: { scope: 'delete-photo', limit: 10, windowMs: MINUTE_MS },
  listAdmins: { scope: 'list-admins', limit: 10, windowMs: MINUTE_MS },
  translateNews: { scope: 'translate-news', limit: 10, windowMs: MINUTE_MS },
  publishNews: { scope: 'publish-news', limit: 5, windowMs: HOUR_MS },
  supportRead: { scope: 'support-read', limit: 300, windowMs: MINUTE_MS, memory: true },
  supportVote: { scope: 'support-vote', limit: 60, windowMs: MINUTE_MS }
};

// High-volume, low-risk limits (analytics pings, thumbnails, listings) are
// counted in memory per serverless instance instead of in Firestore. Each
// Firestore-backed check costs a transaction plus a write, which exhausted the
// free daily write quota and made every API call hang until it timed out.
const memoryWindows = new Map();

function takeMemoryRateLimit({ scope, limit, windowMs }, identity) {
  const now = Date.now();
  if (memoryWindows.size > 5000) {
    for (const [key, entry] of memoryWindows) if (entry.resetAt <= now) memoryWindows.delete(key);
    if (memoryWindows.size > 5000) memoryWindows.clear();
  }
  const key = `${scope}:${identity}`;
  let entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryWindows.set(key, entry);
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function rateKey(scope, identity) {
  const secret = [process.env.ANALYTICS_HMAC_SECRET, process.env.IP_HASH_SECRET]
    .find((value) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32);
  if (!secret) throw new Error('A rate-limit HMAC secret of at least 32 bytes is required');
  if (typeof identity !== 'string' || identity.length < 1 || identity.length > 256) {
    throw new Error('Invalid rate-limit identity');
  }
  return crypto.createHmac('sha256', secret).update(`${scope}:${identity}`).digest('hex').slice(0, 40);
}

async function purgeExpiredWindows(db) {
  if (Math.random() >= 0.05) return;
  try {
    const snapshot = await db.collection('apiRateLimits')
      .where('expiresAt', '<', Timestamp.now())
      .limit(100)
      .get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  } catch (err) {
    console.error('rate limit cleanup failed:', err.message);
  }
}

export async function takeRateLimit(db, config, identity) {
  if (config.memory) return takeMemoryRateLimit(config, String(identity));
  const { scope, limit, windowMs } = config;
  const ref = db.collection('apiRateLimits').doc(`${scope}_${rateKey(scope, identity)}`);
  // Few attempts and a hard deadline: Firestore otherwise retries throttled or
  // over-quota transactions with long back-offs, hanging the whole request.
  const result = await withTimeout(db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.exists ? snapshot.data() : {};
    let windowStart = Number(data.windowStart) || now;
    let count = Number(data.count) || 0;
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
    }
    transaction.set(ref, {
      scope,
      windowStart,
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(windowStart + windowMs + DAY_MS)
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }, { maxAttempts: 2 }), 8000, 'rate-limit check');
  await purgeExpiredWindows(db);
  return result;
}