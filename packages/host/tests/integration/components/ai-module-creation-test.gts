import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { format, subMinutes } from 'date-fns';
import { setupRenderingTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { EventStatus } from 'matrix-js-sdk';
import { module, test } from 'qunit';

import { Deferred, baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import { currentRoomIdPersistenceKey } from '@cardstack/host/components/ai-assistant/panel';
import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  addRoomEvent,
  getCommandReactionEvents,
  getCommandResultEvents,
  updateRoomEvent,
} from '@cardstack/host/lib/matrix-handlers';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { CardDef } from '../../../../experiments-realm/re-export';
import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  type TestContextWithSave,
  getMonacoContent,
  waitForCodeEditor,
  lookupLoaderService,
} from '../../helpers';
import {
  setupMatrixServiceMock,
  MockMatrixService,
} from '../../helpers/mock-matrix-service';
import { renderComponent } from '../../helpers/render-component';

module('Integration | ai-assistant-panel', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let matrixService: MockMatrixService;
  let operatorModeStateService: OperatorModeStateService;
  let cardApi: typeof import('https://cardstack.com/base/card-api');

  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupServerSentEvents(hooks);
  setupMatrixServiceMock(hooks, { autostart: true });

  setupWindowMock(hooks);
  let noop = () => {};

  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    let {
      field,
      contains,
      linksTo,
      linksToMany,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let string: typeof import('https://cardstack.com/base/string');
    string = await loader.import(`${baseRealm.url}string`);
    let { default: StringField } = string;

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

    let petMango = new Pet({ name: 'Mango' });

    await setupIntegrationTestRealm({
      loader,
      contents: {

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

  test('it can create a module using a tool call', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan`;
    let roomId = await renderAiAssistantPanel(id);
    await waitFor('[data-test-person="Fadhlan"]');

    await addRoomEvent(matrixService, {
      event_id: 'event0',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Removing pet and changing preferred carrier',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,
              attributes: {
                address: { shippingInfo: { preferredCarrier: 'Fedex' } },
              },
              relationships: {
                pet: { links: { self: null } },
              },
            },
          },
          eventId: 'patch0',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'patch0',
        },
      },
      status: null,
    });

    const stackCard = `[data-test-stack-card="${id}"]`;

    await waitFor('[data-test-command-apply="ready"]');
    assert.dom(`${stackCard} [data-test-preferredcarrier="DHL"]`).exists();
    assert.dom(`${stackCard} [data-test-pet="Mango"]`).exists();

    await click('[data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists();
    assert.dom(`${stackCard} [data-test-preferredcarrier="Fedex"]`).exists();
    assert.dom(`${stackCard} [data-test-pet="Mango"]`).doesNotExist();

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Link to pet and change preferred carrier',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,
              attributes: {
                address: { shippingInfo: { preferredCarrier: 'UPS' } },
              },
              relationships: {
                pet: {
                  links: { self: `${testRealmURL}Pet/mango` },
                },
              },
            },
          },
          eventId: 'patch1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'patch1',
        },
      },
      status: null,
    });
    await waitFor('[data-test-command-apply="ready"]');
    assert.dom(`${stackCard} [data-test-preferredcarrier="Fedex"]`).exists();
    assert.dom(`${stackCard} [data-test-pet]`).doesNotExist();

    await click('[data-test-command-apply]');
    await waitFor('[data-test-message-idx="1"] [data-test-command-card-idle]');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
    assert.dom(`${stackCard} [data-test-preferredcarrier="UPS"]`).exists();
    assert.dom(`${stackCard} [data-test-pet="Mango"]`).exists();
    assert.dom(`${stackCard} [data-test-city="Bandung"]`).exists();
    assert.dom(`${stackCard} [data-test-country="Indonesia"]`).exists();
  });

  test<TestContextWithSave>('it allows chat commands to change cards in the stack', async function (assert) {
    assert.expect(4);

    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        body: 'i am the body',
        msgtype: 'org.boxel.command',
        formatted_body: 'A patch',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: `${testRealmURL}Person/fadhlan`,
              attributes: { firstName: 'Dave' },
            },
          },
          eventId: 'patch1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'patch1',
        },
      },
      status: null,
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

  test('after search command is issued, a command result event is dispatched', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    await matrixService.createAndJoinRoom('room1', 'test room 1');
    await addRoomEvent(matrixService, {
      event_id: 'room1-event1',
      room_id: 'room1',
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Changing first name to Evie',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'searchCard',
            arguments: {
              description: 'Searching for card',
              filter: {
                type: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
          eventId: 'room1-event1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'room1-event1',
        },
      },
      status: null,
    });
    let commandResultEvents = await getCommandResultEvents(
      matrixService,
      'room1',
    );
    assert.equal(
      commandResultEvents.length,
      0,
      'command result event is not dispatched',
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandResultEvents = await getCommandResultEvents(matrixService, 'room1');
    assert.equal(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
  });

  test('it can search for card instances that is of the same card type as the card shared', async function (assert) {
    let id = `${testRealmURL}Pet/mango.json`;
    let roomId = await renderAiAssistantPanel(id);

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Search for the following card',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'searchCard',
            arguments: {
              description: 'Searching for card',
              filter: {
                type: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
          eventId: 'search1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'search1',
        },
      },
      status: null,
    });
    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-result]');
    await waitFor('[data-test-result-card-idx="1"]');
    let commandResultEvents = await getCommandResultEvents(
      matrixService,
      roomId,
    );
    assert.equal(
      commandResultEvents[0].content.result.length,
      2,
      'number of search results',
    );
    assert
      .dom('[data-test-command-message]')
      .containsText('Search for the following card');
    assert
      .dom('[data-test-comand-result-header]')
      .containsText('Search Results 2 results');

    assert.dom('[data-test-result-card-idx="0"]').containsText('0. Jackie');
    assert.dom('[data-test-result-card-idx="1"]').containsText('1. Mango');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });
});
