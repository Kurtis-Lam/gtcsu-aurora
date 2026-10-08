import { getServices } from './_lib/firebase.js';
import { bearerToken, body, guard } from './_lib/http.js';
import { verifySchoolUser } from './_lib/auth.js';
import crypto from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;

function validToken(id, token) {
  const secret = process.env.ANALYTICS_HMAC_SECRET;
  if (!secret || !ID_RE.test(id) || !TOKEN_RE.test(token)) return false;
  const expected = crypto.createHmac('sha256', secret).update(id).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
}

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  try {
    const user = await verifySchoolUser(bearerToken(req));
    if (!user) return res.status(403).json({ error: 'School account required.' });

    const { pageviewId, sessionToken } = body(req);
    if (!validToken(pageviewId, sessionToken)) return res.status(403).json({ error: 'Invalid analytics session.' });

    const { db } = getServices();
    const ref = db.collection('pageviews').doc(pageviewId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Analytics session not found.' });

    await ref.update({
      userEmail: user.email || '',
      userName: user.name || user.email || ''
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('pageview identity error:', error);
    return res.status(500).json({ error: 'Analytics unavailable.' });
  }
}
