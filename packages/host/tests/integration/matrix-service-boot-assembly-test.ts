import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash, ri } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
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

// Boot assembles the available-realms list from the user's trusted
// realm-servers (`app.boxel.realm-servers`) by asking each via
// `_realm-auth`, rather than reading the realm list directly out of
// `app.boxel.realms`. A transition fallback to the legacy key remains
// until the lazy migration that populates `app.boxel.realm-servers` has
// run on all active accounts.
module(
  'Integration | matrix-service | boot assembly with trusted servers',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // Don't autostart Matrix during realm setup: `setupIntegrationTestRealm`
    // backfills the integration realm URL into `availableRealmIdentifiers`,
    // which would mask a boot-assembly regression. We clear that backfill and
    // run `start()` explicitly so the boot path alone populates the list.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
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
    // `app.boxel.realms` AccountData event carrying `activeRealms`. When
    // trusted servers are authoritative, that re-emission must NOT
    // overwrite the realms the trusted-servers boot path discovered.
    // `activeRealms` is empty while `_realm-auth` advertises testRealmURL,
    // so a clobber would zero the available-realms list and drop
    // testRealmURL — making the regression observable as a missing realm.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      // Clear the URL `setupIntegrationTestRealm` backfills so the boot path —
      // and the `startClient()` legacy-event re-emission it triggers — is
      // solely responsible for the final list.
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('legacy realms event does not overwrite the trusted-servers boot result', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL from _realm-auth survives the legacy event',
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
    // same shape the host sees for a user who hasn't yet been migrated to
    // `app.boxel.realm-servers`.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      // Clear the backfilled URL so the legacy-fallback boot path is what
      // populates the list, not `setupIntegrationTestRealm`.
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
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
