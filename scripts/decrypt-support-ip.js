import { getServices } from '../api/_lib/firebase.js';
import { decryptField } from '../api/_lib/crypto.js';
import { loadVercelEnv } from './_vercel-env.js';

const USAGE =
  'Usage: node scripts/decrypt-support-ip.js <supportLogId | ciphertext> --reason "why this lookup is needed"\n' +
  '       [--local-env]\n' +
  'Env:   VERCEL_TOKEN (the script fetches SUPPORT_ENCRYPTION_KEY and, for a supportLogId, FIREBASE_SERVICE_ACCOUNT from Vercel).\n' +
  '       Optional: VERCEL_PROJECT_ID, VERCEL_TEAM_ID. With --local-env both values are read from the local environment instead.';

const args = process.argv.slice(2);
const reasonIndex = args.indexOf('--reason');
const reason = reasonIndex >= 0 ? (args[reasonIndex + 1] || '').trim() : '';
const target = args.find((a, i) => !a.startsWith('--') && i !== reasonIndex + 1);

if (!target || reason.length < 10) {
  console.error(USAGE);
  console.error('\nA --reason of at least 10 characters is required. Use this only to investigate abuse of the support feature.');
  process.exit(1);
}

function tryDecrypt(token) {
  try {
    return decryptField(token);
  } catch (err) {
    return `<could not decrypt: ${err.message}>`;
  }
}

async function main() {
  const needsDatabase = !target.startsWith('v1.');
  await loadVercelEnv(['SUPPORT_ENCRYPTION_KEY', 'FIREBASE_SERVICE_ACCOUNT'], {
    required: needsDatabase ? ['SUPPORT_ENCRYPTION_KEY', 'FIREBASE_SERVICE_ACCOUNT'] : ['SUPPORT_ENCRYPTION_KEY']
  });

  let ipEnc;
  let deviceEnc = null;
  let meta = {};

  if (target.startsWith('v1.')) {
    ipEnc = target;
  } else {
    const snap = await getServices().db.collection('supportLogs').doc(target).get();
    if (!snap.exists) throw new Error(`No supportLogs document with id ${target}`);
    const data = snap.data();
    ipEnc = data.ipEnc;
    deviceEnc = data.deviceEnc;
    meta = {
      email: data.email ?? null,
      uid: data.uid ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null
    };
  }

  const ip = tryDecrypt(ipEnc);
  let device = null;
  if (deviceEnc) {
    const raw = tryDecrypt(deviceEnc);
    try { device = JSON.parse(raw); } catch { device = raw; }
  }

  console.error(`[audit] ${new Date().toISOString()} decrypt of ${target.startsWith('v1.') ? 'raw ciphertext' : target} — reason: ${reason}`);
  console.log(JSON.stringify({ ip, device, ...meta }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});