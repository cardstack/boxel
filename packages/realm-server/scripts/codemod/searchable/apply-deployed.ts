// Deployed-realm crawl for the `searchable` migration. For each SOURCE realm
// that has >=1 annotated def, pull its source, run the same apply logic as
// apply-local on the pulled copy, and (dry-run) report the modules that would
// change, or (--write) `boxel file write` only those modules. Published realms
// are handled by updating their source realm + republishing (republish is a
// slow full reindex, so it's a separate phase, --republish).
//
//   node apply-deployed.ts --env staging \
//     --derivation staging.full.derivation.json --registry staging-registry.json \
//     --out report.json [--concurrency 6] [--limit N] [--realm <url>] [--write]
//
// DRY-RUN by default — no realm is modified. The DB read that produced the
// derivation already happened (read-only). This script only pulls (read) +
// reports, until --write is given. boxel-cli reads BOXEL_REALM_SECRET_SEED from
// the environment; source ~/.boxel-secrets/<env>.env before running so the seed
// stays out of argv/logs.

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..'); // packages/realm-server/scripts/codemod/searchable -> repo root
const BOXEL = join(REPO, 'packages', 'boxel-cli', 'bin', 'boxel.js');
const APPLY_LOCAL = join(HERE, 'apply-local.ts');

interface Args {
  env: string;
  derivations: string[];
  registry: string;
  out: string;
  concurrency: number;
  limit?: number;
  realm?: string;
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  let a: any = { derivations: [], concurrency: 6, write: false };
  for (let i = 0; i < argv.length; i++) {
    let f = argv[i];
    if (f === '--write') a.write = true;
    else if (f === '--env') a.env = argv[++i];
    else if (f === '--derivation') a.derivations.push(argv[++i]);
    else if (f === '--registry') a.registry = argv[++i];
    else if (f === '--out') a.out = argv[++i];
    else if (f === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (f === '--limit') a.limit = Number(argv[++i]);
    else if (f === '--realm') a.realm = argv[++i];
    else throw new Error(`unknown arg: ${f}`);
  }
  if (!a.env || a.derivations.length === 0 || !a.registry || !a.out) {
    throw new Error(
      'usage: --env <staging|prod> --derivation <json>… --registry <json> --out <report> [--concurrency N] [--limit N] [--realm url] [--write]',
    );
  }
  return a;
}

// run a boxel-cli subcommand with the env-file seed sourced inside a bash -c so
// the seed never lands in this process's argv/env/logs.
function boxel(env: string, args: string[], timeoutMs = 240000): string {
  let quoted = args.map((x) => `'${x.replace(/'/g, `'\\''`)}'`).join(' ');
  let cmd = `set -a; . "$HOME/.boxel-secrets/${env}.env"; set +a; exec node ${JSON.stringify(BOXEL)} ${quoted}`;
  return execFileSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Which source realms have >=1 annotated def? Match annotated defKeys (https)
// to the source realm whose URL is a prefix. @cardstack/<realm> keys are
// repo-handled, skipped.
function realmsWithChanges(
  derivations: string[],
  sourceUrls: string[],
): Map<string, number> {
  let sorted = [...sourceUrls].sort((a, b) => b.length - a.length); // longest-prefix-first
  let counts = new Map<string, number>();
  for (let path of derivations) {
    let { defs } = JSON.parse(readFileSync(path, 'utf8')) as { defs: any[] };
    for (let d of defs) {
      if (!d.fields || Object.keys(d.fields).length === 0) continue;
      if (typeof d.defKey !== 'string' || !d.defKey.startsWith('http'))
        continue;
      let realm = sorted.find((u) => d.defKey.startsWith(u));
      if (realm) counts.set(realm, (counts.get(realm) ?? 0) + 1);
    }
  }
  return counts;
}

// Pull realm source, snapshot via git, run apply-local --write on the copy,
// return the list of changed module paths (realm-relative).
function changedModulesForRealm(
  env: string,
  realmUrl: string,
  derivations: string[],
): string[] {
  let dir = mkdtempSync(join(tmpdir(), 'searchable-realm-'));
  try {
    boxel(env, ['realm', 'pull', realmUrl, dir]);
    // `realm pull` leaves a `.boxel-history` checkpoint dir that is itself a git
    // repo — drop it so our snapshot doesn't treat it as a submodule. (apply-local
    // already ignores dot-dirs, so it never participates in the rewrite.)
    rmSync(join(dir, '.boxel-history'), { recursive: true, force: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=x@x',
        '-c',
        'user.name=x',
        'commit',
        '-qm',
        'snap',
        '--allow-empty',
      ],
      { cwd: dir },
    );
    let derivArgs: string[] = [];
    for (let d of derivations) derivArgs.push('--derivation', d);
    execFileSync(
      'node',
      [
        APPLY_LOCAL,
        '--realm-root',
        dir,
        '--realm-url',
        realmUrl,
        ...derivArgs,
        '--write',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    let out = execFileSync('git', ['diff', '--name-only'], {
      cwd: dir,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  let registry = JSON.parse(readFileSync(args.registry, 'utf8')) as {
    url: string;
    kind: string;
    source_url: string | null;
  }[];
  let sourceUrls = registry
    .filter((r) => r.kind === 'source')
    .map((r) => r.url);
  // source realm -> its published copies (for republish planning)
  let publishedBySource = new Map<string, string[]>();
  for (let r of registry) {
    if (r.kind === 'published' && r.source_url) {
      let list = publishedBySource.get(r.source_url) ?? [];
      list.push(r.url);
      publishedBySource.set(r.source_url, list);
    }
  }

  let counts = realmsWithChanges(args.derivations, sourceUrls);
  let realms = args.realm
    ? [args.realm]
    : [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
  if (args.limit) realms = realms.slice(0, args.limit);

  writeFileSync(args.out, '');
  let log = (obj: any) => appendFileSync(args.out, JSON.stringify(obj) + '\n');
  process.stderr.write(
    `Crawling ${realms.length} realm(s), concurrency ${args.concurrency}, write=${args.write}\n`,
  );

  let idx = 0;
  let changedRealms = 0;
  let failed = 0;
  let done = 0;
  async function worker() {
    while (idx < realms.length) {
      let realmUrl = realms[idx++];
      try {
        let changed = changedModulesForRealm(
          args.env,
          realmUrl,
          args.derivations,
        );
        let published = publishedBySource.get(realmUrl) ?? [];
        if (changed.length > 0) changedRealms++;
        log({
          realm: realmUrl,
          annotatedDefs: counts.get(realmUrl) ?? null,
          changedModules: changed,
          publishedCopies: published,
        });
        if (changed.length > 0) {
          process.stderr.write(
            `  ✓ ${realmUrl} — ${changed.length} module(s)${published.length ? ` (+${published.length} published)` : ''}\n`,
          );
        }
      } catch (err) {
        failed++;
        log({
          realm: realmUrl,
          error: (err as Error).message.split('\n').slice(0, 3).join(' | '),
        });
        process.stderr.write(
          `  ✗ ${realmUrl} — ${(err as Error).message.split('\n')[0]}\n`,
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
    `\nDone. ${realms.length} realms scanned, ${changedRealms} would change, ${failed} failed. Report: ${args.out}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
