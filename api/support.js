// GET  /api/support?device=<id> -> { ok, remainingMs }   (cooldown left for this visitor)
// POST /api/support?device=<id> -> records one support vote
//
// The 10-minute cooldown is enforced per DEVICE (a random id the browser
// generates and keeps, sent as ?device=...) and, when the visitor is signed in
// (Authorization: Bearer <Firebase ID token>), per ACCOUNT as well.
//
//  - Anonymous visitor  -> only the device cooldown applies.
//  - Signed-in visitor  -> BOTH must be clear. Signing in does not dodge a
//                          device cooldown, and using another device does not
//                          dodge an account cooldown.
//
// Because the cooldown no longer depends on IP, people sharing one Wi-Fi
// network no longer block each other. The device id is only ever stored as a
// keyed hash. A signed-in vote also stores the account's email so admins can
// see who supported.
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getServices } from './_lib/firebase.js';
import { guard, hashIp, clientIp } from './_lib/http.js';

const COOLDOWN_MS = 10 * 60 * 1000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const IP_COOLDOWN_KEY_PREFIX = 'ip_';

const remainingMs = (data) => {
  const last = data?.lastClickAt?.toMillis?.() ?? 0;
  return Math.max(0, last + COOLDOWN_MS - Date.now());
};

function getDeviceId(req) {
  const raw =
    req.query?.device ??
    new URL(req.url, 'http://localhost').searchParams.get('device');
  return typeof raw === 'string' && DEVICE_ID_RE.test(raw) ? raw : null;
}

// Returns { user } (user is null for anonymous visitors) or { error } if a
// token was sent but is invalid/expired.
async function getUser(req) {
  const header = req.headers.authorization;
  if (!header) return { user: null };
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) return { error: true };
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    return { user: { uid: decoded.uid, email: decoded.email ?? null } };
  } catch {
    return { error: true };
  }
}

export default async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;

  res.setHeader('Content-Type', 'application/json');

  try {
    const { db } = getServices(); // also initialises firebase-admin for getAuth()

    const deviceId = getDeviceId(req);
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid device id.' });
    }

    const { user, error } = await getUser(req);
    if (error) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired sign-in.' });
    }

    const deviceRef = db.collection('supporters').doc(`device_${hashIp(`device:${deviceId}`)}`);
    const accountRef = user ? db.collection('supporters').doc(`user_${user.uid}`) : null;
    const ipRef = db.collection('supporterIpCooldowns').doc(`${IP_COOLDOWN_KEY_PREFIX}${hashIp(clientIp(req))}`);

    if (req.method === 'GET') {
      const [deviceSnap, accountSnap, ipSnap] = await Promise.all([
        deviceRef.get(),
        accountRef ? accountRef.get() : null,
        ipRef.get(),
      ]);
      const remaining = Math.max(
        remainingMs(deviceSnap.data()),
        accountSnap ? remainingMs(accountSnap.data()) : 0,
        remainingMs(ipSnap.data())
      );
      return res.status(200).json({ ok: true, remainingMs: remaining });
    }

    const counterRef = db.collection('counters').doc('supportCounter');

    const result = await db.runTransaction(async (tx) => {
      // All reads must come before any writes in a transaction.
      const deviceSnap = await tx.get(deviceRef);
      const accountSnap = accountRef ? await tx.get(accountRef) : null;
      const ipSnap = await tx.get(ipRef);

      const remaining = Math.max(
        remainingMs(deviceSnap.data()),
        accountSnap ? remainingMs(accountSnap.data()) : 0,
        remainingMs(ipSnap.data())
      );
      if (remaining > 0) return { ok: false, remainingMs: remaining };

      // The device doc's `clicks` is what adds up to the public total; the
      // account doc is a per-account cooldown + display record (the admin page
      // ignores its clicks when adjusting the counter on delete).
      tx.set(
        deviceRef,
        {
          type: 'device',
          clicks: FieldValue.increment(1),
          lastClickAt: FieldValue.serverTimestamp(),
          ...(user ? { lastUid: user.uid, lastEmail: user.email } : {}),
        },
        { merge: true }
      );

      if (accountRef) {
        tx.set(
          accountRef,
          {
            type: 'account',
            uid: user.uid,
            email: user.email,
            clicks: FieldValue.increment(1),
            lastClickAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      tx.set(
        ipRef,
        {
          type: 'ip-cooldown',
          lastClickAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(counterRef, { count: FieldValue.increment(1) }, { merge: true });
      return { ok: true, remainingMs: COOLDOWN_MS };
    });

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('support error:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong.' });
  }
}