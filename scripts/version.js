#!/usr/bin/env node
// Keeps APP_VERSION / LAST_UPDATED in public/js/info.js up to date.
//
//   node scripts/version.js stamp                          refresh LAST_UPDATED only (run by the pre-commit hook)
//   node scripts/version.js bump patch|minor|major|1.2.3   bump APP_VERSION and refresh LAST_UPDATED
//                                                          (manual only: npm run bump <patch|minor|major|x.y.z>)
//
// Commits never change APP_VERSION. Versions are bumped by hand.
// A bump also keeps the "Current version" line in README.md and README.zh-HK.md in sync (if present).
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
  if (!['stamp', 'bump'].includes(cmd) || (cmd === 'bump' && !arg)) {
    console.error('Usage:\n  node scripts/version.js stamp\n  node scripts/version.js bump patch|minor|major|<x.y.z>');
    process.exit(1);
  }
  if (!existsSync(INFO)) throw new Error(`Not found: ${INFO}`);

  let src = readFileSync(INFO, 'utf8');
  if (!VERSION_RE.test(src) || !UPDATED_RE.test(src)) {
    throw new Error('Could not find APP_VERSION / LAST_UPDATED in public/js/info.js');
  }

  const oldVersion = src.match(VERSION_RE)[2];
  const newVersion = cmd === 'bump' ? nextVersion(oldVersion, arg) : oldVersion;
  const stamp = nowHongKong();

  src = src
    .replace(VERSION_RE, (_, a, __, c) => a + newVersion + c)
    .replace(UPDATED_RE, (_, a, __, c) => a + stamp + c);
  writeFileSync(INFO, src);

  if (cmd === 'bump') {
    for (const [file, re] of READMES) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const updated = text.replace(re, (_, a, b) => a + newVersion + b);
      if (updated !== text) writeFileSync(file, updated);
    }
  }

  console.log(cmd === 'bump'
    ? `Version ${oldVersion} -> ${newVersion} (updated ${stamp})`
    : `LAST_UPDATED -> ${stamp}`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }