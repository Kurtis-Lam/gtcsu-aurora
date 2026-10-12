import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { loadVercelEnv, LOCAL_ENV_FLAG } from './_vercel-env.js';

const args = process.argv.slice(2).filter((value) => value !== LOCAL_ENV_FLAG);
const revoke = args[0] === '--revoke';
const email = (revoke ? args[1] : args[0])?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  process.stderr.write(
    'Usage: node scripts/set-admin-claims.js <approved-email> [--local-env]\n' +
    '       node scripts/set-admin-claims.js --revoke <approved-email> [--local-env]\n' +
    'Fetches FIREBASE_SERVICE_ACCOUNT from Vercel using VERCEL_TOKEN. Use --local-env to read it from the local environment.\n'
  );
  process.exit(2);
}

try {
  await loadVercelEnv(['FIREBASE_SERVICE_ACCOUNT']);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const account = JSON.parse(json);
  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  const auth = getAuth(app);
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (revoke) delete claims.admin;
  else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  process.stdout.write(`${revoke ? 'Revoked' : 'Granted'} admin claim for ${email}. The user must sign out, sign in again, and refresh the ID token.\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}