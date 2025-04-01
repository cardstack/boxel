import { waitFor, click, fillIn } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  type TestContextWithSave,
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

module('Integration | ai-assistant-panel | commands', function (hooks) {
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

  let { createAndJoinRoom, simulateRemoteMessage, getRoomEvents } =
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
    let petJackie = new Pet({ name: 'Jackie' });

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'address.gts': { Address },
        'person.gts': { Person },
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
          <CardPrerender />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test<TestContextWithSave>('it allows chat commands to change cards in the stack', async function (assert) {
    assert.expect(4);

    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-card-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'A patch',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          },
        },
      ],
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: 'patch1',
      },
    });

    await waitFor('[data-test-command-apply]');
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.firstName, 'Dave');
    });
    await click('[data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');
    assert.dom('[data-test-person]').hasText('Dave');
  });

  test('when a command is being prepared, apply button is shown in preparing state', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
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
      formatted_body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first name to Evie',
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCard',
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
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="preparing"]')
      .exists();
  });

  test('it does not display the streaming indicator when ai bot sends a command', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      formatted_body: 'A patch',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'fb8fef81-2142-4861-a902-d5614b0aea52',
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          },
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
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
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
      formatted_body: 'Changing',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      formatted_body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
          name: 'patchCard',
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
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="preparing"]')
      .exists({ count: 1 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      formatted_body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
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
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          },
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
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="preparing"]')
      .exists({ count: 2 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Changing first names',
      formatted_body: 'Changing first names',
      format: 'org.matrix.custom.html',
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '6545dc5a-01a1-47d6-b2f7-493d2ff5a0c2',
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
        {
          id: 'f2da5504-b92f-480a-986a-56ec606d240e',
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/hassan`,
              patch: { attributes: { firstName: 'Ivana' } },
            },
          },
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
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="preparing"]')
      .exists({ count: 0 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="ready"]')
      .exists({ count: 2 });
  });

  test('after command is issued, a reaction event will be dispatched', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
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
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
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
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_COMMAND_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );

    await settled();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_COMMAND_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
  });

  test('after search command is issued, a command result event is dispatched', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
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
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
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
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) => event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
    );
    assert.equal(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = getRoomEvents(roomId).filter(
      (event) => event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
    );
    assert.equal(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
  });

  test('it can search for card instances that is of the same card type as the card shared', async function (assert) {
    let id = `${testRealmURL}Pet/mango.json`;
    let roomId = await renderAiAssistantPanel(id);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'search1',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: {
            attributes: {
              description: 'Searching for card',
              type: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
      ],
    });
    await settled();
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
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'search1',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: {
            description: 'Searching for card',
            attributes: {
              title: 'Mango',
            },
          },
        },
      ],
    });
    await settled();
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
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '721c8c78-d8c1-4cc1-a7e9-51d2d3143e4d',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: {
            attributes: {
              description: 'Searching for card',
              type: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
          },
        },
      ],
    });
    await settled();
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
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'fd4515fb-ed4d-4005-9782-4e844d7d4d9c',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: toolArgs,
        },
      ],
    });
    await settled();
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
      '[data-test-command-result-container] [data-test-more-options-button]',
    );
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${rightStackItem} [data-test-boxel-card-header-title]`)
      .hasText('Search Results');

    const savedCardId = document
      .querySelector(rightStackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-command-result-isolated]`;
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
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'ffd1a3d0-0bd4-491a-a907-b96ec9d8902c',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: toolArgs,
        },
      ],
    });
    await settled();
    assert.dom(`[data-test-stack-card="${id}"]`).exists();
    await click('[data-test-close-button]'); // close the last open card
    assert.dom(`[data-test-stack-card="${id}"]`).doesNotExist();
    assert.dom('[data-test-workspace-chooser]').exists();
    assert
      .dom('[data-test-message-idx="0"] [data-test-boxel-card-header-title]')
      .containsText('Search Results');

    assert
      .dom(
        '[data-test-command-result-container] [data-test-toggle-show-button]',
      )
      .containsText('Show 3 more results');
    let resultListItem = '[data-test-result-list] > li';
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(5)`).containsText('Ian');

    const stackItem =
      '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]';
    assert.dom(stackItem).doesNotExist();

    await click(
      '[data-test-command-result-container] [data-test-more-options-button]',
    );
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${stackItem} [data-test-boxel-card-header-title]`)
      .hasText('Search Results');

    const savedCardId = document
      .querySelector(stackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-command-result-isolated]`;
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
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
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
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
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
  });
});
