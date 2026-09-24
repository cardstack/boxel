#!/usr/bin/env node
// Stand a realm up on a non-production realm server as the first user in the
// credential file, push its contents, and wait for the index.
//
//   node setup-realm.ts --csv ./accounts.csv --source ../some-realm-checkout
//   node setup-realm.ts --csv … --source … --realm-name load-test --skip-push
//
// It also puts the other credential rows on the realm: read for all of them,
// and write for the first `--write-grants` (one by default). The write grant
// is what lets a run drive two identities against one realm, which is the only
// shape in which the per-realm indexing lane can be measured — see
// `lib/fairness.ts`.
//
// Realm creation and the push go through the `boxel` CLI, which owns the upload
// protocol and its conflict handling. Everything after that talks HTTP directly.
// So creating and pushing need the CLI on PATH and run from a workstation
// rather than from the in-region box the driver runs on — but `--grants-only`
// does the grants alone and needs no CLI, which is what makes it reachable
// from that box, where a run refuses to start over a missing grant.
// (`--skip-push` skips only the push: it still runs `boxel profile`,
// `realm create` and `wait-for-ready`.)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authenticate, realmAuthHeader } from './lib/auth.ts';
import {
  DEFAULTS,
  ensureTrailingSlash,
  exitIfProduction,
  parseArgsOrExit,
  readCredentials,
} from './lib/common.ts';
import {
  grantRealmPermissions,
  matrixDomainFor,
  readRealmPermissions,
  matrixIdFor,
  type RealmPermission,
  type RealmPermissions,
} from './lib/permissions.ts';

let args = parseArgsOrExit(process.argv.slice(2), {
  csv: '',
  source: '',
  realmName: 'load-test',
  displayName: 'Load Test',
  matrixUrl: DEFAULTS.matrixUrl,
  realmServerUrl: DEFAULTS.realmServerUrl,
  // The server part of a Matrix ID. Derived from the Matrix URL by stripping a
  // leading `matrix…` label, which is how the deployed environments are named;
  // pass it explicitly for anything that does not follow that convention.
  matrixDomain: '',
  skipPush: false,
  // Do nothing but the grants: no profile switch, no create, no push, no wait.
  //
  // This is the only step that needs no `boxel` CLI, and it is the one an
  // operator reaches for after a run refuses to start because a writer cannot
  // write — which happens on the in-region box, where there is no CLI and no
  // checkout. Takes the realm URL from `--realm`, else derives it the same way
  // the create step does.
  grantsOnly: false,
  // The realm to grant on, for `--grants-only` against a realm whose URL does
  // not follow `<realm server>/<owner>/<realm name>/`.
  realm: '',
  // How many of the non-owner rows are granted `write` as well as `read`.
  //
  // One by default, because a realm with a single writing identity cannot
  // produce the contention the fairness half of a run is about: the lane is
  // per realm, so two writers have to be two *people* for "did this write wait
  // on somebody else's indexing" to have an answer. `0` grants read only,
  // which is what every run before cross-writer measurement needed.
  writeGrants: 1,
  // Skip the permission grants entirely, for a realm whose access is managed
  // somewhere else.
  skipGrants: false,
  dryRun: false,
});

if (!args.csv) {
  console.error(
    'Usage: node setup-realm.ts --csv <accounts.csv> --source <realm-directory>',
  );
  process.exit(1);
}
// `--realm` is the target of a mutating PATCH, so it is guarded like the other
// two. run-load.ts already passes its own `--realm` here; without this the two
// entry points disagree about whether a realm URL is a guarded target, and
// `--grants-only --realm <production>` would get past the guard and into the
// fetch. The guard refuses ahead of the attempt on purpose, and has no
// override, because these targets are typed by hand under time pressure.
exitIfProduction(args.matrixUrl, args.realmServerUrl, args.realm);

if (args.grantsOnly && args.skipGrants) {
  console.error('--grants-only and --skip-grants leave nothing to do.');
  process.exit(1);
}

let source = resolve(args.source);
if (
  !args.grantsOnly &&
  !args.skipPush &&
  (!args.source || !existsSync(source))
) {
  console.error(`Source realm directory not found: ${source}`);
  process.exit(1);
}

let creds = readCredentials(resolve(args.csv));
// One user owns the realm and the rest read it. Taking the first row keeps the
// owner stable across re-runs.
let owner = creds[0];
console.log(`Owner: ${owner.username}  (${creds.length} credentials in file)`);

