import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const revoke = args[0] === '--revoke';
const email = (revoke ? args[1] : args[0])?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  process.stderr.write('Usage: node scripts/set-admin-claims.js <approved-email>\n       node scripts/set-admin-claims.js --revoke <approved-email>\n');
  process.exit(2);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  process.stderr.write('FIREBASE_SERVICE_ACCOUNT must be set in the environment.\n');
  process.exit(2);
}
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
