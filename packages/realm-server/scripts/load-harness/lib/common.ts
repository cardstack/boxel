// Shared plumbing for the load harness: endpoint defaults, the production
// guard, credential reading, argument parsing, and percentile summaries.
//
// Nothing in this directory imports from the workspace, and nothing here needs
// `node_modules`. The harness has to run from inside the same AWS region as the
// realm server under test — a CloudShell session or an ECS task, neither of
// which has a checkout — so installing it is `cp -r` plus a Node that strips
// types. Keep it to global `fetch` and `node:` built-ins.

import { readFileSync } from 'node:fs';

export interface Credential {
  username: string;
  password: string;
}

// Overridable for a local stack. The production guard below is what stops the
// override from pointing anywhere.
export const DEFAULTS = {
  matrixUrl: process.env.MATRIX_URL ?? 'https://matrix-staging.stack.cards',
  realmServerUrl:
    process.env.REALM_SERVER_URL ?? 'https://realms-staging.stack.cards',
};

// This harness drives a realm server to saturation on purpose, so production is
// out of bounds. Refuse rather than warn, and offer no override flag: an
// operator under time pressure will reach for a `--force` that exists, and the
// cost of being wrong is an outage for real users.
const PRODUCTION_HOSTS = [/(^|\.)boxel\.ai$/i];

export function assertNotProduction(...urls: (string | undefined)[]): void {
  for (let url of urls.filter(Boolean) as string[]) {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new Error(`Not a URL: ${url}`);
    }
    if (PRODUCTION_HOSTS.some((re) => re.test(host))) {
      throw new Error(
        `Refusing to run a load harness against production (${host}). ` +
          `This drives a realm server to saturation on purpose. Use staging.`,
      );
    }
  }
}

// What the entry points call. A refusal is a decision rather than a crash, and
// a stack trace reads like the latter.
export function exitIfProduction(...urls: (string | undefined)[]): void {
  try {
    assertNotProduction(...urls);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

// Reads a credential file with `username` and `initial_password` columns;
// `username` is the Matrix localpart. Extra columns are ignored, so a file
// generated for account provisioning can be used as-is.
//
// The password column is read into memory and nowhere else: it is never
// logged, never written to a file, and never included in an error message.
export function readCredentials(csvPath: string): Credential[] {
  let text = readFileSync(csvPath, 'utf8');
  let lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error(`${csvPath} has no data rows`);
  }
  let header = splitCsvLine(lines[0]).map((h) => h.trim());
  let iUser = header.indexOf('username');
  let iPass = header.indexOf('initial_password');
  if (iUser < 0 || iPass < 0) {
    throw new Error(
      `${csvPath} must have 'username' and 'initial_password' columns; got: ${header.join(', ')}`,
    );
  }
  return lines
    .slice(1)
    .map((line) => {
      let cells = splitCsvLine(line);
      return {
        username: cells[iUser]?.trim() ?? '',
        password: cells[iPass] ?? '',
      };
    })
    .filter((r) => r.username);
}

// Minimal CSV: quoted cells and doubled quotes, which is all a generated
// credential file contains. Deliberately not a CSV library — a dependency here
// would cost the copy-and-run property the harness is built around.
function splitCsvLine(line: string): string[] {
  let out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    let ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

type ArgValue = string | number | boolean;

// `--kebab-case` and `--kebab-case=value` into the camelCase keys of `spec`.
// The spec's value type decides the parse: a boolean key is a bare flag, a
// number key is coerced, anything else takes the next argv entry.
export function parseArgs<T extends Record<string, ArgValue>>(
  argv: string[],
  spec: T,
): T {
  let out: Record<string, ArgValue> = { ...spec };
  let unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--' || !arg.startsWith('--')) {
      continue;
    }
    let key = arg.slice(2);
    let eq = key.indexOf('=');
    let inlineValue: string | undefined;
    if (eq >= 0) {
      inlineValue = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    let name = camel(key);
    // A flag the spec does not define is a typo, and a typo that parses is the
    // worst outcome available: the run proceeds on defaults and reports a
    // number for a test nobody asked for. Collect them all so one run names
    // every mistake rather than one per attempt.
    if (!(name in spec)) {
      unknown.push(`--${key}`);
      continue;
    }
    let value: ArgValue;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else if (typeof spec[name] === 'boolean') {
      value = true;
    } else {
      value = argv[++i];
    }
    out[name] = typeof spec[name] === 'number' ? Number(value) : value;
  }
  if (unknown.length) {
    throw new Error(
      `Unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.join(' ')}\n` +
        `Valid options: ${Object.keys(spec)
          .map((k) => `--${kebab(k)}`)
          .join(' ')}`,
    );
  }
  return out as T;
}

// What the entry points call, for the same reason as `exitIfProduction`: a
// mistyped flag is a decision to stop, not a crash to print a stack for.
export function parseArgsOrExit<T extends Record<string, ArgValue>>(
  argv: string[],
  spec: T,
): T {
  try {
    return parseArgs(argv, spec);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return process.exit(1);
  }
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  let idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function summarize(label: string, samples: number[]): string {
  if (!samples.length) {
    return `${label}: (none)`;
  }
  let s = [...samples].sort((a, b) => a - b);
  let mean = s.reduce((a, b) => a + b, 0) / s.length;
  return (
    `${label}: n=${s.length} ` +
    `p50=${Math.round(percentile(s, 50))}ms ` +
    `p90=${Math.round(percentile(s, 90))}ms ` +
    `p99=${Math.round(percentile(s, 99))}ms ` +
    `max=${Math.round(s[s.length - 1])}ms ` +
    `mean=${Math.round(mean)}ms`
  );
}
