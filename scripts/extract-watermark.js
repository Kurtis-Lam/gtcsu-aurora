import { readFile } from 'node:fs/promises';
import { extractWatermark } from '../api/_lib/watermark.js';

const args = process.argv.slice(2);
const file = args.find((value) => !value.startsWith('--'));
const widthsArg = args.find((value) => value.startsWith('--widths='));

if (!file) {
  process.stderr.write('Usage: node scripts/extract-watermark.js <image-file> [--widths=3000,2400,2000]\n');
  process.stderr.write('Requires WATERMARK_SECRET (or ANALYTICS_HMAC_SECRET) in the environment.\n');
  process.exit(2);
}

const widths = widthsArg
  ? widthsArg.slice('--widths='.length).split(',').map((value) => Number(value.trim())).filter(Number.isInteger)
  : [3000, 2400, 2048, 1920, 1600];

try {
  const buffer = await readFile(file);
  const result = await extractWatermark(buffer, { widths });
  if (!result) {
    process.stdout.write('No Aurora watermark could be recovered from this image.\n');
    process.exit(1);
  }
  process.stdout.write([
    'Aurora watermark recovered.',
    `Download ID prefix : ${result.id}`,
    `Search REF         : ${result.id.slice(0, 8).toUpperCase()}`,
    `Confidence         : ${result.confidence}`,
    `Method             : ${result.method}`,
    'Look up this value in the photoDownloadLogs collection (watermarkId / watermarkRef / downloadId).'
  ].join('\n') + '\n');
} catch (error) {
  process.stderr.write(`Could not analyse the image: ${error.message}\n`);
  process.exit(2);
}