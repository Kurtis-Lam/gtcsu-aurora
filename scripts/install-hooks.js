// Runs automatically after `npm install` (the "prepare" script).
// Points git at the tracked .githooks/ folder. Never fails the install.
import { execSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';

try {
  if (existsSync('.git')) {
    execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
    chmodSync('.githooks/pre-commit', 0o755);
  }
} catch { /* e.g. no git on the build server: ignore */ }
