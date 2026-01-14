import { waitFor, click, triggerEvent } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import { BOTTOM_THRESHOLD } from '@cardstack/host/components/ai-assistant/message';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
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

module('Integration | ai-assistant-panel | scrolling', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
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

  let { createAndJoinRoom, simulateRemoteMessage, setReadReceipt } =
    mockMatrixUtils;

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

  async function renderAiAssistantPanel(id?: string) {
    setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  async function scrollAiAssistantToBottom() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;
    conversationElement.scrollTop =
      conversationElement.scrollHeight - conversationElement.clientHeight;
    await triggerEvent('[data-test-ai-assistant-conversation]', 'scroll');
    await new Promise((r) => setTimeout(r, 500)); // wait for the 500ms throttle on the scroll event handler
  }

  async function scrollAiAssistantToTop() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;
    conversationElement.scrollTop = 0;
    await triggerEvent('[data-test-ai-assistant-conversation]', 'scroll');
    await new Promise((r) => setTimeout(r, 500)); // wait for the 500ms throttle on the scroll event handler
  }

  function isAiAssistantScrolledToBottom() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;

    return (
      Math.abs(
        conversationElement.scrollHeight -
          conversationElement.clientHeight -
          conversationElement.scrollTop,
        // we'll use a threshold for considering the ai assistant scrolled
        // all the way to the bottom
      ) < BOTTOM_THRESHOLD
    );
  }
  function isAiAssistantScrolledToTop() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;

    return conversationElement.scrollTop === 0;
  }

  function fillRoomWithReadMessages(
    roomId: string,
    messagesHaveBeenRead = true,
  ) {
    for (let i = 0; i < 20; i++) {
      simulateRemoteMessage(roomId, '@testuser:localhost', {
        body: `question #${i + 1}`,
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      });
      let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: `answer #${i + 1}`,
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      });
      if (messagesHaveBeenRead) {
        setReadReceipt(roomId, eventId, '@testuser:localhost');
      }
    }
  }

  test('it shows unread message indicator when new message received and not scrolled to bottom', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);

    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToTop();
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when all messages have been read',
      );

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');

    assert
      .dom('[data-test-unread-messages-button]')
      .exists('unread messages button exists when there are unread messages');
    assert
      .dom('[data-test-unread-messages-button]')
      .containsText('1 New Message');
  });

  test('clicking on unread message indicator scrolls to unread message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);

    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToTop();
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when all messages have been read',
      );

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');
    await click('[data-test-unread-messages-button]');
    await new Promise((r) => setTimeout(r, 2000)); // wait for animated scroll to complete
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
  });

  test('it does not show unread message indicator when new message received and scrolled to bottom', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);
    await scrollAiAssistantToBottom();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when scrolled to the bottom',
      );
  });

  test('it scrolls to first unread message when opening a room with unread messages', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId, false);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    assert.ok(
      isAiAssistantScrolledToTop(),
      'AI assistant is scrolled to top (where the first unread message is)',
    );
  });

  test('it scrolls to last message when opening a room with no unread messages', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
  });

  test('scrolling stays at the bottom if a message is streaming in', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `thinking...`,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      ['m.relates_to']: {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
  });
});
