import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  APP_BOXEL_REALM_EVENT_ROOM_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import ENV from '@cardstack/host/config/environment';

import {
  testRealmURL,
  setRealmEventRoom,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { RealmEventContent } from '@cardstack/base/matrix-event';

// A realm event carries the URL the realm was started under, which for base is
// its alias, while a subscriber may name a realm by its prefix or by the URL it
// is served from. Each spelling of a realm has to hear that realm's events.
module('Integration | message-service | realm subscriptions', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({ mockMatrixUtils, contents: {} });
  });

  function indexEvent(realmURL: string): RealmEventContent {
    return {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [],
      realmURL,
    } as unknown as RealmEventContent;
  }

  test('every spelling of the base realm hears its events', function (assert) {
    let messageService = getService('message-service');
    let heard: string[] = [];
    let spellings = [
      '@cardstack/base/',
      new URL(ENV.resolvedBaseRealmURL).href,
      baseRealm.url,
    ];
    let unsubscribes = spellings.map((spelling) =>
      messageService.subscribe(spelling, () => heard.push(spelling)),
    );
    let userRealmHeard = 0;
    let unsubscribeUserRealm = messageService.subscribe(testRealmURL, () => {
      userRealmHeard++;
    });
    try {
      messageService.relayRealmEvent(indexEvent(baseRealm.url));
      assert.deepEqual(
        heard.sort(),
        [...spellings].sort(),
        'each spelling hears the event once',
      );
      assert.strictEqual(
        userRealmHeard,
        0,
        'a subscriber to another realm does not hear it',
      );

      unsubscribes[0]();
      heard = [];
      messageService.relayRealmEvent(indexEvent(baseRealm.url));
      assert.deepEqual(
        heard.sort(),
        spellings.slice(1).sort(),
        'an unsubscribed spelling stops hearing events',
      );
    } finally {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribeUserRealm();
    }
  });

  test('a subscriber that unsubscribes while it hears an event does not keep the next subscriber from hearing it', function (assert) {
    let messageService = getService('message-service');
    let heard: string[] = [];
    let unsubscribeFirst: () => void = messageService.subscribe(
      testRealmURL,
      () => {
        heard.push('first');
        unsubscribeFirst();
      },
    );
    let unsubscribeSecond = messageService.subscribe(testRealmURL, () => {
      heard.push('second');
    });
    try {
      messageService.relayRealmEvent(indexEvent(testRealmURL));
      assert.deepEqual(heard, ['first', 'second']);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  test('a realm named by a registered prefix hears events keyed by its URL', function (assert) {
    let { virtualNetwork } = getService('network');
    virtualNetwork.addRealmMapping('@test/mapped/', testRealmURL);
    let messageService = getService('message-service');
    let heard = 0;
    let unsubscribe = messageService.subscribe('@test/mapped/', () => {
      heard++;
    });
    try {
      messageService.relayRealmEvent(indexEvent(testRealmURL));
      assert.strictEqual(heard, 1);
    } finally {
      unsubscribe();
      virtualNetwork.removeRealmMapping('@test/mapped/');
    }
  });
});

// A private realm sends its realm events into a room of its own, which the
// host joins when something first subscribes to the realm.
module('Integration | message-service | realm event rooms', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({ mockMatrixUtils, contents: {} });
  });

  test('subscribing to a private realm joins the room its events go to', async function (assert) {
    let privateRealmURL = 'http://localhost:4205/private/';
    // The realm's own user creates the room and invites the user; the host
    // is not in it yet.
    let roomId = mockMatrixUtils.createAndJoinRoom({
      sender: '@private_realm:localhost',
      name: `Realm events: ${privateRealmURL}`,
      id: '!private-realm-events:localhost',
      roomType: APP_BOXEL_REALM_EVENT_ROOM_TYPE,
    });
    setRealmEventRoom(privateRealmURL, roomId);
    let membership = () => {
      try {
        return mockMatrixUtils.getRoomState(
          roomId,
          'm.room.member',
          '@testuser:localhost',
        ).membership;
      } catch {
        return undefined;
      }
    };
    assert.strictEqual(membership(), undefined, 'the host starts outside it');
    let messageService = getService('message-service');

    let heard: RealmEventContent[] = [];
    let unsubscribe = messageService.subscribe(privateRealmURL, (event) => {
      heard.push(event);
    });
    try {
      await waitUntil(() => membership() === 'join', {
        timeoutMessage: `the host did not join ${roomId}`,
      });
      assert.strictEqual(
        membership(),
        'join',
        'the host joined the realm event room',
      );

      // An event the realm sends into the room reaches the realm's
      // subscribers, which it would not if the room were taken for an AI room.
      mockMatrixUtils.simulateRemoteMessage(
        roomId,
        '@private_realm:localhost',
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${privateRealmURL}card`],
          realmURL: privateRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await waitUntil(() => heard.length > 0, {
        timeoutMessage: `no realm event arrived through ${roomId}`,
      });
      assert.deepEqual(
        heard.map((event) => event.eventName),
        ['index'],
        "the realm's subscriber heard the event sent into its room",
      );
    } finally {
      unsubscribe();
    }
  });
});
