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
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
    }

    class ShippingInfo extends FieldDef {
      static displayName = 'Shipping Info';
      @field preferredCarrier = contains(StringField);
      @field remarks = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: ShippingInfo) {
          return this.preferredCarrier;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-preferredCarrier={{@model.preferredCarrier}}>
            <@fields.preferredCarrier />
          </span>
        </template>
      };
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      @field shippingInfo = contains(ShippingInfo);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
            <div data-test-shippingInfo-field><@fields.shippingInfo /></div>
          </div>
        </template>
      };
    }

    class Country extends CardDef {
      static displayName = 'Country';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia(this: Country) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.name />
        </template>
      };
    }
    class Trips extends FieldDef {
      static displayName = 'Trips';
      @field tripTitle = contains(StringField);
      @field homeCountry = linksTo(Country);
      @field countriesVisited = linksToMany(Country);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          {{#if @model.tripTitle}}
            <h3 data-test-tripTitle><@fields.tripTitle /></h3>
          {{/if}}
          <div>
            Home Country:
            <@fields.homeCountry />
          </div>
          <div>
            Countries Visited:
            <@fields.countriesVisited />
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field trips = contains(Trips);
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
          <div>Trips: <span data-test-trips><@fields.trips /></span></div>
        </template>
      };
    }

    let petMango = new Pet({ name: 'Mango' });
    let petJackie = new Pet({ name: 'Jackie' });
    let usa = new Country({ name: 'USA' });

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'pet.gts': { Pet },
        'shipping-info.gts': { ShippingInfo },
        'address.gts': { Address },
        'person.gts': { Person },
        'country.gts': { Country },
        'Country/usa.json': usa,
        'Pet/mango.json': petMango,
        'Pet/jackie.json': petJackie,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
            shippingInfo: new ShippingInfo({
              preferredCarrier: 'DHL',
              remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
            }),
          }),
          pet: petMango,
        }),
        'Person/burcu.json': new Person({
          firstName: 'Burcu',
          friends: [petJackie, petMango],
        }),
        'Person/mickey.json': new Person({
          firstName: 'Mickey',
          trips: new Trips({
            tripTitle: 'Summer Vacation',
            homeCountry: usa,
          }),
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

  test('it maintains status of apply buttons during a session when switching between rooms', async function (assert) {
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
    await matrixService.createAndJoinRoom('room2', 'test room 2');
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
            name: 'patchCard',
            arguments: {
              card_id: `${testRealmURL}Person/fadhlan`,
              attributes: { firstName: 'Evie' },
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
    await addRoomEvent(matrixService, {
      event_id: 'room1-event2',
      room_id: 'room1',
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Changing first name to Jackie',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: `${testRealmURL}Person/fadhlan`,
              attributes: { firstName: 'Jackie' },
            },
          },
          eventId: 'room1-event2',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'room1-event2',
        },
      },
      status: null,
    });
    await addRoomEvent(matrixService, {
      event_id: 'room2-event1',
      room_id: 'room2',
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Incorrect command',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            argument: {
              card_id: `${testRealmURL}Person/fadhlan`,
              relationships: { pet: null }, // this will error
            },
          },
          eventId: 'room2-event1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'room2-event1',
        },
      },
      status: null,
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="1"] [data-test-command-apply]');
    await click('[data-test-message-idx="1"] [data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');

    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="ready"]')
      .exists();

    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="room2"]`);
    await waitFor('[data-test-room-name="test room 2"]');
    await waitFor('[data-test-command-apply]');
    await click('[data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="failed"]')
      .exists();

    // reopen ai assistant panel
    await click('[data-test-close-ai-assistant]');
    await waitFor('[data-test-ai-assistant-panel]', { count: 0 });
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-ai-assistant-panel]');

    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="room1"]`);
    await waitFor('[data-test-room-name="test room 1"]');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="ready"]')
      .exists();

    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="room2"]`);
    await waitFor('[data-test-room-name="test room 2"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="failed"]')
      .exists();
  });

  test('it only applies changes from the chat if the stack contains a card with that ID', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    let otherCardID = `${testRealmURL}Person/burcu`;
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
        formatted_body:
          'A patch<pre><code>https://www.example.com/path/to/resource?query=param1value&anotherQueryParam=anotherValue&additionalParam=additionalValue&longparameter1=someLongValue1</code></pre>',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: otherCardID,
              attributes: { firstName: 'Dave' },
            },
          },
          eventId: 'event1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event1',
        },
      },
      status: null,
    });

    await waitFor('[data-test-command-apply="ready"]');
    await click('[data-test-command-apply]');

    await waitFor('[data-test-command-card-idle]');
    assert
      .dom('[data-test-card-error]')
      .containsText(`Please open card '${otherCardID}' to make changes to it.`);
    assert.dom('[data-test-apply-state="failed"]').exists();
    assert.dom('[data-test-ai-bot-retry-button]').exists();
    assert.dom('[data-test-command-apply]').doesNotExist();
    assert.dom('[data-test-person]').hasText('Fadhlan');

    await waitFor('[data-test-embedded-card-options-button]');
    await percySnapshot(
      'Integration | ai-assistant-panel | it only applies changes from the chat if the stack contains a card with that ID | error',
    );

    await setCardInOperatorModeState(otherCardID);
    await waitFor('[data-test-person="Burcu"]');
    matrixService.sendReactionDeferred = new Deferred<void>();
    await click('[data-test-ai-bot-retry-button]'); // retry the command with correct card
    assert.dom('[data-test-apply-state="applying"]').exists();
    matrixService.sendReactionDeferred.fulfill();

    await waitFor('[data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists();
    assert.dom('[data-test-person]').hasText('Dave');
    assert.dom('[data-test-command-apply]').doesNotExist();
    assert.dom('[data-test-ai-bot-retry-button]').doesNotExist();

    await waitUntil(
      () =>
        document.querySelectorAll('[data-test-embedded-card-options-button]')
          .length === 2,
    );
    await percySnapshot(
      'Integration | ai-assistant-panel | it only applies changes from the chat if the stack contains a card with that ID | error fixed',
    );
  });

  test('it can apply change to nested contains field', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="Fadhlan"]');
    assert.dom(`[data-test-preferredcarrier="DHL"]`).exists();

    let payload = {
      name: 'patchCard',
      arguments: {
        card_id: `${testRealmURL}Person/fadhlan`,
        attributes: {
          firstName: 'Joy',
          address: { shippingInfo: { preferredCarrier: 'UPS' } },
        },
      },
      eventId: 'event1',
    };
    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        body: 'A patch',
        msgtype: 'org.boxel.command',
        formatted_body: 'A patch',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({ toolCall: payload }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event1',
        },
      },
      status: null,
    });

    await waitFor('[data-test-view-code-button]');
    await click('[data-test-view-code-button]');

    await waitForCodeEditor();
    assert.deepEqual(
      JSON.parse(getMonacoContent()),

      {
        name: 'patchCard',
        payload: {
          attributes: {
            address: {
              shippingInfo: {
                preferredCarrier: 'UPS',
              },
            },
            firstName: 'Joy',
          },
          card_id: 'http://test-realm/test/Person/fadhlan',
        },
      },
      'it can preview code when a change is proposed',
    );
    assert.dom('[data-test-copy-code]').isEnabled('copy button is available');

    await click('[data-test-view-code-button]');
    assert.dom('[data-test-code-editor]').doesNotExist();

    await click('[data-test-command-apply="ready"]');
    await waitFor('[data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists();
    assert.dom('[data-test-person]').hasText('Joy');
    assert.dom(`[data-test-preferredcarrier]`).hasText('UPS');
    assert.dom(`[data-test-city="Bandung"]`).exists();
    assert.dom(`[data-test-country="Indonesia"]`).exists();
  });

  test('it can apply change to a linksTo field', async function (assert) {
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

  test('it does not crash when applying change to a card with preexisting nested linked card', async function (assert) {
    let id = `${testRealmURL}Person/mickey`;
    let roomId = await renderAiAssistantPanel(id);

    await waitFor('[data-test-person="Mickey"]');
    assert.dom('[data-test-tripTitle]').hasText('Summer Vacation');

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Change tripTitle to Trip to Japan',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,
              attributes: { trips: { tripTitle: 'Trip to Japan' } },
            },
          },
          eventId: 'event1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event1',
        },
      },
      status: null,
    });

    await waitFor('[data-test-command-apply="ready"]');
    await click('[data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists();
    assert.dom('[data-test-tripTitle]').hasText('Trip to Japan');
  });

  test('button states only apply to a single button in a chat room', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan`;
    let roomId = await renderAiAssistantPanel(id);

    await waitFor('[data-test-person="Fadhlan"]');

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Change first name to Dave',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,

              attributes: { firstName: 'Dave' },
            },
          },
          eventId: 'event1',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event1',
        },
      },
      status: null,
    });
    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Incorrect patch command',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              arguments: {
                card_id: id,
                relationships: { pet: null },
              },
            },
          },
          eventId: 'event2',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event2',
        },
      },
      status: null,
    });
    await addRoomEvent(matrixService, {
      event_id: 'event3',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Change first name to Jackie',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,
              attributes: { firstName: 'Jackie' },
            },
          },
          eventId: 'event3',
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event3',
        },
      },
      status: null,
    });

    await waitFor('[data-test-command-apply="ready"]', { count: 3 });

    matrixService.sendReactionDeferred = new Deferred<void>();
    await click('[data-test-message-idx="2"] [data-test-command-apply]');
    assert.dom('[data-test-apply-state="applying"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="2"] [data-test-apply-state="applying"]')
      .exists();
    matrixService.sendReactionDeferred.fulfill();

    await waitFor('[data-test-message-idx="2"] [data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="2"] [data-test-apply-state="applied"]')
      .exists();
    assert.dom('[data-test-command-apply="ready"]').exists({ count: 2 });
    assert.dom('[data-test-person]').hasText('Jackie');

    await click('[data-test-message-idx="1"] [data-test-command-apply]');
    await waitFor('[data-test-message-idx="1"] [data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="failed"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="failed"]')
      .exists();
    assert.dom('[data-test-command-apply="ready"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply="ready"]')
      .exists();
  });

  test('assures applied state displayed as a check mark even eventId in command payload is undefined', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan`;
    let roomId = await renderAiAssistantPanel(id);

    await waitFor('[data-test-person="Fadhlan"]');

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      sender: '@aibot:localhost',
      content: {
        msgtype: 'org.boxel.command',
        formatted_body: 'Change first name to Dave',
        format: 'org.matrix.custom.html',
        data: JSON.stringify({
          toolCall: {
            name: 'patchCard',
            arguments: {
              card_id: id,
              attributes: { firstName: 'Dave' },
            },
          },
          eventId: undefined,
        }),
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event1',
        },
      },
      status: null,
    });

    await waitFor('[data-test-command-apply="ready"]', { count: 1 });

    matrixService.sendReactionDeferred = new Deferred<void>();
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    assert.dom('[data-test-apply-state="applying"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applying"]')
      .exists();
    matrixService.sendReactionDeferred?.fulfill();

    await waitFor('[data-test-message-idx="0"] [data-test-command-card-idle]');
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();
    assert.dom('[data-test-person]').hasText('Dave');
  });

  test('it can handle an error in a card attached to a matrix message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(1994, 0, 1, 12, 30).getTime(),
      content: {
        body: '',
        formatted_body: '',
        msgtype: 'org.boxel.cardFragment',
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
      },
      status: null,
    });
    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      origin_server_ts: new Date(1994, 0, 1, 12, 30).getTime(),
      content: {
        body: 'card with error',
        formatted_body: 'card with error',
        msgtype: 'org.boxel.message',
        data: JSON.stringify({
          attachedCardsEventIds: ['event1'],
        }),
      },
      status: null,
    });

    await waitFor('[data-test-card-error]');
    assert
      .dom('[data-test-card-error]')
      .containsText('Error rendering attached cards');
    await percySnapshot(assert);
  });

  test('it can handle an error during room creation', async function (assert) {
    await setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
          <div class='invisible' data-test-throw-room-error />
          <style>
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

  test('when opening ai panel it opens the most recent room', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Pet/mango`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await matrixService.createAndJoinRoom('test1', 'test room 1');
    const room2Id = await matrixService.createAndJoinRoom(
      'test2',
      'test room 2',
    );
    const room3Id = await matrixService.createAndJoinRoom(
      'test3',
      'test room 3',
    );

    await openAiAssistant();
    await waitFor(`[data-room-settled]`);

    assert
      .dom(`[data-test-room="${room3Id}"]`)
      .exists(
        "test room 3 is the most recently created room and it's opened initially",
      );

    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="${room2Id}"]`);

    await click('[data-test-close-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom(`[data-test-room="${room2Id}"]`)
      .exists(
        "test room 2 is the most recently selected room and it's opened initially",
      );

    await click('[data-test-close-ai-assistant]');
    window.localStorage.setItem(
      currentRoomIdPersistenceKey,
      "room-id-that-doesn't-exist-and-should-not-break-the-implementation",
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom(`[data-test-room="${room3Id}"]`)
      .exists(
        "test room 3 is the most recently created room and it's opened initially",
      );

    window.localStorage.removeItem(currentRoomIdPersistenceKey); // Cleanup
  });

  test('can close past-sessions list on outside click', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-past-sessions]').exists();
    assert.dom('[data-test-joined-room]').exists({ count: 1 });
    await click('.operator-mode__main');
    assert.dom('[data-test-past-sessions]').doesNotExist();

    await click('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions]');
    assert.dom('[data-test-past-sessions]').exists();
    await click(`[data-test-past-session-options-button="${roomId}"]`);
    assert.dom('[data-test-past-sessions]').exists();
    await click('[data-test-message-field]');
    assert.dom('[data-test-past-sessions]').doesNotExist();
  });

  test('it can render a markdown message from ai bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: "# Beagles: Loyal Companions\n\nEnergetic and friendly, beagles are wonderful family pets. They _love_ company and always crave playtime.\n\nTheir keen noses lead adventures, unraveling scents. Always curious, they're the perfect mix of independence and affection.",
        msgtype: 'm.text',
        formatted_body:
          "# Beagles: Loyal Companions\n\nEnergetic and friendly, beagles are wonderful family pets. They _love_ company and always crave playtime.\n\nTheir keen noses lead adventures, unraveling scents. Always curious, they're the perfect mix of independence and affection.",
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: 1709652566421,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert.dom('[data-test-message-idx="0"] h1').containsText('Beagles');
    assert.dom('[data-test-message-idx="0"]').doesNotContainText('# Beagles');
    assert.dom('[data-test-message-idx="0"] p').exists({ count: 2 });
    assert.dom('[data-test-message-idx="0"] em').hasText('love');
    assert.dom('[data-test-message-idx="0"]').doesNotContainText('_love_');
  });

  test('displays message slightly muted when it is being sent', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    let originalSendMessage = matrixService.sendMessage;
    let clientGeneratedId = '';
    let event: any;
    matrixService.sendMessage = async function (
      roomId: string,
      body: string,
      attachedCards: CardDef[],
      _skillCards: [],
      _clientGeneratedId: string,
      _context?: any,
    ) {
      let serializedCard = cardApi.serializeCard(attachedCards[0]);
      let cardFragmentEvent = {
        event_id: 'test-card-fragment-event-id',
        room_id: roomId,
        state_key: 'state',
        type: 'm.room.message',
        sender: matrixService.userId!,
        content: {
          msgtype: 'org.boxel.cardFragment' as const,
          format: 'org.boxel.card' as const,
          body: `card fragment 1 of 1`,
          formatted_body: `card fragment 1 of 1`,
          data: JSON.stringify({
            cardFragment: JSON.stringify(serializedCard),
            index: 0,
            totalParts: 1,
          }),
        },
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
        unsigned: {
          age: 105,
          transaction_id: '1',
        },
        status: null,
      };
      await addRoomEvent(this, cardFragmentEvent);

      clientGeneratedId = _clientGeneratedId;
      event = {
        event_id: 'test-event-id',
        room_id: roomId,
        state_key: 'state',
        type: 'm.room.message',
        sender: matrixService.userId!,
        content: {
          body,
          msgtype: 'org.boxel.message',
          formatted_body: body,
          format: 'org.matrix.custom.html',
          clientGeneratedId,
          data: JSON.stringify({
            attachedCardsEventIds: [cardFragmentEvent.event_id],
          }),
        },
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
        unsigned: {
          age: 105,
          transaction_id: '1',
        },
        status: EventStatus.SENDING,
      };
      await addRoomEvent(this, event);
    };
    await openAiAssistant();

    await fillIn('[data-test-message-field]', 'Test Message');
    assert.dom('[data-test-message-field]').hasValue('Test Message');
    assert.dom('[data-test-send-message-btn]').isEnabled();
    assert.dom('[data-test-ai-assistant-message]').doesNotExist();
    await click('[data-test-send-message-btn]');

    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasClass('is-pending');
    await percySnapshot(assert);

    let newEvent = {
      ...event,
      event_id: 'updated-event-id',
      status: EventStatus.SENT,
    };
    await updateRoomEvent(matrixService, newEvent, event.event_id);
    await waitUntil(
      () =>
        !(
          document.querySelector(
            '[data-test-send-message-btn]',
          ) as HTMLButtonElement
        ).disabled,
    );
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasNoClass('is-pending');
    matrixService.sendMessage = originalSendMessage;
  });

  test('displays retry button for message that failed to send', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    let originalSendMessage = matrixService.sendMessage;
    let clientGeneratedId = '';
    let event: any;
    matrixService.sendMessage = async function (
      roomId: string,
      body: string,
      _attachedCards: [],
      _skillCards: [],
      _clientGeneratedId: string,
      _context?: any,
    ) {
      clientGeneratedId = _clientGeneratedId;
      event = {
        event_id: 'test-event-id',
        room_id: roomId,
        state_key: 'state',
        type: 'm.room.message',
        sender: matrixService.userId!,
        content: {
          body,
          msgtype: 'org.boxel.message',
          formatted_body: body,
          format: 'org.matrix.custom.html',
          clientGeneratedId,
        },
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
        unsigned: {
          age: 105,
          transaction_id: '1',
        },
        status: EventStatus.SENDING,
      };
      await addRoomEvent(this, event);
    };
    await openAiAssistant();

    await fillIn('[data-test-message-field]', 'Test Message');
    assert.dom('[data-test-message-field]').hasValue('Test Message');
    assert.dom('[data-test-send-message-btn]').isEnabled();
    assert.dom('[data-test-ai-assistant-message]').doesNotExist();
    await click('[data-test-send-message-btn]');

    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasClass('is-pending');

    let newEvent = {
      ...event,
      event_id: 'updated-event-id',
      status: EventStatus.NOT_SENT,
    };
    await updateRoomEvent(matrixService, newEvent, event.event_id);
    await waitUntil(
      () =>
        !(
          document.querySelector(
            '[data-test-send-message-btn]',
          ) as HTMLButtonElement
        ).disabled,
    );
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasClass('is-error');
    assert.dom('[data-test-card-error]').containsText('Failed to send');
    assert.dom('[data-test-ai-bot-retry-button]').exists();
    await percySnapshot(assert);

    matrixService.sendMessage = async function (
      _roomId: string,
      _body: string,
      _attachedCards: [],
      _skillCards: [],
      _clientGeneratedId: string,
      _context?: any,
    ) {
      event = {
        ...event,
        status: null,
      };
      await addRoomEvent(this, event);
    };
    await click('[data-test-ai-bot-retry-button]');
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasNoClass('is-error');
    matrixService.sendMessage = originalSendMessage;
  });

  test('it does not display the streaming indicator when ai bot sends an option', async function (assert) {
    let roomId = await renderAiAssistantPanel();

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

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .doesNotHaveClass(
        'ai-avatar-animated',
        'ai bot patch message does not have a spinner',
      );
  });

  test('it animates the sessions dropdown button when there are other sessions that have activity which was not seen by the user yet', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await addRoomEvent(matrixService, {
      event_id: 'event0',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@matic:boxel',
      content: {
        body: 'Say one word.',
        msgtype: 'org.boxel.message',
        formatted_body: 'Say one word.',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 100,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'Word.',
        msgtype: 'm.text',
        formatted_body: 'Word.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: Date.now() - 99,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    assert
      .dom('[data-test-past-sessions-button] [data-test-has-active-sessions]')
      .doesNotExist();
    assert
      .dom(
        "[data-test-enter-room='New AI Assistant Chat'] [data-test-is-streaming]",
      )
      .doesNotExist();

    // Create a new room with some activity (this could happen when we will have a feature that interacts with AI outside of the AI pannel, i.e. "commands")

    let anotherRoomId = await matrixService.createAndJoinRoom('Another Room');

    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: anotherRoomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        formatted_body: 'Word.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: Date.now() - 98,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await waitFor('[data-test-has-active-sessions]');

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .exists("'All Sessions button' is animated");

    await click('[data-test-past-sessions-button]');

    assert
      .dom(
        "[data-test-joined-room='Another Room'] [data-test-is-unseen-message]",
      )
      .exists('Newly created room has an unseen message');

    assert
      .dom(
        "[data-test-joined-room='Another Room'] [data-test-is-unseen-message]",
      )
      .containsText('Updated');

    assert
      .dom(
        "[data-test-joined-room='New AI Assistant Chat'][data-test-is-unseen-message]",
      )
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom("[data-test-joined-room='New AI Assistant Chat']")
      .doesNotContainText('Updated');

    await click("[data-test-enter-room='Another Room']");
    assert
      .dom(
        "[data-test-joined-room='Another Room'] [data-test-is-unseen-message]",
      )
      .doesNotExist(
        "Newly created room doesn't have an unseen message because we just opened it and saw the message",
      );
    assert
      .dom(
        "[data-test-joined-room='New AI Assistant'] [data-test-is-unseen-message]",
      )
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .doesNotExist(
        "'All Sessions button' is not animated anymore because the other active session was seen",
      );

    await click('[data-test-past-sessions-button]');

    assert
      .dom("[data-test-joined-room='New AI Assistant Chat']")
      .doesNotContainText('Updated');
    assert
      .dom("[data-test-joined-room='Another Room']")
      .doesNotContainText('Updated');
  });

  test('sends read receipts only for bot messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await addRoomEvent(matrixService, {
      event_id: 'userevent0',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@matic:boxel',
      content: {
        body: 'Say one word.',
        msgtype: 'org.boxel.message',
        formatted_body: 'Say one word.',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 100,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await waitFor(`[data-room-settled]`);

    await addRoomEvent(matrixService, {
      event_id: 'botevent1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'Word.',
        msgtype: 'm.text',
        formatted_body: 'Word.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: Date.now() - 99,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    assert
      .dom('[data-test-past-sessions-button] [data-test-has-active-sessions]')
      .doesNotExist();
    assert
      .dom(
        "[data-test-enter-room='New AI Assistant Chat'] [data-test-is-streaming]",
      )
      .doesNotExist();

    let anotherRoomId = await matrixService.createAndJoinRoom('Another Room');

    await addRoomEvent(matrixService, {
      event_id: 'botevent2',
      room_id: anotherRoomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        formatted_body: 'Word.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: Date.now() - 98,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await waitFor('[data-test-has-active-sessions]');
    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="${anotherRoomId}"]`);

    assert.deepEqual(
      Array.from(matrixService.currentUserEventReadReceipts.keys()),
      ['botevent1', 'botevent2'],
    );
  });

  test('it can retry a message when receiving an error from the AI bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@testuser:staging',
      content: {
        body: 'I have a feeling something will go wrong',
        msgtype: 'org.boxel.message',
        formatted_body: 'I have a feeling something will go wrong',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 100,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'There was an error processing your request, please try again later',
        msgtype: 'm.text',
        formatted_body:
          'There was an error processing your request, please try again later',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        errorMessage: 'AI bot error',
      },
      origin_server_ts: Date.now() - 99,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event3',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@testuser:staging',
      content: {
        body: 'I have a feeling something will go wrong',
        msgtype: 'org.boxel.message',
        formatted_body: 'I have a feeling something will go wrong',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 98,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event4',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'There was an error processing your request, please try again later',
        msgtype: 'm.text',
        formatted_body:
          'There was an error processing your request, please try again later',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        errorMessage: 'AI bot error',
      },
      origin_server_ts: Date.now() - 97,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
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
    let firstMessage = {
      event_id: 'first-message-event',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
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
      origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    };
    let secondMessage = {
      event_id: 'second-message-event',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'Second message body',
        msgtype: 'org.text',
        formatted_body: 'Second message body',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: new Date(2024, 0, 3, 12, 31).getTime(),
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    };
    let firstMessageReplacement = {
      event_id: 'first-message-replacement-event',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
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
          event_id: 'first-message-event',
          rel_type: 'm.replace',
        },
      },
      origin_server_ts: new Date(2024, 0, 3, 12, 32).getTime(),
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    };

    await addRoomEvent(matrixService, firstMessage);

    await addRoomEvent(matrixService, secondMessage);

    await addRoomEvent(matrixService, firstMessageReplacement);

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

  test('it displays the streaming indicator when ai bot message is in progress (streaming words)', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await addRoomEvent(matrixService, {
      event_id: 'event0',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@matic:boxel',
      content: {
        body: 'Say one word.',
        msgtype: 'org.boxel.message',
        formatted_body: 'Say one word.',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 100,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'French.',
        msgtype: 'm.text',
        formatted_body: 'French.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: Date.now() - 99,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@matic:boxel',
      content: {
        body: 'What is a french bulldog?',
        msgtype: 'org.boxel.message',
        formatted_body: 'What is a french bulldog?',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 98,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await addRoomEvent(matrixService, {
      event_id: 'event3',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'French bulldog is a',
        msgtype: 'm.text',
        formatted_body: 'French bulldog is a',
        format: 'org.matrix.custom.html',
      },
      origin_server_ts: Date.now() - 97,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

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

    await click('[data-test-past-sessions-button]');
    assert
      .dom("[data-test-enter-room='New AI Assistant Chat']")
      .includesText('Thinking');
    assert.dom('[data-test-is-streaming]').exists();

    await addRoomEvent(matrixService, {
      event_id: 'event4',
      room_id: roomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'French bulldog is a French breed of companion dog or toy dog.',
        msgtype: 'm.text',
        formatted_body:
          'French bulldog is a French breed of companion dog or toy dog',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true, // This is an indicator from the ai bot that the message is finalized and the openai is done streaming
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'event3',
        },
      },
      origin_server_ts: Date.now() - 96,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

    await waitFor('[data-test-message-idx="3"]');
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
      .dom("[data-test-enter-room='New AI Assistant Chat']")
      .doesNotContainText('Thinking');
    assert.dom('[data-test-is-streaming]').doesNotExist();
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
    let anotherRoomId = await matrixService.createAndJoinRoom('Another Room');

    // A message that hasn't been seen and was sent more than fifteen minutes ago must not be shown in the toast.
    let sixteenMinutesAgo = subMinutes(new Date(), 16);
    await addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: anotherRoomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'I sent a message sixteen minutes ago',
        msgtype: 'm.text',
        formatted_body: 'A message that was sent sixteen minutes ago.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: sixteenMinutesAgo.getTime(),
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });
    assert.dom('[data-test-ai-assistant-toast]').exists({ count: 0 });

    let fourteenMinutesAgo = subMinutes(new Date(), 14);
    await addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: anotherRoomId,
      state_key: 'state',
      type: 'm.room.message',
      sender: '@aibot:localhost',
      content: {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        formatted_body: 'A message from the background.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      origin_server_ts: fourteenMinutesAgo.getTime(),
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
      status: null,
    });

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

  test('it should create a new line in the right position when user type `Shift+Enter`', async function (assert) {
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

  test('after command is issued, a reaction event will be dispatched', async function (assert) {
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
            name: 'patchCard',
            arguments: {
              card_id: `${testRealmURL}Person/fadhlan`,
              attributes: { firstName: 'Evie' },
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
    let commandReactionEvents = await getCommandReactionEvents(
      matrixService,
      'room1',
    );
    assert.equal(
      commandReactionEvents.length,
      0,
      'reaction event is not dispatched',
    );

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-name="test room 1"]');
    await waitFor('[data-test-message-idx="0"] [data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-card-idle]');

    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();

    commandReactionEvents = await getCommandReactionEvents(
      matrixService,
      'room1',
    );
    assert.equal(
      commandReactionEvents.length,
      1,
      'reaction event is dispatched',
    );
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

  test('toggle more search results', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan.json`;
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
                  module: `${testRealmURL}person`,
                  name: 'Person',
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
    await waitFor('[data-test-result-card-idx="4"]');
    assert.dom('[data-test-result-card-idx="5"]').doesNotExist();
    assert
      .dom('[data-test-toggle-show-button]')
      .containsText('Show 3 more results');
    await click('[data-test-toggle-show-button]');
    await waitFor('[data-test-result-card-idx="7"]');
    assert.dom('[data-test-toggle-show-button]').containsText('See Less');
    assert.dom('[data-test-result-card-idx="0"]').containsText('0. Buck');
    assert.dom('[data-test-result-card-idx="1"]').containsText('1. Burcu');
    assert.dom('[data-test-result-card-idx="2"]').containsText('2. Fadhlan');
    assert.dom('[data-test-result-card-idx="3"]').containsText('3. Hassan');
    assert.dom('[data-test-result-card-idx="4"]').containsText('4. Ian');
    assert.dom('[data-test-result-card-idx="5"]').containsText('5. Justin');
    assert.dom('[data-test-result-card-idx="6"]').containsText('6. Matic');
    assert.dom('[data-test-result-card-idx="7"]').containsText('7. Mickey');
    await click('[data-test-toggle-show-button]');
    assert.dom('[data-test-result-card-idx="0"]').containsText('0. Buck');
    assert.dom('[data-test-result-card-idx="1"]').containsText('1. Burcu');
    assert.dom('[data-test-result-card-idx="2"]').containsText('2. Fadhlan');
    assert.dom('[data-test-result-card-idx="3"]').containsText('3. Hassan');
    assert.dom('[data-test-result-card-idx="4"]').containsText('4. Ian');
    assert.dom('[data-test-result-card-idx="5"]').doesNotExist();
  });
});
