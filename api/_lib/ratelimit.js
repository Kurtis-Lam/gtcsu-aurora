import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

function rateKey(scope, identity) {
  const secret = process.env.ANALYTICS_HMAC_SECRET || process.env.IP_HASH_SECRET || 'aurora-rate-limit';
  return crypto.createHmac('sha256', secret).update(`${scope}:${identity}`).digest('hex').slice(0, 40);
}

// Fixed-window limiter backed by Firestore (shared across serverless instances).
// Returns { allowed, retryAfterSeconds }.
export async function takeRateLimit(db, scope, identity, { limit, windowMs }) {
  const ref = db.collection('apiRateLimits').doc(`${scope}_${rateKey(scope, identity)}`);
  return db.runTransaction(async (transaction) => {
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
      expiresAt: Timestamp.fromMillis(windowStart + windowMs + 24 * 60 * 60 * 1000)
    });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function enforceRateLimit(db, res, scope, identity, options) {
  const result = await takeRateLimit(db, scope, identity, options);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({ error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' });
  return false;
}