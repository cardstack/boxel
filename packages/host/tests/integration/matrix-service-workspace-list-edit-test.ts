import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  registerDefaultRoutes,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';

import { setupRenderingTest } from '../helpers/setup';

const newRealmURL = ensureTrailingSlash(
  `${new URL(testRealmURL).origin}/testuser/new-workspace/`,
);

async function realmsInAccountData(matrixService: MatrixService) {
  let data = (await (matrixService as any)._client.getAccountDataFromServer(
    APP_BOXEL_REALMS_EVENT_TYPE,
  )) as { realms?: string[] } | null;
  return data?.realms ?? [];
}

// The app asks the realm server to edit the user's workspace list, so the
// edit is serialized with the server's own edits of it, and writes the list to
// Matrix itself only when the server keeps no list for the user.
module('Integration | matrix-service | workspace list edits', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

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
    let matrixService = getService('matrix-service') as MatrixService;
    await matrixService.ready;
    await matrixService.start();
  });

  hooks.afterEach(function () {
    // Puts back the default `/_user-realms` route a test stood in for.
    registerDefaultRoutes();
  });

  test('the realm server makes the edit when it keeps the list', async function (assert) {
    let edits: unknown[] = [];
    registerRealmServerRoute({
      path: '/_user-realms',
      handler: async (req) => {
        if (req.method !== 'PATCH') {
          return null;
        }
        edits.push(await req.json());
        return new Response(
          JSON.stringify({
            data: {
              type: 'user-realms-edit',
              id: '@testuser:localhost',
              attributes: { added: [newRealmURL], removed: [] },
            },
          }),
          { status: 200 },
        );
      },
    });
    let matrixService = getService('matrix-service') as MatrixService;

    await matrixService.appendRealmToAccountData(newRealmURL);
    await matrixService.removeRealmFromAccountData(testRealmURL);

    assert.deepEqual(
      edits,
      [
        { data: { type: 'user-realms', attributes: { add: [newRealmURL] } } },
        {
          data: { type: 'user-realms', attributes: { remove: [testRealmURL] } },
        },
      ],
      'both edits went to the realm server',
    );
    assert.deepEqual(
      await realmsInAccountData(matrixService),
      [baseRealm.url, testRealmURL],
      'the app wrote nothing to Matrix itself',
    );
  });

  test('the app writes the list itself when the realm server keeps none', async function (assert) {
    let matrixService = getService('matrix-service') as MatrixService;

    await matrixService.appendRealmToAccountData(newRealmURL);
    assert.deepEqual(
      await realmsInAccountData(matrixService),
      [baseRealm.url, testRealmURL, newRealmURL],
      'the app added the realm to Matrix',
    );

    await matrixService.removeRealmFromAccountData(testRealmURL);
    assert.deepEqual(
      await realmsInAccountData(matrixService),
      [baseRealm.url, newRealmURL],
      'the app removed the realm from Matrix',
    );
  });
});
