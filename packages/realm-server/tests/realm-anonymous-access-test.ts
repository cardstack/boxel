import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { writeFileSync } from 'fs';
import type { Test, SuperTest } from 'supertest';
import {
  DEFAULT_ANONYMOUS_RATE_LIMIT,
  logger,
  parseIP,
  rangesContain,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  realmConfigCardJSON,
  setupPermissionedRealmCached,
} from './helpers/index.ts';

const REALM_NAME = 'Anonymous Access Test Realm';
const BLOCKED = '192.0.2.10';
const BLOCKED_RANGE = '198.51.100.0/24';

// Every warning the realm logs while `fn` runs, at `warn` or louder whatever
// LOG_LEVELS says.
async function realmWarningsDuring(fn: () => Promise<void>): Promise<string[]> {
  let log = logger('realm');
  let warnings: string[] = [];
  let originalFactory = log.methodFactory;
  let originalLevel = log.getLevel();
  log.methodFactory = (methodName, level, loggerName) => {
    let raw = originalFactory(methodName, level, loggerName);
    return (...args: unknown[]) => {
      if (methodName === 'warn') {
        warnings.push(args.map(String).join(' '));
      }
      raw(...args);
    };
  };
  log.setLevel(originalLevel > log.levels.WARN ? 'warn' : originalLevel);
  try {
    await fn();
  } finally {
    log.methodFactory = originalFactory;
    log.setLevel(originalLevel);
  }
  return warnings;
}

function blocks(
  access: Awaited<ReturnType<Realm['getAnonymousAccess']>>,
  address: string,
) {
  return rangesContain(access.blocklist, parseIP(address)!);
}

module(basename(import.meta.filename), function () {
  module(
    "a realm's realm.json limits and blocks anonymous callers",
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/anonymous-access/');
      let testRealm: Realm;
      let testRealmPath: string;
      let request: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'], writer: ['read', 'write'] },
        fileSystem: {
          'realm.json': realmConfigCardJSON({ name: REALM_NAME }),
        },
        onRealmSetup(args) {
          testRealm = args.testRealm;
          testRealmPath = args.testRealmPath;
          request = args.request;
        },
      });

      hooks.beforeEach(async function () {
        await testRealm.indexing();
      });

      async function writeRealmConfig(fields: {
        anonymousRateLimit?: unknown;
        anonymousBlocklist?: unknown;
      }) {
        await testRealm.write(
          'realm.json',
          realmConfigCardJSON({ name: REALM_NAME, ...fields }),
        );
        await testRealm.indexing();
      }

      test("a realm that sets nothing gets the platform's limit and blocks nobody", async function (assert) {
        let access = await testRealm.getAnonymousAccess();
        assert.deepEqual(access.limit, DEFAULT_ANONYMOUS_RATE_LIMIT);
        assert.strictEqual(access.limitFrom, 'platform');
        assert.deepEqual(access.blocklist, []);
        assert.deepEqual(access.invalidBlocklistEntries, []);
      });

      test('a realm sets its own limit and blocklist', async function (assert) {
        await writeRealmConfig({
          anonymousRateLimit: { requests: 20, windowSeconds: 600 },
          anonymousBlocklist: [BLOCKED, BLOCKED_RANGE],
        });
        let access = await testRealm.getAnonymousAccess();
        assert.deepEqual(access.limit, { requests: 20, windowSeconds: 600 });
        assert.strictEqual(access.limitFrom, 'realm');
        assert.true(blocks(access, BLOCKED));
        assert.true(blocks(access, '198.51.100.250'));
        assert.false(blocks(access, '192.0.2.11'));
      });

      test("a limit that isn't one falls back to the platform's, and says so", async function (assert) {
        let access:
          | Awaited<ReturnType<Realm['getAnonymousAccess']>>
          | undefined;
        let warnings = await realmWarningsDuring(async () => {
          await writeRealmConfig({
            anonymousRateLimit: { requests: 0, windowSeconds: 60 },
          });
          access = await testRealm.getAnonymousAccess();
        });
        assert.deepEqual(access?.limit, DEFAULT_ANONYMOUS_RATE_LIMIT);
        assert.strictEqual(access?.limitFrom, 'platform');
        assert.true(
          warnings.some((w) => w.includes('`anonymousRateLimit`')),
          'the log says the limit was ignored',
        );
      });

      test('an unfilled limit field, as a saved card writes it, sets nothing and warns about nothing', async function (assert) {
        let warnings = await realmWarningsDuring(async () => {
          await writeRealmConfig({
            anonymousRateLimit: { requests: null, windowSeconds: null },
            anonymousBlocklist: [],
          });
          await testRealm.getAnonymousAccess();
        });
        assert.strictEqual(
          (await testRealm.getAnonymousAccess()).limitFrom,
          'platform',
        );
        assert.false(
          warnings.some((w) => w.includes('anonymous')),
          'nothing is logged',
        );
      });

      test('a blocklist entry that is not an address is reported, so the realm can close to anonymous callers', async function (assert) {
        let access:
          | Awaited<ReturnType<Realm['getAnonymousAccess']>>
          | undefined;
        let warnings = await realmWarningsDuring(async () => {
          await writeRealmConfig({
            anonymousBlocklist: [BLOCKED, 'the spammer'],
          });
          access = await testRealm.getAnonymousAccess();
        });
        assert.deepEqual(access?.invalidBlocklistEntries, ['the spammer']);
        assert.true(blocks(access!, BLOCKED), 'the valid entry still parses');
        assert.true(
          warnings.some(
            (w) =>
              w.includes('`anonymousBlocklist`') && w.includes('the spammer'),
          ),
          'the log names the entry',
        );
      });

      test('the file on disk is authoritative, so a newly blocked address is blocked before the index catches up', async function (assert) {
        await testRealm.getAnonymousAccess();
        writeFileSync(
          join(testRealmPath, 'realm.json'),
          realmConfigCardJSON({
            name: REALM_NAME,
            anonymousBlocklist: [BLOCKED],
          }),
        );
        testRealm.invalidateCachedRealmInfo();
        assert.true(blocks(await testRealm.getAnonymousAccess(), BLOCKED));
      });

      test("the settings are not served on the realm's info", async function (assert) {
        await writeRealmConfig({
          anonymousRateLimit: { requests: 20, windowSeconds: 600 },
          anonymousBlocklist: [BLOCKED],
        });
        let info = await request
          .get(new URL('_info', realmURL).pathname)
          .set('Accept', 'application/vnd.api+json');
        let served = JSON.stringify(info.body);
        assert.false(served.includes(BLOCKED), 'no blocked address');
        assert.false(
          served.includes('anonymousAccess'),
          'no anonymous-access settings',
        );
      });
    },
  );
});
