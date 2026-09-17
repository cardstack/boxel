#!/usr/bin/env node
// Stand a realm up on a non-production realm server as the first user in the
// credential file, push its contents, and wait for the index.
//
//   node setup-realm.ts --csv ./accounts.csv --source ../some-realm-checkout
//   node setup-realm.ts --csv … --source … --realm-name load-test --skip-push
//
// Realm creation and the push go through the `boxel` CLI, which owns the upload
// protocol and its conflict handling. Everything after that talks HTTP directly.
//
// Unlike the driver, this step needs the `boxel` CLI on PATH, so it is run from
// a workstation rather than from the in-region box the driver runs on.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULTS,
  ensureTrailingSlash,
  exitIfProduction,
  parseArgsOrExit,
  readCredentials,
} from './lib/common.ts';

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
  dryRun: false,
});

if (!args.csv) {
  console.error(
    'Usage: node setup-realm.ts --csv <accounts.csv> --source <realm-directory>',
  );
  process.exit(1);
}
exitIfProduction(args.matrixUrl, args.realmServerUrl);

let source = resolve(args.source);
if (!args.skipPush && (!args.source || !existsSync(source))) {
  console.error(`Source realm directory not found: ${source}`);
  process.exit(1);
}

let creds = readCredentials(resolve(args.csv));
// One user owns the realm and the rest read it. Taking the first row keeps the
// owner stable across re-runs.
let owner = creds[0];
console.log(`Owner: ${owner.username}  (${creds.length} credentials in file)`);

// The Matrix ID the realm has to end up owned by.
let matrixDomain =
  args.matrixDomain ||
  new URL(args.matrixUrl).host.replace(/^matrix[^.]*\./, '');
let ownerMatrixId = owner.username.startsWith('@')
  ? owner.username
  : `@${owner.username}:${matrixDomain}`;
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

// 1. Make the credential file's owner the active profile. `migrate` reads the
// env vars above and registers the profile; `switch` makes it the identity
// every subsequent command runs as.
boxel(['profile', 'migrate'], { allowFailure: true });
boxel(['profile', 'switch', ownerMatrixId]);

// 2. Create. Allowed to fail: re-running setup against an existing realm is
// normal, and the realm URL is derivable either way.
let create = boxel(['realm', 'create', args.realmName, args.displayName], {
  allowFailure: true,
});

// The CLI colours its output, so the URL it prints carries SGR escapes that
// would otherwise end up inside the realm URL. `\p{Cc}` matches the escape by
// Unicode category rather than as a literal control character in the pattern.
const ANSI_SGR = /\p{Cc}\[[0-9;]*m/gu;

let realmUrl = ensureTrailingSlash(
  (create.stdout ?? '')
    .match(/(https?:\/\/\S+?)\s*$/m)?.[1]
    ?.replace(ANSI_SGR, '') ??
    `${args.realmServerUrl.replace(/\/$/, '')}/${ownerLocalpart}/${args.realmName}/`,
);
console.log(`\nRealm URL: ${realmUrl}`);

// Verify the realm landed under the intended owner. A realm created under the
// wrong user looks entirely successful otherwise, and is noticed only later by
// reading the URL — by which point a run has already authorized against a realm
// nobody else can see.
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

console.log(`
Realm is ready.

  ${realmUrl}

Next: grant the other ${creds.length - 1} users read access to this realm, then

  node run-load.ts --csv ${args.csv} --realm ${realmUrl} --workload <workload.json>

Read access is not exposed as a 'boxel realm' subcommand, so it is a UI step or
a direct API call. Each simulated session authenticates as its own user:
searches authorize per realm and realm events are broadcast into each user's own
session room, so one shared account reproduces neither.
`);
