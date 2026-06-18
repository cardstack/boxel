import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash, ri } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);

// CS-11658: boot assembles the available-realms list from the user's
// trusted realm-servers (`app.boxel.realm-servers`) by asking each via
// `_realm-auth`, instead of reading the realm list directly out of
// `app.boxel.realms`. A transition fallback to the legacy key remains
// until CS-11659's lazy migration has run on all active accounts.
module(
  'Integration | matrix-service | boot assembly with trusted servers',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
      autostart: true,
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      });
    });

    test('boot populates availableRealmIdentifiers when `app.boxel.realm-servers` is set', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL is present in availableRealmIdentifiers',
      );
    });

    test('fetchUserRealmsFromTrustedServers returns realms advertised by `_realm-auth`', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let realms = await realmServer.fetchUserRealmsFromTrustedServers([
        testRealmServerURL,
      ]);
      assert.deepEqual(
        realms,
        [testRealmURL],
        'returns the trusted server’s realms',
      );
    });

    test('fetchUserRealmsFromTrustedServers returns [] for an empty input', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let realms = await realmServer.fetchUserRealmsFromTrustedServers([]);
      assert.deepEqual(realms, [], 'short-circuits without any HTTP call');
    });

    test('fetchUserRealmsFromTrustedServers rejects non-own realm-server URLs', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      await assert.rejects(
        realmServer.fetchUserRealmsFromTrustedServers([
          'https://other-server.example/',
        ]),
        /Multi-realm server support is not yet implemented/,
      );
    });
  },
);

module(
  'Integration | matrix-service | trusted-servers result survives legacy event',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // The mock matrix client's `startClient` re-emits a synthetic
    // `app.boxel.realms` AccountData event with `activeRealms` content.
    // With the new key authoritative, that re-emission must NOT overwrite
    // the realms the trusted-servers boot path discovered. The setup
    // below deliberately diverges activeRealms from realmPermissions so
    // the bug (if reintroduced) shows up as a missing realm from the
    // _realm-auth response.
    const otherRealmURL = 'http://test-realm/test-other/';

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [], // synthetic legacy event would clear availableRealms
      activeRealmServers: [testRealmServerURL],
      realmPermissions: {
        [testRealmURL]: ['read', 'write'],
        [otherRealmURL]: ['read', 'write'],
      },
      autostart: true,
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      });
    });

    test('legacy realms event does not overwrite the trusted-servers boot result', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL from _realm-auth survives the legacy event',
      );
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(otherRealmURL)),
        'otherRealmURL from _realm-auth survives the legacy event (regression guard)',
      );
    });
  },
);

module(
  'Integration | matrix-service | boot assembly fallback to legacy realms',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // No activeRealmServers — the mock returns `{ realmServers: [] }`, the
    // same shape the host sees for a user who hasn’t been migrated to
    // `app.boxel.realm-servers` yet (CS-11659).
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      });
    });

    test('boot still populates realms from `app.boxel.realms`', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL is present in availableRealmIdentifiers',
      );
    });
  },
);
