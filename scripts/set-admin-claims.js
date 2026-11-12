import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import path from 'node:path';

const args = process.argv.slice(2);
const revoke = args[0] === '--revoke';
const email = (revoke ? args[1] : args[0])?.trim().toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  process.stderr.write(
    'Usage: node scripts/set-admin-claims.js <approved-email>\n' +
    '       node scripts/set-admin-claims.js --revoke <approved-email>\n' +
    'Uses credentials/service-account.json for Firebase Admin initialization.\n'
  );
  process.exit(2);
}

try {
  const serviceAccountPath = path.join(process.cwd(), 'credentials/service-account.json');
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccountPath) });
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