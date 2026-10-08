import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getServices } from './_lib/firebase.js';
import { body, clientIp, guard, hashIp } from './_lib/http.js';

const VALID_ROUTES = new Set([
  '/', '/aboutus', '/news', '/activities', '/financial', '/schedule',
  '/welfare', '/photos', '/feedbacks', '/admin'
]);
const ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const MAX_DURATION = 86400;
const RATE_LIMIT_MAX = 240;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function analyticsSecret() {
  const secret = process.env.ANALYTICS_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error('ANALYTICS_HMAC_SECRET is not configured securely');
  return secret;
}

function signId(id) {
  return crypto.createHmac('sha256', analyticsSecret()).update(id).digest('hex');
}

function validToken(id, token) {
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(signId(id), 'hex'), Buffer.from(token, 'hex'));
}

function normalisePath(value) {
  if (typeof value !== 'string') return null;
  let path = value.toLowerCase().replace(/\.html$/, '');
  if (path === '/index' || path === '') path = '/';
  if (path === '/supportus' || path === '/feedback') path = '/feedbacks';
  return VALID_ROUTES.has(path) ? path : null;
}

function hktDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(date);
}

async function takeRateLimitSlot(db, ip) {
  const ref = db.collection('analyticsRateLimits').doc(hashIp(`analytics:${ip}`));
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const now = Date.now();
    let windowStart = Number(data.windowStart) || now;
    let count = Number(data.count) || 0;
    if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    if (count >= RATE_LIMIT_MAX) return false;
    tx.set(ref, { windowStart, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const payload = body(req);
    const action = payload.action;
    const pageviewId = payload.pageviewId;
    const path = normalisePath(payload.path);

    if (!['open', 'update', 'exit'].includes(action) || !ID_RE.test(String(pageviewId || '')) || !path) {
      return res.status(400).json({ error: 'Invalid analytics request.' });
    }

    const { db } = getServices();
    if (!(await takeRateLimitSlot(db, clientIp(req)))) {
      return res.status(429).json({ error: 'Too many analytics requests.' });
    }

    const ref = db.collection('pageviews').doc(pageviewId);

    if (action === 'open') {
      await ref.set({
        path,
        durationSeconds: 0,
        dateStr: hktDateString(),
        timestamp: FieldValue.serverTimestamp(),
        openedAt: FieldValue.serverTimestamp(),
        lastActiveAt: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ ok: true, token: signId(pageviewId) });
    }

    if (!validToken(pageviewId, payload.token)) {
      return res.status(403).json({ error: 'Invalid analytics session.' });
    }

    const duration = Number(payload.durationSeconds);
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION) {
      return res.status(400).json({ error: 'Invalid duration.' });
    }

    const update = {
      durationSeconds: Math.round(duration),
      lastActiveAt: FieldValue.serverTimestamp()
    };
    if (action === 'exit') update.closedAt = FieldValue.serverTimestamp();

    await ref.update(update);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('pageview error:', error);
    return res.status(500).json({ error: 'Analytics unavailable.' });
  }
}
