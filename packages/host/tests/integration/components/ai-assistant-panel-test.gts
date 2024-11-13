import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { format, subMinutes } from 'date-fns';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import { currentRoomIdPersistenceKey } from '@cardstack/host/components/ai-assistant/panel';
import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { CommandResultEvent } from 'https://cardstack.com/base/matrix-event';

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
  CardDef,
  Component,
  FieldDef,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | ai-assistant-panel', function (hooks) {
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
  setupServerSentEvents(hooks);
  let {
    createAndJoinRoom,
    simulateRemoteMessage,
    getRoomEvents,
    setReadReceipt,
  } = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
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
      static fitted = class Fitted extends Component<typeof this> {
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
        // we'll use a 20px threshold for considering the ai assistant scrolled
        // all the way to the bottom
      ) < 20
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
      simulateRemoteMessage(roomId, '@testuser:staging', {
        body: `question #${i + 1}`,
        msgtype: 'org.boxel.message',
        formatted_body: `question #${i + 1}`,
        format: 'org.matrix.custom.html',
      });
      let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: `answer #${i + 1}`,
        msgtype: 'm.text',
        formatted_body: `answer #${i + 1}`,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      });
      if (messagesHaveBeenRead) {
        setReadReceipt(roomId, eventId, '@testuser:staging');
      }
    }
  }

  test<TestContextWithSave>('it allows chat commands to change cards in the stack', async function (assert) {
    assert.expect(4);

    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-card-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: 'org.boxel.command',
      formatted_body: 'A patch',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
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
        eventId: '__EVENT_ID__',
      }),
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
    let room1Id = createAndJoinRoom('@testuser:staging', 'test room 1');
    let room2Id = createAndJoinRoom('@testuser:staging', 'test room 2');
    simulateRemoteMessage(room2Id, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Incorrect command',
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
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    simulateRemoteMessage(room1Id, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Changing first name to Evie',
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
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
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    simulateRemoteMessage(room1Id, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Changing first name to Jackie',
      formatted_body: 'Changing first name to Jackie',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: `${testRealmURL}Person/fadhlan`,
              patch: {
                attributes: { firstName: 'Jackie' },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    // let the room events all process before we open the assistant, so it will
    // pick the appropriate room.
    await settled();

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
    await click(`[data-test-enter-room="${room2Id}"]`);
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
    await click(`[data-test-enter-room="${room1Id}"]`);
    await waitFor('[data-test-room-name="test room 1"]');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="ready"]')
      .exists();

    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="${room2Id}"]`);
    await waitFor('[data-test-room-name="test room 2"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="failed"]')
      .exists();
  });

  test('it can apply change to nested contains field', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="Fadhlan"]');
    assert.dom(`[data-test-preferredcarrier="DHL"]`).exists();

    let payload = {
      name: 'patchCard',
      arguments: {
        attributes: {
          cardId: `${testRealmURL}Person/fadhlan`,
          patch: {
            attributes: {
              firstName: 'Joy',
              address: { shippingInfo: { preferredCarrier: 'UPS' } },
            },
          },
        },
      },
      eventId: 'event1',
    };
    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'A patch',
      msgtype: 'org.boxel.command',
      formatted_body: 'A patch',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({ toolCall: payload }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: 'event1',
      },
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
            cardId: 'http://test-realm/test/Person/fadhlan',
            patch: {
              attributes: {
                address: {
                  shippingInfo: {
                    preferredCarrier: 'UPS',
                  },
                },
                firstName: 'Joy',
              },
            },
          },
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Removing pet and changing preferred carrier',
      formatted_body: 'Removing pet and changing preferred carrier',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
                attributes: {
                  address: { shippingInfo: { preferredCarrier: 'Fedex' } },
                },
                relationships: {
                  pet: { links: { self: null } },
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Link to pet and change preferred carrier',
      formatted_body: 'Link to pet and change preferred carrier',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
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
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Change tripTitle to Trip to Japan',
      formatted_body: 'Change tripTitle to Trip to Japan',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
                attributes: {
                  trips: {
                    tripTitle: 'Trip to Japan',
                  },
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Change first name to Dave',
      formatted_body: 'Change first name to Dave',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Incorrect patch command',
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
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Change first name to Jackie',
      formatted_body: 'Change first name to Jackie',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
                attributes: { firstName: 'Jackie' },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    await waitFor('[data-test-command-apply="ready"]', { count: 3 });

    click('[data-test-message-idx="2"] [data-test-command-apply]');
    await waitFor(
      '[data-test-message-idx="2"] [data-test-apply-state="applying"]',
    );
    assert.dom('[data-test-apply-state="applying"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="2"] [data-test-apply-state="applying"]')
      .exists();

    await waitFor('[data-test-message-idx="2"] [data-test-command-card-idle]');
    await waitFor(
      '[data-test-message-idx="2"] [data-test-apply-state="applied"]',
    );
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Change first name to Dave',
      formatted_body: 'Change first name to Dave',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: id,
              patch: {
                attributes: { firstName: 'Dave' },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    await waitFor('[data-test-command-apply="ready"]', { count: 1 });

    click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor(
      '[data-test-message-idx="0"] [data-test-apply-state="applying"]',
    );
    assert.dom('[data-test-apply-state="applying"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applying"]')
      .exists();

    await waitFor('[data-test-message-idx="0"] [data-test-command-card-idle]');
    await waitFor(
      '[data-test-message-idx="0"] [data-test-apply-state="applied"]',
    );
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 1 });
    assert
      .dom('[data-test-message-idx="0"] [data-test-apply-state="applied"]')
      .exists();
    assert.dom('[data-test-person]').hasText('Dave');
  });

  test('it can handle an error in a card attached to a matrix message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let event1Id = await simulateRemoteMessage(roomId, '@aibot:localhost', {
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
    });
    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'card with error',
      formatted_body: 'card with error',
      msgtype: 'org.boxel.message',
      data: JSON.stringify({
        attachedCardsEventIds: [event1Id],
      }),
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

      createAndJoinRoom('@testuser:staging', 'test room 0');
      let room1Id = createAndJoinRoom('@testuser:staging', 'test room 1');
      const room2Id = createAndJoinRoom('@testuser:staging', 'test room 2');
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
        currentRoomIdPersistenceKey,
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
      window.localStorage.removeItem(currentRoomIdPersistenceKey); // Cleanup
    }
  });

  test('can close past-sessions list on outside click', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-past-sessions]').exists();
    assert.dom('[data-test-joined-room]').exists({ count: 1 });
    await click('.interact-submode'); // outside click
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
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

    await waitFor('[data-test-ai-assistant-message].is-pending');
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasClass('is-pending');
    await percySnapshot(assert);

    await waitFor('[data-test-ai-assistant-message]:not(.is-pending)');
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

    await openAiAssistant();

    await fillIn(
      '[data-test-message-field]',
      'This is a magic message with a SENDING_DELAY_THEN_FAILURE!',
    );
    assert
      .dom('[data-test-message-field]')
      .hasValue('This is a magic message with a SENDING_DELAY_THEN_FAILURE!');
    assert.dom('[data-test-send-message-btn]').isEnabled();
    assert.dom('[data-test-ai-assistant-message]').doesNotExist();
    click('[data-test-send-message-btn]');

    await waitFor('[data-test-ai-assistant-message].is-pending');
    assert.dom('[data-test-message-field]').hasValue('');
    assert.dom('[data-test-send-message-btn]').isDisabled();
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasClass('is-pending');

    await waitFor('[data-test-ai-assistant-message].is-error');
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

    await click('[data-test-ai-bot-retry-button]');
    assert.dom('[data-test-ai-assistant-message]').exists({ count: 1 });
    assert.dom('[data-test-ai-assistant-message]').hasNoClass('is-error');
  });

  test('it does not display the streaming indicator when ai bot sends an option', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'i am the body',
      msgtype: 'org.boxel.command',
      formatted_body: 'A patch',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
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
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: 'patch1',
      },
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

    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'Say one word.',
      msgtype: 'org.boxel.message',
      formatted_body: 'Say one word.',
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
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

    // Create a new room with some activity (this could happen when we will have a feature that interacts with AI outside of the AI pannel, i.e. "commands")

    let anotherRoomId = createAndJoinRoom('@testuser:staging', 'Another Room');

    simulateRemoteMessage(
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

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .exists("'All Sessions button' is animated");

    await click('[data-test-past-sessions-button]');

    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .exists('Newly created room has an unseen message');

    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .containsText('Updated');

    assert
      .dom(`[data-test-joined-room='${roomId}'][data-test-is-unseen-message]`)
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom(`[data-test-joined-room='${roomId}']`)
      .doesNotContainText('Updated');

    await click(`[data-test-enter-room='${anotherRoomId}']`);
    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .doesNotExist(
        "Newly created room doesn't have an unseen message because we just opened it and saw the message",
      );
    assert
      .dom(`[data-test-joined-room='${roomId}'] [data-test-is-unseen-message]`)
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .doesNotExist(
        "'All Sessions button' is not animated anymore because the other active session was seen",
      );

    await click('[data-test-past-sessions-button]');

    assert
      .dom(`[data-test-joined-room='${roomId}']`)
      .doesNotContainText('Updated');
    assert
      .dom(`[data-test-joined-room='${anotherRoomId}']`)
      .doesNotContainText('Updated');
  });

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
      formatted_body: 'This is an unread message',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');

    assert
      .dom('[data-test-unread-messages-button]')
      .exists('unread messages button exists when there are unread messages');
    assert
      .dom('[data-test-unread-messages-button]')
      .containsText('1 unread message');
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
      formatted_body: 'This is an unread message',
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
      formatted_body: 'This is an unread message',
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
    let roomId = createAndJoinRoom('@testuser:staging', 'test room 1');
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
    let roomId = createAndJoinRoom('@testuser:staging', 'test room 1');
    fillRoomWithReadMessages(roomId);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
  });

  test('sends read receipts only for bot messages', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@testuser:staging', {
      body: 'Say one word.',
      msgtype: 'org.boxel.message',
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

    let anotherRoomId = createAndJoinRoom('@testuser:staging', 'Another Room');

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

    await simulateRemoteMessage(roomId, '@testuser:staging', {
      body: 'I have a feeling something will go wrong',
      msgtype: 'org.boxel.message',
      formatted_body: 'I have a feeling something will go wrong',
      format: 'org.matrix.custom.html',
    });

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'There was an error processing your request, please try again later',
      msgtype: 'm.text',
      formatted_body:
        'There was an error processing your request, please try again later',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      errorMessage: 'AI bot error',
    });

    await simulateRemoteMessage(roomId, '@testuser:staging', {
      body: 'I have a feeling something will go wrong',
      msgtype: 'org.boxel.message',
      formatted_body: 'I have a feeling something will go wrong',
      format: 'org.matrix.custom.html',
    });

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
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
    let firstMessageId = await simulateRemoteMessage(
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
    await simulateRemoteMessage(
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
    await simulateRemoteMessage(
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

  test('it displays the streaming indicator when ai bot message is in progress (streaming words)', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'Say one word.',
      msgtype: 'org.boxel.message',
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
      msgtype: 'org.boxel.message',
      formatted_body: 'What is a french bulldog?',
      format: 'org.matrix.custom.html',
    });

    let partialEventId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'French bulldog is a',
        msgtype: 'm.text',
        formatted_body: 'French bulldog is a',
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
      },
      {
        origin_server_ts: Date.now(),
      },
    );

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
          event_id: partialEventId,
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
      .dom(`[data-test-enter-room='${roomId}']`)
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
    let anotherRoomId = await createAndJoinRoom(
      '@testuser:staging',
      'Another Room',
    );

    // A message that hasn't been seen and was sent more than fifteen minutes ago must not be shown in the toast.
    let sixteenMinutesAgo = subMinutes(new Date(), 16);
    await simulateRemoteMessage(
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
    await simulateRemoteMessage(
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
    let roomId = createAndJoinRoom('@testuser:staging', 'test room 1');
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Changing first name to Evie',
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
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
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    let commandReactionEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === 'm.reaction' &&
        event.content['m.relates_to']?.rel_type === 'm.annotation' &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      commandReactionEvents.length,
      0,
      'reaction event is not dispatched',
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

    commandReactionEvents = await getRoomEvents(roomId).filter(
      (event) =>
        event.type === 'm.reaction' &&
        event.content['m.relates_to']?.rel_type === 'm.annotation' &&
        event.content['m.relates_to']?.key === 'applied',
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
    let roomId = createAndJoinRoom('@testuser:staging', 'test room 1');
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Changing first name to Evie',
      msgtype: 'org.boxel.command',
      formatted_body: 'Changing first name to Evie',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: {
            attributes: {
              description: 'Searching for card',
              filter: {
                type: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    let commandResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === 'm.room.message' &&
        typeof event.content === 'object' &&
        event.content.msgtype === 'org.boxel.commandResult',
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

    commandResultEvents = await getRoomEvents(roomId).filter(
      (event) =>
        event.type === 'm.room.message' &&
        typeof event.content === 'object' &&
        event.content.msgtype === 'org.boxel.commandResult',
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

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: {
            attributes: {
              description: 'Searching for card',
              filter: {
                type: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-result]');
    await waitFor('.result-list li:nth-child(2)');
    let commandResultEvent = (await getRoomEvents(roomId)).find(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === 'org.boxel.commandResult' &&
        e.content['m.relates_to']?.rel_type === 'm.annotation',
    ) as CommandResultEvent;
    let serializedResults =
      typeof commandResultEvent?.content?.result === 'string'
        ? JSON.parse(commandResultEvent.content.result)
        : commandResultEvent.content.result;
    serializedResults = Array.isArray(serializedResults)
      ? serializedResults
      : [];
    assert.equal(serializedResults.length, 2, 'number of search results');
    assert
      .dom('[data-test-command-message]')
      .containsText('Search for the following card');
    assert
      .dom('[data-test-command-result-header]')
      .containsText('Search Results 2 Results');

    assert.dom('.result-list li:nth-child(1)').containsText('Jackie');
    assert.dom('.result-list li:nth-child(2)').containsText('Mango');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });

  test('it can search for card instances based upon title of card', async function (assert) {
    let id = `${testRealmURL}Pet/mango.json`;
    let roomId = await renderAiAssistantPanel(id);

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: {
            attributes: {
              description: 'Searching for card',
              filter: {
                contains: {
                  title: 'Mango',
                },
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
    });
    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-result]');
    await waitFor('.result-list li:nth-child(1)');
    let commandResultEvent = (await getRoomEvents(roomId)).find(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === 'org.boxel.commandResult' &&
        e.content['m.relates_to']?.rel_type === 'm.annotation',
    ) as CommandResultEvent;
    let serializedResults =
      typeof commandResultEvent?.content?.result === 'string'
        ? JSON.parse(commandResultEvent.content.result)
        : commandResultEvent.content.result;
    serializedResults = Array.isArray(serializedResults)
      ? serializedResults
      : [];
    assert.equal(serializedResults.length, 1, 'number of search results');
    assert
      .dom('[data-test-command-message]')
      .containsText('Search for the following card');
    assert
      .dom('[data-test-command-result-header]')
      .containsText('Search Results 1 Result');

    assert.dom('.result-list li:nth-child(1)').containsText('Mango');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });

  test('toggle more search results', async function (assert) {
    let id = `${testRealmURL}Person/fadhlan.json`;
    let roomId = await renderAiAssistantPanel(id);
    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: {
            attributes: {
              description: 'Searching for card',
              filter: {
                type: {
                  module: `${testRealmURL}person`,
                  name: 'Person',
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    await waitFor('[data-test-command-result]');
    await waitFor('.result-list li:nth-child(5)');
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
    const id = `${testRealmURL}Person/fadhlan.json`;
    const roomId = await renderAiAssistantPanel(id);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        filter: {
          type: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
    };

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: toolArgs,
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    assert.dom(`[data-test-stack-card="${id}"]`).exists();

    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-command-result-header]')
      .containsText('Search Results 8 Results');

    let resultListItem = '[data-test-result-list] > li';
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(5)`).containsText('Ian');

    const rightStackItem =
      '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]';
    assert.dom(rightStackItem).doesNotExist();

    await click('[data-test-command-result] [data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${rightStackItem} [data-test-boxel-card-header-title]`)
      .hasText('Command Result');

    const savedCardId = document
      .querySelector(rightStackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-command-result-isolated]`;
    assert.dom(`${savedCard} header`).hasText('Search Results 8 Results');
    assert.dom(`${savedCard} [data-test-boxel-field]`).exists({ count: 3 });
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(1)`)
      .hasText(`Description ${toolArgs.description}`);
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(2)`)
      .hasText(`Filter ${JSON.stringify(toolArgs.attributes.filter, null, 2)}`);

    resultListItem = `${savedCard} ${resultListItem}`;
    assert.dom(resultListItem).exists({ count: 8 });
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(6)`).containsText('Justin');
    assert.dom(`${resultListItem}:nth-child(8)`).containsText('Mickey');
  });

  test('it can copy search results card to workspace (no cards in stack)', async function (assert) {
    const id = `${testRealmURL}Person/fadhlan.json`;
    const roomId = await renderAiAssistantPanel(id);
    const toolArgs = {
      description: 'Search for Person cards',
      attributes: {
        filter: {
          type: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
    };

    await simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: 'org.boxel.command',
      body: 'Search for the following card',
      formatted_body: 'Search for the following card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'searchCard',
          arguments: toolArgs,
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    assert.dom(`[data-test-stack-card="${id}"]`).exists();
    await click('[data-test-close-button]'); // close the last open card
    assert.dom(`[data-test-stack-card="${id}"]`).doesNotExist();
    assert.dom('[data-test-workspace-chooser]').exists();

    await waitFor('[data-test-command-apply]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom('[data-test-command-result-header]')
      .containsText('Search Results 8 Results');

    let resultListItem = '[data-test-result-list] > li';
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(5)`).containsText('Ian');

    const stackItem =
      '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]';
    assert.dom(stackItem).doesNotExist();

    await click('[data-test-command-result] [data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Copy to Workspace"]');
    assert
      .dom(`${stackItem} [data-test-boxel-card-header-title]`)
      .hasText('Command Result');

    const savedCardId = document
      .querySelector(stackItem)
      ?.getAttribute('data-stack-card');
    const savedCard = `[data-test-card="${savedCardId}"] [data-test-command-result-isolated]`;
    assert.dom(`${savedCard} header`).hasText('Search Results 8 Results');
    assert.dom(`${savedCard} [data-test-boxel-field]`).exists({ count: 3 });
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(1)`)
      .hasText(`Description ${toolArgs.description}`);
    assert
      .dom(`${savedCard} [data-test-boxel-field]:nth-child(2)`)
      .hasText(`Filter ${JSON.stringify(toolArgs.attributes.filter, null, 2)}`);

    resultListItem = `${savedCard} ${resultListItem}`;
    assert.dom(resultListItem).exists({ count: 8 });
    assert.dom(`${resultListItem}:nth-child(1)`).containsText('Buck');
    assert.dom(`${resultListItem}:nth-child(6)`).containsText('Justin');
    assert.dom(`${resultListItem}:nth-child(8)`).containsText('Mickey');
  });
});
