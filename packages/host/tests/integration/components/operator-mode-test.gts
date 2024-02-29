import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  focus,
  blur,
  setupOnerror,
  triggerEvent,
  triggerKeyEvent,
  typeIn,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test, skip } from 'qunit';

import { FieldContainer } from '@cardstack/boxel-ui/components';

import { baseRealm, Deferred } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';

import type LoaderService from '@cardstack/host/services/loader-service';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  showSearchResult,
  type TestContextWithSave,
} from '../../helpers';
import {
  setupMatrixServiceMock,
  MockMatrixService,
} from '../../helpers/mock-matrix-service';
import { renderComponent } from '../../helpers/render-component';

let cardApi: typeof import('https://cardstack.com/base/card-api');
const realmName = 'Operator Mode Workspace';
let setCardInOperatorModeState: (card: string) => Promise<void>;

let loader: Loader;

module('Integration | operator-mode', function (hooks) {
  let matrixService: MockMatrixService;
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupServerSentEvents(hooks);
  setupMatrixServiceMock(hooks);
  let noop = () => {};

  hooks.afterEach(async function () {
    localStorage.removeItem('recent-cards');
  });

  hooks.beforeEach(async function () {
    localStorage.removeItem('recent-cards');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;

    //Generate 11 person card to test recent card menu in card sheet
    let personCards: Map<String, any> = new Map<String, any>();
    for (let i = 1; i <= 11; i++) {
      personCards.set(`Person/${i}.json`, {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/${i}`,
          attributes: {
            firstName: `${i}`,
            address: {
              city: 'Bandung',
              country: 'Indonesia',
            },
          },
          relationships: {
            pet: {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      });
    }

    let string: typeof import('https://cardstack.com/base/string');
    let textArea: typeof import('https://cardstack.com/base/text-area');

    string = await loader.import(`${baseRealm.url}string`);
    textArea = await loader.import(`${baseRealm.url}text-area`);

    let {
      field,
      contains,
      linksTo,
      linksToMany,
      serialize,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let { default: StringField } = string;
    let { default: TextAreaField } = textArea;

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
          <span data-test-preferredCarrier={{@model.preferredCarrier}}></span>
          <@fields.preferredCarrier />
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

      static edit = class Edit extends Component<typeof this> {
        <template>
          <FieldContainer @label='city' @tag='label' data-test-boxel-input-city>
            <@fields.city />
          </FieldContainer>
          <FieldContainer
            @label='country'
            @tag='label'
            data-test-boxel-input-country
          >
            <@fields.country />
          </FieldContainer>
          <div data-test-shippingInfo-field><@fields.shippingInfo /></div>
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

    // this field explodes when serialized (saved)
    class BoomField extends StringField {
      static [serialize](_boom: any) {
        throw new Error('Boom!');
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          {{@model}}
        </template>
      };
    }
    class BoomPet extends Pet {
      static displayName = 'Boom Pet';
      @field boom = contains(BoomField);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet={{@model.name}}>
            <@fields.name />
            <@fields.boom />
          </h2>
        </template>
      };
    }

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-author='{{@model.firstName}}'>
            <@fields.firstName />
            <@fields.lastName />
          </span>
        </template>
      };
    }

    class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field title = contains(StringField);
      @field slug = contains(StringField);
      @field body = contains(TextAreaField);
      @field authorBio = linksTo(Author);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.title /> by <@fields.authorBio />
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-blog-post-isolated>
            <@fields.title />
            by
            <@fields.authorBio />
          </div>
        </template>
      };
    }

    class PublishingPacket extends CardDef {
      static displayName = 'Publishing Packet';
      @field blogPost = linksTo(BlogPost);
      @field socialBlurb = contains(TextAreaField);
    }

    class PetRoom extends CardDef {
      static displayName = 'Pet Room';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: PetRoom) {
          return this.name;
        },
      });
    }

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'pet.gts': { Pet },
        'shipping-info.gts': { ShippingInfo },
        'address.gts': { Address },
        'person.gts': { Person },
        'boom-field.gts': { BoomField },
        'boom-pet.gts': { BoomPet },
        'blog-post.gts': { BlogPost },
        'author.gts': { Author },
        'publishing-packet.gts': { PublishingPacket },
        'pet-room.gts': { PetRoom },
        'Pet/mango.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'BoomPet/paper.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}BoomPet/paper`,
            attributes: {
              name: 'Paper',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}boom-pet`,
                name: 'BoomPet',
              },
            },
          },
        },
        'Pet/jackie.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/jackie`,
            attributes: {
              name: 'Jackie',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Pet/woody.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/woody`,
            attributes: {
              name: 'Woody',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Person/fadhlan.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Person/fadhlan`,
            attributes: {
              firstName: 'Fadhlan',
              address: {
                city: 'Bandung',
                country: 'Indonesia',
                shippingInfo: {
                  preferredCarrier: 'DHL',
                  remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
                },
              },
            },
            relationships: {
              pet: {
                links: {
                  self: `${testRealmURL}Pet/mango`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
          },
        },
        'Person/burcu.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Person/burcu`,
            attributes: {
              firstName: 'Burcu',
            },
            relationships: {
              'friends.0': {
                links: {
                  self: `${testRealmURL}Pet/jackie`,
                },
              },
              'friends.1': {
                links: {
                  self: `${testRealmURL}Pet/woody`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
          },
        },
        'grid.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        'CatalogEntry/publishing-packet.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Publishing Packet',
              description: 'Catalog entry for PublishingPacket',
              ref: {
                module: `${testRealmURL}publishing-packet`,
                name: 'PublishingPacket',
              },
              demo: {
                socialBlurb: null,
              },
            },
            relationships: {
              'demo.blogPost': {
                links: {
                  self: '../BlogPost/1',
                },
              },
            },
            meta: {
              fields: {
                demo: {
                  adoptsFrom: {
                    module: `../publishing-packet`,
                    name: 'PublishingPacket',
                  },
                },
              },
              adoptsFrom: {
                module: 'https://cardstack.com/base/catalog-entry',
                name: 'CatalogEntry',
              },
            },
          },
        },
        'CatalogEntry/pet-room.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'General Pet Room',
              description: 'Catalog entry for Pet Room Card',
              ref: {
                module: `${testRealmURL}pet-room`,
                name: 'PetRoom',
              },
            },
            meta: {
              fields: {
                demo: {
                  adoptsFrom: {
                    module: `../pet-room`,
                    name: 'PetRoom',
                  },
                },
              },
              adoptsFrom: {
                module: 'https://cardstack.com/base/catalog-entry',
                name: 'CatalogEntry',
              },
            },
          },
        },
        'CatalogEntry/pet-card.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Pet',
              description: 'Catalog entry for Pet',
              ref: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
              demo: {
                name: 'Snoopy',
              },
            },
            meta: {
              fields: {
                demo: {
                  adoptsFrom: {
                    module: `../pet`,
                    name: 'Pet',
                  },
                },
              },
              adoptsFrom: {
                module: 'https://cardstack.com/base/catalog-entry',
                name: 'CatalogEntry',
              },
            },
          },
        },
        'BlogPost/1.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Outer Space Journey',
              body: 'Hello world',
            },
            relationships: {
              authorBio: {
                links: {
                  self: '../Author/1',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../blog-post',
                name: 'BlogPost',
              },
            },
          },
        },
        'BlogPost/2.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Beginnings',
            },
            relationships: {
              authorBio: {
                links: {
                  self: null,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../blog-post',
                name: 'BlogPost',
              },
            },
          },
        },
        'Author/1.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Alien',
              lastName: 'Bob',
            },
            meta: {
              adoptsFrom: {
                module: '../author',
                name: 'Author',
              },
            },
          },
        },
        'Author/2.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'R2-D2',
            },
            meta: {
              adoptsFrom: {
                module: '../author',
                name: 'Author',
              },
            },
          },
        },
        'Author/mark.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mark',
              lastName: 'Jackson',
            },
            meta: {
              adoptsFrom: {
                module: '../author',
                name: 'Author',
              },
            },
          },
        },
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://example-icon.test" }`,
        ...Object.fromEntries(personCards),
      },
    });

    setCardInOperatorModeState = async (cardURL: string) => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      await operatorModeStateService.restore({
        stacks: [
          [
            {
              id: cardURL,
              format: 'isolated',
            },
          ],
        ],
      });
    };
  });

  test<TestContextWithSave>('it allows chat commands to change cards in the stack', async function (assert) {
    assert.expect(4);
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    await click('[data-test-open-ai-assistant]');

    matrixService.createAndJoinRoom('testroom');

    addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: 'testroom',
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
          command: {
            type: 'patch',
            id: `${testRealmURL}Person/fadhlan`,
            patch: {
              attributes: { firstName: 'Dave' },
            },
          },
        }),
      },
    });

    await waitFor('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test_a"]');

    await waitFor('[data-test-command-apply]');
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.firstName, 'Dave');
    });
    await click('[data-test-command-apply]');
    await waitFor('[data-test-patch-card-idle]');

    assert.dom('[data-test-person]').hasText('Dave');
  });

  test('it allows only applies changes from the chat if the stack contains a card with that ID', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    await click('[data-test-open-ai-assistant]');

    matrixService.createAndJoinRoom('testroom');

    addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: 'testroom',
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
          command: {
            type: 'patch',
            id: `${testRealmURL}Person/anotherPerson`,
            patch: {
              attributes: { firstName: 'Dave' },
            },
          },
        }),
      },
    });

    await waitFor('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test_a"]');

    await waitFor('[data-test-command-apply]');
    await click('[data-test-command-apply]');

    await waitFor('[data-test-person="Fadhlan"]');
    assert.dom('[data-test-person]').hasText('Fadhlan');
  });

  test('it sends regular messages without any context while the share checkbox is unticked', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    await click('[data-test-open-ai-assistant]');

    matrixService.createAndJoinRoom('testroom');

    await waitFor('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test_a"]');

    // Add some text so that we can click the send button
    // Do not share the context here
    assert.dom('[data-test-message-field="test_a"]').exists();
    await fillIn('[data-test-message-field="test_a"]', 'hello');

    // Send message
    await click('[data-test-send-message-btn]');
    assert.deepEqual(matrixService.lastMessageSent, {
      body: 'hello',
      cards: undefined,
      context: undefined,
      roomId: 'testroom',
    });
  });

  test('sends the top stack cards when context sharing is on', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Pet/mango`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-boxel-header-title]');
    assert.dom('[data-test-boxel-header-title]').hasText('Pet');
    await click('[data-test-open-ai-assistant]');

    matrixService.createAndJoinRoom('testroom');

    await waitFor('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test_a"]');

    // Add some text so that we can click the send button
    assert.dom('[data-test-message-field="test_a"]').exists();
    await fillIn('[data-test-message-field="test_a"]', 'hello');
    // Set sharing the context to true
    await click('[data-test-share-context]');

    // Send message
    await click('[data-test-send-message-btn]');
    // Checking the object itself has issues due to serialisation
    // checking we're sharing the correct card should be enough
    assert.equal(matrixService.lastMessageSent.context.openCards.length, 1);
    assert.equal(matrixService.lastMessageSent.context.submode, 'interact');
    assert.equal(
      matrixService.lastMessageSent.context.openCards[0].id,
      'http://test-realm/test/Pet/mango',
    );
  });

  test('it can handle an error in a card attached to a matrix message', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await operatorModeStateService.restore({
      stacks: [[]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    matrixService.createAndJoinRoom('testroom');
    addRoomEvent(matrixService, {
      event_id: 'event1',
      room_id: 'testroom',
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
    });
    addRoomEvent(matrixService, {
      event_id: 'event2',
      room_id: 'testroom',
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
    });

    await waitFor('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test_a"]');
    await waitFor('[data-test-card-error]');
    assert
      .dom('[data-test-card-error]')
      .containsText(
        'Error: cannot render card http://this-is-not-a-real-card.com/: status: 500 - Failed to fetch.',
      );
    await percySnapshot(assert);
  });

  test('it loads a card and renders its isolated view', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert
      .dom(`[data-test-boxel-header-icon="https://example-icon.test"]`)
      .exists();
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
    assert.dom('[data-test-stack-card]').exists({ count: 1 });
    await waitFor('[data-test-pet="Mango"]');
    await click('[data-test-pet="Mango"]');
    assert.dom('[data-test-stack-card]').exists({ count: 2 });
    assert.dom('[data-test-stack-card-index="1"]').includesText('Mango');
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

    let tinyDelay = () => new Promise((resolve) => setTimeout(resolve, 1)); // Add a tiny artificial delay to ensure rooms are created in the correct order with increasing timestamps
    await matrixService.createAndJoinRoom('test1', 'test room 1');
    await tinyDelay();
    await matrixService.createAndJoinRoom('test2', 'test room 2');
    await tinyDelay();
    await matrixService.createAndJoinRoom('test3', 'test room 3');

    await waitFor(`[data-test-open-ai-assistant]`);
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    assert
      .dom('[data-test-room="test room 3"]')
      .exists(
        "test room 3 is the most recently created room and it's opened initially",
      );

    await click('[data-test-past-sessions-button]');
    await click('[data-test-enter-room="test room 2"]');

    await click('[data-test-close-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom('[data-test-room="test room 2"]')
      .exists(
        "test room 2 is the most recently selected room and it's opened initially",
      );

    await click('[data-test-close-ai-assistant]');
    localStorage.setItem(
      'aiPanelCurrentRoomId',
      "room-id-that-doesn't-exist-and-should-not-break-the-implementation",
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom('[data-test-room="test room 3"]')
      .exists(
        "test room 3 is the most recently created room and it's opened initially",
      );

    localStorage.removeItem('aiPanelCurrentRoomId'); // Cleanup
  });

  test<TestContextWithSave>('it auto saves the field value', async function (assert) {
    assert.expect(3);
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.firstName, 'EditedName');
    });
    await fillIn('[data-test-boxel-input]', 'EditedName');
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('E');
  });

  // TODO CS-6268 visual indicator for failed auto-save should build off of this test
  test('an error in auto-save is handled gracefully', async function (assert) {
    let done = assert.async();

    setupOnerror(function (error) {
      assert.ok(error, 'expected a global error');
      done();
    });

    await setCardInOperatorModeState(`${testRealmURL}BoomPet/paper`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-pet]');
    await click('[data-test-edit-button]');
    await fillIn('[data-test-field="boom"] input', 'Bad cat!');
    await setCardInOperatorModeState(`${testRealmURL}BoomPet/paper`);

    await waitFor('[data-test-pet]');
    // Card still runs (our error was designed to only fire during save)
    // despite save error
    assert.dom('[data-test-pet]').includesText('Paper Bad cat!');
  });

  test('displays add card button if user closes the only card in the stack and opens a card from card chooser', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').isVisible();

    await click('[data-test-close-button]');
    await waitUntil(() => !document.querySelector('[data-test-stack-card]'));
    assert.dom('[data-test-person]').isNotVisible();
    assert.dom('[data-test-add-card-button]').isVisible();

    await click('[data-test-add-card-button]');
    assert.dom('[data-test-card-catalog-modal]').isVisible();

    await waitFor(`[data-test-select]`);
    await showSearchResult(
      'Operator Mode Workspace',
      `${testRealmURL}Person/fadhlan`,
    );

    await percySnapshot(assert);

    await click(`[data-test-select="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-card-catalog-go-button]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .isVisible();
  });

  test('displays cards on cards-grid and includes `catalog-entry` instances', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    assert.dom(`[data-test-cards-grid-item]`).exists();
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-thumbnail-text]`,
      )
      .hasText('Blog Post');
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-title]`,
      )
      .hasText('Outer Space Journey');
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-display-name]`,
      )
      .hasText('Blog Post');
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
      )
      .exists('publishing-packet catalog-entry is displayed on cards-grid');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}CatalogEntry/pet-room"]`)
      .exists('pet-room catalog-entry instance is displayed on cards-grid');
  });

  test<TestContextWithSave>('can create a card using the cards-grid', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let saved = new Deferred<void>();
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
      saved.fulfill();
    });

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();

    await click('[data-test-create-new-card-button]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
    );
    assert.dom('[data-test-card-catalog-item]').exists({ count: 4 });

    await click(
      `[data-test-select="${testRealmURL}CatalogEntry/publishing-packet"]`,
    );
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();
    await click(
      '[data-test-stack-card-index="1"] [data-test-more-options-button]',
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Card URL"]')
      .hasAttribute('disabled');
    assert
      .dom('[data-test-boxel-menu-item-text="Delete"]')
      .hasAttribute('disabled');
    await fillIn(`[data-test-field="title"] input`, 'New Post');
    await saved.promise;
    let packetId = [...savedCards].find((k) => k.includes('PublishingPacket'))!;
    await setCardInOperatorModeState(packetId);

    await waitFor(`[data-test-stack-card="${packetId}"]`);
    assert.dom(`[data-test-stack-card="${packetId}"]`).exists();
  });

  test('can open a card from the cards-grid and close it', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-stack-card-index]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();

    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/burcu"]`);

    assert.dom(`[data-test-stack-card-index="1"]`).exists(); // Opens card on the stack
    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-boxel-header-title]`)
      .includesText('Person');

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
  });

  test<TestContextWithSave>('create new card editor opens in the stack at each nesting level', async function (assert) {
    assert.expect(11);
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
    );
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    assert.dom('[data-test-card-catalog-item]').exists({ count: 4 });

    await click(
      `[data-test-select="${testRealmURL}CatalogEntry/publishing-packet"]`,
    );
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);

    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .exists();

    // Update the blog post card first to trigger auto-save.
    // This allows us to simulate a scenario where the non-top item in the card-catalog-modal stack is saved before the top item.
    await fillIn(
      '[data-test-stack-card-index="2"] [data-test-field="title"] [data-test-boxel-input]',
      'Mad As a Hatter',
    );

    await click(
      '[data-test-stack-card-index="2"] [data-test-field="authorBio"] [data-test-add-new]',
    );
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);

    await waitFor(`[data-test-stack-card-index="3"]`);

    assert
      .dom('[data-test-field="firstName"] [data-test-boxel-input]')
      .exists();
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );
    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="3"][data-test-stack-card="${authorId}"]`,
    );
    await fillIn(
      '[data-test-field="lastName"] [data-test-boxel-input]',
      'Enwunder',
    );

    await click('[data-test-stack-card-index="3"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="3"]', { count: 0 });

    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .containsText('Alice Enwunder');

    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    let packetId = [...savedCards].find((k) => k.includes('PublishingPacket'))!;
    await waitFor(
      `[data-test-stack-card-index="1"][data-test-stack-card="${packetId}"]`,
    );
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="socialBlurb"] [data-test-boxel-input]',
      `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`,
    );
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .containsText('Mad As a Hatter by Alice Enwunder');

    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(
        json.data.attributes!.socialBlurb,
        `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`,
      );
    });

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');
    assert
      .dom(`[data-test-stack-card="${packetId}"]`)
      .containsText(
        'Everyone knows that Alice ran the show in the Brady household.',
      );
  });

  test('can choose a card for a linksTo field that has an existing value', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-add-new]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-add-new]').exists();
    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);

    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/2"][data-test-card-catalog-item-selected]`,
      )
      .exists();

    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitFor(`.operator-mode [data-test-author="R2-D2"]`);
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');
  });

  test('can choose a card for a linksTo field that has no existing value', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new]').exists();

    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-blog-post-isolated]');

    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Beginnings by R2-D2');
  });

  test<TestContextWithSave>('can create a new card to populate a linksTo field', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new]').exists();

    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="firstName"]')
      .exists();
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );

    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="1"][data-test-stack-card="${authorId}"]`,
    );

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom('[data-test-add-new]').doesNotExist();
    assert.dom('[data-test-field="authorBio"]').containsText('Alice');

    await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by Alice');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    await click('[data-test-field="authorBio"] [data-test-remove-card]');
    await click('[data-test-edit-button]');

    await waitFor('.operator-mode [data-test-blog-post-isolated]');
    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Outer Space Journey by');
  });

  test('can add a card to a linksToMany field with existing values', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    assert.dom('[data-test-field="friends"] [data-test-add-new]').exists();

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert
      .dom('[data-test-field="friends"]')
      .containsText('Jackie Woody Mango');
  });

  test('can add a card to linksToMany field that has no existing values', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    assert.dom('[data-test-add-new]').hasText('Add Pets');
    await click('[data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can change the item selection in a linksToMany field', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie');

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test<TestContextWithSave>('can create a new card to add to a linksToMany field from card chooser', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"][data-test-stack-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Woodster');
  });

  test<TestContextWithSave>('does not create a new card to add to a linksToMany field from card chooser, if user cancel the edit view', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"][data-test-stack-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    //Ensuring the card chooser modal doesn't get stuck
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
  });

  test('can remove all items of a linksToMany field', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert.dom(`[data-test-plural-view-item]`).exists({ count: 2 });
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );

    await click('[data-test-edit-button]');
    await waitFor(`[data-test-person="Burcu"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/burcu"]`)
      .doesNotContainText('Jackie');
    assert.dom(`[data-test-plural-view-item]`).doesNotExist();
  });

  skip('can create a specialized a new card to populate a linksTo field');
  skip('can create a specialized a new card to populate a linksToMany field');

  test('can close cards by clicking the header of a card deeper in the stack', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    await waitFor('[data-test-person]');

    await waitFor('[data-test-cards-grid-item]');
    await click('[data-test-cards-grid-item]');
    assert.dom(`[data-test-stack-card-index="2"]`).exists();
    await click('[data-test-stack-card-index="0"] [data-test-boxel-header]');
    assert.dom(`[data-test-stack-card-index="2"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
  });

  test(`displays realm name as cards grid card title and card's display name as other card titles`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-header-title]`,
      )
      .containsText('Person');

    assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
    assert.dom(`[data-test-create-new-card-button]`).isNotVisible();
  });

  test(`displays recently accessed card`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-header-title]`,
      )
      .containsText('Person');

    assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
    assert.dom(`[data-test-create-new-card-button]`).isNotVisible();

    await focus(`[data-test-search-field]`);
    assert
      .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
      .exists();
    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/burcu"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();

    await focus(`[data-test-search-field]`);
    assert.dom(`[data-test-search-sheet-recent-card]`).exists({ count: 2 });
    assert
      .dom(
        `[data-test-search-sheet-recent-card="0"][data-test-search-result="${testRealmURL}Person/burcu"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-search-sheet-recent-card="1"][data-test-search-result="${testRealmURL}Person/fadhlan"]`,
      )
      .exists();
  });

  test(`displays recently accessed card, maximum 10 cards`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await waitFor(`[data-test-cards-grid-item]`);
    for (let i = 1; i <= 11; i++) {
      await click(`[data-test-cards-grid-item="${testRealmURL}Person/${i}"]`);
      await waitFor(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
      );
      await click(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"] [data-test-close-button]`,
      );
      await waitFor(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
        { count: 0 },
      );
    }

    await focus(`[data-test-search-field]`);
    await waitFor(`[data-test-search-result]`);
    assert.dom(`[data-test-search-result]`).exists({ count: 10 });
  });

  test(`displays searching results`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await waitFor(`[data-test-cards-grid-item]`);

    await focus(`[data-test-search-field]`);
    await typeIn(`[data-test-search-field]`, 'Ma');
    assert.dom(`[data-test-search-label]`).containsText('Searching for “Ma”');

    await waitFor(`[data-test-search-sheet-search-result]`);
    assert.dom(`[data-test-search-label]`).containsText('2 Results for “Ma”');
    assert.dom(`[data-test-search-sheet-search-result]`).exists({ count: 2 });
    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(`[data-test-search-result="${testRealmURL}Author/mark"]`)
      .exists();

    await click(`[data-test-search-sheet-cancel-button]`);

    await focus(`[data-test-search-field]`);
    await typeIn(`[data-test-search-field]`, 'Mar');
    await waitFor(`[data-test-search-sheet-search-result]`);
    assert.dom(`[data-test-search-label]`).containsText('1 Result for “Mar”');

    //Ensures that there is no cards when reopen the search sheet
    await click(`[data-test-search-sheet-cancel-button]`);
    await focus(`[data-test-search-field]`);
    assert.dom(`[data-test-search-label]`).doesNotExist();
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();

    //No cards match
    await focus(`[data-test-search-field]`);
    await typeIn(`[data-test-search-field]`, 'No Cards');
    assert
      .dom(`[data-test-search-label]`)
      .containsText('Searching for “No Cards”');

    await waitUntil(
      () =>
        (
          document.querySelector('[data-test-search-label]') as HTMLElement
        )?.innerText.includes('0'),
      {
        timeoutMessage: 'timed out waiting for search label to show 0 results',
      },
    );
    assert
      .dom(`[data-test-search-label]`)
      .containsText('0 Results for “No Cards”');
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();
  });

  test(`can specify a card by URL in the card chooser`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(
      `[data-test-search-field]`,
      `https://cardstack.com/base/types/card`,
    );

    await waitFor('[data-test-card-catalog-item]', {
      count: 1,
    });

    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-results-count]`)
      .hasText('1 result');

    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });
    await click('[data-test-select]');

    await waitFor('[data-test-card-catalog-go-button][disabled]', {
      count: 0,
    });
    await click('[data-test-card-catalog-go-button]');

    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-field="title"]`)
      .exists();
    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-field="description"]`)
      .exists();
    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-field="thumbnailURL"]`)
      .exists();
  });

  test(`can search by card title in card chooser`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
      )
      .exists();

    await fillIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await fillIn(`[data-test-search-field]`, `publishing packet`);
    await waitUntil(
      () =>
        !document.querySelector(
          `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-card"]`,
        ),
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 1 });

    await click(
      `[data-test-select="${testRealmURL}CatalogEntry/publishing-packet"]`,
    );
    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click(`[data-test-card-catalog-go-button]`);
    assert.dom('[data-test-stack-card-index="1"]').exists();
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-boxel-header-title]')
      .hasText('Publishing Packet');
  });

  test(`can search by card title when opening card chooser from a field editor`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`).exists();
    await click(
      `[data-test-stack-card="${testRealmURL}BlogPost/2"] [data-test-edit-button]`,
    );
    await waitFor(`[data-test-field="authorBio"]`);
    await click('[data-test-add-new]');

    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .hasText('Choose an Author card');
    assert.dom('[data-test-results-count]').hasText('3 results');

    await fillIn(`[data-test-search-field]`, `alien`);
    await waitFor('[data-test-card-catalog-item]');
    assert.dom(`[data-test-select="${testRealmURL}Author/1"]`).exists();
  });

  test(`displays no cards available message if search result does not exist`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await fillIn(`[data-test-search-field]`, `friend`);
    await waitFor('[data-test-card-catalog-item]', { count: 0 });
    assert.dom(`[data-test-card-catalog]`).hasText('No cards available');
  });

  test(`can filter by realm after searching in card catalog`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 4 });

    await fillIn(`[data-test-search-field]`, `general`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-card"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });
    assert.dom(`[data-test-realm]`).exists({ count: 2 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert
      .dom(
        '[data-test-realm="Operator Mode Workspace"] [data-test-results-count]',
      )
      .hasText('1 result');
    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-select="${testRealmURL}CatalogEntry/pet-room"]`,
      )
      .exists();
    assert.dom('[data-test-realm="Base Workspace"]').exists();
    assert
      .dom('[data-test-realm="Base Workspace"] [data-test-results-count]')
      .hasText('1 result');
    assert
      .dom(
        `[data-test-realm="Base Workspace"] [data-test-select="${baseRealm.url}types/card"]`,
      )
      .exists();

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Base Workspace"]');
    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').doesNotExist();
    assert.dom('[data-test-realm="Base Workspace"]').exists();
    assert.dom(`[data-test-select="${baseRealm.url}types/card"]`).exists();

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]');
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').exists();
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await fillIn(`[data-test-search-field]`, '');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-card"]`,
    );
    assert
      .dom(`[data-test-card-catalog-item]`)
      .exists({ count: 4 }, 'can clear search input');

    await fillIn(`[data-test-search-field]`, 'pet');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-card"]`,
    );
    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]');
    await waitFor('[data-test-card-catalog-item]', { count: 0 });
    assert.dom('[data-test-card-catalog]').hasText('No cards available');
  });

  test(`can open new card editor in the stack after searching in card catalog`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await typeIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await click(`[data-test-select="${testRealmURL}CatalogEntry/pet-card"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-card"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-boxel-header-title]')
      .hasText('Pet');
  });

  test(`cancel button closes the catalog-entry card picker`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);

    await typeIn(`[data-test-search-field]`, `pet`);
    assert.dom(`[data-test-search-field]`).hasValue('pet');
    await waitFor('[data-test-card-catalog-item]', { count: 2 });
    await click(`[data-test-select="${testRealmURL}CatalogEntry/pet-room"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/pet-room"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert.dom('[data-test-operator-mode-stack="0"]').exists();
    assert
      .dom('[data-test-operator-mode-stack="1"]')
      .doesNotExist('no cards are added');

    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Card picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`cancel button closes the field picker`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    await click(`[data-test-field="authorBio"] [data-test-add-new]`);

    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-card-catalog-item]', { count: 3 });
    await typeIn(`[data-test-search-field]`, `bob`);
    assert.dom(`[data-test-search-field]`).hasValue('bob');
    await waitFor('[data-test-card-catalog-item]', { count: 1 });
    await click(`[data-test-select="${testRealmURL}Author/1"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/1"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert
      .dom(`[data-test-field="authorBio"] [data-test-add-new]`)
      .exists('no card is chosen');

    await click(`[data-test-field="authorBio"] [data-test-add-new]`);
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Field picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`can add a card to the stack by URL from search sheet`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await focus(`[data-test-search-field]`);

    await click('[data-test-search-field]');

    assert
      .dom(`[data-test-boxel-input-validation-state="invalid"]`)
      .doesNotExist('invalid state is not shown');

    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');
    await waitFor(`[data-test-boxel-input-validation-state="invalid"]`);

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();
    assert.dom('[data-test-boxel-input-validation-state="invalid"]').exists();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    assert
      .dom('[data-test-search-label]')
      .containsText('Card found at http://localhost:4202/test/mango');
    assert.dom('[data-test-search-sheet-search-result]').exists({ count: 1 });
    assert
      .dom(`[data-test-boxel-input-validation-state="invalid"]`)
      .doesNotExist();

    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');
    await waitFor(`[data-test-boxel-input-validation-state="invalid"]`);

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();
    assert.dom('[data-test-boxel-input-validation-state="invalid"]').exists();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    await click('[data-test-search-sheet-search-result]');

    await waitFor(`[data-test-stack-card="http://localhost:4202/test/mango"]`);
    assert
      .dom(
        `[data-test-stack-card="http://localhost:4202/test/mango"] [data-test-field-component-card]`,
      )
      .containsText('Mango', 'the card is rendered in the stack');
  });

  test(`can select one or more cards on cards-grid and unselect`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-cards-grid-cards]`).exists();

    await waitFor(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`,
    );
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await click(`[data-test-overlay-select="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-overlay-selected="${testRealmURL}Person/fadhlan"]`)
      .exists();
    assert.dom('[data-test-overlay-selected]').exists({ count: 1 });

    await click(`[data-test-overlay-select="${testRealmURL}Pet/jackie"]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}Author/1"]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}BlogPost/2"]`);
    assert.dom('[data-test-overlay-selected]').exists({ count: 4 });

    await click(`[data-test-cards-grid-item="${testRealmURL}Pet/jackie"]`);
    assert.dom('[data-test-overlay-selected]').exists({ count: 3 });

    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    await click(`[data-test-cards-grid-item="${testRealmURL}BlogPost/2"]`);
    await click(`[data-test-overlay-select="${testRealmURL}Author/1"]`);
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
  });

  test('displays realm name as header title when hovering realm icon', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
    assert
      .dom(`[data-test-boxel-header-icon="https://example-icon.test"]`)
      .exists();
    await triggerEvent(`[data-test-boxel-header-icon]`, 'mouseenter');
    assert
      .dom('[data-test-boxel-header-title]')
      .hasText('In Operator Mode Workspace');
    await triggerEvent(`[data-test-boxel-header-icon]`, 'mouseleave');
    assert.dom('[data-test-boxel-header-title]').hasText('Person');
  });

  test(`it has an option to copy the card url`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-more-options-button]');
    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Copy Card URL"]');
    assert.dom('[data-test-boxel-menu-item]').doesNotExist();
  });

  test(`"links to" field has an overlay header and click on the embedded card will open it on the stack`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    // Linked cards have the realm's icon in the overlaid header title
    await waitFor('[data-test-overlay-card-display-name="Author"]');
    assert
      .dom('[data-test-overlay-card-display-name="Author"] .header-title img')
      .hasAttribute('src', 'https://example-icon.test');

    await click('[data-test-author');
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-boxel-header-title]')
      .includesText('Author');
  });

  test(`toggles mode switcher`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');

    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Interact');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();
  });

  test(`card url bar shows realm info of valid URL`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await blur('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar shows error message when URL is invalid`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('This resource does not exist');
    await percySnapshot(assert);

    await fillIn('[data-test-card-url-bar-input]', `Wrong URL`);
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('Not a valid URL');
  });

  test('user can dismiss url bar error message', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await click('[data-test-dismiss-url-error-button]');
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard_2`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar URL reacts to external changes of code path when user is not editing`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await waitFor('[data-test-boxel-menu-item-text]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;
    operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
  });

  test(`card url bar URL does not react to external changes when user is editing`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    let someRandomText = 'I am still typing a url';
    await typeIn('[data-test-card-url-bar-input]', someRandomText);

    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;
    operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);

    blur('[data-test-card-url-bar-input]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);
  });

  test(`can open and close search sheet`, async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await focus(`[data-test-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await click(`[data-test-search-sheet] .search-sheet-content`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await typeIn(`[data-test-search-field]`, 'A');
    await click(
      `[data-test-search-sheet] .search-sheet-content .search-result-section`,
    );
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(
      `[data-test-search-sheet] .search-sheet-content .search-result-section`,
    );
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(`[data-test-operator-mode-stack]`);
    assert.dom(`[data-test-search-sheet="closed"]`).exists();
  });
});
