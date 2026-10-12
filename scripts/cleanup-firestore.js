import readline from 'node:readline/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { getServices } from '../api/_lib/firebase.js';
import { loadVercelEnv } from './_vercel-env.js';

const DAY = 24 * 60 * 60 * 1000;
const SAMPLE_SIZE = 5;

const KNOWN_COLLECTIONS = new Set([
  'adminCheck', 'analyticsRateLimits', 'apiRateLimits', 'counters', 'feedbacks',
  'galleryFolders', 'galleryImages', 'news', 'newsDeliveries', 'newsDrafts',
  'newsReads', 'newsSubscriptions', 'pageviews', 'photoDerivativeCache',
  'photoDownloadLogs', 'photoDownloadRateLimits', 'photoDownloadStats',
  'photoDownloadUsers', 'publicFeedbacks', 'rateLimits', 'supporterIpCooldowns',
  'supporters', 'supportLogs'
]);

const USAGE = `Usage: node scripts/cleanup-firestore.js [options]

Finds unused, expired and legacy Firestore data. By default it only REPORTS
what it would delete. Nothing is removed until you pass --execute.

supportLogs and photoDownloadLogs are permanent records and are never touched
by this script.

Options:
  --execute                       Delete what the report lists (asks you to confirm)
  --yes                           Skip the confirmation prompt (use with --execute)
  --only=a,b                      Run only these categories (see below)
  --pageviews-older-than-days=N   Also delete analytics pageviews older than N days
  --photo-stats                   Also delete download stats for photos that no longer exist
  --unknown-collections           Also delete top-level collections this app does not use
  --local-env                     Read FIREBASE_SERVICE_ACCOUNT from the local environment
  --help                          Show this message

Categories (all on by default):
  expired               Rate-limit windows whose expiry timestamp has passed
  stale-rate-limits     Old rate-limit windows and supporter IP cooldowns
  news-orphans          Deliveries, read receipts and logs of news that no longer exists
  photo-orphans         Cached photo variants of deleted or replaced photos

Opt-in categories: pageviews, photo-stats, unknown-collections

Env: VERCEL_TOKEN (fetches FIREBASE_SERVICE_ACCOUNT from Vercel), optional VERCEL_PROJECT_ID / VERCEL_TEAM_ID.
`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const match = args.find((value) => value.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
};

