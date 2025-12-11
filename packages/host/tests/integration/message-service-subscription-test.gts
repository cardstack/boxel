import { on } from '@ember/modifier';
import { click, settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

// @ts-expect-error says unused but the component uses it
import { tracked } from '@glimmer/tracking';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { testRealmURLToUsername } from '@cardstack/runtime-common/helpers/const';
import { Loader } from '@cardstack/runtime-common/loader';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import SubscribeToRealms from '@cardstack/host/helpers/subscribe-to-realms';

import { renderComponent } from '@cardstack/host/tests/helpers/render-component';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupSnapshotRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';
import { getService } from '@universal-ember/test-support';

let loader: Loader;

module('Integration | message service subscription', function (hooks) {
  setupRenderingTest(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let realmMatrixUsername = testRealmURLToUsername(testRealmURL);

  let realmRoomId = mockMatrixUtils.getRoomIdForRealmAndUser(
    testRealmURL,
    '@testuser:localhost',
  );

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });

      return { loader };
    },
  });

  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(function () {
    ({ loader } = snapshot.get());
  });

  test('realm event subscriptions are released when the subscriber is destroyed', async function (assert) {
    let messageCount = 0;

    await renderComponent(
      class SubscriberContainer extends GlimmerComponent {
        // @ts-expect-error TS1206: Decorators are not valid here.
        @tracked subscribe = true;

        <template>
          {{#if this.subscribe}}
            <button data-test-unsubscribe {{on 'click' this.unsubscribe}}>
              {{SubscribeToRealms this.realms this.handleMessage}}
              Unsubscribe
            </button>
          {{else}}
            Not subscribed to realm events.
          {{/if}}
        </template>

        get realms() {
          return [testRealmURL];
        }

        handleMessage(_ev: RealmEventContent, _realmURL: string) {
          messageCount++;
        }

        unsubscribe = () => {
          this.subscribe = false;
        };
      },
    );

    let messageCountAfterRender = messageCount;

    await click('[data-test-unsubscribe]');

    mockMatrixUtils.simulateRemoteMessage(realmRoomId, realmMatrixUsername, {
      type: APP_BOXEL_REALM_EVENT_TYPE,
      content: {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: 'index.json',
      },
    });

    await settled();

    assert.strictEqual(messageCount, messageCountAfterRender);
  });
});
