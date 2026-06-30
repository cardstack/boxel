// Deployed-realm crawl that strips the `isUsed` field option from every hosted
// realm whose source carries it. Source is read from the read-only EFS mount
// (the aws-access fs-explorer SSM tunnel — a Caddy file-server), each affected
// module is rewritten in-process with the searchable codemod's strip-only
// transform, and the changed modules are written back with boxel-cli
// `file write` (which mints its own realm JWT from the secret seed) and then
// read back to confirm the write round-tripped.
//
//   node apply-deployed.ts --env staging \
//     --efs-base http://localhost:58080 \
//     --hits staging-userland-isused.json \
//     --out report.jsonl [--write] [--concurrency 6] [--limit N] [--realm <url>]
//
// DRY-RUN by default — no realm is modified; it reads from EFS, runs the strip,
// and reports the modules that would change. Pass --write to write them back.
//
// `--hits` is the scan report from `scan-deployed-isused.mjs` listing the EFS
// paths that contain `isUsed` (objects with a `path` like
// `/realms/<user>/<realm>/<module>`). Published copies (paths under
// `/realms/_published/`) are skipped here — they pick up the strip when their
// source realm is republished, not by a direct write.
//
// The seed is read from ~/.config/boxel/realm-secret-seed-staging (for --env
// staging) or ~/.config/boxel/realm-secret-seed-production (for --env prod) and
// handed to boxel-cli via BOXEL_REALM_SECRET_SEED in the child's env, so it
// never lands in this process's argv or the logs.

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { transformSearchable } from './transform.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..'); // packages/realm-server/scripts/codemod/searchable -> repo root
const BOXEL = join(REPO, 'packages', 'boxel-cli', 'bin', 'boxel.js');

// Realm-server origin per environment. A user realm at EFS
// `/realms/<user>/<realm>/` is served at `<origin>/<user>/<realm>/`.
const ORIGIN: Record<string, string> = {
  staging: 'https://realms-staging.stack.cards',
  prod: 'https://app.boxel.ai',
};

// Matches the `isUsed:` field OPTION (an object-literal property) — not a field
// or getter named `isUsed` (`@field isUsed = …`, `get isUsed()`), nor a
// `this.isUsed` / `@model.isUsed` reference. Used to tell a real leftover
// annotation from a coincidental identifier when deciding clean vs. not.
const ISUSED_OPTION = /(?<![.\w])isUsed\s*:/;
const SEED_FILE: Record<string, string> = {
  staging: 'realm-secret-seed-staging',
  prod: 'realm-secret-seed-production',
};

