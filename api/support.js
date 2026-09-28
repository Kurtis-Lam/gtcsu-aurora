// GET  /api/support -> { ok, remainingMs }   (cooldown left for this visitor)
// POST /api/support -> records one anonymous support vote
//
// No sign-in needed. Visitors are rate limited by a keyed hash of their IP
// (the raw IP is never stored). Note: people on the same network (e.g. school
// Wi-Fi) share one IP and therefore share one 10-minute cooldown.
import { FieldValue } from 'firebase-admin/firestore';
import { getServices } from './_lib/firebase.js';
import { guard, clientIp, hashIp } from './_lib/http.js';

const COOLDOWN_MS = 10 * 60 * 1000;

const remainingMs = (data) => {
  const last = data?.lastClickAt?.toMillis?.() ?? 0;
  return Math.max(0, last + COOLDOWN_MS - Date.now());
};

export default async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;

  res.setHeader('Content-Type', 'application/json');

  try {
    const { db } = getServices();
    const supporterRef = db.collection('supporters').doc(`ip_${hashIp(clientIp(req))}`);

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