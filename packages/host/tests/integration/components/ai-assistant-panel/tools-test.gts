import { waitFor, click, fillIn } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, skip, test } from 'qunit';

import { skillCardRef } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  addSkillToAiAssistant,
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  type TestContextWithSave,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
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

module('Integration | ai-assistant-panel | tools', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  const readOnlyRealmName = 'Read Only Workspace';
  const readOnlyRealmURL = 'http://test-realm/read-only/';
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
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, readOnlyRealmURL],
    realmPermissions: {
      [testRealmURL]: ['read', 'write'],
      [readOnlyRealmURL]: ['read'],
    },
    autostart: true,
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let { createAndJoinRoom, simulateRemoteMessage, getRoomEvents } =
    mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
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
          <div class='pet-container'>
            <@fields.pet />
          </div>
          Friends:
          <@fields.friends />
          <div data-test-addresses>Address: <@fields.address /></div>
          <style scoped>
            .pet-container {
              height: 120px;
              padding: 10px;
            }
          </style>
        </template>
      };
    }

    let petMango = new Pet({ name: 'Mango' });
    let petJackie = new Pet({ name: 'Jackie' });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'address.gts': { Address },
        'hello.txt': 'Hello, world!',
        'person.gts': { Person },
        'pet.gts': { Pet },
        'Pet/mango.json': petMango,
        'Pet/jackie.json': petJackie,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
        }),
        'Person/burcu.json': new Person({
          firstName: 'Burcu',
          friends: [petJackie, petMango],
        }),
        'Person/mickey.json': new Person({
          firstName: 'Mickey',
        }),
        'Person/justin.json': new Person({ firstName: 'Justin' }),
        'Person/ian.json': new Person({ firstName: 'Ian' }),
        'Person/matic.json': new Person({ firstName: 'Matic' }),
        'Person/buck.json': new Person({ firstName: 'Buck' }),
        'Person/hassan.json': new Person({ firstName: 'Hassan' }),
        'Skill/boxel-environment.json': {
          data: {
            attributes: {
              title: 'Boxel Environment',
              description: 'Test environment skill',
              instructions: 'Test skill card for environment commands',
              commands: [
                {
                  codeRef: {
                    name: 'SearchCardsByTypeAndTitleTool',
                    module: '@cardstack/boxel-host/commands/search-cards',
                  },
                  requiresApproval: false,
                },
                {
                  codeRef: {
                    name: 'SearchCardsByQueryTool',
                    module: '@cardstack/boxel-host/commands/search-cards',
                  },
                  requiresApproval: false,
                },
                {
                  codeRef: {
                    name: 'default',
                    module:
                      '@cardstack/boxel-host/commands/read-file-for-ai-assistant',
                  },
                  requiresApproval: false,
                },
                {
                  codeRef: {
                    name: 'default',
                    module:
                      '@cardstack/boxel-host/commands/read-card-for-ai-assistant',
                  },
                  requiresApproval: false,
                },
              ],
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
        'realm.json': realmConfigCardJSON({ name: realmName }),
      },
    });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: readOnlyRealmURL,
      contents: {
        'pet.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
          }
        `,
        'person.gts': `
          import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          import { Pet } from "./pet";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
            @field pet = linksTo(Pet);
          }
        `,
        'Person/ian.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Ian',
            },
            relationships: {
              pet: {
                data: {
                  type: 'card',
                  id: `${readOnlyRealmURL}Pet/rose`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './person',
                name: 'Person',
              },
            },
          },
        },
        'Pet/rose.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Rose',
            },
            meta: {
              adoptsFrom: {
                module: './pet',
                name: 'Pet',
              },
            },
          },
        },
        'realm.json': realmConfigCardJSON({ name: readOnlyRealmName }),
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

  test<TestContextWithSave>('it allows chat commands to change cards in the stack', async function (assert) {
    assert.expect(4);

    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person]');
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          }),
        },
      ],
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: 'patch1',
      },
    });

    await waitFor('[data-test-tool-call-apply]');
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.firstName, 'Dave');
    });
    await click('[data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');
    assert.dom('[data-test-person]').hasText('Dave');
  });

  test('when a command is being prepared, apply button is shown in preparing state', async function (assert) {
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
    let initialEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCardInstance',
        },
      ],
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: initialEventId,
      },
    });

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists();
  });

  test('it does not display the streaming indicator when ai bot sends a command', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'fb8fef81-2142-4861-a902-d5614b0aea52',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          }),
        },
      ],
    });

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'ai bot patch message does not have a spinner',
      );
  });

  test('when command is done streaming, apply button is shown in ready state', async function (assert) {
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
    let initialEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCardInstance',
        },
      ],
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: initialEventId,
      },
    });

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 1 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          }),
        },
      ],
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: initialEventId,
      },
    });
    await settled();

    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 2 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          }),
        },
      ],
      isStreamingFinished: true,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: initialEventId,
      },
    });
    await settled();

    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 0 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-tool-call-apply="ready"]')
      .exists({ count: 2 });
  });

  test('after command is executed, a command result event will be dispatched', async function (assert) {
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
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
      ],
    });
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).context,
      {
        agentId: getService('matrix-service').agentId,
        submode: 'interact',
        debug: false,
        openCardIds: ['http://test-realm/test/Person/fadhlan'],
        realmUrl: 'http://test-realm/test/',
        realmPermissions: {
          canRead: true,
          canWrite: true,
        },
      },
      'command result event contains the context',
    );
  });

  test('after search command is executed, a command result event is dispatched', async function (assert) {
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
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Changing first name to Evie',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
      ],
    });
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) => event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    );
    assert.strictEqual(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) => event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    );
    assert.strictEqual(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).context,
      {
        agentId: getService('matrix-service').agentId,
        submode: 'interact',
        debug: false,
        openCardIds: ['http://test-realm/test/Person/fadhlan'],
        realmUrl: 'http://test-realm/test/',
        realmPermissions: {
          canRead: true,
          canWrite: true,
        },
      },
      'command result event contains the context',
    );
  });

  test('it can search for card instances that is of the same card type as the card shared', async function (assert) {
    let id = `${testRealmURL}Pet/mango.json`;
    let roomId = await renderAiAssistantPanel(id);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'search1',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify({
            description: 'Searching for card',
            attributes: {
              type: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]', { timeout: 10_000 });
    assert
      .dom('[data-test-ai-message-content]')
      .containsText('Search for the following card');
    assert
      .dom('[data-test-ai-message-content] [data-test-view-code-button]')
      .exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-boxel-card-header-title]')
      .containsText('Search Results');

    assert.dom('.result-list li').exists({ count: 2 });

    assert.dom('.result-list li:nth-child(1)').containsText('Jackie');
    assert.dom('.result-list li:nth-child(2)').containsText('Mango');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });

  test('it can search for card instances based upon title of card', async function (assert) {
    let id = `${testRealmURL}Pet/mango.json`;
    let roomId = await renderAiAssistantPanel(id);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'search1',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify({
            description: 'Searching for card',
            attributes: {
              cardTitle: 'Mango',
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]', { timeout: 10_000 });
    assert
      .dom('[data-test-ai-message-content]')
      .containsText('Search for the following card');
    assert
      .dom('[data-test-ai-message-content] [data-test-view-code-button]')
      .exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-boxel-card-header-title]')
      .containsText('Search Results');

    assert.dom('.result-list li:nth-child(1)').containsText('Mango');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });

  test('toggle more search results', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan.json`;
    let roomId = await renderAiAssistantPanel(id);
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '721c8c78-d8c1-4cc1-a7e9-51d2d3143e4d',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify({
            description: 'Searching for card',
            attributes: {
              type: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]');
    assert.dom('.result-list li:nth-child(6)').doesNotExist();
    assert
      .dom('[data-test-toggle-show-button]')
      .containsText('Show 3 more results');
    await click('[data-test-toggle-show-button]');

    await waitFor('.result-list li', { count: 8 });
    assert.dom('[data-test-toggle-show-button]').containsText('See Less');
    assert.dom('.result-list li:nth-child(1)').containsText('Buck');
    assert.dom('.result-list li:nth-child(2)').containsText('Burcu');
    assert.dom('.result-list li:nth-child(3)').containsText('Fadhlan');
    assert.dom('.result-list li:nth-child(4)').containsText('Hassan');
    assert.dom('.result-list li:nth-child(5)').containsText('Ian');
    assert.dom('.result-list li:nth-child(6)').containsText('Justin');
    assert.dom('.result-list li:nth-child(7)').containsText('Matic');
    assert.dom('.result-list li:nth-child(8)').containsText('Mickey');
    await click('[data-test-toggle-show-button]');
    assert.dom('.result-list li:nth-child(1)').containsText('Buck');
    assert.dom('.result-list li:nth-child(2)').containsText('Burcu');
    assert.dom('.result-list li:nth-child(3)').containsText('Fadhlan');
    assert.dom('.result-list li:nth-child(4)').containsText('Hassan');
    assert.dom('.result-list li:nth-child(5)').containsText('Ian');
    assert.dom('.result-list li:nth-child(6)').doesNotExist();
  });

  test('it can copy search results card to workspace', async function (assert) {
    const id = `${testRealmURL}Person/fadhlan`;
    const roomId = await renderAiAssistantPanel(`${id}.json`);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        type: {
          module: `${testRealmURL}person`,
          name: 'Person',
        },
      },
    };

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'fd4515fb-ed4d-4005-9782-4e844d7d4d9c',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify(toolArgs),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]');
    assert.dom(`[data-test-stack-card="${id}"]`).exists();
    assert
      .dom('[data-test-message-idx="0"] [data-test-boxel-card-header-title]')
      .containsText('Search Results');

    let resultListItem = '[data-test-result-list] > li';
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(5)`).containsText('Ian');

    const rightStackItem =
      '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]';
    assert.dom(rightStackItem).doesNotExist();

    await click(
      '[data-test-tool-result-container] [data-test-more-options-button]',
    );
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${rightStackItem} [data-test-boxel-card-header-title]`)
      .hasText('Search Results - Search Results');

    const savedCardId = document
      .querySelector(rightStackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-tool-result-isolated]`;
    assert.dom(`${savedCard} header`).hasText('Search Results 8 Results');
    assert.dom(`${savedCard} [data-test-boxel-field]`).exists({ count: 2 });
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(1)`)
      .hasText(
        `Description Query: { "type": { "module": "http://test-realm/test/person", "name": "Person" } }`,
      );

    resultListItem = `${savedCard} ${resultListItem}`;
    assert.dom(resultListItem).exists({ count: 8 });
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(6)`).containsText('Justin');
    assert.dom(`${resultListItem}:nth-child(8)`).containsText('Mickey');
  });

  test('copy to workspace menu item is shown for writable realm', async function (assert) {
    const id = `${testRealmURL}Person/fadhlan`;
    const roomId = await renderAiAssistantPanel(`${id}.json`);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        type: {
          module: `${testRealmURL}person`,
          name: 'Person',
        },
      },
    };

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '9a5b7422-87de-4a93-9f07-9b7c40b75b1e',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify(toolArgs),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]');

    await click(
      '[data-test-tool-result-container] [data-test-more-options-button]',
    );
    assert.dom('[data-test-boxel-menu-item-text="Copy to Workspace"]').exists();
  });

  test('copy to workspace menu item is hidden for read-only realm', async function (assert) {
    const id = `${readOnlyRealmURL}Person/ian`;
    const roomId = await renderAiAssistantPanel(`${id}.json`);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        type: {
          module: `${testRealmURL}person`,
          name: 'Person',
        },
      },
    };

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6c6e2d73-8e09-4b44-a0d9-688f36b73be8',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify(toolArgs),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]');

    assert
      .dom('[data-test-tool-result-container] [data-test-more-options-button]')
      .doesNotExist();
    assert
      .dom('[data-test-boxel-menu-item-text="Copy to Workspace"]')
      .doesNotExist();
  });

  test('it can copy search results card to workspace (no cards in stack)', async function (assert) {
    const id = `${testRealmURL}Person/fadhlan`;
    const roomId = await renderAiAssistantPanel(`${id}.json`);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        type: {
          module: `${testRealmURL}person`,
          name: 'Person',
        },
      },
    };

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'ffd1a3d0-0bd4-491a-a907-b96ec9d8902c',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify(toolArgs),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-tool-result-header]');
    assert.dom(`[data-test-stack-card="${id}"]`).exists();
    await click('[data-test-close-button]'); // close the last open card
    assert.dom(`[data-test-stack-card="${id}"]`).doesNotExist();
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    await click('[data-test-close-button]'); // close index card
    assert
      .dom('[data-test-message-idx="0"] [data-test-boxel-card-header-title]')
      .containsText('Search Results');

    assert
      .dom('[data-test-tool-result-container] [data-test-toggle-show-button]')
      .containsText('Show 3 more results');
    let resultListItem = '[data-test-result-list] > li';
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(5)`).containsText('Ian');

    const stackItem =
      '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]';
    assert.dom(stackItem).doesNotExist();

    await click(
      '[data-test-tool-result-container] [data-test-more-options-button]',
    );
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${stackItem} [data-test-boxel-card-header-title]`)
      .hasText('Search Results - Search Results');

    const savedCardId = document
      .querySelector(stackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-tool-result-isolated]`;
    assert.dom(`${savedCard} header`).hasText('Search Results 8 Results');
    assert.dom(`${savedCard} [data-test-boxel-field]`).exists({ count: 2 });
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(1)`)
      .hasText(
        `Description Query: { "type": { "module": "http://test-realm/test/person", "name": "Person" } }`,
      );

    resultListItem = `${savedCard} ${resultListItem}`;
    assert.dom(resultListItem).exists({ count: 8 });
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(6)`).containsText('Justin');
    assert.dom(`${resultListItem}:nth-child(8)`).containsText('Mickey');
  });

  test('it maintains status of View Code panel as additional events stream in', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let room1Id = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });

    simulateRemoteMessage(room1Id, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
      ],
    });

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    assert
      .dom('[data-test-ai-message-content] [data-test-editor]')
      .doesNotExist('View Code panel should not yet be open');
    await click('[data-test-view-code-button]');
    assert
      .dom('[data-test-ai-message-content] [data-test-editor]')
      .exists('View Code panel should be open');

    await fillIn(
      '[data-test-message-field]',
      'Asking a question about what I saw in the proposed code...',
    );
    await click('[data-test-send-message-btn]');

    // previously, a new event would cause re-rendering and the open-ness of the View Code panel to be lost
    assert
      .dom('[data-test-ai-message-content] [data-test-editor]')
      .exists('View Code panel should remain open');
    await percySnapshot(assert); // can preview code in ViewCode panel
  });

  test('when command in a message with continuations is done streaming, apply button is shown in ready state', async function (assert) {
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
    let initialEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: initialEventId,
      },
    });
    let continuationEventId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'Changing first names',
        format: 'org.matrix.custom.html',
        [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: initialEventId,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
            name: 'patchCard',
          },
        ],
        isStreamingFinished: false,
      },
    );

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 1 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: initialEventId,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCard',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCard',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          }),
        },
      ],
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: continuationEventId,
      },
    });
    await settled();

    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 2 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]: initialEventId,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCard',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Evie' },
              },
            },
          }),
        },
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCard',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          }),
        },
      ],
      isStreamingFinished: true,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: continuationEventId,
      },
    });
    await settled();

    assert.dom('[data-test-message-idx]').exists({ count: 1 });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom(
        '[data-test-message-idx="0"] [data-test-tool-call-apply="preparing"]',
      )
      .exists({ count: 0 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-tool-call-apply="ready"]')
      .exists({ count: 2 });
  });

  //TODO: unskip when the boxel skills instances have been updated to the new cardDef fields
  skip('command that returns a FileForAttachmentCard result is specially handled to attach the file', async function (assert) {
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
    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]', { timeout: 10000 });

    // add environment skill
    await addSkillToAiAssistant(`${testRealmURL}Skill/boxel-environment`);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Reading hello file',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '0ce51dc1-c819-4d6d-9f4f-77fbf60e9a0a',
          name: 'read-file-for-ai-assistant_a831',
          arguments: JSON.stringify({
            attributes: {
              fileIdentifier: `${testRealmURL}hello.txt`,
            },
          }),
        },
      ],
    });
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );

    await settled();

    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedFiles.length,
      1,
      'command result event contains an attached file',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedFiles[0].name,
      'hello.txt',
      'command result event contains attached file',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedFiles[0]
        .sourceUrl,
      'http://test-realm/test/hello.txt',
      'command result event contains file whose url was reference in the input of the command as an attached file',
    );
  });

  //TODO: unskip when the boxel skills instances have been updated to the new cardDef fields
  skip('command that returns a CardForAttachmentCard result is specially handled to attach the card', async function (assert) {
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
    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]', { timeout: 10000 });

    // add environment skill
    await addSkillToAiAssistant(`${testRealmURL}Skill/boxel-environment`);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Reading card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '1ef9a66a-2201-4874-a156-9705acb1ac13',
          name: 'read-card-for-ai-assistant_dd38',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Pet/mango`,
            },
          }),
        },
      ],
    });
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );

    await settled();

    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedCards.length,
      1,
      'command result event contains an attached file',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedCards[0].name,
      'Mango',
      'command result event contains attached card',
    );
    assert.deepEqual(
      JSON.parse(commandResultEvents[0].content.data).attachedCards[0]
        .sourceUrl,
      'http://test-realm/test/Pet/mango',
      'command result event contains file whose url was reference in the input of the command as an attached file',
    );
  });

  // The host's MessageTool.eventId is captured from the bot message's
  // effectiveEventId at construction time and never refreshes. When a tool_call
  // first appears on a later m.replace event, the bot message's "current"
  // event_id (in room.events) is the m.replace's event_id — but
  // MessageTool.eventId is the parent/original. Emitting a commandResult
  // bound to the parent id can disagree with what ai-bot's `getRoomEvents`
  // reads via /messages, so the host sources the linkage event_id from
  // current room state at execute time.
  test('commandResult event_id is sourced from current room state, not a streaming snapshot', async function (assert) {
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

    let commandRequestId = 'cmd-request-id';

    // Streaming event #1: original bot message, no toolRequests yet.
    let streamingEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });

    // Streaming event #2: m.replace adding the tool_call. After this,
    // room.events has both events. The latest event with the matching
    // commandRequestId is the m.replace event (replacedEventId), while
    // MessageTool.eventId is streamingEventId because getEffectiveEventId
    // resolves replace events to their parent and updateMessage refreshes
    // content but not eventId. The host emits
    // commandResult.m.relates_to.event_id = replacedEventId — what room.events
    // currently shows for the bot message that owns this tool_call.
    let replacedEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: commandRequestId,
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Evie' } },
            },
          }),
        },
      ],
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: streamingEventId,
      },
    });

    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor('[data-test-tool-call-card-idle]');

    // The host's MessageTool must reach 'applied' state once the
    // commandResult is dispatched. _messageCache is keyed by the bot
    // message's effective/parent id (streamingEventId), but the dispatched
    // commandResult.m.relates_to.event_id is the latest m.replace
    // (replacedEventId). updateMessageCommandResult in resources/room.ts has
    // to derive the cache key from the located bot-message event so the
    // m.replace id Y still resolves back to the parent X — otherwise the
    // status flip is silently lost and the UI stays re-applicable.
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists(
        'MessageTool status should flip to applied even though commandResult.m.relates_to.event_id is the m.replace id, not the streaming id the cache is keyed by',
      );

    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_TOOL_RESULT_REL_TYPE,
    );

    assert.strictEqual(
      commandResultEvents.length,
      1,
      'exactly one commandResult should be dispatched',
    );
    assert.strictEqual(
      commandResultEvents[0].content['m.relates_to']?.event_id,
      replacedEventId,
      'commandResult.m.relates_to.event_id should be the bot message event_id currently in room.events that owns the toolRequest, not a stale snapshot of the streaming/original id',
    );
    assert.notStrictEqual(
      commandResultEvents[0].content['m.relates_to']?.event_id,
      streamingEventId,
      'commandResult should not reference the original/streaming event_id once a later event in room.events owns the toolRequest',
    );
  });

  // When a command is applied on a streamed bot message, its commandResult is
  // linked to the latest m.replace edit id Y. On reload the timeline filter
  // strips all m.replace edits, so only the original event X is loaded (with
  // aggregated content) and Y is absent — the result's event_id link dangles.
  // Correlating the result to its command by commandRequestId, not by that
  // event_id, keeps the command rendered as applied.
  test('an applied command on a streamed bot message still renders applied after reload (m.replace edits stripped)', async function (assert) {
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

    let commandRequestId = 'cmd-request-id';
    // The edit event Y that owns the commandResult link; reload strips it via
    // the m.replace timeline filter, so no loaded event has this id — the
    // result's m.relates_to.event_id dangles.
    let strippedEditEventId = 'stripped-edit-event-id';

    // The only bot message that survives reload: the original event X with the
    // final edit's content aggregated in, so it carries the command request.
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: commandRequestId,
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Evie' } },
            },
          }),
        },
      ],
    });

    // The persisted commandResult, linked to the stripped edit id Y rather than
    // the surviving original X — exactly what reload loads from the server.
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId,
        'm.relates_to': {
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
          key: 'applied',
          event_id: strippedEditEventId,
        },
        data: {},
      },
      { type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE },
    );

    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists(
        'a command applied before reload still renders applied even though its commandResult links to a stripped m.replace edit id; correlation is by commandRequestId, not the dangling event_id',
      );
  });

  // commandRequestId correlation must resolve the *specific* owning bot
  // message, not just the first one that happens to carry a command request.
  // With two streamed bot messages, an applied result for one must flip only
  // that message; the other stays ready.
  test('an applied commandResult flips only its own bot message, not a sibling message that also carries a command', async function (assert) {
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

    let firstCommandRequestId = 'first-cmd-request-id';
    let secondCommandRequestId = 'second-cmd-request-id';
    let strippedEditEventId = 'stripped-edit-event-id';

    // First bot message (idx 0): carries a command but is never applied.
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: firstCommandRequestId,
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Evie' } },
            },
          }),
        },
      ],
    });

    // Second bot message (idx 1): the one whose command was applied pre-reload.
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Mango',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: secondCommandRequestId,
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Mango' } },
            },
          }),
        },
      ],
    });

    // Applied result for the second message only, linked to a stripped edit id
    // so correlation has to fall through to commandRequestId.
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId: secondCommandRequestId,
        'm.relates_to': {
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
          key: 'applied',
          event_id: strippedEditEventId,
        },
        data: {},
      },
      { type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE },
    );

    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="1"]');

    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists(
        'the bot message whose commandRequestId owns the applied result renders applied',
      );
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="ready"]')
      .exists(
        'the sibling bot message, which has no result of its own, stays ready — the applied status did not bleed across messages',
      );
  });

  test('Accept All bar does not flash for an always-auto-executed command (checkCorrectness)', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // checkCorrectness is on the always-auto-execute list (one of three
    // branches in isAutoExecutableTool). Before the fix, the manual
    // approval bar painted for the ~100ms debounce window before
    // tool-service flipped `acceptingAllRoomIds`; the user saw
    // Accept All / Cancel briefly appear then disappear. The bar must
    // never paint in its manual-approval branch for any auto-executed
    // command, regardless of which condition triggers auto-execute.
    //
    // agentId must match the host's matrix service so the
    // agent-ownership gate in isAutoExecutableTool passes — otherwise
    // the predicate short-circuits to false (the not-our-agent case
    // exercised by acceptance/commands-test.gts) and the bar would show
    // for an unrelated reason.
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'checking correctness',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'cs-11647-check-correctness',
          name: 'checkCorrectness',
          arguments: '{}',
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-accept-all]')
      .doesNotExist(
        'Accept All button must not paint in the debounce window before auto-execute starts',
      );

    await settled();
    assert
      .dom('[data-test-accept-all]')
      .doesNotExist(
        'Accept All button still hidden after the auto-execute debounce window elapses',
      );
  });

  test('Accept All bar does not flash for a requiresApproval=false command', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'auto-exec via skill',
    });
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="auto-exec via skill"]', {
      timeout: 10000,
    });

    // The boxel-environment skill declares read-file-for-ai-assistant with
    // requiresApproval=false (see the skill JSON earlier in this module),
    // so MessageTool.requiresApproval is false here — the second
    // isAutoExecutableTool branch. The fix must also suppress the
    // Accept All bar for this path.
    await addSkillToAiAssistant(`${testRealmURL}Skill/boxel-environment`);

    let roomId = document
      .querySelector('[data-test-room]')!
      .getAttribute('data-test-room')!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Reading hello file',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'cs-11647-no-approval',
          name: 'read-file-for-ai-assistant_a831',
          arguments: JSON.stringify({
            attributes: { fileIdentifier: `${testRealmURL}hello.txt` },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-accept-all]')
      .doesNotExist(
        'Accept All button suppressed for requiresApproval=false commands',
      );
  });

  test('per-command Apply button does not flash Run before auto-execute starts', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // The per-command Apply button (rendered next to each tool-call message)
    // has the same race as the Accept All bar: between "message lands"
    // and "tool-service starts the run", a ready Run button would
    // briefly render. The fix presents the applying-spinner immediately
    // for any auto-executable command.
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'checking correctness',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'cs-11647-apply-button',
          name: 'checkCorrectness',
          arguments: '{}',
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-tool-call-apply="ready"]')
      .doesNotExist(
        'per-command Apply button must not show the ready/Run state for an auto-executed command',
      );
    assert
      .dom('[data-test-message-idx="0"] [data-test-tool-call-apply="applying"]')
      .exists('per-command Apply button shows the applying spinner instead');
    // The data-test-tool-call-card-idle attribute is computed from
    // applyButtonState (not the raw status); while the synthetic 'applying'
    // is on it must NOT mark the card idle. Glimmer omits an attribute
    // bound to a falsy expression, so the coherence check is on attribute
    // presence — the apply button + the card must agree the spinner is
    // up, not just one of them.
    assert
      .dom('[data-test-message-idx="0"] [data-test-tool-call-card-idle]')
      .doesNotExist(
        'data-test-tool-call-card-idle agrees with applyButtonState while the synthetic spinner is on',
      );
  });

  test('stuck-processing helper dispatches an invalid commandResult for each auto-executable command', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // Verifies the followup-fix for the synthetic-spinner hang flagged in
    // the self-review of this branch: drainToolProcessingQueue must
    // dispatch an `invalid` commandResult when a room is wedged, so the
    // synthetic 'applying' state in room-message-tool.gts falls through
    // to the invalidToolCallState ("Try Anyway") branch instead of pinning
    // a spinner that no terminal event ever clears.
    //
    // Driving the real wait-loop end-to-end is unstable: roomResource is
    // an ember-resources proxy so own-property defines for isProcessing /
    // processingLastStartedAt silently no-op, and there's no public seam
    // to keep the processRoomTask "running" without rewriting the
    // resource itself. Instead, exercise the helper directly with a
    // spied sendToolResultEvent on matrixService — this proves the
    // dispatch shape, the per-command iteration, and the failureReason
    // text without depending on the proxy internals.
    let matrixService = getService('matrix-service');
    let toolService = getService('tool-service');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'checking correctness',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'cs-11647-stuck-auto',
          name: 'checkCorrectness',
          arguments: '{}',
        },
        {
          id: 'cs-11647-stuck-manual',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Dave' } },
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: matrixService.agentId,
        },
      },
    });
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');

    let roomResource = matrixService.roomResources.get(roomId)!;
    let message = roomResource.messages.find((m: any) => m.tools?.length === 2);
    assert.ok(message, 'two-command bot message lands in the room resource');

    let captured: Array<{ toolCallId: string; failureReason?: string }> = [];
    let originalSend = matrixService.sendToolResultEvent.bind(matrixService);
    (matrixService as any).sendToolResultEvent = async (params: any) => {
      captured.push({
        toolCallId: params.toolCallId,
        failureReason: params.failureReason,
      });
    };
    try {
      await (
        toolService as any
      ).invalidateAutoExecutableToolsForStuckProcessing(
        roomResource,
        roomId,
        message!.eventId,
      );
    } finally {
      (matrixService as any).sendToolResultEvent = originalSend;
    }

    assert.strictEqual(
      captured.length,
      1,
      'only the auto-executable command is invalidated; manual-approval command is left in ready',
    );
    assert.strictEqual(
      captured[0]?.toolCallId,
      'cs-11647-stuck-auto',
      'the dispatched invalid event targets the auto-executable command',
    );
    assert.true(
      (captured[0]?.failureReason ?? '').startsWith(
        'Room processing did not finish within',
      ),
      'failureReason surfaces the stuck-processing cause for the invalidToolCallState alert',
    );
  });

  test('an invalid result is terminal for auto-execution: a later drain pass does not re-resolve the request', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let matrixService = getService('matrix-service');
    let toolService = getService('tool-service');

    // Capture result events without forwarding them. The swallowed event
    // recreates the window where the invalid result has not round-tripped
    // into the room resource yet, so the MessageTool's status still reads
    // 'ready' — the window in which a second drain pass used to re-validate
    // the request and post a contradictory second result (CS-12103's
    // invalid-then-applied signature).
    let captured: Array<{ toolCallId: string; status: string }> = [];
    let originalSend = matrixService.sendToolResultEvent.bind(matrixService);
    (matrixService as any).sendToolResultEvent = async (params: any) => {
      captured.push({ toolCallId: params.toolCallId, status: params.status });
    };
    try {
      let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: 'Do the thing',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: 'cs-12103-invalid-terminal',
            name: 'no-such-command',
            arguments: JSON.stringify({
              description: 'do it',
              attributes: {},
            }),
          },
        ],
        data: {
          context: {
            agentId: matrixService.agentId,
          },
        },
      });
      await settled();

      assert.deepEqual(
        captured,
        [{ toolCallId: 'cs-12103-invalid-terminal', status: 'invalid' }],
        'validation resolves the request invalid exactly once',
      );
      assert.true(
        toolService.claimedToolRequestIds.has('cs-12103-invalid-terminal'),
        'the terminal resolution is recorded locally, not just in the (still in-flight) result event',
      );

      // A later pass over the same event — e.g. a trailing m.replace
      // re-queuing it — must not re-validate a request the model has
      // already been told failed.
      toolService.queueEventForToolProcessing({
        event_id: eventId,
        room_id: roomId,
        content: {} as any,
      });
      await settled();

      assert.strictEqual(
        captured.length,
        1,
        'the resolved request gets no second result and is not executed',
      );
    } finally {
      (matrixService as any).sendToolResultEvent = originalSend;
    }
  });

  test('overlapping drain passes resolve a tool request exactly once', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let matrixService = getService('matrix-service');
    let toolService = getService('tool-service');

    // Capture result events without forwarding them, so room state never
    // reflects the first resolution and cannot mask a second one — each
    // pass sees the request exactly as its concurrent sibling does.
    let captured: Array<{ toolCallId: string; status: string }> = [];
    let originalSend = matrixService.sendToolResultEvent.bind(matrixService);
    (matrixService as any).sendToolResultEvent = async (params: any) => {
      captured.push({ toolCallId: params.toolCallId, status: params.status });
    };
    // The message arrives owned by a different agent, so the timeline-driven
    // drain leaves it unresolved; the deliberately-overlapping passes below
    // are then the only resolvers in play.
    let overlapAgentId = 'overlap-test-agent';
    let originalAgentId = matrixService.agentId;
    try {
      let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: 'Do the thing',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: 'overlap-victim',
            name: 'checkCorrectness',
            arguments: 'not parseable json, so validation resolves invalid',
          },
        ],
        data: {
          context: {
            agentId: overlapAgentId,
          },
        },
      });
      await settled();
      assert.strictEqual(
        captured.length,
        0,
        'the not-our-agent message is left unresolved by the timeline drain',
      );

      matrixService.agentId = overlapAgentId;

      // Reproduce the window where two drain passes run concurrently over
      // the same request: the drain's flush promise releases every waiter
      // at once, so a pass can start while another is parked inside
      // validate() — after that pass checked the guards but before it
      // recorded any resolution. Pass one is started and given one
      // microtask to snapshot the queue and park inside validate; pass two
      // then processes the re-queued event during that window.
      let svc = toolService as any;
      svc.toolProcessingEventQueue.push(`${roomId}|${eventId}`);
      let firstPass = svc.drainToolProcessingQueue();
      await Promise.resolve();
      svc.flushToolProcessingQueue = undefined;
      svc.toolProcessingEventQueue.push(`${roomId}|${eventId}`);
      let secondPass = svc.drainToolProcessingQueue();
      await Promise.all([firstPass, secondPass]);
      await settled();

      assert.deepEqual(
        captured,
        [{ toolCallId: 'overlap-victim', status: 'invalid' }],
        'the request gets exactly one terminal result across both passes',
      );
    } finally {
      matrixService.agentId = originalAgentId;
      (matrixService as any).sendToolResultEvent = originalSend;
    }
  });

  test('Accept All bar still renders for a command that requires user approval', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'patching',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'cs-11647-patch',
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: { attributes: { firstName: 'Dave' } },
            },
          }),
        },
      ],
    });

    await waitFor('[data-test-accept-all]');
    assert
      .dom('[data-test-accept-all]')
      .exists(
        'manual approval bar still renders for commands that need user approval',
      );
  });
});