// The Matrix ID the realm has to end up owned by.
let matrixDomain = args.matrixDomain || matrixDomainFor(args.matrixUrl);
let ownerMatrixId = matrixIdFor(owner.username, matrixDomain);
let ownerLocalpart = ownerMatrixId.replace(/^@/, '').split(':')[0];

// MATRIX_USERNAME / MATRIX_PASSWORD do not authenticate a CLI invocation. They
// are read only by `profile migrate`, which imports them into the saved profile
// store; every other command authenticates as whichever profile is *active*.
// Setting them and running `realm create` silently creates the realm under
// whoever was already signed in. So: import the credential, make it active,
// then verify the realm landed where it was meant to.
let env = {
  ...process.env,
  MATRIX_URL: args.matrixUrl,
  REALM_SERVER_URL: args.realmServerUrl,
  MATRIX_USERNAME: ownerLocalpart,
  MATRIX_PASSWORD: owner.password,
};

function boxel(argv: string[], { allowFailure = false } = {}) {
  console.log(`\n$ boxel ${argv.join(' ')}`);
  if (args.dryRun) {
    return { status: 0, stdout: '' };
  }
  let result = spawnSync('boxel', argv, {
    env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.status !== 0 && !allowFailure) {
    console.error(
      `\nboxel ${argv[0]} ${argv[1] ?? ''} exited ${result.status}`,
    );
    process.exit(result.status ?? 1);
  }
  return result;
}

// The URL a realm of this name under this owner has, which is also the shape
// `realm create` reports back. `--grants-only` never runs the CLI, so it takes
// this derivation or an explicit `--realm`.
function derivedRealmUrl(): string {
  return `${args.realmServerUrl.replace(/\/$/, '')}/${ownerLocalpart}/${args.realmName}/`;
}

// The CLI colours its output, so the URL it prints carries SGR escapes that
// would otherwise end up inside the realm URL. `\p{Cc}` matches the escape by
// Unicode category rather than as a literal control character in the pattern.
const ANSI_SGR = /\p{Cc}\[[0-9;]*m/gu;

// Steps 1-4 are the CLI's: it owns the upload protocol and its conflict
// handling. `--grants-only` skips all of them, which is what makes the grant
// reachable from a box that has no CLI and no checkout.
function createPushAndIndex(): string {
  // 1. Make the credential file's owner the active profile. `migrate` reads
  // the env vars above and registers the profile; `switch` makes it the
  // identity every subsequent command runs as.
  boxel(['profile', 'migrate'], { allowFailure: true });
  boxel(['profile', 'switch', ownerMatrixId]);

  // 2. Create. Allowed to fail: re-running setup against an existing realm is
  // normal, and the realm URL is derivable either way.
  let create = boxel(['realm', 'create', args.realmName, args.displayName], {
    allowFailure: true,
  });

  let realmUrl = ensureTrailingSlash(
    (create.stdout ?? '')
      .match(/(https?:\/\/\S+?)\s*$/m)?.[1]
      ?.replace(ANSI_SGR, '') ?? derivedRealmUrl(),
  );
  console.log(`\nRealm URL: ${realmUrl}`);

  // Verify the realm landed under the intended owner. A realm created under
  // the wrong user looks entirely successful otherwise, and is noticed only
  // later by reading the URL — by which point a run has already authorized
  // against a realm nobody else can see.
  if (!args.dryRun && !realmUrl.includes(`/${ownerLocalpart}/`)) {
    console.error(
      `\nRealm was created under a different user than intended.\n` +
        `  expected owner: ${ownerLocalpart}\n` +
        `  realm URL:      ${realmUrl}\n\n` +
        `The active boxel profile is not ${ownerMatrixId}. Check 'boxel profile list',\n` +
        `then re-run. Remove the wrongly-owned realm with 'boxel realm remove' first\n` +
        `if it was created.`,
    );
    process.exit(1);
  }

  // 3. Push. `--delete` makes the realm match the source exactly, so a re-run
  // after editing card code does not leave the old module behind.
  if (!args.skipPush) {
    boxel(['realm', 'push', source, realmUrl, '--delete']);
  }

  // 4. Wait for the index. Measuring before this finishes measures indexing.
  boxel(['realm', 'wait-for-ready', '--realm', realmUrl]);
  return realmUrl;
}

let realmUrl = args.grantsOnly
  ? ensureTrailingSlash(args.realm || derivedRealmUrl())
  : createPushAndIndex();
if (args.grantsOnly) {
  console.log(`\nRealm URL: ${realmUrl}`);
}

// 5. Put the other credential rows on the realm.
//
// Every simulated session authenticates as its own user — searches authorize
// per realm and realm events are broadcast into each user's own session room,
// so one shared account reproduces neither — and none of them can reach a
// realm they have no grant on. This is not exposed as a `boxel realm`
// subcommand, but the realm answers `PATCH /_permissions` to its owner, so it
// is a request rather than the UI step this script used to leave behind.
//
// The write grants are what make a cross-writer run possible at all. A realm's
// write permission belongs to its owner, so before this every write in a run
// came from one identity, and "did this write wait on somebody else's
// indexing" had no way to be asked.
//
// `realm-owner` is neither granted nor modifiable through that endpoint — the
// realm refuses both — so this can hand out access but never the realm.
async function grantAccess(): Promise<void> {
  let others = creds.slice(1);
  if (others.length === 0) {
    console.log('\nOnly one credential row, so there is nobody to grant.');
    return;
  }
  // `parseArgs` coerces with `Number()`, so a typo arrives as NaN — and every
  // comparison against NaN is false, so it would slip through both the clamp
  // and the notice below and grant everyone read-only with no error. That is
  // precisely the single-identity run the rest of this work exists to make
  // impossible, arriving silently through the one flag whose job is to prevent
  // it.
  if (!Number.isFinite(args.writeGrants) || args.writeGrants < 0) {
    console.error(
      `--write-grants must be a non-negative number (parsed as ` +
        `${args.writeGrants}). A non-numeric value reaches here as NaN, and ` +
        `every\n  comparison against NaN is false — so left unchecked it would ` +
        `grant everyone\n  read-only and say nothing.`,
    );
    process.exit(1);
  }
  let writeGrants = Math.max(0, Math.min(args.writeGrants, others.length));
  if (args.writeGrants > others.length) {
    console.log(
      `\n--write-grants ${args.writeGrants} exceeds the ${others.length} non-owner rows; ` +
        `granting write to all of them.`,
    );
  }
  let grants: RealmPermissions = {};
  others.forEach((row, i) => {
    let permissions: RealmPermission[] =
      i < writeGrants ? ['read', 'write'] : ['read'];
    grants[matrixIdFor(row.username, matrixDomain)] = permissions;
  });
  console.log(
    `\nGranting on ${realmUrl}:\n` +
      Object.entries(grants)
        .map(([user, permissions]) => `  ${user}  ${permissions!.join(', ')}`)
        .join('\n'),
  );
  if (args.dryRun) {
    return;
  }
  // As the owner: only they may read or patch a realm's permissions.
  let session = await authenticate({
    matrixUrl: args.matrixUrl,
    realmServerUrl: args.realmServerUrl,
    username: ownerLocalpart,
    password: owner.password,
  });
  let authorization = realmAuthHeader(session, realmUrl);
  // Read before writing, so the output says what CHANGED rather than what was
  // asked for. A re-run against a realm already granted is the common case —
  // `--grants-only` exists for retries — and "granted" printed over a no-op
  // reads as the fix having been applied when nothing moved.
  let before = await readRealmPermissions({ realmUrl, authorization });
  let after = await grantRealmPermissions({ realmUrl, authorization, grants });
  let changed = Object.keys(grants).filter(
    (user) =>
      (before[user] ?? []).slice().sort().join(',') !==
      (after[user] ?? []).slice().sort().join(','),
  );
  console.log(
    changed.length
      ? `Granted; changed: ${changed.join(', ')}.`
      : `Granted; no change — these accounts already had these permissions.`,
  );
}

if (!args.skipGrants) {
  try {
    await grantAccess();
  } catch (e) {
    console.error(
      `\nGranting access failed: ${e instanceof Error ? e.message : String(e)}\n` +
        `The realm itself is ready. Re-run with --grants-only --realm ${realmUrl}\n` +
        `to retry just the grants — that path needs no boxel CLI — or pass\n` +
        `--skip-grants if access is managed elsewhere.`,
    );
    process.exit(1);
  }
}

console.log(`
Realm is ready.

  ${realmUrl}

  node run-load.ts --csv ${args.csv} --realm ${realmUrl} --workload <workload.json>
`);
