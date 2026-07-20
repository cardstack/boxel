import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type RealmServerService from '@cardstack/host/services/realm-server';

// Bug 3 (CS-12207 family): event-subscriber *wiring* is app-scoped — services
// call subscribeEvent() once in their constructor, for the app's lifetime.
// Logout is an in-app reset, not a page reload, so those constructors never
// re-run. resetState() used to wipe the eventSubscribers map, silently killing
// billing-notification (and any future) push updates after a re-login. This
// test locks in that resetState() preserves the wiring.
module(
  'Unit | Service | realm-server | subscriber preservation',
  function (hooks) {
    setupTest(hooks);

    test('resetState() preserves event subscribers registered before logout', async function (assert) {
      let realmServer = this.owner.lookup(
        'service:realm-server',
      ) as RealmServerService;

      let received: unknown[] = [];
      realmServer.subscribeEvent('billing-notification', async (data) => {
        received.push(data);
      });

      // Simulate the in-app logout reset.
      realmServer.resetState();

      // Stub logged-in claims so handleEvent dispatches to subscribers without
      // a real login round-trip.
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
