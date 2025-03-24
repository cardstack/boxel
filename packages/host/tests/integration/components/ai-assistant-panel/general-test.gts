import { waitFor, waitUntil, click, triggerEvent } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { format, subMinutes } from 'date-fns';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { CurrentRoomIdPersistenceKey } from '@cardstack/host/utils/local-storage-keys';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  lookupLoaderService,
} from '../../../helpers';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';
import { suspendGlobalErrorHook } from '../../../helpers/uncaught-exceptions';

module('Integration | ai-assistant-panel | general', function (hooks) {
  const realmName = 'Operator Mode Workspace';
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
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
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
      @field address = contains(Address);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          Pet:
          <@fields.pet />
          Friends:
          <@fields.friends />
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    let petMango = new Pet({ name: 'Mango' });

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'address.gts': { Address },
        'person.gts': { Person },
        'Pet/mango.json': petMango,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
        }),
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

  async function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    await operatorModeStateService.restore({
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
    await setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('when opening ai panel it opens the most recent room', async function (assert) {
    try {
      await setCardInOperatorModeState(`${testRealmURL}Pet/mango`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
            <CardPrerender />
          </template>
        },
      );

      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'test room 0',
      });
      let room1Id = createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'test room 1',
      });
      const room2Id = createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'test room 2',
      });
      await settled();
      await openAiAssistant();
      await waitFor(`[data-room-settled]`);

      assert
        .dom(`[data-test-room="${room2Id}"]`)
        .exists(
          "test room 2 is the most recently created room and it's opened initially",
        );

      await click('[data-test-past-sessions-button]');
      await click(`[data-test-enter-room="${room1Id}"]`);

      await click('[data-test-close-ai-assistant]');
      await click('[data-test-open-ai-assistant]');
      await waitFor(`[data-room-settled]`);
      assert
        .dom(`[data-test-room="${room1Id}"]`)
        .exists(
          "test room 1 is the most recently selected room and it's opened initially",
        );

      await click('[data-test-close-ai-assistant]');
      window.localStorage.setItem(
        CurrentRoomIdPersistenceKey,
        "room-id-that-doesn't-exist-and-should-not-break-the-implementation",
      );
      await click('[data-test-open-ai-assistant]');
      await waitFor(`[data-room-settled]`);
      assert
        .dom(`[data-test-room="${room2Id}"]`)
        .exists(
          "test room 2 is the most recently created room and it's opened initially",
        );
    } finally {
      window.localStorage.removeItem(CurrentRoomIdPersistenceKey); // Cleanup
    }
  });

  test('it renders only new/updated messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: `question #0`,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: `question #1`,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    let messageEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Thinking...`,
      msgtype: 'm.text',
      formatted_body: `Thinking...`,
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    let commandEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Thinking...`,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: `Thinking...`,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    setReadReceipt(roomId, messageEventId, '@testuser:localhost');
    setReadReceipt(roomId, commandEventId, '@testuser:localhost');

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-message-idx="1"]');

    let instanceIds = Array.from(
      document.querySelectorAll('[data-test-boxel-message-instance-id]'),
    ).map((el) => el.getAttribute('data-test-boxel-message-instance-id'));
    assert.strictEqual(instanceIds.length, 3);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `answer #0`,
      msgtype: 'm.text',
      formatted_body: `answer #0`,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      'm.relates_to': {
        event_id: messageEventId,
        rel_type: 'm.replace',
      },
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Changing first name to Evie',
      formatted_body: 'Changing first name to Evie',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      'm.relates_to': {
        event_id: commandEventId,
        rel_type: 'm.replace',
      },
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          },
        },
      ],
    });
    let newInstanceIds = Array.from(
      document.querySelectorAll('[data-test-boxel-message-instance-id]'),
    ).map((el) => el.getAttribute('data-test-boxel-message-instance-id'));

    assert.deepEqual(newInstanceIds, instanceIds);
  });

  test('it can render a markdown message from ai bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: "# Beagles: Loyal Companions\n\nEnergetic and friendly, beagles are wonderful family pets. They _love_ company and always crave playtime.\n\nTheir keen noses lead adventures, unraveling scents. Always curious, they're the perfect mix of independence and affection.",
      msgtype: 'm.text',
      formatted_body:
        "# Beagles: Loyal Companions\n\nEnergetic and friendly, beagles are wonderful family pets. They _love_ company and always crave playtime.\n\nTheir keen noses lead adventures, unraveling scents. Always curious, they're the perfect mix of independence and affection.",
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert.dom('[data-test-message-idx="0"] h1').containsText('Beagles');
    assert.dom('[data-test-message-idx="0"]').doesNotContainText('# Beagles');
    assert.dom('[data-test-message-idx="0"] p').exists({ count: 2 });
    assert.dom('[data-test-message-idx="0"] em').hasText('love');
    assert.dom('[data-test-message-idx="0"]').doesNotContainText('_love_');
  });

  test('it displays the streaming indicator when ai bot message is in progress (streaming words)', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'Say one word.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'Say one word.',
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'French.',
      msgtype: 'm.text',
      formatted_body: 'French.',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'What is a french bulldog?',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'What is a french bulldog?',
      format: 'org.matrix.custom.html',
    });

    let partialEventId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'Thinking...',
        msgtype: 'm.text',
        formatted_body: 'Thinking...',
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
      },
      {
        origin_server_ts: Date.now(),
      },
    );
    let originalEventId = partialEventId;

    await waitFor('[data-test-message-idx="3"]');

    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'Answer to my previous question is not in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-avatar]')
      .hasClass(
        'ai-avatar-animated',
        'Answer to my current question is in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-message-content]')
      .hasText('Thinking...');

    partialEventId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'French bulldog is a',
        msgtype: 'm.text',
        formatted_body: 'French bulldog is a',
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: originalEventId,
        },
      },
      {
        origin_server_ts: Date.now(),
      },
    );

    await waitUntil(() => {
      let el = document.querySelector(
        '[data-test-message-idx="3"] [data-test-ai-message-content]',
      );
      if (el) {
        return (el as HTMLElement).innerText === 'French bulldog is a';
      } else {
        return false;
      }
    });
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-avatar]')
      .hasClass(
        'ai-avatar-animated',
        'Answer to my current question is in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-message-content]')
      .hasText('French bulldog is a');

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'French bulldog is a French breed',
        msgtype: 'm.text',
        formatted_body: 'French bulldog is a French breed',
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: originalEventId,
        },
      },
      {
        origin_server_ts: Date.now(),
      },
    );
    await waitUntil(() => {
      let el = document.querySelector(
        '[data-test-message-idx="3"] [data-test-ai-message-content]',
      );
      if (el) {
        return (
          (el as HTMLElement).innerText === 'French bulldog is a French breed'
        );
      } else {
        return false;
      }
    });

    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-avatar]')
      .hasClass(
        'ai-avatar-animated',
        'Answer to my current question is in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-message-content]')
      .hasText('French bulldog is a French breed');

    await click('[data-test-past-sessions-button]');
    assert.dom(`[data-test-enter-room='${roomId}']`).includesText('Thinking');
    assert.dom('[data-test-is-streaming]').exists();

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'French bulldog is a French breed of companion dog or toy dog.',
        msgtype: 'm.text',
        formatted_body:
          'French bulldog is a French breed of companion dog or toy dog',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true, // This is an indicator from the ai bot that the message is finalized and the openai is done streaming
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: originalEventId,
        },
      },
      {
        origin_server_ts: Date.now(),
      },
    );

    await waitFor('[data-test-message-idx="3"]');
    await waitUntil(() => !document.querySelector('.ai-avatar-animated'));
    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'Answer to my previous question is not in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'Answer to my last question is not in progress',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-message-content]')
      .hasText('French bulldog is a French breed of companion dog or toy dog');

    assert
      .dom(`[data-test-enter-room='${roomId}']`)
      .doesNotContainText('Thinking');
    assert.dom('[data-test-is-streaming]').doesNotExist();
  });

  test('it can handle an error in a card attached to a matrix message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let event1Id = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      formatted_body: '',
      msgtype: APP_BOXEL_CARDFRAGMENT_MSGTYPE,
      data: JSON.stringify({
        index: 0,
        totalParts: 1,
        cardFragment: JSON.stringify({
          data: {
            id: 'http://this-is-not-a-real-card.com',
            type: 'card',
            attributes: {
              firstName: 'Boom',
            },
            meta: {
              adoptsFrom: {
                module: 'http://not-a-real-card.com',
                name: 'Boom',
              },
            },
          },
        }),
      }),
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'card with error',
      formatted_body: 'card with error',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      data: JSON.stringify({
        attachedCardsEventIds: [event1Id],
      }),
      isStreamingFinished: true,
    });

    await waitFor('[data-test-card-error]');
    assert
      .dom('[data-test-card-error]')
      .containsText('Error rendering attached cards');
    await percySnapshot(assert);
  });

  test(`should handle events in order to prevent 'cardFragment not found' error`, async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let cardFragmentsEventId = '!card_fragments_event_id';
    let now = Date.now();
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'Update mango card',
        formatted_body: 'Update mango card',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        data: JSON.stringify({
          attachedCardsEventIds: [cardFragmentsEventId],
        }),
        isStreamingFinished: true,
      },
      { origin_server_ts: now + 60000 },
    );
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: '',
        formatted_body: '',
        msgtype: APP_BOXEL_CARDFRAGMENT_MSGTYPE,
        data: JSON.stringify({
          index: 0,
          totalParts: 1,
          cardFragment: JSON.stringify({
            data: {
              id: `${testRealmURL}Pet/mango`,
              type: 'card',
              attributes: {
                firstName: 'Mango',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}Pet`,
                  name: 'Mango',
                },
              },
            },
          }),
        }),
      },
      { event_id: cardFragmentsEventId, origin_server_ts: now },
    );

    await waitFor('[data-test-message-idx="0"]');
    assert.dom('[data-test-message-idx="0"]').exists({ count: 1 });
    assert.dom('[data-test-message-idx="0"]').containsText('Update mango card');
  });

  module('suspending global error hook', (hooks) => {
    let { capturedExceptions } = suspendGlobalErrorHook(hooks);

    test('it can handle an error during room creation', async function (assert) {
      await setCardInOperatorModeState();
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
            <CardPrerender />
            <div class='invisible' data-test-throw-room-error />
            <style scoped>
              .invisible {
                display: none;
              }
            </style>
          </template>
        },
      );

      await waitFor('[data-test-open-ai-assistant]');
      await click('[data-test-open-ai-assistant]');
      await waitFor('[data-test-new-session]');
      assert.dom('[data-test-room-error]').exists();
      assert.dom('[data-test-room]').doesNotExist();
      assert.dom('[data-test-past-sessions-button]').isDisabled();
      assert.strictEqual(
        capturedExceptions[0].message,
        'Intentional error thrown',
      );
      await percySnapshot(
        'Integration | ai-assistant-panel | it can handle an error during room creation | error state',
      );

      document.querySelector('[data-test-throw-room-error]')?.remove();
      await click('[data-test-room-error] > button');
      await waitFor('[data-test-room]');
      assert.dom('[data-test-room-error]').doesNotExist();
      assert.dom('[data-test-past-sessions-button]').isEnabled();
      await percySnapshot(
        'Integration | ai-assistant-panel | it can handle an error during room creation | new room state',
      );
    });
  });

  test('sends read receipts only for bot messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Say one word.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'Say one word.',
      format: 'org.matrix.custom.html',
    });

    await waitFor(`[data-room-settled]`);

    let eventId2 = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Word.',
      msgtype: 'm.text',
      formatted_body: 'Word.',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    assert
      .dom('[data-test-past-sessions-button] [data-test-has-active-sessions]')
      .doesNotExist();
    assert
      .dom(`[data-test-enter-room='${roomId}'] [data-test-is-streaming]`)
      .doesNotExist();

    let anotherRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'Another Room',
    });

    let eventId3 = simulateRemoteMessage(
      anotherRoomId,
      '@aibot:localhost',
      {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        formatted_body: 'Word.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: Date.now(),
      },
    );

    await waitFor('[data-test-has-active-sessions]');
    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="${anotherRoomId}"]`);
    await waitFor('[data-test-message-idx="0"]');

    let matrixService = this.owner.lookup(
      'service:matrix-service',
    ) as MatrixService;
    assert.deepEqual(
      Array.from(matrixService.currentUserEventReadReceipts.keys()),
      [eventId2, eventId3],
    );
  });

  test('it can retry a message when receiving an error from the AI bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'I have a feeling something will go wrong',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'I have a feeling something will go wrong',
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'There was an error processing your request, please try again later',
      msgtype: 'm.text',
      formatted_body:
        'There was an error processing your request, please try again later',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      errorMessage: 'AI bot error',
    });

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'I have a feeling something will go wrong',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'I have a feeling something will go wrong',
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'There was an error processing your request, please try again later',
      msgtype: 'm.text',
      formatted_body:
        'There was an error processing your request, please try again later',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      errorMessage: 'AI bot error',
    });

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="1"]')
      .containsText(
        'There was an error processing your request, please try again later',
      );
    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-bot-retry-button]')
      .doesNotExist('Only last errored message has a retry button');

    assert
      .dom('[data-test-message-idx="3"]')
      .containsText(
        'There was an error processing your request, please try again later',
      );
    assert
      .dom('[data-test-message-idx="3"] [data-test-ai-bot-retry-button]')
      .exists('Only last errored message has a retry button');

    assert.dom('[data-test-message-idx="4"]').doesNotExist();

    await click('[data-test-ai-bot-retry-button]');

    // This below is user's previous message that is sent again after retry button is clicked
    assert
      .dom('[data-test-message-idx="4"]')
      .exists('Retry message is sent to the AI bot');

    assert
      .dom('[data-test-message-idx="4"]')
      .containsText('I have a feeling something will go wrong');
  });

  test('replacement message should use `created` from the oldest message', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    let firstMessageId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'This is the first message',
        msgtype: 'org.text',
        formatted_body: 'This is the first message',
        format: 'org.matrix.custom.html',
        'm.new_content': {
          body: 'First message body',
          msgtype: 'org.text',
          formatted_body: 'First message body',
          format: 'org.matrix.custom.html',
        },
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'Second message body',
        msgtype: 'org.text',
        formatted_body: 'Second message body',
        format: 'org.matrix.custom.html',
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 31).getTime(),
      },
    );
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'First replacement message body',
        msgtype: 'org.text',
        formatted_body: 'First replacement message body',
        format: 'org.matrix.custom.html',
        ['m.new_content']: {
          body: 'First replacement message body',
          msgtype: 'org.text',
          formatted_body: 'First replacement message body',
          format: 'org.matrix.custom.html',
        },
        ['m.relates_to']: {
          event_id: firstMessageId,
          rel_type: 'm.replace',
        },
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 32).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="1"]');

    assert
      .dom('[data-test-message-idx="0"]')
      .containsText(
        'Wednesday Jan 3, 2024, 12:30 PM First replacement message body',
      );
    assert
      .dom('[data-test-message-idx="1"]')
      .containsText('Wednesday Jan 3, 2024, 12:31 PM Second message body');
  });

  test('it displays a toast if there is an activity that was not seen by the user yet', async function (assert) {
    await setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await openAiAssistant();
    await click('[data-test-close-ai-assistant]');

    // Create a new room with some activity
    let anotherRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'Another Room',
    });

    // A message that hasn't been seen and was sent more than fifteen minutes ago must not be shown in the toast.
    let sixteenMinutesAgo = subMinutes(new Date(), 16);
    simulateRemoteMessage(
      anotherRoomId,
      '@aibot:localhost',
      {
        body: 'I sent a message sixteen minutes ago',
        msgtype: 'm.text',
        formatted_body: 'A message that was sent sixteen minutes ago.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: sixteenMinutesAgo.getTime(),
      },
    );
    assert.dom('[data-test-ai-assistant-toast]').exists({ count: 0 });

    let fourteenMinutesAgo = subMinutes(new Date(), 14);
    simulateRemoteMessage(
      anotherRoomId,
      '@aibot:localhost',
      {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        formatted_body: 'A message from the background.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: fourteenMinutesAgo.getTime(),
      },
    );

    await waitFor('[data-test-ai-assistant-toast]');
    // Hovering over the toast prevents it from disappearing
    await triggerEvent('[data-test-ai-assistant-toast]', 'mouseenter');
    assert
      .dom('[data-test-ai-assistant-toast-header]')
      .containsText(`${format(fourteenMinutesAgo, 'dd.MM.yyyy, h:mm aa')}`);
    await triggerEvent('[data-test-ai-assistant-toast]', 'mouseleave');
    await click('[data-test-ai-assistant-toast-button]');
    assert.dom('[data-test-chat-title]').containsText('Another Room');
    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-message-content]')
      .containsText('A message from the background.');
  });
});
