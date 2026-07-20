import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

// Bug 3 (CS-12207 family): event-subscriber *wiring* is app-scoped — services
// call subscribeEvent() once in their constructor, for the app's lifetime.
// Logout is an in-app reset, not a page reload, so those constructors never
// re-run. resetState() used to wipe the eventSubscribers map, silently killing
// billing-notification (and any future) push updates after a re-login. This
// test locks in that resetState() preserves the wiring.
module(
  'Integration | realm-server | subscriber preservation',
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

    test('resetState() preserves event subscribers registered before logout', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      await getService('matrix-service').ready;

      let received: unknown[] = [];
      realmServer.subscribeEvent('billing-notification', async (data) => {
        received.push(data);
      });

      // Simulate the in-app logout reset.
      realmServer.resetState();

      // Stub logged-in claims so handleEvent dispatches to subscribers without
      // depending on the live session room id.
      let sessionRoom = 'test-session-room';
      (realmServer as any).auth = {
        type: 'logged-in',
        claims: { sessionRoom },
      };

      await realmServer.handleEvent({
        room_id: sessionRoom,
        content: {
          body: JSON.stringify({
            eventType: 'billing-notification',
            data: { credits: 42 },
          }),
        },
      } as any);

      assert.deepEqual(
        received,
        [{ credits: 42 }],
        'a subscriber registered before resetState still fires after it',
      );
    });
  },
);
