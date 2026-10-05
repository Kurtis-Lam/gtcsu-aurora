import crypto from 'node:crypto';
import { getServices } from './_lib/firebase.js';
import { body, guard } from './_lib/http.js';

function getToken(req) {
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string') return queryToken;
  const urlToken = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (urlToken) return urlToken;
  return typeof body(req).token === 'string' ? body(req).token : '';
}

function verifyToken(token) {
  const [payload, signature, extra] = token.split('.');
  const secret = process.env.NEWS_UNSUBSCRIBE_SECRET;
  if (!payload || !signature || extra || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const uid = Buffer.from(payload, 'base64url').toString();
    return uid && /^[A-Za-z0-9:_-]{1,128}$/.test(uid) ? uid : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!guard(req, res, ['GET', 'POST'])) return;
  const uid = verifyToken(getToken(req));
  if (!uid) return res.status(400).send('This unsubscribe link is invalid. Please contact Aurora for help.');

  if (req.method === 'GET') {
    const action = `https://gtcsu-aurora.vercel.app/api/unsubscribe-news?token=${encodeURIComponent(getToken(req))}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aurora news preferences</title><body style="margin:0;background:#050b12;color:#dff6f2;font:16px Arial,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;margin:24px;padding:32px;background:#0a1a20;border:1px solid #28505a;border-radius:16px"><h1 style="color:#7fe9f0">Email preferences</h1><p>Confirm that you want to stop receiving Aurora announcement emails. You can still read all news on the <a style="color:#7fe9f0" href="https://gtcsu-aurora.web.app/news.html">Aurora website</a>.</p><form method="post" action="${action}"><button style="padding:11px 18px;border:0;border-radius:999px;background:#2fe6b8;color:#04121c;font-weight:bold;cursor:pointer">Unsubscribe</button></form></main></body></html>`);
  }

  try {
    const { db } = getServices();
    const subscriptionRef = db.collection('newsSubscriptions').doc(uid);
    const subscription = await subscriptionRef.get();
    if (subscription.exists && subscription.data().subscribed === true) {
      await subscriptionRef.update({
        subscribed: false,
        unsubscribedAt: new Date()
      });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aurora news preferences</title><body style="margin:0;background:#050b12;color:#dff6f2;font:16px Arial,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;margin:24px;padding:32px;background:#0a1a20;border:1px solid #28505a;border-radius:16px"><h1 style="color:#2fe6b8">You are unsubscribed</h1><p>You will no longer receive Aurora announcement emails. You can still read all news on the <a style="color:#7fe9f0" href="https://gtcsu-aurora.web.app/news.html">Aurora website</a>.</p></main></body></html>`);
  } catch (error) {
    console.error('Could not unsubscribe from news emails:', error);
    return res.status(500).send('Could not update your email preferences. Please try again later.');
  }
}
