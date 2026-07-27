import { click, visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

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
});
