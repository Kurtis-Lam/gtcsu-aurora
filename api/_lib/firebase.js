// Lazily-initialised Firebase Admin SDK (used for privileged writes that the
// browser must never be able to do itself: feedback, support votes, rate limits).
//
// Env: FIREBASE_SERVICE_ACCOUNT = the service-account JSON (raw or base64).
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';

let services = null;

export function getServices() {
  if (services) return services;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const account = JSON.parse(json);

  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  services = {
    // preferRest: use HTTP/1.1 instead of gRPC. gRPC channels go stale when a
    // serverless instance is frozen and thawed, and the next Firestore call then
    // hangs until Vercel kills the function ("Task timed out after 30 seconds").
    db: initializeFirestore(app, { preferRest: true }),
    auth: getAuth(app),
    appCheck: getAppCheck(app),
    projectId: account.project_id
  };
  return services;
}

// Rejects with code FIRESTORE_TIMEOUT if a Firestore/Google call does not settle in
// time. Firestore retries throttled or over-quota requests for up to a minute,
// longer than a Vercel function may run, so callers fail fast and log the cause.
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms (Firestore may be throttled or over its daily quota)`);
      error.code = 'FIRESTORE_TIMEOUT';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}