#!/usr/bin/env node
// Releases are cut by hand. Nothing here runs on git commit or git push.
//
//   npm run bump patch|minor|major|<x.y.z>
//   (same as: node scripts/version.js bump patch|minor|major|<x.y.z>)
//
// A bump updates APP_VERSION and LAST_UPDATED in public/js/info.js and the
// "Current version" line in README.md and README.zh-HK.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INFO = resolve(root, 'public/js/info.js');
const READMES = [
  [resolve(root, 'README.md'), /(\*\*Current version: v)[\d.]+(\*\*)/],
  [resolve(root, 'README.zh-HK.md'), /(\*\*目前版本：v)[\d.]+(\*\*)/],
];

const VERSION_RE = /(export const APP_VERSION = ')([^']*)(')/;
const UPDATED_RE = /(export const LAST_UPDATED = ')([^']*)(')/;

// Hong Kong has no DST, so it is always UTC+8. Shift the clock and print it as +08:00.
function nowHongKong() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19) + '+08:00';
}

function nextVersion(current, arg) {
  const explicit = String(arg).replace(/^v/, '');
  if (/^\d+\.\d+\.\d+$/.test(explicit)) return explicit;

  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Current APP_VERSION "${current}" is not x.y.z`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (arg === 'major') { major++; minor = 0; patch = 0; }
  else if (arg === 'minor') { minor++; patch = 0; }
  else if (arg === 'patch') { patch++; }
  else throw new Error('Use: patch | minor | major | <x.y.z>');
  return `${major}.${minor}.${patch}`;
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd !== 'bump' || !arg) {
    console.error('Usage:\n  npm run bump patch|minor|major|<x.y.z>\n  node scripts/version.js bump patch|minor|major|<x.y.z>');
    process.exit(1);
  }
  if (!existsSync(INFO)) throw new Error(`Not found: ${INFO}`);

  let src = readFileSync(INFO, 'utf8');
  if (!VERSION_RE.test(src) || !UPDATED_RE.test(src)) {
    throw new Error('Could not find APP_VERSION / LAST_UPDATED in public/js/info.js');
  }

  const oldVersion = src.match(VERSION_RE)[2];
  const newVersion = nextVersion(oldVersion, arg);
  const stamp = nowHongKong();

  src = src
    .replace(VERSION_RE, (_, a, __, c) => a + newVersion + c)
    .replace(UPDATED_RE, (_, a, __, c) => a + stamp + c);
  writeFileSync(INFO, src);

  for (const [file, re] of READMES) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const updated = text.replace(re, (_, a, b) => a + newVersion + b);
    if (updated !== text) writeFileSync(file, updated);
  }

  console.log(`Version ${oldVersion} -> ${newVersion} (updated ${stamp})`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }