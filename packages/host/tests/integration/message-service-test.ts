import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import { testRealmURL, setupIntegrationTestRealm } from '../helpers';
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
