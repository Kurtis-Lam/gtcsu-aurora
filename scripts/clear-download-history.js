import readline from 'node:readline/promises';
import { getServices } from '../api/_lib/firebase.js';
import { loadVercelEnv } from './_vercel-env.js';

const COUNTER_PATH = 'counters/supportCounter';
const CONFIRM_PHRASE = 'ERASE HISTORY';

const COLLECTIONS = [
  { name: 'supportLogs', what: 'encrypted IP/device log of every support vote' },
  { name: 'supporters', what: 'per-device and per-account supporter records' },
  { name: 'supporterIpCooldowns', what: 'supporter IP cooldown markers' },
  { name: 'photoDownloadLogs', what: 'audit log of every photo download' },
  { name: 'photoDownloadStats', what: 'download totals (overall and per photo)' },
  { name: 'photoDownloadUsers', what: 'per-account download totals' },
  { name: 'photoDownloadRateLimits', what: 'legacy download quota windows' }
];

const USAGE = `Usage: node scripts/clear-download-history.js [options]

Clears ALL supporter history and ALL photo download history.
The public support count (${COUNTER_PATH}) is never modified.

By default this is a DRY RUN: it only reports what it would delete.

Options:
  --execute      Delete the data (asks you to type ${CONFIRM_PHRASE})
  --yes          Skip the typed confirmation (use with --execute)
  --local-env    Read FIREBASE_SERVICE_ACCOUNT from .env.local / environment
  --help         Show this message

Collections cleared:
${COLLECTIONS.map((c) => `  ${c.name.padEnd(26)}${c.what}`).join('\n')}
  apiRateLimits             only entries with scope "photo-download"

Env: VERCEL_TOKEN (fetches FIREBASE_SERVICE_ACCOUNT from Vercel), optional VERCEL_PROJECT_ID / VERCEL_TEAM_ID.

WARNING: supporter logs and photo download logs are the school's permanent
records. Deletion cannot be undone. Export them first if they may be needed.
`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

if (flag('--help') || flag('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const execute = flag('--execute');
const assumeYes = flag('--yes');

async function readCounter(db) {
  const snapshot = await db.doc(COUNTER_PATH).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function countDocs(query) {
  try {
    return (await query.count().get()).data().count;
  } catch {
    return (await query.select().get()).size;
  }
}

async function confirm() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write('Not an interactive terminal. Add --yes to confirm the deletion.\n');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`This permanently erases the history above. Type ${CONFIRM_PHRASE} to continue: `);
    return answer.trim() === CONFIRM_PHRASE;
  } finally {
    rl.close();
  }
}

async function deleteQuery(db, query) {
  const writer = db.bulkWriter();
  let deleted = 0;
  let failed = 0;
  writer.onWriteError((error) => error.failedAttempts < 3);
  const snapshot = await query.select().get();
  const pending = snapshot.docs.map((doc) => writer.delete(doc.ref).then(
    () => { deleted += 1; },
    (error) => {
      failed += 1;
      process.stderr.write(`Could not delete ${doc.ref.path}: ${error.message}\n`);
    }
  ));
  await writer.close();
  await Promise.all(pending);
  return { deleted, failed };
}

async function main() {
  await loadVercelEnv(['FIREBASE_SERVICE_ACCOUNT']);
  const { db, projectId } = getServices();

  process.stdout.write(`Project: ${projectId}\nMode   : ${execute ? 'EXECUTE (will delete)' : 'DRY RUN (nothing is deleted)'}\n\n`);

  const counterBefore = await readCounter(db);
  if (!counterBefore) {
    process.stdout.write(`Note: ${COUNTER_PATH} does not exist yet, so there is no support count to preserve.\n\n`);
  } else {
    process.stdout.write(`Support count to preserve: ${Number(counterBefore.count) || 0}\n\n`);
  }

  const targets = COLLECTIONS.map((c) => ({ label: c.name, query: db.collection(c.name) }));
  targets.push({
    label: 'apiRateLimits (scope = photo-download)',
    query: db.collection('apiRateLimits').where('scope', '==', 'photo-download')
  });

  let total = 0;
  for (const target of targets) {
    target.count = await countDocs(target.query);
    total += target.count;
    process.stdout.write(`  ${target.label.padEnd(40)} ${target.count} document(s)\n`);
  }
  process.stdout.write(`\nTotal: ${total} document(s).\n`);

  if (!total) return;
  if (!execute) {
    process.stdout.write('Dry run only. Re-run with --execute to delete.\n');
    return;
  }
  if (!(await confirm())) {
    process.stdout.write('Cancelled. Nothing was deleted.\n');
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const target of targets) {
    if (!target.count) continue;
    const result = await deleteQuery(db, target.query);
    deleted += result.deleted;
    failed += result.failed;
    process.stdout.write(`  cleared ${target.label}: ${result.deleted} deleted${result.failed ? `, ${result.failed} failed` : ''}\n`);
  }

  const counterAfter = await readCounter(db);
  const before = counterBefore ? Number(counterBefore.count) || 0 : null;
  const after = counterAfter ? Number(counterAfter.count) || 0 : null;
  process.stdout.write(`\nDeleted ${deleted} document(s)${failed ? `, ${failed} failed` : ''}.\n`);
  process.stdout.write(`Support count: ${before} -> ${after}${before === after ? ' (unchanged)' : ' (CHANGED - check this)'}\n`);
  if (failed || before !== after) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});