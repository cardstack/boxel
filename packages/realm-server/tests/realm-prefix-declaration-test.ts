import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { fileURLToPath } from 'url';

import { PREFIX_REALM_PREFIXES } from '@cardstack/runtime-common';

// The realm-server learns its realm-prefix mappings from `--fromUrl`/`--toUrl`
// arguments, while the host bakes its own set in from build config. Nothing in
// either mechanism keeps the two equal, and `internalKeyFor` resolves module
// references through whichever set the process has — so the host's prerender
// can write the definitions cache under keys the realm-server never produces.
// `PREFIX_REALMS` is the one declaration of that set; these tests hold the
// launch arguments to it, so a realm gained or lost on one side cannot ship
// quietly.
const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');

// Every launcher that passes `--fromUrl`, in any environment: the deploy
// scripts, the mise service tasks, and the two test harnesses that build their
// own argument lists.
const LAUNCH_SCRIPTS = [
  'packages/realm-server/scripts/start-production.sh',
  'packages/realm-server/scripts/start-staging.sh',
  'packages/realm-server/scripts/start-worker-production.sh',
  'packages/realm-server/scripts/start-worker-staging.sh',
  'mise-tasks/services/realm-server',
  'mise-tasks/services/realm-server-base',
  'mise-tasks/services/test-realms',
  'mise-tasks/services/worker',
  'mise-tasks/services/worker-base',
  'mise-tasks/services/worker-test',
  'packages/matrix/support/isolated-realm-server.ts',
  'packages/realm-test-harness/src/isolated-realm-stack.ts',
];

// Production is the environment whose set must be complete. The others are
// allowed to run a subset — `worker-test` deliberately starts only the realms
// its tests need — but none of them may introduce a prefix nothing declares.
const COMPLETE_SCRIPTS = [
  'packages/realm-server/scripts/start-production.sh',
  'packages/realm-server/scripts/start-worker-production.sh',
];

// `main.ts` derives a prefix from a `--fromUrl` two ways, and this mirrors both:
// a value already in prefix form is registered as-is, and a
// `https://cardstack.com/X/` alias additionally registers `@cardstack/X/`. Any
// other URL maps to itself and contributes no prefix.
const CARDSTACK_ALIAS = /^https:\/\/cardstack\.com\/([^/]+)\/$/;

// A `--fromUrl` value may be quoted on its own, or bare because the whole
// argument is the quoted thing (`'--fromUrl=https://…'`, as the test harnesses
// write it). The bare form stops at whatever delimiter follows it, so a value
// interpolated from a variable is read as the literal `${…}` and contributes no
// prefix — which is what the per-script floor below exists to catch.
const FROM_URL = /--fromUrl=(?:'([^']*)'|"([^"]*)"|([^'"`,\s\\]+))/g;

function declaredPrefixes(scriptPath: string): string[] {
  let contents = readFileSync(join(REPO_ROOT, scriptPath), 'utf8');
  let values = [...contents.matchAll(FROM_URL)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
  let prefixes = new Set<string>();
  for (let value of values) {
    if (value.startsWith('@')) {
      prefixes.add(value);
      continue;
    }
    let alias = CARDSTACK_ALIAS.exec(value);
    if (alias) {
      prefixes.add(`@cardstack/${alias[1]}/`);
    }
  }
  return [...prefixes].sort();
}

module(basename(import.meta.filename), function () {
  test('no launch script registers an undeclared realm prefix', function (assert) {
    for (let script of LAUNCH_SCRIPTS) {
      let prefixes = declaredPrefixes(script);
      // A script the scan reads nothing out of would satisfy the loop below
      // vacuously, so the guard would switch itself off — silently — the next
      // time one of these files changes how it spells its arguments. Every
      // launcher mounts at least the base realm, so a floor of one is a real
      // property rather than a formality.
      assert.true(
        prefixes.length > 0,
        `${script} yields at least one prefix (the scan can still read it)`,
      );
      for (let prefix of prefixes) {
        assert.true(
          PREFIX_REALM_PREFIXES.includes(prefix),
          `${script} passes ${prefix}, which PREFIX_REALMS declares`,
        );
      }
    }
  });

  test('the production scripts register every declared realm prefix', function (assert) {
    for (let script of COMPLETE_SCRIPTS) {
      assert.deepEqual(
        declaredPrefixes(script),
        [...PREFIX_REALM_PREFIXES].sort(),
        `${script} covers the whole declared set`,
      );
    }
  });

  test('a prefix is spelled as a scoped namespace with a trailing slash', function (assert) {
    // `isRegisteredPrefix` tests `startsWith`, and the `@` leader is what tells
    // identifier-classifying code (`isRelativePath`, `isLocalId`) that a value
    // is a prefix rather than a URL or a relative path. A prefix missing either
    // property would be silently misread rather than rejected.
    for (let prefix of PREFIX_REALM_PREFIXES) {
      assert.true(prefix.startsWith('@'), `${prefix} is scoped`);
      assert.true(prefix.endsWith('/'), `${prefix} ends with a slash`);
    }
  });
});
