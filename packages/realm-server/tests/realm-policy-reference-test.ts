import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { readFileSync } from 'fs';
import type { Test, SuperTest } from 'supertest';
import { logger, rri } from '@cardstack/runtime-common';
import type { Realm, VirtualNetwork } from '@cardstack/runtime-common';
import {
  createJWT,
  realmConfigCardJSON,
  setupPermissionedRealmCached,
} from './helpers/index.ts';

// A card in a realm this suite never starts. Nothing here follows the
// pointer, so the card it names does not need to exist.
const POLICY_CARD = 'http://127.0.0.1:4444/policy-org/policies/education';
const REALM_NAME = 'Policy Reference Test Realm';
const SETTINGS = { approver: '@mae:localhost' };

const REJECTION = "ignoring the RealmConfig card's `policy`";
const NOT_AN_IDENTIFIER =
  'which is an object whose `card` is neither an absolute URL nor a realm-prefixed card id';

// Every warning the realm logs while `fn` runs. The realm and this suite share
// the named `realm` logger, so a tap on its method factory sees exactly what
// the realm writes. The level is held at `warn` or louder for the duration,
// so a quieter LOG_LEVELS setting cannot hide the line a test is looking for.
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
  // Rebinds the logger's methods, which is what puts the tap in place.
  log.setLevel(originalLevel > log.levels.WARN ? 'warn' : originalLevel);
  try {
    await fn();
  } finally {
    log.methodFactory = originalFactory;
    log.setLevel(originalLevel);
  }
  return warnings;
}

