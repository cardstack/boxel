import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';
import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

// CS-11655: the matrix-service exposes read/write helpers for the new
// `app.boxel.realm-servers` account-data event. These tests round-trip
// the `{ realmServers }` payload through the mock matrix client and
// confirm append + remove behave idempotently.
module(
  'Integration | matrix-service | realm-servers account data',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    setupBaseRealm(hooks);

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      });
      // Boot's lazy migration (CS-11659) seeds `app.boxel.realm-servers` from
      // the active realms, so reset to a known-empty starting point — these
      // tests exercise the raw read/write helpers, not the migration.
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.setRealmServersInAccountData([]);
    });

    test('get returns empty when the realm-servers list is empty', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let servers = await matrixService.getRealmServersFromAccountData();
      assert.deepEqual(
        servers,
        [],
        'returns an empty array when the event has no servers',
      );
    });

    test('set then get round-trips the realmServers payload', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let payload = ['https://server-a.example/', 'https://server-b.example/'];

      await matrixService.setRealmServersInAccountData(payload);

      let read = await matrixService.getRealmServersFromAccountData();
      assert.deepEqual(read, payload, 'reads back exactly what was written');
    });

    test('append is idempotent and preserves prior entries', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let a = 'https://server-a.example/';
      let b = 'https://server-b.example/';

      await matrixService.appendRealmServerToAccountData(a);
      await matrixService.appendRealmServerToAccountData(b);
      // Re-appending an existing server is a no-op.
      await matrixService.appendRealmServerToAccountData(a);

      assert.deepEqual(
        await matrixService.getRealmServersFromAccountData(),
        [a, b],
        'append preserves order and does not duplicate',
      );
    });

    test('remove drops the entry and leaves others intact', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let a = 'https://server-a.example/';
      let b = 'https://server-b.example/';

      await matrixService.setRealmServersInAccountData([a, b]);
      await matrixService.removeRealmServerFromAccountData(a);

      assert.deepEqual(
        await matrixService.getRealmServersFromAccountData(),
        [b],
        'only the targeted server is removed',
      );

      // Removing something not in the list is a no-op.
      await matrixService.removeRealmServerFromAccountData(
        'https://not-present.example/',
      );
      assert.deepEqual(
        await matrixService.getRealmServersFromAccountData(),
        [b],
        'removing a non-existent server leaves the list unchanged',
      );
    });

    // CS-11659: the lazy boot migration derives the realm-server URLs to seed
    // into `app.boxel.realm-servers`. These exercise the derivation directly
    // with non-test origins so `normalizeRealmServerURL` is a no-op and the
    // origin-vs-claim resolution is observable.
    test('deriveRealmServerURLsForRealms uses the realm URL origin when no token is present', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      window.localStorage.removeItem(SessionLocalStorageKey);

      assert.deepEqual(
        realmServer.deriveRealmServerURLsForRealms([
          'https://content.example/my-realm/',
          'https://content.example/another-realm/',
        ]),
        ['https://content.example/'],
        'distinct realms sharing an origin collapse to a single server',
      );
    });

    test('deriveRealmServerURLsForRealms prefers the JWT realmServerURL claim over the origin', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let realmURL = 'https://content.example/my-realm/';
      // A realm whose content is served from one origin but whose JWT names a
      // different realm-server origin — the claim is authoritative.
      let claim = { realmServerURL: 'https://api.example/' };
      let token = `header.${btoa(JSON.stringify(claim))}.signature`;
      window.localStorage.setItem(
        SessionLocalStorageKey,
        JSON.stringify({ [realmURL]: token }),
      );

      assert.deepEqual(
        realmServer.deriveRealmServerURLsForRealms([realmURL]),
        ['https://api.example/'],
        'the realmServerURL claim cross-checks and overrides the bare origin',
      );
    });
  },
);
