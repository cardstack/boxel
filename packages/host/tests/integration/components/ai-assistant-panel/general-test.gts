import {
  click,
  find,
  waitFor,
  waitUntil,
  triggerEvent,
} from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import { fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { format, subMinutes } from 'date-fns';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type LocalPersistenceService from '@cardstack/host/services/local-persistence-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  getMonacoContent,
  setMonacoContent,
  setupRealmServerEndpoints,
  setupOperatorModeStateCleanup,
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

module('Integration | ai-assistant-panel | general', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;
  let localPersistenceService: LocalPersistenceService;

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

  let {
    createAndJoinRoom,
    simulateRemoteMessage,
    setReadReceipt,
    getRoomEvents,
  } = mockMatrixUtils;

  // Setup realm server endpoints for summarization tests
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        // Handle summarization requests
        if (body.url.includes('openrouter.ai/api/v1/chat/completions')) {
          const requestBody = JSON.parse(body.requestBody);

          // Check if this is a summarization request
          if (
            requestBody.messages &&
            requestBody.messages.some(
              (msg: any) =>
                msg.content &&
                msg.content.includes('Please provide a concise summary'),
            )
          ) {
            // Return a mock summary based on the conversation content
            const conversationText = requestBody.messages
              .filter(
                (msg: any) =>
                  msg.role === 'user' &&
                  !msg.content.includes('Please provide a concise summary'),
              )
              .map((msg: any) => msg.content)
              .join(' ');

            let summary = 'This conversation focused on general discussion.';

            if (conversationText.includes('project')) {
              summary =
                'This conversation focused on project help, specifically creating a new card for a person with name and age fields. The user requested assistance with card creation and field definition.';
            } else if (
              conversationText.includes('card') &&
              conversationText.includes('file')
            ) {
              summary =
                'This conversation involved discussing a person card (Hassan) and a pet definition file. The user shared both a Person card and a pet.gts file, then asked for help understanding the structure.';
            } else if (conversationText.includes('error')) {
              throw new Error('OpenRouter API error');
            }

            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: summary,
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
        }

        // Default response for other requests
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 123, name: 'test' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');
    localPersistenceService = getService('local-persistence-service');

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
        'example-file.gts': `
          @field name = contains(StringField);
        `,
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
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('when opening ai panel it opens the most recent room', async function (assert) {
    try {
      setCardInOperatorModeState(`${testRealmURL}Pet/mango`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
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

      const testValue =
        "room-id-that-doesn't-exist-and-should-not-break-the-implementation";

      localPersistenceService.setCurrentRoomId(testValue);

      await click('[data-test-open-ai-assistant]');
      await waitFor(`[data-test-room="${room2Id}"]`);
      assert
        .dom(`[data-test-room="${room2Id}"]`)
        .exists(
          "test room 2 is the most recently created room and it's opened initially",
        );
    } finally {
      localPersistenceService.setCurrentRoomId(undefined);
    }
  });

  test('it renders only new/updated messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: `question #0`,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    let messageEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Thinking...`,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    let commandEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Thinking...`,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    setReadReceipt(roomId, messageEventId, '@testuser:localhost');
    setReadReceipt(roomId, commandEventId, '@testuser:localhost');

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
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
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      'm.relates_to': {
        event_id: messageEventId,
        rel_type: 'm.replace',
      },
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Changing first name to Evie',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      'm.relates_to': {
        event_id: commandEventId,
        rel_type: 'm.replace',
      },
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
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

  test('it converts decorative star bullets into markdown lists', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let bulletMessage =
      "Here are 4 points for you:\n\n★ First point - You're currently at the workspace chooser, ready to select from your available workspaces\n★ Second point - You have 7 personal workspaces and 3 catalog workspaces available to explore\n★ Third point - To get started, you can navigate to any workspace and open a card to begin working\n★ Fourth point - I'm here to help you with card creation, editing, code generation, or any questions you have about Boxel\n\nIs there anything specific you'd like to do in one of your workspaces?";

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: bulletMessage,
      msgtype: 'm.text',
    });

    await waitFor(
      `[data-test-room="${roomId}"] [data-test-message-idx="0"] ul`,
    );

    assert.dom('[data-test-message-idx="0"] ul li').exists({ count: 4 });
    assert
      .dom('[data-test-message-idx="0"] ul li:nth-child(1)')
      .includesText(
        "First point - You're currently at the workspace chooser, ready to select from your available workspaces",
      );
    assert
      .dom('[data-test-message-idx="0"] ul li:nth-child(2)')
      .includesText(
        'Second point - You have 7 personal workspaces and 3 catalog workspaces available to explore',
      );
    assert
      .dom('[data-test-message-idx="0"] ul li:nth-child(3)')
      .includesText(
        'Third point - To get started, you can navigate to any workspace and open a card to begin working',
      );
    assert
      .dom('[data-test-message-idx="0"] ul li:nth-child(4)')
      .includesText(
        "Fourth point - I'm here to help you with card creation, editing, code generation, or any questions you have about Boxel",
      );
    assert
      .dom('[data-test-message-idx="0"] ul li:nth-child(1)')
      .includesText('★ First point');
  });

  test('it converts various decorative bullets in a single message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let multiBulletMessage =
      'Decorative bullets:\n\n★ First milestone complete\n✅ Review workspace permissions\n➤ Share it with your team once ready\n❖ Investigate matrix connection\n◉ Update host fixtures';

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: multiBulletMessage,
      msgtype: 'm.text',
    });

    await waitFor(
      `[data-test-room="${roomId}"] [data-test-message-idx="0"] ul`,
    );

    let expectedItems = [
      '★ First milestone complete',
      '✅ Review workspace permissions',
      '➤ Share it with your team once ready',
      '❖ Investigate matrix connection',
      '◉ Update host fixtures',
    ];

    assert
      .dom('[data-test-message-idx="0"] ul li')
      .exists({ count: expectedItems.length });
    expectedItems.forEach((text, idx) => {
      assert
        .dom(`[data-test-message-idx="0"] ul li:nth-child(${idx + 1})`)
        .includesText(text);
    });
  });

  test('it displays the streaming indicator when ai bot message is in progress (streaming words)', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'Say one word.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'French.',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'What is a french bulldog?',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    let partialEventId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'Thinking...',
        msgtype: 'm.text',
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
      .hasText('French bulldog is a French breed of companion dog or toy dog.');

    assert
      .dom(`[data-test-enter-room='${roomId}']`)
      .doesNotContainText('Thinking');
    assert.dom('[data-test-is-streaming]').doesNotExist();
  });

  test('it can handle an error in a card attached to a matrix message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'card with error',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      data: JSON.stringify({
        attachedCards: [
          {
            sourceUrl: 'http://this-is-not-a-real-card.com',
            url: 'http://this-is-not-a-real-card.com',
            contentType: 'text/plain',
          },
        ],
      }),
      isStreamingFinished: true,
    });

    await waitFor('[data-test-card-error]');
    assert
      .dom('[data-test-card-error]')
      .containsText('Error rendering attached cards');
    await percySnapshot(assert);
  });

  test('it can handle an error during room creation', async function (assert) {
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />

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

  test('sends read receipts only for bot messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Say one word.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    await waitFor(`[data-room-settled]`);

    let eventId2 = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Word.',
      msgtype: 'm.text',
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

    let matrixService = getService('matrix-service');
    assert.deepEqual(
      Array.from(matrixService.currentUserEventReadReceipts.keys()),
      [eventId2, eventId3],
    );
  });

  test('it offers to buy more credits when balance is low', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    let billingService = getService('billing-service');

    let attributes = {
      creditsAvailableInPlanAllowance: 1,
      extraCreditsAvailableInBalance: 2,
    };

    billingService.fetchSubscriptionData = async () => {
      return new Response(JSON.stringify({ data: { attributes } }));
    };

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'You need a minimum of 10 credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      errorMessage:
        'You need a minimum of 10 credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.',
    });

    await waitFor('[data-test-message-idx="0"]');
    assert.dom('[data-test-alert-action-button="Buy More Credits"]').exists();
    assert.dom('[data-test-credits-added]').doesNotExist();
    await click('[data-test-alert-action-button="Buy More Credits"]');
    assert
      .dom('[data-test-settings-modal]')
      .exists('Profile Settings modal (which has credit buy links) is open');

    await click('[data-test-close-modal]');
    attributes.extraCreditsAvailableInBalance = 1000;
    await billingService.loadSubscriptionData();
    await settled();
    assert
      .dom('[data-test-alert-action-button="Retry"]')
      .exists(
        "After adding credits, 'buy more credits' button is replaced with 'retry'",
      );
    assert.dom('[data-test-credits-added]').exists();
  });

  test('it can retry a message when receiving an error from the AI bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'I have a feeling something will go wrong',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'There was an error processing your request, please try again later',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      errorMessage: 'AI bot error',
    });

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'I have a feeling something will go wrong',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'There was an error processing your request, please try again later',
      msgtype: 'm.text',
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
      .dom(
        '[data-test-message-idx="1"] [data-test-alert-action-button="Retry"]',
      )
      .doesNotExist('Only last errored message has a retry button');

    assert
      .dom('[data-test-message-idx="3"]')
      .containsText(
        'There was an error processing your request, please try again later',
      );
    assert
      .dom(
        '[data-test-message-idx="3"] [data-test-alert-action-button="Retry"]',
      )
      .exists('Only last errored message has a retry button');

    assert.dom('[data-test-message-idx="4"]').doesNotExist();

    await click('[data-test-alert-action-button="Retry"]');

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
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
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
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
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
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
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
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
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
        body: 'A message that was sent sixteen minutes ago.',
        msgtype: 'm.text',
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
      .containsText('I sent a message from the background.');

    // Send another message that will open a toast
    await click('[data-test-close-ai-assistant]');
    simulateRemoteMessage(
      anotherRoomId,
      '@aibot:localhost',
      {
        body: 'Toasty!',
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: fourteenMinutesAgo.getTime(),
      },
    );
    await waitFor('[data-test-ai-assistant-toast]');

    assert.dom('[data-test-ai-assistant-toast]').exists();
    await settled();
    await waitFor('[data-test-close-toast]');
    await click('[data-test-close-toast]');
    await waitUntil(
      () => !document.querySelector('[data-test-ai-assistant-toast]'),
    );
    assert.dom('[data-test-ai-assistant-toast]').doesNotExist();
  });

  test('continuation events should be combined into one message that uses `created` from the oldest message', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    let firstMessageId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
        [APP_BOXEL_REASONING_CONTENT_KEY]: 'Here is some reasoning that',
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_REASONING_CONTENT_KEY]:
          'Here is some reasoning that I am doing to figure things out. It continues',
        [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
        ['m.relates_to']: {
          event_id: firstMessageId,
          rel_type: 'm.replace',
        },
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 31).getTime(),
      },
    );
    let secondMessageId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_REASONING_CONTENT_KEY]: ' with some more reasoning. Hmmm...',
        [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
        [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: firstMessageId,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 32).getTime(),
      },
    );
    await waitFor('[data-test-message-idx="0"]');
    await waitUntil(() =>
      (find('[data-test-message-idx="0"]') as HTMLElement)?.innerText.includes(
        'with some more reasoning',
      ),
    );

    assert
      .dom('[data-test-message-idx="0"]')
      .containsText(
        'Wednesday Jan 3, 2024, 12:30 PM Thinking... Here is some reasoning that I am doing to figure things out. It continues with some more reasoning. Hmmm...',
      );
    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .hasClass('ai-avatar-animated', 'Message is in progress');
    let thirdMessageId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'Now we are on to the body where ',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_REASONING_CONTENT_KEY]: '',
        [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
        [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: secondMessageId,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 33).getTime(),
      },
    );
    let fourthMessageId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'a thing can be done',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,

        [APP_BOXEL_REASONING_CONTENT_KEY]: '',
        [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: thirdMessageId,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 34).getTime(),
      },
    );

    await waitUntil(() =>
      (find('[data-test-message-idx="0"]') as HTMLElement).innerText.includes(
        'a thing can be done',
      ),
    );

    assert
      .dom('[data-test-message-idx="0"]')
      .containsText(
        'Wednesday Jan 3, 2024, 12:30 PM Thinking... Here is some reasoning that I am doing to figure things out. It continues with some more reasoning. Hmmm... Now we are on to the body where a thing can be done',
      );
    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .hasClass('ai-avatar-animated', 'Message is in progress');
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'a thing can be done.',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        ['m.relates_to']: {
          event_id: fourthMessageId,
          rel_type: 'm.replace',
        },

        [APP_BOXEL_REASONING_CONTENT_KEY]: '',
        [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: thirdMessageId,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 35).getTime(),
      },
    );
    await waitUntil(() =>
      (find('[data-test-message-idx="0"]') as HTMLElement).innerText.includes(
        'a thing can be done.',
      ),
    );
    assert
      .dom('[data-test-message-idx="0"]')
      .containsText(
        'Wednesday Jan 3, 2024, 12:30 PM Thinking... Here is some reasoning that I am doing to figure things out. It continues with some more reasoning. Hmmm... Now we are on to the body where a thing can be done.',
      );
    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'Message is in no longer in progress',
      );
  });

  test('ensures cards are reuploaded only when content changes', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    // Send first message with the card
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'First message with card',
    );
    await click('[data-test-send-message-btn]');

    // Send second message with the same card
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Second message with same card',
    );
    await click('[data-test-send-message-btn]');

    // Get the first two message events
    let messageEvents = getRoomEvents(roomId).filter(
      (e) => e.type === 'm.room.message',
    );
    let firstMessageEvent = messageEvents[0];
    let secondMessageEvent = messageEvents[1];
    let firstMessageData = firstMessageEvent.content.data
      ? JSON.parse(firstMessageEvent.content.data)
      : undefined;
    let secondMessageData = secondMessageEvent.content.data
      ? JSON.parse(secondMessageEvent.content.data)
      : undefined;

    // Verify first two messages have the same card URL
    assert.ok(
      firstMessageData?.attachedCards,
      'First message has attached cards',
    );
    assert.ok(
      secondMessageData?.attachedCards,
      'Second message has attached cards',
    );
    assert.strictEqual(
      firstMessageData.attachedCards[0].url,
      secondMessageData.attachedCards[0].url,
      'First and second messages use the same URL',
    );
    assert.strictEqual(
      firstMessageData.attachedCards[0].sourceUrl,
      secondMessageData.attachedCards[0].sourceUrl,
      'First and second messages have the same source URL',
    );

    // Now modify the card
    await click('[data-test-edit-button]');
    await fillIn('[data-test-field="firstName"] input', 'Updated Name');
    await click('[data-test-edit-button]');

    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Third message with modified card',
    );
    await click('[data-test-send-message-btn]');

    // Get the third message event
    messageEvents = getRoomEvents(roomId).filter(
      (e) => e.type === 'm.room.message',
    );
    let thirdMessageEvent = messageEvents[2];
    let thirdMessageData = thirdMessageEvent.content.data
      ? JSON.parse(thirdMessageEvent.content.data)
      : undefined;

    // Verify third message has a different card URL
    assert.ok(
      thirdMessageData?.attachedCards,
      'Third message has attached cards',
    );
    assert.notEqual(
      firstMessageData.attachedCards[0].url,
      thirdMessageData.attachedCards[0].url,
      'Third message uses a different URL after modification',
    );
    assert.strictEqual(
      firstMessageData.attachedCards[0].sourceUrl,
      thirdMessageData.attachedCards[0].sourceUrl,
      'Source URLs remain the same even after modification',
    );
  });

  test('ensures files are reuploaded only when content changes', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await click('[data-test-file="example-file.gts"]');
    assert.dom('[data-test-attached-file]').exists({ count: 1 });

    // Send first message with the file
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'First message with file',
    );
    await click('[data-test-send-message-btn]');

    // Send second message with the same file
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Second message with same file',
    );
    await click('[data-test-send-message-btn]');

    // Get the first two message events
    let messageEvents = getRoomEvents(roomId).filter(
      (e) => e.type === 'm.room.message',
    );
    let firstMessageEvent = messageEvents[0];
    let secondMessageEvent = messageEvents[1];
    let firstMessageData = firstMessageEvent.content.data
      ? JSON.parse(firstMessageEvent.content.data)
      : undefined;
    let secondMessageData = secondMessageEvent.content.data
      ? JSON.parse(secondMessageEvent.content.data)
      : undefined;

    // Verify first two messages have the same card URL
    assert.ok(
      firstMessageData?.attachedFiles,
      'First message has attached files',
    );
    assert.ok(
      secondMessageData?.attachedFiles,
      'Second message has attached files',
    );
    assert.strictEqual(
      firstMessageData.attachedFiles[0].url,
      secondMessageData.attachedFiles[0].url,
      'First and second messages use the same URL',
    );
    assert.strictEqual(
      firstMessageData.attachedFiles[0].sourceUrl,
      secondMessageData.attachedFiles[0].sourceUrl,
      'First and second messages have the same source URL',
    );

    // Now modify the file
    let commandSrc = getMonacoContent();
    setMonacoContent(
      commandSrc.replace(
        `@field name = contains(StringField);`,
        `@field updatedName = contains(StringField);`,
      ),
    );
    await settled();

    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Third message with modified file',
    );
    await click('[data-test-send-message-btn]');
    await waitFor('[data-test-message-idx="2"]');

    // Get the third message event
    messageEvents = getRoomEvents(roomId).filter(
      (e) => e.type === 'm.room.message',
    );
    let thirdMessageEvent = messageEvents[2];
    let thirdMessageData = thirdMessageEvent.content.data
      ? JSON.parse(thirdMessageEvent.content.data)
      : undefined;

    // Verify third message has a different card URL
    assert.ok(
      thirdMessageData?.attachedFiles,
      'Third message has attached files',
    );
    assert.notEqual(
      firstMessageData.attachedFiles[0].url,
      thirdMessageData.attachedFiles[0].url,
      'Third message uses a different URL after modification',
    );
    assert.strictEqual(
      firstMessageData.attachedFiles[0].sourceUrl,
      thirdMessageData.attachedFiles[0].sourceUrl,
      'Source URLs remain the same even after modification',
    );
  });

  test('displays non-standard used LLMs in panel', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    await getService('matrix-service').sendActiveLLMEvent(
      roomId,
      'non-standard-llm-1',
    );
    await waitUntil(() =>
      find(`[data-test-llm-select-selected]`)?.textContent?.includes(
        'non-standard-llm-1',
      ),
    );
    await getService('matrix-service').sendActiveLLMEvent(
      roomId,
      'non-standard-llm-2',
    );
    await waitUntil(() =>
      find(`[data-test-llm-select-selected]`)?.textContent?.includes(
        'non-standard-llm-2',
      ),
    );
    assert
      .dom(`[data-test-llm-select-selected]`)
      .containsText(
        'non-standard-llm-2',
        'Non-standard LLM is displayed in the panel',
      );
    await click(`[data-test-llm-select-selected]`);
    assert.dom('.menu-content').containsText('non-standard-llm-1');
    assert.dom('.menu-content').containsText('non-standard-llm-2');
  });

  test('new session settings menu - comprehensive functionality', async function (assert) {
    await renderAiAssistantPanel();
    await fillIn('[data-test-boxel-input-id="ai-chat-input"]', 'Test message');
    await click('[data-test-send-message-btn]');

    // Test initial state
    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu should not be visible initially');

    // Test tooltip appears on hover
    await triggerEvent('[data-test-create-room-btn]', 'mouseenter');

    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText(
        'New Session (Shift+Click for options)',
        'Tooltip shows correct text when menu is closed',
      );

    // Test menu opens on Shift+Click
    await click('[data-test-create-room-btn]', { shiftKey: true });

    await waitFor('[data-test-new-session-settings-menu]');

    // Test tooltip changes when menu is open
    await triggerEvent('[data-test-create-room-btn]', 'mouseenter');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText(
        'Close New Session Settings',
        'Tooltip shows correct text when menu is open',
      );

    assert
      .dom('[data-test-new-session-settings-title]')
      .hasText('New Session Options', 'Menu title is displayed correctly');

    assert
      .dom('[data-test-new-session-settings-option]')
      .exists({ count: 3 }, 'All three options are present');
    assert
      .dom('[data-test-new-session-settings-label="Add Same Skills"]')
      .exists('First option is present');
    assert
      .dom('[data-test-new-session-settings-label="Copy File History"]')
      .exists('Second option is present');
    assert
      .dom('[data-test-new-session-settings-label="Summarize Current Session"]')
      .exists('Third option is present');

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .doesNotExist('No checkboxes are initially checked');
    await percySnapshot(assert);

    // Test checkbox functionality
    await click('[data-test-new-session-settings-checkbox="Add Same Skills"]');

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .exists({ count: 1 }, 'One checkbox should be checked');

    await click(
      '[data-test-new-session-settings-checkbox="Copy File History"]',
    );

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .exists({ count: 2 }, 'One checkboxes should be checked');

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .exists({ count: 2 }, 'Two checkboxes should be checked');

    await click('[data-test-new-session-settings-checkbox="Add Same Skills"]');

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .exists({ count: 1 }, 'One checkbox should be checked after unchecking');

    // Test close button functionality
    assert
      .dom('[data-test-new-session-settings-close-button]')
      .exists('Close button should be present');

    await click('[data-test-new-session-settings-close-button]');

    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu should be hidden after clicking close button');

    // Test menu opens again on Shift+Click
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await waitFor('[data-test-new-session-settings-menu]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .exists('Menu should be visible after Shift+Click again');

    // Use plus button to close menu
    await click('[data-test-create-room-btn]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu shoud be hidden after clicking plus button');

    // Test menu opens again on Shift+Click
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await waitFor('[data-test-new-session-settings-menu]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .exists('Menu should be visible after Shift+Click again');

    // Test create button functionality
    assert
      .dom('[data-test-new-session-settings-create-button]')
      .hasText('Start New Session', 'Create button should have correct text');
    await click('[data-test-new-session-settings-create-button]');

    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu should be hidden after clicking create button');

    // Make create button enabled
    await waitFor('[data-test-room-settled]');
    await fillIn('[data-test-boxel-input-id="ai-chat-input"]', 'Test message');
    await click('[data-test-send-message-btn]');
    // Test menu opens again and create with options selected
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await waitFor('[data-test-new-session-settings-menu]');

    // Select some options
    await click('[data-test-new-session-settings-checkbox="Add Same Skills"]');

    assert
      .dom('[data-test-new-session-settings-option].checked')
      .exists({ count: 2 }, 'Two checkboxes should be checked before creating');

    await click('[data-test-new-session-settings-create-button]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist(
        'Menu should be hidden after creating with options selected',
      );

    // Make create button enabled
    await waitFor('[data-test-room-settled]');
    await fillIn('[data-test-boxel-input-id="ai-chat-input"]', 'Test message');
    await click('[data-test-send-message-btn]');
    // Test click outside functionality
    await click('[data-test-create-room-btn]', { shiftKey: true });

    await waitFor('[data-test-new-session-settings-menu]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .exists('Menu should be visible for click outside test');

    // Click outside the menu
    await click('[data-test-boxel-input-id="ai-chat-input"]');
    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu should be hidden after clicking outside');

    // Test normal click creates session immediately (without opening menu)
    await click('[data-test-create-room-btn]');

    assert
      .dom('[data-test-new-session-settings-menu]')
      .doesNotExist('Menu should not open on normal click');

    // Make create button enalebed
    await waitFor('[data-test-room-settled]');
    await fillIn('[data-test-boxel-input-id="ai-chat-input"]', 'Test message');
    await click('[data-test-send-message-btn]');
    // Verify tooltip shows correct text after normal click
    await triggerEvent('[data-test-create-room-btn]', 'mouseenter');
    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText(
        'New Session (Shift+Click for options)',
        'Tooltip shows correct text after normal click',
      );
  });
});
