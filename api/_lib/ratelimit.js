import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_LIMITS = {
  photoDownload: { scope: 'photo-download', limit: 10, windowMs: HOUR_MS },
  feedback: { scope: 'feedback', limit: 3, windowMs: DAY_MS }
};

function rateKey(scope, identity) {
  const secret = process.env.ANALYTICS_HMAC_SECRET || process.env.IP_HASH_SECRET || 'aurora-rate-limit';
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

export async function takeRateLimit(db, { scope, limit, windowMs }, identity) {
  const ref = db.collection('apiRateLimits').doc(`${scope}_${rateKey(scope, identity)}`);
  const result = await db.runTransaction(async (transaction) => {
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
  });
  await purgeExpiredWindows(db);
  return result;
}