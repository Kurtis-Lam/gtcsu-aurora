import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { extractWatermark, describeImage } from '../api/_lib/watermark.js';
import { loadVercelEnv } from './_vercel-env.js';

const args = process.argv.slice(2);
const file = args.find((value) => !value.startsWith('--'));
const widthsArg = args.find((value) => value.startsWith('--widths='));

if (!file) {
  process.stderr.write('Usage: node scripts/extract-watermark.js <image-file> [--widths=3000,2400,2000] [--local-env]\n');
  process.stderr.write('Fetches WATERMARK_SECRET (or ANALYTICS_HMAC_SECRET) from Vercel using VERCEL_TOKEN.\n');
  process.stderr.write('Use --local-env to read it from the local environment instead.\n');
  process.exit(2);
}

const widths = widthsArg
  ? widthsArg.slice('--widths='.length).split(',').map((value) => Number(value.trim())).filter(Number.isInteger)
  : [3000, 2400, 2048, 1920, 1600];

function fingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function collectSecrets() {
  const secrets = [];
  const seen = new Set();
  for (const name of ['WATERMARK_SECRET', 'ANALYTICS_HMAC_SECRET']) {
    const raw = process.env[name];
    if (!raw) continue;
    const variants = [raw, raw.trim(), raw.trim().replace(/^["']|["']$/g, '')];
    for (const value of variants) {
      if (!value || Buffer.byteLength(value) < 32 || seen.has(value)) continue;
      seen.add(value);
      secrets.push({ name, value, fingerprint: fingerprint(value) });
    }
  }
  return secrets;
}

try {
  await loadVercelEnv(['WATERMARK_SECRET', 'ANALYTICS_HMAC_SECRET'], { requireAny: true });
  const secrets = collectSecrets();
  if (!secrets.length) {
    throw new Error('No usable secret found. WATERMARK_SECRET / ANALYTICS_HMAC_SECRET must be at least 32 characters.');
  }

  const buffer = await readFile(file);
  const info = await describeImage(buffer);
  process.stdout.write(`Image ${info.width}x${info.height}, trying ${secrets.length} secret candidate(s): ${secrets.map((s) => `${s.name}#${s.fingerprint}`).join(', ')}\n`);

  const result = await extractWatermark(buffer, {
    widths,
    secrets,
    onProgress: (width) => process.stdout.write(`Analysing at width ${width}...\n`)
  });

  if (!result) {
    const lines = ['No Aurora watermark could be recovered from this image.'];
    lines.push('Checklist:');
    lines.push('  - The file must be the untouched download from the gallery (no screenshot, crop, heavy resize or re-save).');
    lines.push('  - The secret candidates above must match the ones the deployed site used when the photo was downloaded.');
    lines.push('    Compare the #fingerprints with a second run on another machine, or check that Vercel production has the same WATERMARK_SECRET.');
    lines.push('  - Photos downloaded from a preview deployment or local dev server used that environment\'s secret, not production.');
    if (info.clippedShare > 0.5) {
      lines.push(`  - ${(info.clippedShare * 100).toFixed(0)}% of this image is pure black or white. Downloads made before the dct-qim-v2 update carry far less signal on such images.`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(1);
  }

  process.stdout.write([
    'Aurora watermark recovered.',
    `Download ID prefix : ${result.id}`,
    `Search REF         : ${result.id.slice(0, 8).toUpperCase()}`,
    `Confidence         : ${result.confidence}`,
    `Method             : ${result.method}`,
    `Secret used        : ${result.secretName}`,
    'Look up this value in the photoDownloadLogs collection (watermarkId / watermarkRef / downloadId).'
  ].join('\n') + '\n');
} catch (error) {
  process.stderr.write(`Could not analyse the image: ${error.message}\n`);
  process.exit(2);
}
