import { FieldValue } from 'firebase-admin/firestore';
import { getServices } from './_lib/firebase.js';
import { guard, clientIp, hashIp } from './_lib/http.js';

const COOLDOWN_MS = 10 * 60 * 1000;

const remainingMs = (data) => {
  const last = data?.lastClickAt?.toMillis?.() ?? 0;
  return Math.max(0, last + COOLDOWN_MS - Date.now());
};

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight browser requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!guard(req, res, req.method)) {
    if (!res.writableEnded) {
      return res.status(403).json({ ok: false, error: 'Request blocked by security guard.' });
    }
    return;
  }

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

      tx.set(supporterRef, { clicks: FieldValue.increment(1), lastClickAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(counterRef, { count: FieldValue.increment(1) }, { merge: true });
      return { ok: true, remainingMs: COOLDOWN_MS };
    });

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('support error:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong.' });
  }
}