import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
} from '../../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | sending', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
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
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
        }),
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  async function openAiAssistant(): Promise<string> {
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  test('displays message slightly muted when it is being sent', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await openAiAssistant();

    await fillIn(
      '[data-test-message-field]',
      'This is a magic message with a SENDING_DELAY_THEN_SUCCESS!',
    );
    assert
      .dom('[data-test-message-field]')
      .hasValue('This is a magic message with a SENDING_DELAY_THEN_SUCCESS!');
    assert.dom('[data-test-send-message-btn]').isEnabled();
    assert.dom('[data-test-ai-assistant-message]').doesNotExist();
    click('[data-test-send-message-btn]');

    await waitFor('[data-test-ai-assistant-message-pending]');
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-user-message]').hasClass('is-pending');
    await percySnapshot(assert);

    await waitFor('[data-test-user-message]:not(.is-pending)');
    await waitUntil(
      () =>
        !(
          document.querySelector(
            '[data-test-send-message-btn]',
          ) as HTMLButtonElement
        ).disabled,
    );
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-user-message]').hasNoClass('is-pending');
  });

  test('displays retry button for message that failed to send', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let roomId = await openAiAssistant();
    const failingMessage =
      'This is a magic message with a SENDING_DELAY_THEN_FAILURE!';

    await fillIn('[data-test-message-field]', failingMessage);
    assert.dom('[data-test-message-field]').hasValue(failingMessage);
    assert.dom('[data-test-send-message-btn]').isEnabled();
    assert.dom('[data-test-ai-assistant-message]').doesNotExist();
    click('[data-test-send-message-btn]');

    await waitFor('[data-test-ai-assistant-message-pending]');
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-user-message]').hasClass('is-pending');

    await waitFor('[data-test-boxel-alert="error"]');
    assert
      .dom('[data-test-message-field]')
      .hasValue(failingMessage, 'prompt is not lost after sending failed');

    await settled();

    assert.dom('[data-test-card-error]').containsText('Failed to send');
    assert.dom('[data-test-alert-action-button="Retry"]').exists();
    assert
      .dom(`[data-test-message-field="${roomId}"]`)
      .hasValue(failingMessage);

    await percySnapshot(assert);

    click('[data-test-alert-action-button="Retry"]');
    await waitFor('[data-test-ai-assistant-message-pending]');
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    await settled();
    assert
      .dom('[data-test-message-field]')
      .hasValue(failingMessage, 'prompt is not lost after retry');
  });

  test('it enlarges the input box when entering/pasting lots of text', async function (assert) {
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await openAiAssistant();
    let element = document.querySelector('#ai-chat-input');

    let initialHeight = element
      ? parseInt(window.getComputedStyle(element).height)
      : 0;

    assert.true(initialHeight < 50, 'input box is short');
    await fillIn('[data-test-message-field]', 'Hello '.repeat(1000));

    let newHeight = element
      ? parseInt(window.getComputedStyle(element).height)
      : 0;

    assert.true(
      newHeight >= 130,
      'input box grows when entering/pasting lots of text',
    );
  });

  test('it should create a new line in the right position when user type `Shift+Enter`', async function (assert) {
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await openAiAssistant();

    await fillIn(
      '[data-test-message-field]',
      'This is 1st sentence This is 2nd sentence',
    );

    const textarea = document.querySelector(
      '[data-test-message-field]',
    ) as HTMLTextAreaElement;
    textarea!.selectionStart = 21; // position after "This is 1st sentence"
    textarea!.selectionEnd = 21;

    await triggerEvent(textarea!, 'keydown', {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
    });

    assert
      .dom('[data-test-message-field]')
      .hasValue('This is 1st sentence \n\nThis is 2nd sentence');
  });
});
