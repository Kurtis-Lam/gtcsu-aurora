// Lazily-initialised Firebase Admin SDK (used for privileged writes that the
// browser must never be able to do itself: feedback, support votes, rate limits).
//
// Env: FIREBASE_SERVICE_ACCOUNT = the service-account JSON (raw or base64).
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let services = null;

export function getServices() {
  if (services) return services;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const account = JSON.parse(json);

  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  services = {
    db: getFirestore(app),
    auth: getAuth(app),
    projectId: account.project_id
  };
  return services;
}