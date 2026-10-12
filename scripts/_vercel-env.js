import { readFile } from 'node:fs/promises';

const API = (process.env.VERCEL_API_URL || 'https://api.vercel.com').replace(/\/+$/, '');
const DEFAULT_PROJECT = 'gtcsu-aurora';
const TARGET = process.env.VERCEL_ENV_TARGET || 'production';

export const LOCAL_ENV_FLAG = '--local-env';

async function linkedProject() {
  try {
    const link = JSON.parse(await readFile(new URL('../.vercel/project.json', import.meta.url), 'utf8'));
    return { projectId: link.projectId, teamId: link.orgId };
  } catch {
    return {};
  }
}

const LOCAL_ENV_FILES = ['.env.local', '.env'];

async function readLocalEnvFiles(names) {
  const found = {};
  for (const file of LOCAL_ENV_FILES) {
    let text;
    try {
      text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !names.includes(match[1]) || found[match[1]]) continue;
      let value = match[2];
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (value) found[match[1]] = value;
    }
  }
  return found;
}

async function vercelGet(path, token) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch {}
    const hint = response.status === 401 || response.status === 403
      ? ' (check that VERCEL_TOKEN is valid and can access the project)'
      : response.status === 404
        ? ' (check VERCEL_PROJECT_ID / VERCEL_TEAM_ID)'
        : '';
    throw new Error(`Vercel API returned ${response.status}${detail ? `: ${detail}` : ''}${hint}`);
  }
  return response.json();
}

function matchesTarget(entry) {
  const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
  return targets.includes(TARGET);
}

/**
 * Loads environment variables from the Vercel project into process.env.
 *
 *   names       variables to look for
 *   required    variables that must be available afterwards (default: all of names)
 *   requireAny  true = at least one of `required` is enough
 *
 * Needs VERCEL_TOKEN. The project comes from VERCEL_PROJECT_ID, else
 * .vercel/project.json (created by `vercel link`), else "gtcsu-aurora".
 * Teams: VERCEL_TEAM_ID, or the orgId from .vercel/project.json.
 * Without a token, or with --local-env, Vercel is skipped. Anything still
 * missing is then read from .env.local / .env in the project root (never
 * overriding variables that are already set). Sensitive-type Vercel variables
 * cannot be read back through the API, so those must live in .env.local.
 * Values are never printed.
 */
export async function loadVercelEnv(names, { required = names, requireAny = false } = {}) {
  const token = process.env.VERCEL_TOKEN?.trim();
  const useLocalOnly = process.argv.includes(LOCAL_ENV_FLAG);
  const fetched = [];
  const sensitive = new Set();

  if (token && !useLocalOnly) {
    const link = await linkedProject();
    const project = process.env.VERCEL_PROJECT_ID?.trim() || link.projectId || DEFAULT_PROJECT;
    const teamId = process.env.VERCEL_TEAM_ID?.trim() || (link.teamId?.startsWith('team_') ? link.teamId : '');
    const team = teamId ? `&teamId=${encodeURIComponent(teamId)}` : '';
    const base = `/v9/projects/${encodeURIComponent(project)}/env?decrypt=true${team}`;

    const { envs = [] } = await vercelGet(base, token);

    for (const name of names) {
      const candidates = envs
        .filter((entry) => entry.key === name && matchesTarget(entry))
        .sort((a, b) => Number(Boolean(a.gitBranch)) - Number(Boolean(b.gitBranch)));
      const entry = candidates[0];
      if (!entry) continue;

      let value = entry.value;
      if (!value && entry.id && entry.type !== 'sensitive') {
        const single = await vercelGet(`/v1/projects/${encodeURIComponent(project)}/env/${encodeURIComponent(entry.id)}${team ? `?${team.slice(1)}` : ''}`, token);
        value = single.value;
      }
      if (value) {
        process.env[name] = value;
        fetched.push(name);
      } else if (entry.type === 'sensitive') {
        sensitive.add(name);
      }
    }
  }

  const stillMissing = names.filter((name) => !process.env[name]);
  if (stillMissing.length) {
    const fromFiles = await readLocalEnvFiles(stillMissing);
    for (const [name, value] of Object.entries(fromFiles)) process.env[name] = value;
  }

  const present = required.filter((name) => process.env[name]);
  const ok = requireAny ? present.length > 0 : present.length === required.length;
  if (!ok) {
    const missing = required.filter((name) => !process.env[name]);
    const hidden = missing.filter((name) => sensitive.has(name));
    const lines = [`Missing ${requireAny ? 'one of ' : ''}${(requireAny ? required : missing).join(', ')}.`];
    if (hidden.length) {
      lines.push(`Vercel never returns Sensitive variables (${hidden.join(', ')}). Add ${hidden.map((name) => `${name}=<value>`).join(' and ')} to .env.local in the project root (keep that file out of git), or export it and run with --local-env.`);
    } else if (!token) {
      lines.push('Set VERCEL_TOKEN (and optionally VERCEL_PROJECT_ID / VERCEL_TEAM_ID) so the script can fetch it from Vercel, or put it in .env.local, or export it and run with --local-env.');
    } else if (useLocalOnly) {
      lines.push('Running with --local-env, so Vercel was not queried.');
    } else {
      lines.push(`It was not found in the Vercel project for the "${TARGET}" environment.`);
    }
    throw new Error(lines.join(' '));
  }
  return fetched;
}