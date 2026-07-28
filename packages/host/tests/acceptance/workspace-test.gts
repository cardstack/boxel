import { click, settled, visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { testRealmInfo } from '@cardstack/runtime-common/helpers/const';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const STACK = '[data-test-operator-mode-stack="0"]';

module('Acceptance | workspace card', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({ sender: '@testuser:localhost', name: 'room-test' });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { Workspace } = await loader.import<
      typeof import('@cardstack/base/workspace')
    >('@cardstack/base/workspace');

    class Note extends CardDef {
      @field cardTitle = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-note><@fields.cardTitle /></div>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'note.gts': { Note },
        'index.json': new Workspace(),
        'Note/1.json': new Note({ cardTitle: 'First Note' }),
        // A remix cloned from Note/1 — its own indexed instance is the record
        // of the clone that the Activity feed surfaces as a "Remixed" event.
        'Remix/1.json': {
          data: {
            attributes: { listingName: 'Remixed Space' },
            relationships: {
              remixedFrom: { links: { self: '../Note/1' } },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/remix-card',
                name: 'RemixCard',
              },
            },
          },
        },
      },
    });
  });

  test('a realm indexed by Workspace renders its shell and switches segments', async function (assert) {
    await visit('/');
    assert.dom('[data-test-workspace-chooser]').exists();
    await click('[data-test-workspace-button="Unnamed Workspace"]');

    await waitFor(`${STACK} nav.tabs`);
    assert
      .dom(`${STACK} nav.tabs .tab`)
      .exists({ count: 3 }, 'Home, Library, and Activity tabs render');
    assert
      .dom(`${STACK} nav.tabs .tab.active`)
      .hasText('Home', 'Home is the default segment');

    await click(`${STACK} nav.tabs .tab:nth-child(2)`);
    assert.dom(`${STACK} .library`).exists('Library pane renders');

    await click(`${STACK} nav.tabs .tab:nth-child(3)`);
    assert.dom(`${STACK} .activity-pane`).exists('Activity pane renders');
  });

  test('a remix surfaces in the Activity feed as a first-class event', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} nav.tabs .tab:nth-child(3)`); // Activity
    await waitFor(`${STACK} .feed-verb.remixed`);
    assert
      .dom(`${STACK} .feed-verb.remixed`)
      .hasText('Remixed', 'the remix reads as a Remixed event, not a save');

    await waitFor(`${STACK} .feed-remix-source`);
    assert
      .dom(`${STACK} .feed-remix-source`)
      .hasText(
        'from First Note',
        'the event names the source it was cloned from',
      );
  });

  test('a completed indexing pass surfaces in the Activity feed', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} nav.tabs`);
    await click(`${STACK} nav.tabs .tab:nth-child(3)`); // Activity

    // Deliver a realm index event the way the realm-server would, over the
    // realm's matrix room the Workspace subscribes to.
    let realmRoomId = mockMatrixUtils.getRoomIdForRealmAndUser(
      testRealmURL,
      '@testuser:localhost',
    );
    mockMatrixUtils.simulateRemoteMessage(
      realmRoomId,
      testRealmInfo.realmUserId!,
      {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmURL}Note/1`, `${testRealmURL}Note/2`],
        realmURL: testRealmURL,
      },
      { type: APP_BOXEL_REALM_EVENT_TYPE },
    );
    await settled();

    // The `.indexed` class is only applied to an Indexed verb, so its presence
    // proves the pass rendered as a first-class event. `exists` (not `hasText`)
    // keeps the test robust if the realm also fires its own incremental pass.
    await waitFor(`${STACK} .feed-verb.indexed`);
    assert
      .dom(`${STACK} .feed-verb.indexed`)
      .exists('the indexing pass reads as a first-class Indexed event');
    assert
      .dom(`${STACK} .feed-event-tile`)
      .exists('a card-less event tile stands in for the embedded card');
    assert
      .dom(`${STACK} .activity-pane`)
      .containsText('2 cards reindexed', 'the event describes the pass');
  });
});
