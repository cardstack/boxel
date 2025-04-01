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
  assertMessages,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setPlaygroundSelections } from '../../helpers/playground';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | ask-ai', function (hooks) {
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

    const petCard = `import { CardDef, Component } from "https://cardstack.com/base/card-api";
      export class Pet extends CardDef {
        static displayName = 'Pet';
        static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2><@fields.title /></h2>
        </template>
      };
    }`;

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': petCard,
        'Pet/marco.json': {
          data: {
            attributes: { title: 'Marco' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            attributes: { title: 'Mango' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
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

  test('can send message to AI Assistant in interact submode', async function (assert) {
    const cardId = `${testRealmURL}Pet/marco`;
    operatorModeStateService.restore({
      stacks: [[{ id: cardId, format: 'isolated' }]],
      submode: 'interact',
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
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
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
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('1 of 1 Skill Active');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Hello world',
        cards: [{ id: cardId, title: 'Marco' }],
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-message-field]').hasNoValue();
  });

  test('can send message to AI Assistant in code submode', async function (assert) {
    const petCardId = `${testRealmURL}pet.gts`;
    operatorModeStateService.restore({
      stacks: [[{ id: `${testRealmURL}Pet/mango`, format: 'isolated' }]],
      submode: 'code',
      codePath: petCardId,
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    assert.dom('[data-test-code-mode]').exists();
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    await sendAskAiMessage('Change embedded template background to blue');
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('2 of 2 Skills Active');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Change embedded template background to blue',
        files: [{ sourceUrl: petCardId, name: 'pet.gts' }],
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-message-field]').hasNoValue();
  });

  test('can send message to AI Assistant from workspace chooser', async function (assert) {
    operatorModeStateService.restore({
      stacks: [[{ id: `${testRealmURL}Pet/marco`, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await click('[data-test-close-button]');
    assert.dom('[data-test-workspace-chooser]').exists();
    assert.dom('[data-test-ask-ai-label]').exists();
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    await sendAskAiMessage('Hello world');
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('1 of 1 Skill Active');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Hello world',
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-message-field]').hasNoValue();
  });

  test('can send multiple messages and include playground card in attachments', async function (assert) {
    const marcoId = `${testRealmURL}Pet/marco`;
    const mangoId = `${testRealmURL}Pet/mango`;
    const petCardId = `${testRealmURL}pet.gts`;
    operatorModeStateService.restore({
      stacks: [[{ id: mangoId, format: 'isolated' }]],
      submode: 'code',
      codePath: petCardId,
    });
    setPlaygroundSelections({
      [`${petCardId.replace('.gts', '')}/Pet`]: {
        cardId: marcoId,
        format: 'isolated',
      },
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    assert.dom('[data-test-code-mode]').exists();
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    await sendAskAiMessage('Change embedded template background to blue');
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert
      .dom('[data-test-pill-menu-header]')
      .containsText('2 of 2 Skills Active');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Change embedded template background to blue',
        cards: [{ id: marcoId, title: 'Marco' }],
        files: [{ sourceUrl: petCardId, name: 'pet.gts' }],
      },
    ]);
    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-joined-room]').exists({ count: 1 });
    await click('[data-test-past-sessions-button]');

    // sending new message from AskAI box to open panel
    await sendAskAiMessage('Change title to Marquitos');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Change title to Marquitos',
        cards: [{ id: marcoId, title: 'Marco' }],
        files: [{ sourceUrl: petCardId, name: 'pet.gts' }],
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-message-field]').hasNoValue();
    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-joined-room]').exists({ count: 2 });
    await click('[data-test-past-sessions-button]');

    // sending message to open room via panel's chatbox
    await fillIn('[data-test-message-field]', 'Goodbye');
    await click('[data-test-send-message-btn]');
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Change title to Marquitos',
        cards: [{ id: marcoId, title: 'Marco' }],
        files: [{ sourceUrl: petCardId, name: 'pet.gts' }],
      },
      {
        from: 'testuser',
        message: 'Goodbye',
        cards: [{ id: marcoId, title: 'Marco' }],
        files: [{ sourceUrl: petCardId, name: 'pet.gts' }],
      },
    ]);
    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-joined-room]').exists({ count: 2 });
    await click('[data-test-past-sessions-button]');
  });
});
