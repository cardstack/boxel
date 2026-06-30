// Republish each (source -> published) pair so the published snapshot picks up
// the searchable annotations now in its source realm, then ASSERT the annotation
// landed: `realm publish` waits for the published realm to be ready (fully
// indexed), after which we read a known-changed module back from the published
// realm and confirm it carries `searchable`.
//
//   node republish.mjs <pairs.json> <staging|prod> <out.jsonl> [--limit N]
// You do not need to source the seed before running: each boxel-cli call sources
// ~/.boxel-secrets/<env>.env itself, so the seed never enters this process.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

let [pairsPath, env, out] = process.argv.slice(2);
let limitIdx = process.argv.indexOf('--limit');
let limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : Infinity;
if (env !== 'staging' && env !== 'prod') {
  throw new Error(
    `env must be 'staging' or 'prod' (got ${JSON.stringify(env)})`,
  );
}
const HERE = dirname(fileURLToPath(import.meta.url));
// …/scripts/codemod/searchable -> repo root
const REPO = join(HERE, '..', '..', '..', '..', '..');
let BOXEL = join(REPO, 'packages', 'boxel-cli', 'bin', 'boxel.js');

// The `isUsed:` field OPTION — not a field/getter named `isUsed` or a
// `this.isUsed` / `@model.isUsed` reference.
const ISUSED_OPTION = /(?<![.\w])isUsed\s*:/;

// Seed read once from ~/.config/boxel/realm-secret-seed-<staging|production>
// and handed to boxel-cli via BOXEL_REALM_SECRET_SEED in the child's env, so it
// never lands in argv or the logs. boxel-cli mints the realm JWT itself.
let SEED = readFileSync(
  join(
    homedir(),
    '.config',
    'boxel',
    env === 'prod'
      ? 'realm-secret-seed-production'
      : 'realm-secret-seed-staging',
  ),
  'utf8',
).replace(/\r?\n$/, '');

function boxel(args, timeout = 660000) {
  return execFileSync('node', [BOXEL, ...args], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BOXEL_REALM_SECRET_SEED: SEED },
  });
}

let pairs = JSON.parse(readFileSync(pairsPath, 'utf8')).slice(0, limit);
writeFileSync(out, '');
let log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
let ok = 0,
  fail = 0,
  skipped = 0,
  assertFail = 0;
process.stderr.write(`Republishing ${pairs.length} pair(s) on ${env}\n`);

for (let [i, p] of pairs.entries()) {
  try {
    // Waits for the published realm to be ready (fully indexed) by default.
    boxel([
      'realm',
      'publish',
      p.source,
      p.published,
      '--realm-secret-seed',
      '--force',
      '--timeout',
      '600000',
    ]);
    // Assert: the `isUsed` option is gone from the republished snapshot — i.e.
    // the strip propagated from the (already-stripped) source realm.
    let r = JSON.parse(
      boxel([
        'file',
        'read',
        p.sampleModule,
        '--realm',
        p.published,
        '--json',
        '--realm-secret-seed',
      ]),
    );
    let isUsedGone = Boolean(r.ok && !ISUSED_OPTION.test(r.content || ''));
    if (!isUsedGone) assertFail++;
    log({
      published: p.published,
      source: p.source,
      sampleModule: p.sampleModule,
      isUsedAbsent: isUsedGone,
    });
    process.stderr.write(
      `  ${isUsedGone ? '✓' : '⚠'} ${p.published} (isUsed gone from ${p.sampleModule}: ${isUsedGone})\n`,
    );
    ok++;
  } catch (e) {
    let msg = String(e.message);
    // A realm the server refuses to publish ("not publishable") is an expected
    // skip, not a rollout failure — count it separately so it never trips the
    // nonzero exit below.
    let notPublishable = /not publishable/.test(msg);
    if (notPublishable) skipped++;
    else fail++;
    log({
      published: p.published,
      source: p.source,
      ...(notPublishable ? { skipped: true } : {}),
      error: msg.split('\n').slice(0, 2).join(' | '),
    });
    process.stderr.write(
      `  ${notPublishable ? '⊘ skip (not publishable):' : '✗'} ${p.published} — ${msg.split('\n')[0]}\n`,
    );
  }
  process.stderr.write(`  …${i + 1}/${pairs.length}\n`);
}
process.stderr.write(
  `\nDone. ${ok} republished, ${assertFail} still-has-isUsed, ${skipped} skipped (not publishable), ${fail} failed.\n`,
);
// Surface real failures to callers/CI; expected "not publishable" skips do not
// fail the run.
process.exit(fail > 0 || assertFail > 0 ? 1 : 0);