if (flag('--help') || flag('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const execute = flag('--execute');
const assumeYes = flag('--yes');
const onlyArg = option('--only');
const only = onlyArg ? new Set(onlyArg.split(',').map((value) => value.trim()).filter(Boolean)) : null;
const pageviewDaysArg = option('--pageviews-older-than-days');
const pageviewDays = pageviewDaysArg === null ? null : Number(pageviewDaysArg);
if (pageviewDaysArg !== null && (!Number.isFinite(pageviewDays) || pageviewDays < 1)) {
  process.stderr.write('--pageviews-older-than-days needs a number of days, for example 365.\n');
  process.exit(2);
}

function millis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function item(ref, reason) {
  return { ref, reason };
}

async function expiredBy(db, collectionName, field, now) {
  const snapshot = await db.collection(collectionName)
    .where(field, '<', Timestamp.fromMillis(now))
    .select()
    .get();
  return snapshot.docs.map((doc) => item(doc.ref, `${collectionName}.${field} has passed`));
}

function makeContext(db, now) {
  let newsIndex = null;
  let imageIndex = null;
  return {
    db,
    now,
    async news() {
      if (!newsIndex) {
        const snapshot = await db.collection('news').select('deleted', 'revision').get();
        newsIndex = new Map(snapshot.docs.map((doc) => [doc.id, {
          deleted: doc.get('deleted') === true,
          revision: Number(doc.get('revision')) || 1
        }]));
      }
      return newsIndex;
    },
    async images() {
      if (!imageIndex) {
        const snapshot = await db.collection('galleryImages').select('publicId').get();
        imageIndex = new Map(snapshot.docs.map((doc) => [doc.id, doc.get('publicId') || null]));
      }
      return imageIndex;
    }
  };
}

const categories = [
  {
    key: 'expired',
    title: 'Expired rate-limit windows',
    async run({ db, now }) {
      const targets = [
        ['photoDownloadRateLimits', 'expiresAt'],
        ['apiRateLimits', 'expiresAt']
      ];
      const found = [];
      for (const [name, field] of targets) found.push(...await expiredBy(db, name, field, now));
      return found;
    }
  },
  {
    key: 'stale-rate-limits',
    title: 'Stale rate limits and cooldowns',
    async run({ db, now }) {
      const found = [];
      const old = (value) => value === null || value < now - DAY;

      for (const name of ['rateLimits', 'analyticsRateLimits']) {
        const snapshot = await db.collection(name).get();
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const last = Math.max(millis(data.windowStart) ?? 0, millis(data.updatedAt) ?? 0) || null;
          if (old(last)) found.push(item(doc.ref, `${name} window ended more than a day ago`));
        }
      }

      const cooldowns = await db.collection('supporterIpCooldowns').get();
      for (const doc of cooldowns.docs) {
        if (old(millis(doc.get('lastClickAt')))) found.push(item(doc.ref, 'supporter IP cooldown ended more than a day ago'));
      }

      const apiLimits = await db.collection('apiRateLimits').get();
      for (const doc of apiLimits.docs) {
        const data = doc.data();
        if (!data.expiresAt && old(millis(data.windowStart) ?? millis(data.updatedAt))) {
          found.push(item(doc.ref, 'apiRateLimits window without an expiry date'));
        }
      }

      const photoLimits = await db.collection('photoDownloadRateLimits').get();
      for (const doc of photoLimits.docs) {
        const data = doc.data();
        const last = millis(data.lastAttemptAt);
        if (!data.expiresAt && (last === null || last < now - 7 * DAY)) {
          found.push(item(doc.ref, 'photoDownloadRateLimits entry without an expiry date'));
        }
      }
      return found;
    }
  },
  {
    key: 'news-orphans',
    title: 'Orphaned news data',
    async run(context) {
      const { db } = context;
      const news = await context.news();
      const found = [];

      const deliveries = await db.collection('newsDeliveries').select('newsId', 'revision').get();
      for (const doc of deliveries.docs) {
        const newsId = doc.get('newsId');
        const revision = Number(doc.get('revision')) || 1;
        const article = news.get(newsId);
        if (!article) found.push(item(doc.ref, `news ${newsId} no longer exists`));
        else if (article.deleted) found.push(item(doc.ref, `news ${newsId} is deleted`));
        else if (revision < article.revision) found.push(item(doc.ref, `delivery of an older revision (${revision} < ${article.revision})`));
      }

      const reads = await db.collection('newsReads').select('newsId').get();
      for (const doc of reads.docs) {
        const newsId = doc.get('newsId');
        if (!news.has(newsId)) found.push(item(doc.ref, `read receipt for news ${newsId} that no longer exists`));
      }

      const logs = await db.collectionGroup('logs').select().get();
      for (const doc of logs.docs) {
        const parent = doc.ref.parent.parent;
        if (parent && parent.parent.id === 'news' && !news.has(parent.id)) {
          found.push(item(doc.ref, `audit log of news ${parent.id} that no longer exists`));
        }
      }
      return found;
    }
  },
  {
    key: 'photo-orphans',
    title: 'Orphaned photo cache',
    async run(context) {
      const images = await context.images();
      const snapshot = await context.db.collection('photoDerivativeCache').get();
      const found = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const imageId = data.imageDocId || doc.id.replace(/_(thumb|view)$/, '');
        if (!images.has(imageId)) found.push(item(doc.ref, `photo ${imageId} no longer exists`));
        else if (data.publicId !== images.get(imageId)) found.push(item(doc.ref, `photo ${imageId} was replaced`));
        else if (typeof data.secureUrl !== 'string') found.push(item(doc.ref, 'cache entry has no URL'));
      }
      return found;
    }
  },
  {
    key: 'pageviews',
    title: 'Old analytics pageviews',
    optIn: () => pageviewDays !== null,
    async run({ db, now }) {
      const cutoff = Timestamp.fromMillis(now - pageviewDays * DAY);
      const snapshot = await db.collection('pageviews').where('timestamp', '<', cutoff).select().get();
      return snapshot.docs.map((doc) => item(doc.ref, `older than ${pageviewDays} days`));
    }
  },
  {
    key: 'photo-stats',
    title: 'Download stats of deleted photos',
    optIn: () => flag('--photo-stats'),
    async run(context) {
      const images = await context.images();
      const snapshot = await context.db.collection('photoDownloadStats').select().get();
      const found = [];
      for (const doc of snapshot.docs) {
        if (!doc.id.startsWith('photo_')) continue;
        const imageId = doc.id.slice('photo_'.length);
        if (!images.has(imageId)) found.push(item(doc.ref, `photo ${imageId} no longer exists`));
      }
      return found;
    }
  },
  {
    key: 'unknown-collections',
    title: 'Collections this app does not use',
    optIn: () => flag('--unknown-collections'),
    async run({ db }) {
      const collections = await db.listCollections();
      return collections
        .filter((collection) => !KNOWN_COLLECTIONS.has(collection.id))
        .map((collection) => ({ ref: collection, reason: 'top-level collection not used by this app', recursive: true }));
    }
  }
];

