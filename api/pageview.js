import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getServices, withTimeout } from './_lib/firebase.js';
import { bearerToken, body, clientIp, guard, hashIp } from './_lib/http.js';
import { verifySchoolUser, verifiedAdmin } from './_lib/auth.js';
import { RATE_LIMITS, takeRateLimit } from './_lib/ratelimit.js';

const VALID_ROUTES = new Set([
  '/', '/aboutus', '/news', '/activities', '/financial', '/schedule',
  '/welfare', '/photos', '/feedbacks', '/disclaimer', '/admin'
]);
const ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const MAX_DURATION = 86400;

function analyticsSecret() {
  const analyticsKey = process.env.ANALYTICS_HMAC_SECRET;
  if (analyticsKey && Buffer.byteLength(analyticsKey, 'utf8') >= 32) return analyticsKey;

  const ipHashKey = process.env.IP_HASH_SECRET;
  if (ipHashKey && Buffer.byteLength(ipHashKey, 'utf8') >= 32) {
    return crypto.createHmac('sha256', ipHashKey)
      .update('gtcsu-aurora:pageview-session-signing:v1')
      .digest();
  }

  throw new Error('ANALYTICS_HMAC_SECRET or IP_HASH_SECRET must contain at least 32 bytes');
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

function isQuotaError(error) {
  return error?.code === 8
    || error?.code === 'resource-exhausted'
    || /RESOURCE_EXHAUSTED/.test(String(error?.message || ''));
}

function isNotFound(error) {
  return error?.code === 5 || error?.code === 'not-found';
}

function hktDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(date);
}

// action "identity": attaches the signed-in account to an existing pageview.
// Only verified Google accounts on the school domain can attach their identity
// to an analytics session; administrators use the same school-domain policy.
// Merged in from the former api/pageview-identity.js to stay under the
// Hobby plan's 12-function limit.
async function attachIdentity(req, res, payload) {
  const token = bearerToken(req) || (typeof payload.idToken === 'string' ? payload.idToken : null);
  const user = (await verifySchoolUser(token)) || (await verifiedAdmin(token));
  if (!user) return res.status(403).json({ error: 'Signed-in account required.' });

  const { pageviewId, sessionToken } = payload;
  if (!validToken(String(pageviewId || ''), String(sessionToken || ''))) {
    return res.status(403).json({ error: 'Invalid analytics session.' });
  }

  const { db } = getServices();
  const quota = await takeRateLimit(db, RATE_LIMITS.pageviewWrite, pageviewId);
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many analytics updates.' });
  }
  const ref = db.collection('pageviews').doc(pageviewId);
  try {
    await withTimeout(ref.update({
      userEmail: user.email || '',
      userName: user.name || user.email || ''
    }), 8000, 'pageview identity update');
  } catch (error) {
    if (isNotFound(error)) return res.status(404).json({ error: 'Analytics session not found.' });
    throw error;
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const payload = body(req);
    const action = payload.action;
    if (action === 'identity') return await attachIdentity(req, res, payload);
    const pageviewId = payload.pageviewId;
    const path = normalisePath(payload.path);

    if (!['open', 'update', 'exit'].includes(action) || !ID_RE.test(String(pageviewId || '')) || !path) {
      return res.status(400).json({ error: 'Invalid analytics request.' });
    }

    // Resolve the signing key before writing anything. Otherwise a missing
    // key can leave a pageview document that the browser cannot update.
    const sessionToken = action === 'open' ? signId(pageviewId) : null;
    const { db } = getServices();
    const ref = db.collection('pageviews').doc(pageviewId);

    if (action === 'open') {
      const quota = await takeRateLimit(db, RATE_LIMITS.pageviewOpen, hashIp(clientIp(req)));
      if (!quota.allowed) {
        res.setHeader('Retry-After', String(quota.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many analytics sessions. Try again later.' });
      }
      try {
        await withTimeout(ref.create({
          path,
          durationSeconds: 0,
          dateStr: hktDateString(),
          timestamp: FieldValue.serverTimestamp(),
          openedAt: FieldValue.serverTimestamp(),
          lastActiveAt: FieldValue.serverTimestamp()
        }), 8000, 'pageview create');
      } catch (error) {
        if (error.code === 6 || error.code === 'already-exists') {
          return res.status(409).json({ error: 'Analytics session already exists.' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true, token: sessionToken });
    }

    if (!validToken(pageviewId, payload.token)) {
      return res.status(403).json({ error: 'Invalid analytics session.' });
    }

    const quota = await takeRateLimit(db, RATE_LIMITS.pageviewWrite, pageviewId);
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many analytics updates.' });
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

    try {
      await withTimeout(ref.update(update), 8000, 'pageview update');
    } catch (error) {
      if (isNotFound(error)) return res.status(404).json({ error: 'Analytics session not found.' });
      throw error;
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('pageview error:', error?.code || '', error?.stack || error);
    if (isQuotaError(error)) {
      res.setHeader('Retry-After', '3600');
      return res.status(503).json({ error: 'Analytics unavailable.' });
    }
    if (error.code === 'FIRESTORE_TIMEOUT') return res.status(503).json({ error: 'Analytics unavailable.' });
    return res.status(500).json({ error: 'Analytics unavailable.' });
  }
}