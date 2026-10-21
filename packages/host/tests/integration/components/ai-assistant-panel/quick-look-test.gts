import { waitFor, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../../helpers';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | quick look', function (hooks) {
  const realmName = 'Quick Look Workspace';
  const cardId = `${testRealmURL}Person/fadhlan`;
  const bubblePill = `[data-test-user-message] [data-test-attached-card="${cardId}"]`;
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      let clock = new Date(2024, 8, 21).getTime();
      return () => (clock += 10);
    })(),
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
        </template>
      };
    }

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/fadhlan.json': new Person({ firstName: 'Fadhlan' }),
          'realm.json': realmConfigCardJSON({ name: realmName }),
        },
      });
    });
  });

  // The open card is attached to the message the reader sends, so it shows
  // as a pill in their bubble.
  async function sendWithCardAttached() {
    operatorModeStateService.restore({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    await fillIn('[data-test-message-field]', 'What is in this card?');
    await click('[data-test-send-message-btn]');
    await waitFor(`[data-test-user-message]:not(.is-pending) ${bubblePill}`);
  }

  test('a card pill in the reader’s bubble opens in Quick Look, and Escape puts it away', async function (assert) {
    await sendWithCardAttached();
    assert.dom('[data-test-quick-look]').doesNotExist();

    await click(bubblePill);
    assert
      .dom(`[data-test-quick-look="${cardId}"]`)
      .exists('the card opens in Quick Look on the click')
      .hasAttribute('role', 'dialog')
      .hasAttribute('aria-modal', 'true');
    await waitFor('[data-test-quick-look] [data-test-person="Fadhlan"]');
    assert
      .dom('[data-test-quick-look] [data-test-pretui-quick-look-title]')
      .hasText('Fadhlan', 'the bar names the card');
    assert
      .dom('[data-test-quick-look] [data-test-pretui-quick-look-kind]')
      .hasText('Person');
    assert
      .dom('[data-test-quick-look] [data-test-quick-look-open]')
      .exists('it offers to open the card properly');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-quick-look]'),
      'focus moves into the sheet',
    );
    assert.strictEqual(
      operatorModeStateService.state.stacks[0]?.length,
      1,
      'looking does not open the card on a stack',
    );

    await triggerKeyEvent('[data-test-quick-look]', 'keydown', 'Escape');

    assert
      .dom('[data-test-quick-look]')
      .doesNotExist('Escape closes it on the same render');
    assert.strictEqual(
      document.activeElement,
      document.querySelector(bubblePill),
      'focus returns to the pill that opened it',
    );
  });

  test('Open in Quick Look opens the card on the stack beside the panel', async function (assert) {
    await sendWithCardAttached();
    await click(bubblePill);
    await click('[data-test-quick-look-open]');
    assert.dom('[data-test-quick-look]').doesNotExist();
    let stacks = operatorModeStateService.state.stacks;
    let rightmost = stacks[stacks.length - 1] ?? [];
    assert.strictEqual(
      rightmost[rightmost.length - 1]?.id,
      cardId,
      'the card is the top of the rightmost stack',
    );
  });

  test('the backdrop closes Quick Look', async function (assert) {
    await sendWithCardAttached();
    await click(bubblePill);
    assert.dom('[data-test-quick-look]').exists();
    await click('[data-test-pretui-quick-look-backdrop]');
    assert.dom('[data-test-quick-look]').doesNotExist();
  });
});