function selected(category) {
  if (only) return only.has(category.key);
  return category.optIn ? category.optIn() : true;
}

async function describeUnknownCollections(db) {
  const collections = await db.listCollections();
  const unknown = collections.filter((collection) => !KNOWN_COLLECTIONS.has(collection.id));
  const lines = [];
  for (const collection of unknown) {
    let size = '?';
    try {
      size = (await collection.count().get()).data().count;
    } catch {}
    lines.push(`  - ${collection.id} (${size} documents)`);
  }
  return lines;
}

function labelOf(entry) {
  return entry.recursive ? `${entry.ref.id}/` : entry.ref.path;
}

async function confirm(total) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write('Not an interactive terminal. Add --yes to confirm the deletion.\n');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Permanently delete ${total} item(s)? Type DELETE to continue: `);
    return answer.trim() === 'DELETE';
  } finally {
    rl.close();
  }
}

async function deleteAll(db, entries) {
  const writer = db.bulkWriter();
  let failed = 0;
  let deleted = 0;
  writer.onWriteError((error) => error.failedAttempts < 3);

  const pending = entries.filter((value) => !value.recursive).map((entry) => writer.delete(entry.ref).then(() => {
    deleted += 1;
  }, (error) => {
    failed += 1;
    process.stderr.write(`Could not delete ${entry.ref.path}: ${error.message}\n`);
  }));
  await writer.close();
  await Promise.all(pending);

  for (const entry of entries.filter((value) => value.recursive)) {
    try {
      await db.recursiveDelete(entry.ref);
      deleted += 1;
    } catch (error) {
      failed += 1;
      process.stderr.write(`Could not delete collection ${entry.ref.id}: ${error.message}\n`);
    }
  }
  return { deleted, failed };
}

async function main() {
  await loadVercelEnv(['FIREBASE_SERVICE_ACCOUNT']);
  const { db, projectId } = getServices();
  const now = Date.now();
  const context = makeContext(db, now);

  process.stdout.write(`Project: ${projectId}\nMode   : ${execute ? 'EXECUTE (will delete)' : 'DRY RUN (nothing is deleted)'}\n\n`);

  const plan = [];
  const claimed = new Set();
  for (const category of categories) {
    if (!selected(category)) continue;
    process.stdout.write(`Scanning ${category.title}...\n`);
    const entries = (await category.run(context)).filter((entry) => {
      const id = labelOf(entry);
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    });
    plan.push({ category, entries });
  }

  process.stdout.write('\n');
  let total = 0;
  for (const { category, entries } of plan) {
    total += entries.length;
    process.stdout.write(`${category.title} [${category.key}]: ${entries.length}\n`);
    for (const entry of entries.slice(0, SAMPLE_SIZE)) process.stdout.write(`    ${labelOf(entry)}  (${entry.reason})\n`);
    if (entries.length > SAMPLE_SIZE) process.stdout.write(`    ... and ${entries.length - SAMPLE_SIZE} more\n`);
  }

  if (!plan.some(({ category }) => category.key === 'unknown-collections')) {
    const unknown = await describeUnknownCollections(db);
    if (unknown.length) {
      process.stdout.write(`\nCollections this app does not use (kept; add --unknown-collections to delete them):\n${unknown.join('\n')}\n`);
    }
  }

  process.stdout.write(`\nTotal: ${total} item(s).\n`);
  if (!total) return;
  if (!execute) {
    process.stdout.write('Dry run only. Review the list, then re-run with --execute to delete.\n');
    return;
  }
  if (!(await confirm(total))) {
    process.stdout.write('Cancelled. Nothing was deleted.\n');
    return;
  }

  const entries = plan.flatMap((value) => value.entries);
  const result = await deleteAll(db, entries);
  process.stdout.write(`Deleted ${result.deleted} item(s)${result.failed ? `, ${result.failed} failed` : ''}.\n`);
  if (result.failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});