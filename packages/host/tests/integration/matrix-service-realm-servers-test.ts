import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

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
    });

    test('get returns empty when no event has been written', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let servers = await matrixService.getRealmServersFromAccountData();
      assert.deepEqual(
        servers,
        [],
        'returns an empty array when the event is absent',
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
  },
);
