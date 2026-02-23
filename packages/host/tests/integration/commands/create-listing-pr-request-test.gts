import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { isBotTriggerEvent } from '@cardstack/runtime-common';

import CreateListingPRRequestCommand from '@cardstack/host/commands/bot-requests/create-listing-pr-request';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmInfo,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | create-listing-pr-request', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom, getRoomEvents } = mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(async function () {
    class Listing extends CardDef {
      @field name = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'listing.gts': { Listing },
        'Listing/test-listing.json': new Listing({ name: 'Some Listing' }),
      },
    });
  });

  test('sends listingName in pr-listing-create trigger input', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');

    let command = new CreateListingPRRequestCommand(
      commandService.commandContext,
    );
    await command.execute({
      roomId,
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/test-listing`,
    });

    let event = getRoomEvents(roomId).pop()!;
    assert.ok(isBotTriggerEvent(event));
    assert.strictEqual(event.content.type, 'pr-listing-create');
    assert.strictEqual(event.content.realm, testRealmURL);
    assert.strictEqual(event.content.userId, '@testuser:localhost');
    assert.deepEqual(event.content.input, {
      roomId,
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/test-listing`,
      listingName: 'Some Listing',
    });
  });
});
