// GET  /api/support -> { ok, remainingMs }   (cooldown left for this account)
// POST /api/support -> records one support vote for this account
//
// Identity = the signed-in @gtcollege.edu.hk Google account (verified server-side
// from the Firebase ID token). Nothing is keyed on IP any more, so a whole school
// sharing one network no longer shares one vote.
import { FieldValue } from 'firebase-admin/firestore';
import { getServices } from './_lib/firebase.js';
import { guard, bearerToken, hashIp } from './_lib/http.js';
import { verifySchoolUser } from './_lib/auth.js';

const COOLDOWN_MS = 10 * 60 * 1000;

const remainingMs = (data) => {
  const last = data?.lastClickAt?.toMillis?.() ?? 0;
  return Math.max(0, last + COOLDOWN_MS - Date.now());
};

export default async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;

  res.setHeader('Content-Type', 'application/json');

  try {
    const user = await verifySchoolUser(bearerToken(req));
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'Sign in with your school account to support.',
        code: 'AUTH_REQUIRED'
      });
    }

    const { db } = getServices();
    // Keyed hash of the account id: admins see a stable pseudonym, not an email.
    const supporterRef = db.collection('supporters').doc(`acct_${hashIp(user.uid)}`);

    if (req.method === 'GET') {
      const snap = await supporterRef.get();
      return res.status(200).json({ ok: true, remainingMs: remainingMs(snap.data()) });
    }

    const counterRef = db.collection('counters').doc('supportCounter');

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(supporterRef);
      const remaining = remainingMs(snap.data());
      if (remaining > 0) return { ok: false, remainingMs: remaining };

      tx.set(
        supporterRef,
        { clicks: FieldValue.increment(1), lastClickAt: FieldValue.serverTimestamp() },
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