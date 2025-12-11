import { click, fillIn, triggerEvent, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  assertMessages,
  setupOperatorModeStateCleanup,
  setupSnapshotRealm,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setPlaygroundSelections } from '../../helpers/playground';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | ask-ai', function (hooks) {
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils: mockMatrixUtils,
    async build({ loader }) {
      operatorModeStateService = getService('operator-mode-state-service');
      const petCard = `import { CardDef, Component, contains, field, StringField } from "https://cardstack.com/base/card-api";
      export class Pet extends CardDef {
        static displayName = 'Pet';
        @field title = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2><@fields.title /></h2>
        </template>
      };
    }`;

      await setupIntegrationTestRealm({
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
        loader,
      });
      return { loader };
    },
  });
  hooks.beforeEach(function () {
    ({ loader } = snapshot.get());
  });

  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );

  let noop = () => {};

  hooks.beforeEach(async function () {});

  const sendAskAiMessage = async (message: string, assert: Assert) => {
    assert.dom('[data-test-ask-ai-input]').hasStyle({ width: '140px' });
    await fillIn('[data-test-ask-ai-input]', message);
    await waitUntil(() => {
      let el = document.querySelector(
        '[data-test-ask-ai-input]',
      ) as HTMLElement | null;
      return el && getComputedStyle(el).width === '310px';
    });
    assert.dom('[data-test-ask-ai-input]').hasStyle({ width: '310px' });
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
      .hasText('New AI Assistant Chat')
      .hasAttribute('title', 'New AI Assistant Chat');
    assert.dom('[data-test-active-skills-count]').containsText('1 Skill');
    await assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Hello world',
        cards: [{ id: cardId, title: 'Marco' }],
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').doesNotExist();
    assert.dom('[data-test-message-field]').hasNoValue();
  });

  test('can send message to AI Assistant from workspace chooser', async function (assert) {
    operatorModeStateService.restore({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await click('[data-test-close-button]'); // close last card
    assert.dom('[data-test-workspace-chooser]').exists();
    assert.dom('[data-test-ask-ai-label]').exists();
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    await sendAskAiMessage('Hello world', assert);
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert.dom('[data-test-active-skills-count]').containsText('1 Skill');
    await assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Hello world',
      },
    ]);
    assert.dom('[data-test-ask-ai-input]').doesNotExist();
    assert.dom('[data-test-message-field]').hasNoValue();
  });

  test('can send message to AI Assistant in code submode', async function (assert) {
    const marcoId = `${testRealmURL}Pet/marco`;
    const mangoId = `${testRealmURL}Pet/mango`;
    const petCardId = `${testRealmURL}pet.gts`;
    operatorModeStateService.restore({
      stacks: [[{ id: mangoId, format: 'isolated' }]],
      submode: 'code',
      codePath: petCardId,
      moduleInspector: 'preview',
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
        </template>
      },
    );

    assert.dom('[data-test-code-mode]').exists();
    assert.dom('[data-test-ask-ai-input]').hasNoValue();
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();
    await sendAskAiMessage(
      'Change embedded template background to blue',
      assert,
    );
    assert
      .dom('[data-test-ai-assistant-panel] [data-test-chat-title]')
      .hasText('New AI Assistant Chat');
    assert.dom('[data-test-active-skills-count]').containsText('3 Skills');
    await assertMessages(assert, [
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
    assert.dom('[data-test-ask-ai-input]').doesNotExist();

    // sending message to open room via panel's chatbox
    await fillIn('[data-test-message-field]', 'Goodbye');
    await click('[data-test-send-message-btn]');
    await assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Change embedded template background to blue',
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
    assert.dom('[data-test-joined-room]').exists({ count: 1 });
    await click('[data-test-past-sessions-button]');
  });
});
