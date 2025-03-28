import { click, fillIn, triggerEvent } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  lookupLoaderService,
} from '../../helpers';
import { CardDef, Component, setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | ask-ai-text-box', function (hooks) {
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    class Pet extends CardDef {
      static displayName = 'Pet';
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2><@fields.title /></h2>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'Pet/marco.json': new Pet({ title: 'Marco' }),
        '.realm.json': `{ "name": "Operator Mode Workspace" }`,
      },
    });
  });

  const sendAskAiMessage = async (message: string) => {
    await fillIn('[data-test-ask-ai-input]', message);
    await triggerEvent('[data-test-ask-ai-input]', 'keydown', {
      key: 'Enter',
      code: 'Enter',
    });
  };

  test('can send message to new AI Assistant room', async function (assert) {
    const cardId = `${testRealmURL}Pet/marco`;
    await operatorModeStateService.restore({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    assert.dom('[data-test-ask-ai-label]').exists();
    assert.dom('[data-test-ask-ai-input]').hasValue('');
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    await fillIn('[data-test-ask-ai-input]', 'Hello world');
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();
    await triggerEvent('[data-test-ask-ai-input]', 'keydown', {
      key: 'Enter',
      code: 'Enter',
    });
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert.dom('[data-test-ai-message-content]').hasText('Hello world');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('1 of 1 Skill Active');
    assert.dom(`[data-test-attached-card="${cardId}"]`).exists();
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-ask-ai-input]').hasValue('');

    await click('[data-test-submode-switcher] > button');
    await click('[data-test-boxel-menu-item-text="Code"]');

    // sending message in code submode
    assert.dom('[data-test-code-mode]').exists();
    assert.dom('[data-test-ask-ai-input]').hasValue('');

    await sendAskAiMessage('Hello new world');
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert.dom('[data-test-ai-message-content]').hasText('Hello new world');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('2 of 2 Skills Active');
    assert.dom(`[data-test-attached-file="${cardId}.json"]`).exists();
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-ask-ai-input]').hasValue('');

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-joined-room]').exists({ count: 2 });

    await fillIn('[data-test-message-field]', 'Goodbye');
    await triggerEvent('[data-test-message-field]', 'keydown', {
      key: 'Enter',
      code: 'Enter',
    });
    assert
      .dom('[data-test-ai-assistant-message]')
      .exists(
        { count: 2 },
        'can still send message to chat via message input box',
      );

    // sending message while workspace chooser is open
    await click('[data-test-workspace-chooser-toggle]');
    await click('[data-test-close-ai-assistant]');

    await sendAskAiMessage('How are you?');
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert.dom('[data-test-ai-message-content]').hasText('How are you?');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('2 of 2 Skills Active');
    assert.dom(`[data-test-attached-file="${cardId}.json"]`).exists();
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-ask-ai-input]').hasValue('');

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-joined-room]').exists({ count: 3 });
  });
});