const NOTE = {
  data: {
    type: 'card' as const,
    attributes: { cardInfo: { name: 'A note' } },
    meta: {
      adoptsFrom: { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
    },
  },
};

module(basename(import.meta.filename), function () {
  module('a realm whose realm.json names its policy card', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/policy-reference/');
    let testRealm: Realm;
    let testRealmPath: string;
    let virtualNetwork: VirtualNetwork;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'], writer: ['read', 'write'] },
      fileSystem: {
        'realm.json': realmConfigCardJSON({
          name: REALM_NAME,
          config: SETTINGS,
          policy: { card: POLICY_CARD },
        }),
        'note.json': NOTE,
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        testRealmPath = args.testRealmPath;
        virtualNetwork = args.virtualNetwork;
        request = args.request;
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
    });

    async function writeRealmConfig(policy?: unknown) {
      await testRealm.write(
        'realm.json',
        realmConfigCardJSON({ name: REALM_NAME, config: SETTINGS, policy }),
      );
      await testRealm.indexing();
    }

    function getInfo() {
      return request
        .get(new URL('_info', realmURL).pathname)
        .set('Accept', 'application/vnd.api+json');
    }

    function getNote() {
      return request
        .get(new URL('note', realmURL).pathname)
        .set('Accept', 'application/vnd.card+json');
    }

    test('the realm reads which card its policy is', async function (assert) {
      assert.deepEqual(
        await testRealm.getRealmPolicy(),
        { card: POLICY_CARD },
        'the pointer realm.json holds',
      );
    });

    // A prefix-mapped realm serves its cards' ids in prefix form, so a pointer
    // copied from one of them is written that way.
    test('a pointer written as a realm-prefixed card id is read as the URL it resolves to', async function (assert) {
      let prefixed = '@cardstack/catalog/policies/education';
      let resolved = virtualNetwork.toURL(prefixed).href;
      assert.true(
        resolved.startsWith('http'),
        `the prefix resolves to a URL in this realm's network: ${resolved}`,
      );

      await writeRealmConfig({ card: prefixed });
      assert.deepEqual(
        await testRealm.getRealmPolicy(),
        { card: resolved },
        'the pointer is handed back in URL form',
      );
    });

    test('the policy pointer and the settings are read apart', async function (assert) {
      assert.deepEqual(
        await testRealm.getRealmConfig(),
        SETTINGS,
        'the settings carry no policy',
      );
      assert.deepEqual(
        await testRealm.getRealmPolicy(),
        { card: POLICY_CARD },
        'and the policy carries no settings',
      );
      let info = await testRealm.getRealmInfo();
      assert.false('policy' in info, 'the served info has no policy');
      assert.false('config' in info, 'and no settings');
    });

    // A write through the card, rather than to the file, keeps only what the
    // RealmConfig card declares — so this is the test that the pointer is a
    // field of that card and not just a key the file happened to hold.
    test('the policy pointer survives a write to the realm config card', async function (assert) {
      let response = await request
        .patch(new URL('realm', realmURL).pathname)
        .send({
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Renamed Realm' } },
            meta: {
              adoptsFrom: {
                module: rri('@cardstack/base/realm-config'),
                name: 'RealmConfig',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      await testRealm.indexing();

      assert.strictEqual(
        (await testRealm.getRealmInfo()).name,
        'Renamed Realm',
        'the write reached the realm',
      );
      let stored = JSON.parse(
        readFileSync(join(testRealmPath, 'realm.json'), 'utf8'),
      );
      assert.deepEqual(
        stored.data.attributes.policy,
        { card: POLICY_CARD },
        'the file the card wrote still holds the pointer',
      );
      assert.deepEqual(
        await testRealm.getRealmPolicy(),
        { card: POLICY_CARD },
        'and the realm still reads it',
      );
    });

    test('the policy pointer is not carried on a response that stamps the realm info', async function (assert) {
      // The premise, asserted rather than left to the fixture: a realm that
      // turned out to have no policy would pass the checks below for the
      // wrong reason.
      assert.deepEqual(
        await testRealm.getRealmPolicy(),
        { card: POLICY_CARD },
        'the realm under test does name a policy card',
      );

      let info = await getInfo();
      assert.strictEqual(info.status, 200, 'the realm info is served');
      assert.strictEqual(
        info.body.data.attributes.name,
        REALM_NAME,
        'with the name it always carried',
      );
      assert.false(
        info.text.includes(POLICY_CARD),
        'and without the policy card',
      );

      let note = await getNote();
      assert.strictEqual(note.status, 200, 'the card is served');
      assert.strictEqual(
        note.body.data.meta.realmInfo.name,
        REALM_NAME,
        'with the realm info it always carried',
      );
      assert.false(
        note.text.includes(POLICY_CARD),
        'and without the policy card',
      );
    });

    test('a realm.json with no policy leaves the realm with none, and its responses as they were', async function (assert) {
      let infoBefore = await getInfo();
      let noteBefore = await getNote();

      let policy: unknown = 'unread';
      let warnings = await realmWarningsDuring(async () => {
        await writeRealmConfig();
        policy = await testRealm.getRealmPolicy();
      });
      assert.strictEqual(policy, undefined, 'the realm has no policy');
      assert.deepEqual(
        warnings.filter((w) => w.includes('`policy`')),
        [],
        'and a missing key is not a malformed one',
      );
      assert.deepEqual(
        await testRealm.getRealmConfig(),
        SETTINGS,
        'the settings are untouched',
      );

      let infoAfter = await getInfo();
      assert.strictEqual(
        infoAfter.text,
        infoBefore.text,
        'the realm info is the same bytes with or without a policy',
      );
      let noteAfter = await getNote();
      assert.deepEqual(
        noteAfter.body.data.meta.realmInfo,
        noteBefore.body.data.meta.realmInfo,
        'and so is the realm info a card carries',
      );
    });

    test('an explicit null policy leaves the realm with none, without a warning', async function (assert) {
      let policy: unknown = 'unread';
      let warnings = await realmWarningsDuring(async () => {
        await writeRealmConfig(null);
        policy = await testRealm.getRealmPolicy();
      });
      assert.strictEqual(policy, undefined, 'the realm has no policy');
      assert.deepEqual(
        warnings.filter((w) => w.includes('`policy`')),
        [],
        'null is how an owner writes "no policy"',
      );
    });

    // Each one replaces the well-formed pointer the realm started with, so a
    // realm left with no policy also shows that the earlier pointer is not
    // what the realm falls back to.
    test('a malformed policy pointer is dropped with a warning, and the realm keeps serving', async function (assert) {
      let shapes: { label: string; value: unknown; problem: string }[] = [
        {
          label: 'a bare URL',
          value: POLICY_CARD,
          problem: 'which is string',
        },
        {
          label: 'an array',
          value: [{ card: POLICY_CARD }],
          problem: 'which is an array',
        },
        {
          label: 'an object with no card',
          value: { url: POLICY_CARD },
          problem: 'which is an object with no `card`',
        },
        {
          label: 'a card that is not a string',
          value: { card: 42 },
          problem: 'which is an object whose `card` is number',
        },
        {
          label: 'a card that is not a URL',
          value: { card: 'not a url' },
          problem: NOT_AN_IDENTIFIER,
        },
        {
          label: 'a relative card',
          value: { card: './policies/education' },
          problem: NOT_AN_IDENTIFIER,
        },
        {
          label: 'a card under a prefix no realm is mapped at',
          value: { card: '@nowhere/policies/education' },
          problem: NOT_AN_IDENTIFIER,
        },
        {
          label: 'a file URL',
          value: { card: 'file:///etc/passwd' },
          problem: 'which is an object whose `card` is a file: URL',
        },
        {
          label: 'a data URL',
          value: { card: 'data:application/json,{}' },
          problem: 'which is an object whose `card` is a data: URL',
        },
        {
          label: 'a javascript URL',
          value: { card: 'javascript:alert(1)' },
          problem: 'which is an object whose `card` is a javascript: URL',
        },
        {
          label: 'a mailto URL',
          value: { card: 'mailto:owner@example.test' },
          problem: 'which is an object whose `card` is a mailto: URL',
        },
      ];

      for (let { label, value, problem } of shapes) {
        let policy: unknown = 'unread';
        let config: unknown;
        let warnings = await realmWarningsDuring(async () => {
          await writeRealmConfig(value);
          policy = await testRealm.getRealmPolicy();
          config = await testRealm.getRealmConfig();
        });
        assert.strictEqual(
          policy,
          undefined,
          `${label}: the realm has no policy`,
        );
        assert.true(
          warnings.some((w) => w.includes(REJECTION) && w.includes(problem)),
          `${label}: the log says what the value was`,
        );
        assert.deepEqual(
          config,
          SETTINGS,
          `${label}: the settings beside it are untouched`,
        );
        let info = await getInfo();
        assert.strictEqual(
          info.status,
          200,
          `${label}: the realm keeps serving its info`,
        );
        assert.strictEqual(
          info.body.data.attributes.name,
          REALM_NAME,
          `${label}: with its name`,
        );
      }
    });
  });

  module(
    'a realm that starts with a malformed policy pointer',
    function (hooks) {
      let realmURL = new URL(
        'http://127.0.0.1:4444/policy-reference-malformed/',
      );
      let testRealm: Realm;
      let request: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'] },
        fileSystem: {
          'realm.json': realmConfigCardJSON({
            name: REALM_NAME,
            config: SETTINGS,
            policy: POLICY_CARD,
          }),
          'note.json': NOTE,
        },
        onRealmSetup(args) {
          testRealm = args.testRealm;
          request = args.request;
        },
      });

      test('the realm starts and serves, with no policy', async function (assert) {
        await testRealm.indexing();

        let info = await request
          .get(new URL('_info', realmURL).pathname)
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(info.status, 200, 'the realm info is served');
        assert.strictEqual(
          info.body.data.attributes.name,
          REALM_NAME,
          'with its name',
        );

        let note = await request
          .get(new URL('note', realmURL).pathname)
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(note.status, 200, 'its cards are served');

        assert.strictEqual(
          await testRealm.getRealmPolicy(),
          undefined,
          'the realm has no policy',
        );
        assert.deepEqual(
          await testRealm.getRealmConfig(),
          SETTINGS,
          'and its settings are read',
        );
      });
    },
  );
});