interface Args {
  env: 'staging' | 'prod';
  efsBase: string;
  hits: string;
  out: string;
  concurrency: number;
  limit?: number;
  realm?: string;
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  let a: any = { concurrency: 6, write: false };
  for (let i = 0; i < argv.length; i++) {
    let f = argv[i];
    if (f === '--write') a.write = true;
    else if (f === '--env') a.env = argv[++i];
    else if (f === '--efs-base') a.efsBase = argv[++i];
    else if (f === '--hits') a.hits = argv[++i];
    else if (f === '--out') a.out = argv[++i];
    else if (f === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (f === '--limit') a.limit = Number(argv[++i]);
    else if (f === '--realm') a.realm = argv[++i];
    else throw new Error(`unknown arg: ${f}`);
  }
  if (a.env !== 'staging' && a.env !== 'prod') {
    throw new Error(
      `--env must be 'staging' or 'prod' (got ${JSON.stringify(a.env)})`,
    );
  }
  if (!a.efsBase || !a.hits || !a.out) {
    throw new Error(
      'usage: --env <staging|prod> --efs-base <url> --hits <scan.json> --out <report.jsonl> [--write] [--concurrency N] [--limit N] [--realm url]',
    );
  }
  if (!Number.isFinite(a.concurrency) || a.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  if (a.limit !== undefined && (!Number.isFinite(a.limit) || a.limit < 1)) {
    throw new Error('--limit must be a positive number');
  }
  return a;
}

// Read the env's realm secret seed once. boxel-cli reads it from
// BOXEL_REALM_SECRET_SEED (and mints the JWT itself); we strip a trailing
// newline so an editor-saved seed file still authenticates.
function readSeed(env: string): string {
  let p = join(homedir(), '.config', 'boxel', SEED_FILE[env]);
  return readFileSync(p, 'utf8').replace(/\r?\n$/, '');
}

// Run a boxel-cli subcommand with the seed supplied via the child's env only —
// never on argv, never logged.
function boxel(seed: string, args: string[], timeoutMs = 240000): string {
  return execFileSync('node', [BOXEL, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BOXEL_REALM_SECRET_SEED: seed },
  });
}

// Write one module via boxel-cli `file write` (content through a temp file).
function writeRealmFile(
  seed: string,
  realmUrl: string,
  relPath: string,
  content: string,
): void {
  let dir = mkdtempSync(join(tmpdir(), 'isused-write-'));
  let tmp = join(dir, 'content');
  try {
    writeFileSync(tmp, content);
    boxel(seed, [
      'file',
      'write',
      relPath,
      '--realm',
      realmUrl,
      '--file',
      tmp,
      '--realm-secret-seed',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Read one module back via boxel-cli `file read --json`. Returns the content,
// or null if the file isn't there.
function readRealmFile(
  seed: string,
  realmUrl: string,
  relPath: string,
): string | null {
  let out = boxel(seed, [
    'file',
    'read',
    relPath,
    '--realm',
    realmUrl,
    '--json',
    '--realm-secret-seed',
  ]);
  let parsed = JSON.parse(out);
  return parsed.ok ? (parsed.content ?? null) : null;
}

// Read a module's source straight off the read-only EFS mount (Caddy file
// server over the SSM tunnel). Retries a few times so a transient tunnel hiccup
// doesn't drop a realm.
async function efsRead(efsBase: string, efsPath: string): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      let res = await fetch(efsBase + efsPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`EFS read ${efsPath} failed: ${(last as Error)?.message}`);
}

interface FileTarget {
  efsPath: string;
  relPath: string;
}

// Group the scan's hit paths into the realms they belong to, skipping published
// copies (republished, not directly written).
function realmsFromHits(
  hitsPath: string,
  origin: string,
): Map<string, FileTarget[]> {
  let payload = JSON.parse(readFileSync(hitsPath, 'utf8')) as {
    hits?: { path: string }[];
  };
  let byRealm = new Map<string, FileTarget[]>();
  for (let { path } of payload.hits ?? []) {
    let segs = path.split('/').filter(Boolean); // realms / <user> / <realm> / <rel...>
    if (segs[0] !== 'realms' || segs.length < 4) continue;
    if (segs[1] === '_published') continue; // republished separately
    let [, user, realm, ...rest] = segs;
    let realmUrl = `${origin}/${user}/${realm}/`;
    let relPath = rest.join('/');
    let list = byRealm.get(realmUrl);
    if (!list) byRealm.set(realmUrl, (list = []));
    list.push({ efsPath: path, relPath });
  }
  return byRealm;
}

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  // Seed only needed to write; a dry-run reads from EFS and never authenticates.
  let seed = args.write ? readSeed(args.env) : '';
  let origin = ORIGIN[args.env];

  let byRealm = realmsFromHits(args.hits, origin);
  let realms = args.realm ? [args.realm] : [...byRealm.keys()].sort();
  if (args.limit) realms = realms.slice(0, args.limit);

  writeFileSync(args.out, '');
  let log = (obj: any) => appendFileSync(args.out, JSON.stringify(obj) + '\n');
  process.stderr.write(
    `${args.env}: ${realms.length} realm(s) with isUsed, concurrency ${args.concurrency}, write=${args.write}\n`,
  );

  let idx = 0;
  let changedRealms = 0;
  let strippedModules = 0;
  let noopModules = 0;
  let unstrippedModules = 0;
  let failed = 0;
  let done = 0;

  async function worker() {
    while (idx < realms.length) {
      let realmUrl = realms[idx++];
      let targets = byRealm.get(realmUrl) ?? [];
      let stripped: string[] = [];
      let noop: string[] = [];
      // `isUsed` survived the transform: it sits in non-literal field options
      // (`const o = { isUsed: true }; linksTo(X, o)`) or another form the codemod
      // can't statically rewrite (these land in `result.skipped`). This is NOT a
      // no-op — the annotation is still there, so it's surfaced for manual
      // handling and the file is left untouched rather than half-written.
      let unstripped: string[] = [];
      let errors: string[] = [];
      for (let { efsPath, relPath } of targets) {
        try {
          let before = await efsRead(args.efsBase, efsPath);
          let result = transformSearchable(before, {
            filename: relPath,
            policyForClass: () => undefined, // strip-only: never add searchable
            stripIsUsed: true,
          });
          let changed =
            result.status === 'transformed' && result.output !== before;
          let after = changed ? result.output : before;
          if (ISUSED_OPTION.test(after)) {
            let where = result.skipped.length
              ? ` (${result.skipped.map((s) => `${s.className ?? '?'}.${s.fieldName}`).join(', ')})`
              : '';
            unstripped.push(relPath + where);
            unstrippedModules++;
            continue;
          }
          if (!changed) {
            // No `isUsed` present — genuinely clean (already stripped / stale hit).
            noop.push(relPath);
            noopModules++;
            continue;
          }
          if (args.write) {
            writeRealmFile(seed, realmUrl, relPath, result.output);
            let readBack = readRealmFile(seed, realmUrl, relPath);
            if (readBack !== result.output) {
              throw new Error(`verify ${relPath}: write did not round-trip`);
            }
          }
          stripped.push(relPath);
          strippedModules++;
        } catch (err) {
          errors.push(`${relPath}: ${(err as Error).message.split('\n')[0]}`);
          failed++;
        }
      }
      if (stripped.length > 0) changedRealms++;
      log({
        realm: realmUrl,
        stripped,
        noop,
        unstripped: unstripped.length ? unstripped : undefined,
        errors: errors.length ? errors : undefined,
        written: args.write ? stripped : undefined,
      });
      if (stripped.length > 0 || errors.length > 0 || unstripped.length > 0) {
        process.stderr.write(
          `  ${errors.length || unstripped.length ? '✗' : '✓'} ${realmUrl} — ${stripped.length} module(s)${args.write ? ' WRITTEN' : ' would strip'}${unstripped.length ? `, ${unstripped.length} STILL has isUsed` : ''}${errors.length ? `, ${errors.length} error(s)` : ''}\n`,
        );
      }
      done++;
      if (done % 25 === 0)
        process.stderr.write(`  …${done}/${realms.length}\n`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, () => worker()),
  );

  process.stderr.write(
    `\nDone. ${realms.length} realms, ${changedRealms} ${args.write ? 'changed' : 'would change'}, ${strippedModules} module(s) ${args.write ? 'stripped' : 'to strip'}, ${noopModules} no-op, ${unstrippedModules} still-has-isUsed, ${failed} failed. Report: ${args.out}\n`,
  );
  // A leftover `isUsed` (unstripped) means the realm isn't clean yet, so it
  // fails the run just like a hard error.
  if (failed > 0 || unstrippedModules > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
