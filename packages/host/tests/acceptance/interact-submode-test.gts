import { on } from '@ember/modifier';
import {
  currentURL,
  click,
  fillIn,
  find,
  triggerKeyEvent,
  settled,
  waitUntil,
  waitFor,
} from '@ember/test-helpers';

import { triggerEvent } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  Deferred,
  SingleCardDocument,
  type LooseSingleCardDocument,
  isLocalId,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';

import { claimsFromRawToken } from '@cardstack/host/services/realm';

import { RecentCards } from '@cardstack/host/utils/local-storage-keys';

import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  type TestContextWithSave,
  assertMessages,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const testRealm2URL = `http://test-realm/test2/`;
const testRealm3URL = `http://test-realm/test3/`;

module('Acceptance | interact submode tests', function (hooks) {
  let realm: Realm;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL, testRealm3URL],
  });

  let { createAndJoinRoom, setActiveRealms, setRealmPermissions } =
    mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let spec: typeof import('https://cardstack.com/base/spec');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    spec = await loader.import(`${baseRealm.url}spec`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let { default: StringField } = string;
    let { Spec } = spec;
    let { CardsGrid } = cardsGrid;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field favoriteTreat = contains(StringField);

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
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <GridContainer class='container'>
            <h2 data-test-pet-title><@fields.title /></h2>
            <div>
              <div>Favorite Treat: <@fields.favoriteTreat /></div>
              <div data-test-editable-meta>
                {{#if @canEdit}}
                  <@fields.title />
                  is editable.
                {{else}}
                  <@fields.title />
                  is NOT editable.
                {{/if}}
              </div>
            </div>
          </GridContainer>
        </template>
      };
    }

    class Puppy extends Pet {
      static displayName = 'Puppy';
      @field age = contains(StringField);
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
          <h3 data-test-city={{@model.city}}>
            <@fields.city />
          </h3>
          <h3 data-test-country={{@model.country}}>
            <@fields.country />
          </h3>
          <div data-test-shippingInfo-field><@fields.shippingInfo /></div>

          <div data-test-editable-meta>
            {{#if @canEdit}}
              address is editable
            {{else}}
              address is NOT editable.
            {{/if}}
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
          if (!this.firstName) {
            return;
          }
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field primaryAddress = contains(Address);
      @field additionalAddresses = containsMany(Address);

      static isolated = class Isolated extends Component<typeof this> {
        updateAndSavePet = () => {
          let pet = this.args.model.pet;
          if (pet) {
            pet.name = 'Updated Pet';
            this.args.saveCard?.(pet.id);
          }
        };
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
          Primary Address:
          <@fields.primaryAddress />
          Additional Adresses:
          <@fields.additionalAddresses />
          <button
            data-test-update-and-save-pet
            {{on 'click' this.updateAndSavePet}}
          >
            Update and Save Pet
          </button>
          <style scoped>
            .pet-container {
              height: 80px;
              padding: 10px;
            }
          </style>
        </template>
      };
    }

    class Personnel extends Person {
      static displayName = 'Personnel';
    }

    let generateSpec = (
      fileName: string,
      title: string,
      ref: { module: string; name: string },
    ) => ({
      [`${fileName}.json`]: new Spec({
        title,
        description: `Spec for ${title}`,
        specType: 'card',
        ref,
      }),
    });
    let catalogEntries = {};
    for (let i = 0; i < 5; i++) {
      let entry = generateSpec(`p-${i + 1}`, `Personnel-${i + 1}`, {
        module: `${testRealmURL}personnel`,
        name: 'Personnel',
      });
      catalogEntries = { ...catalogEntries, ...entry };
    }

    let mangoPet = new Pet({ name: 'Mango' });

    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'address.gts': { Address },
        'person.gts': { Person },
        'personnel.gts': { Personnel },
        'pet.gts': { Pet, Puppy },
        'shipping-info.gts': { ShippingInfo },
        'README.txt': `Hello World`,
        'person-entry.json': new Spec({
          title: 'Person Card',
          description: 'Spec for Person Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        }),
        'pet-entry.json': new Spec({
          title: 'Pet Card',
          description: 'Spec for Pet Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        }),
        ...catalogEntries,
        'puppy-entry.json': new Spec({
          title: 'Puppy Card',
          description: 'Spec for Puppy Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Puppy',
          },
        }),
        'Pet/mango.json': mangoPet,
        'Pet/vangogh.json': new Pet({ name: 'Van Gogh' }),
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
          additionalAddresses: [
            new Address({
              city: 'Jakarta',
              country: 'Indonesia',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'FedEx',
                remarks: `Make sure to deliver to the back door`,
              }),
            }),
            new Address({
              city: 'Bali',
              country: 'Indonesia',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'UPS',
                remarks: `Call ahead to make sure someone is home`,
              }),
            }),
          ],
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'Puppy/marco.json': new Puppy({ name: 'Marco', age: '5 months' }),
        'grid.json': new CardsGrid(),
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    }));
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace A',
          backgroundURL:
            'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
        'Pet/ringo.json': new Pet({ name: 'Ringo' }),
        'Person/hassan.json': new Person({
          firstName: 'Hassan',
          pet: mangoPet,
          additionalAddresses: [
            new Address({
              city: 'New York',
              country: 'USA',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'DHL',
                remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
              }),
            }),
          ],
          friends: [mangoPet],
        }),
      },
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealm3URL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace C',
          backgroundURL:
            'https://boxel-images.boxel.ai/background-images/4k-powder-puff.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
      },
    });
  });

  module('0 stacks', function () {
    test('Clicking card in search panel opens card on a new stack', async function (assert) {
      await visitOperatorMode({});

      assert.dom('[data-test-operator-mode-stack]').doesNotExist();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-field]', 'Mango');

      assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

      // Click on search result
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      // Search closed

      // The card appears on a new stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Mango');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
      assert.dom('[data-test-open-search-field]').hasValue('');
    });

    test('Can search for an index card by URL (without "index" in path)', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');

      await fillIn('[data-test-search-field]', testRealmURL);

      assert
        .dom('[data-test-search-label]')
        .includesText('Card found at http://test-realm/test/');
      assert
        .dom('[data-test-card="http://test-realm/test/index"]')
        .exists({ count: 1 });
    });

    test('Can open a recent card in empty stack', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', `${testRealmURL}person-entry`);

      await click('[data-test-card="http://test-realm/test/person-entry"]');

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .containsText('http://test-realm/test/person');

      // Close the card, find it in recent cards, and reopen it
      await click(
        `[data-test-stack-card="${testRealmURL}person-entry"] [data-test-close-button]`,
      );

      await click('[data-test-open-search-field]');
      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await click(`[data-test-search-result="${testRealmURL}person-entry"]`);

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .exists();
    });
  });

  module('1 stack', function (_hooks) {
    test('restoring the stack from query param', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert);

      assert
        .dom(
          '[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]',
        )
        .includesText('Person');

      assert
        .dom(
          '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
        )
        .includesText('Pet');

      // Remove mango (the dog) from the stack
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-operator-mode-stack] [data-test-pet="Mango"]');
      let expectedURL = `/?operatorModeState=${encodeURIComponent(
        stringify({
          stacks: [
            [
              {
                id: `${testRealmURL}Person/fadhlan`,
                format: 'isolated',
              },
              {
                id: `${testRealmURL}Pet/mango`,
                format: 'isolated',
              },
            ],
          ],
          submode: 'interact',
          cardPreviewFormat: 'isolated',
          fileView: 'inspector',
          openDirs: {},
          moduleInspector: 'schema',
          trail: [],
        })!,
      )}`;
      assert.strictEqual(currentURL(), expectedURL);

      // Click Edit on the top card
      await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

      // The edit format should be reflected in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  id: `${testRealmURL}Person/fadhlan`,
                  format: 'isolated',
                },
                {
                  id: `${testRealmURL}Pet/mango`,
                  format: 'edit',
                },
              ],
            ],
            submode: 'interact',
            fileView: 'inspector',
            openDirs: {},
            cardPreviewFormat: 'isolated',
            moduleInspector: 'schema',
            trail: [],
          })!,
        )}`,
      );
    });

    test<TestContextWithSave>('a realm event with known clientRequestId is ignored', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/vangogh`,
              format: 'edit',
            },
          ],
        ],
        codePath: `${testRealmURL}Pet/vangogh.json`,
      });

      let deferred = new Deferred<void>();

      this.onSave(() => {
        deferred.fulfill();
      });

      await fillIn(`[data-test-field="name"] input`, 'Renamed via UI');
      await deferred.promise;
      await click('[data-test-edit-button]');

      let knownClientRequestIds =
        getService('card-service').clientRequestIds.values();

      let knownClientRequestId = knownClientRequestIds.next().value;

      await realm.write(
        'Pet/vangogh.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              name: 'Renamed via realm call',
            },
            meta: {
              adoptsFrom: { module: 'http://test-realm/test/pet', name: 'Pet' },
            },
          },
        }),
        {
          clientRequestId: knownClientRequestId,
        },
      );

      await settled();

      assert.dom('[data-test-pet-title]').containsText('Renamed via UI');
    });

    test('restoring the stack from query param when card is in edit format', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      await percySnapshot(assert);

      assert.dom('[data-test-field="firstName"] input').exists(); // Existence of an input field means it is in edit mode
    });

    test('click left or right add card button will open the search panel and then click on a recent card will open a new stack on the left or right', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'edit',
            },
          ],
        ],
      });

      let operatorModeStateService = getService('operator-mode-state-service');
      let recentCardsService = getService('recent-cards-service');

      operatorModeStateService.state.stacks[0].map((item) =>
        recentCardsService.add(item.id),
      );

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Add a card to the left stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-field]').isFocused();
      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Mango'); // Mango goes on the left stack
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Fadhlan');

      // Buttons to add a neighbor stack are gone
      assert.dom('[data-test-add-card-left-stack]').doesNotExist();
      assert.dom('[data-test-add-card-right-stack]').doesNotExist();

      // Close the only card in the 1st stack
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      assert
        .dom('[data-test-operator-mode-stack]')
        .exists({ count: 1 }, 'after close, expect 1 stack');
      assert
        .dom('[data-test-add-card-left-stack]')
        .exists('after close, expect add to left stack button');
      assert
        .dom('[data-test-add-card-right-stack]')
        .exists('after close, expect add to right stack button');

      // Add a card to the left stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There are now 2 stacks
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango'); // Mango gets moved onto the right stack

      // Buttons to add a neighbor stack are gone
      assert.dom('[data-test-add-card-left-stack]').doesNotExist();
      assert.dom('[data-test-add-card-right-stack]').doesNotExist();

      // Close the only card in the 1st stack
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      // There is now only 1 stack and the buttons to add a neighbor stack are back
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();

      // Replace the current stack by interacting with search prompt directly
      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There is still only 1 stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-neighbor-stack-trigger]').exists({ count: 2 });

      await click('[data-test-workspace-chooser-toggle]');
      assert.dom('[data-test-workspace-chooser]').exists();
      assert.dom('[data-test-neighbor-stack-trigger]').doesNotExist();
    });

    test('Clicking search panel (without left and right buttons activated) replaces open card on existing stack', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      let operatorModeStateService = getService('operator-mode-state-service');
      let recentCardsService = getService('recent-cards-service');

      operatorModeStateService.state.stacks[0].map((item) =>
        recentCardsService.add(item.id),
      );

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // The recent card REPLACES onto on current stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Mango');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
    });

    test('search can be dismissed with escape', async function (assert) {
      await visitOperatorMode({});
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await triggerKeyEvent(
        '[data-test-search-sheet] input',
        'keydown',
        'Escape',
      );

      assert.dom('[data-test-search-sheet]').hasClass('closed');
    });

    test<TestContextWithSave>('can create a card from the index stack item', async function (assert) {
      assert.expect(7);
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });
      let deferred = new Deferred<void>();
      let id: string | undefined;
      this.onSave((url, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        if (json.data.attributes?.firstName === null) {
          // Because we create an empty card, upon choosing a catalog item, we must skip the scenario where attributes null
          // eslint-disable-next-line qunit/no-early-return
          return;
        }
        id = url.href;
        assert.strictEqual(json.data.attributes?.firstName, 'Hassan');
        assert.strictEqual(json.data.meta.realmURL, testRealmURL);
        deferred.fulfill();
      });

      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .doesNotExist('No card is pre-selected');
      assert.dom('[data-test-card-catalog-item]').exists();
      assert
        .dom('[data-test-show-more-cards]')
        .containsText('not shown', 'Entries are paginated');
      await click(`[data-test-select="${testRealmURL}person-entry"]`);
      await click('[data-test-card-catalog-go-button]');

      await fillIn(`[data-test-field="firstName"] input`, 'Hassan');
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      await deferred.promise;
      await waitUntil(() => id, {
        timeoutMessage: 'waiting for id to be assigned to new card',
      });
      id = id!;

      let recentCards: { cardId: string; timestamp: number }[] = JSON.parse(
        window.localStorage.getItem(RecentCards) ?? '[]',
      );
      assert.ok(
        recentCards.find((c) => c.cardId === id),
        `the newly created card's remote id is in recent cards`,
      );
      assert.notOk(
        recentCards.find((c) => isLocalId(c.cardId)),
        `no local ID's are in recent cards`,
      );
    });

    // TODO we don't yet support viewing an unsaved card in code mode since it has no URL
    test<TestContextWithSave>('can switch to submode after newly created card is saved', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      let id: string | undefined;
      this.onSave((url) => {
        id = url.href;
      });

      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .doesNotExist('No card is pre-selected');
      assert.dom('[data-test-card-catalog-item]').exists();
      assert
        .dom('[data-test-show-more-cards]')
        .containsText('not shown', 'Entries are paginated');
      await click(`[data-test-select="${testRealmURL}person-entry"]`);
      await click('[data-test-card-catalog-go-button]');

      await fillIn(`[data-test-field="firstName"] input`, 'Hassan');

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Code"]');
      assert.ok(id, 'new card has been assign an id');

      assert
        .dom(`[data-test-card-url-bar-input]`)
        .hasValue(
          `${id}.json`,
          "the new card's url appears in the card URL field",
        );
    });

    test<TestContextWithSave>('create a new card instance when type is seleted in CardsGrid', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      assert.dom('[data-test-stack-card-index]').exists({ count: 1 });
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      assert.dom('[data-test-card-catalog-item]').exists();
      await click('[data-test-card-catalog-cancel-button]');

      await click('[data-test-boxel-filter-list-button="Person"]');
      await click('[data-test-create-new-card-button]');
      assert.dom('[data-test-card-catalog-item]').doesNotExist();
      assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
      assert
        .dom(
          '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
        )
        .hasText('Person');
      assert
        .dom('[data-test-stack-card-index="1"] [data-test-card-format="edit"]')
        .exists();
    });

    test('duplicate card in a stack is not allowed', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-boxel-filter-list-button="All Cards"]');
      // Simulate simultaneous clicks for spam-clicking
      let cardSelector = `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`;
      await Promise.all([click(cardSelector), click(cardSelector)]);

      assert
        .dom(`[data-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists({ count: 1 });
    });

    test('embedded card from writable realm shows pencil icon in edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'edit',
            },
          ],
        ],
      });
      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-links-to-editor="pet"] [data-test-field-component-card]`,
        'mouseenter',
      );
      assert
        .dom(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
        )
        .exists();
      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-card-format="edit"]`,
        )
        .exists('linked card now rendered as a stack item in edit format');
    });

    test('can save mutated card without having opened in stack', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-update-and-save-pet]');
      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-pet]`,
        'mouseenter',
      );
      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
        )
        .hasValue('Updated Pet');
    });

    test('New card is auto-attached once it is saved', async function (assert) {
      let indexCardId = `${testRealm2URL}index`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: indexCardId,
              format: 'isolated',
            },
          ],
        ],
      });
      assert.dom(`[data-test-stack-card="${indexCardId}"]`).exists();
      await click('[data-test-open-ai-assistant]');
      assert.dom('[data-test-attached-card]').doesNotExist();
      // Press the + button to create a new card instance
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      // Select a card from catalog entries
      await click(
        `[data-test-select="https://cardstack.com/base/cards/skill"]`,
      );

      await click(`[data-test-card-catalog-go-button]`);

      await fillIn('[data-test-field="title"] input', 'new skill');
      assert.dom(`[data-test-attached-card]`).containsText('new skill');
    });

    test<TestContextWithSave>("new card's remote ID is reflected in the URL once it is saved", async function (assert) {
      let indexCardId = `${testRealm2URL}index`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: indexCardId,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      await click(
        `[data-test-select="https://cardstack.com/base/cards/skill"]`,
      );

      let id: string | undefined;
      this.onSave((url) => {
        id = url.href;
      });

      // intentionally not awaiting the click
      click(`[data-test-card-catalog-go-button]`);

      // new card is not serialized into the url before it is saved
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: indexCardId,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitUntil(() => id, { timeout: 5000 });

      assert.ok(id, 'new card has been assigned a remote id');
      id = id!;

      // new card is serialized into the url after it is saved
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: indexCardId,
              format: 'isolated',
            },
            {
              format: 'edit',
              id,
            },
          ],
        ],
      });
    });

    test<TestContextWithSave>('new card is created in the selected realm', async function (assert) {
      assert.expect(1);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });
      this.onSave((url) => {
        if (url.href.includes('Pet')) {
          assert.ok(
            url.href.startsWith(testRealmURL),
            `The pet card is saved in the selected realm ${testRealmURL}`,
          );
        }
      });
      await click('[data-test-add-new="friends"]');
      await click(
        `[data-test-card-catalog-create-new-button="${testRealmURL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
    });

    test<TestContextWithSave>('new card can enter edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      await click(
        `[data-test-select="https://cardstack.com/base/cards/skill"]`,
      );

      let id: string | undefined;
      this.onSave((url) => {
        id = url.href;
      });

      await click(`[data-test-card-catalog-go-button]`);
      await waitUntil(() => id);
      await click(`[data-test-edit-button]`);
      assert
        .dom(
          `[data-test-stack-card="${id}"] [data-test-card-format="isolated"]`,
        )
        .exists('new card is in isolated format');
      await click(`[data-test-edit-button]`);
      assert
        .dom(`[data-test-stack-card="${id}"] [data-test-card-format="edit"]`)
        .exists('new card is in edit format');
    });

    test<TestContextWithSave>('new linked card is created in a different realm than its consuming reference', async function (assert) {
      assert.expect(5);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      let consumerSaved = new Deferred<void>();
      let consumerSaveCount = 0;
      let newLinkId: string | undefined;
      this.onSave((url, doc) => {
        doc = doc as SingleCardDocument;
        if (url.href === `${testRealmURL}Person/fadhlan`) {
          consumerSaveCount++;
          if (consumerSaveCount === 1) {
            // the first time we save the consumer we set the relationship to null
            // as we are still waiting for the other realm to assign an ID to the new linked card
            assert.strictEqual(doc.included!.length, 1);
            assert.strictEqual(
              doc.included![0].id,
              `${testRealmURL}Pet/mango`,
              "the side loaded resources don't include the newly created card yet",
            );
          }
          if (consumerSaveCount === 2) {
            // as soon as the other realm assigns an id to the linked card we then
            // save the consumer with a relationship to the linked card's id
            assert.deepEqual(
              doc.data?.relationships?.['friends.1'],
              {
                links: { self: newLinkId! },
                data: { type: 'card', id: newLinkId! },
              },
              'the "friends.1" relationship was populated with the linked card\'s new id',
            );
            consumerSaved.fulfill();
          }
        }
        if (url.href.includes('Pet')) {
          newLinkId = url.href;
          assert.ok(
            url.href.startsWith(testRealm3URL),
            `The pet card is saved in the selected realm ${testRealm3URL}`,
          );
        }
      });
      await click('[data-test-add-new="friends"]');
      assert
        .dom(`[data-test-realm="Test Workspace C"] header`)
        .containsText('Test Workspace C No results');
      await click(
        `[data-test-card-catalog-create-new-button="${testRealm3URL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
      await consumerSaved.promise;
    });

    test<TestContextWithSave>('open a stack item of a new card instance when the "New Card of This Type" is clicked', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-stack-card-index]').exists({ count: 1 });
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-more-options-button]');
      assert
        .dom('[data-test-boxel-menu-item-text="New Card of This Type"]')
        .doesNotExist();
      await click(
        `[data-cards-grid-item="${testRealm2URL}Pet/ringo"] .field-component-card`,
      );
      assert.dom('[data-test-stack-card-index]').exists({ count: 2 });

      await click('[data-test-more-options-button]');
      assert
        .dom('[data-test-boxel-menu-item-text="New Card of This Type"]')
        .exists();

      await click('[data-test-boxel-menu-item-text="New Card of This Type"]');
      assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
      assert
        .dom('[data-test-stack-card-index="2"] [data-test-card-format="edit"]')
        .exists();
      assert
        .dom(
          '[data-test-stack-card-index="2"] [data-test-boxel-card-header-title]',
        )
        .containsText('Pet');
    });
  });

  module('1 stack, when the user lacks write permissions', function (hooks) {
    hooks.beforeEach(async function () {
      setRealmPermissions({
        [testRealmURL]: ['read'],
        [testRealm2URL]: ['read', 'write'],
      });
    });

    test('the edit button is hidden when the user lacks permissions', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert.dom('[data-test-edit-button]').doesNotExist();
    });

    test('the card format components are informed whether it is editable', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-editable-meta]')
        .containsText('Mango is NOT editable');

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Pet/ringo`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom('[data-test-editable-meta]').containsText('Ringo is editable');

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-editable-meta]')
        .containsText('address is NOT editable');

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      assert
        .dom("[data-test-contains-many='additionalAddresses'] input:enabled")
        .doesNotExist();

      assert
        .dom(
          "[data-test-contains-many='additionalAddresses'] [data-test-remove]",
        )
        .doesNotExist();
      assert
        .dom(
          "[data-test-contains-many='additionalAddresses'] [data-test-add-new]",
        )
        .doesNotExist();

      assert
        .dom("[data-test-field='pet'] [data-test-remove-card]")
        .doesNotExist();

      assert
        .dom("[data-test-field='friends'] [data-test-add-new]")
        .doesNotExist();
      assert
        .dom("[data-test-field='friends'] [data-test-remove-card]")
        .doesNotExist();

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-editable-meta]')
        .containsText('address is editable');

      await click('[data-test-operator-mode-stack] [data-test-edit-button]');

      assert
        .dom("[data-test-contains-many='additionalAddresses'] input:disabled")
        .exists({ count: 1 });

      assert
        .dom(
          "[data-test-contains-many='additionalAddresses'] [data-test-remove]",
        )
        .exists();

      assert
        .dom(
          "[data-test-contains-many='additionalAddresses'] [data-test-add-new]",
        )
        .exists();

      assert.dom("[data-test-field='pet'] [data-test-remove-card]").exists();
      assert.dom("[data-test-field='friends'] [data-test-add-new]").exists();
      assert
        .dom("[data-test-field='friends'] [data-test-remove-card]")
        .exists();
    });

    test('card catalog create buttons respect realm write permissions for linksTo field', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
      await click('[data-test-add-new="friends"]');

      await waitFor('[data-test-card-catalog]');
      await waitFor('[data-test-realm="Test Workspace A"]');
      await waitFor('[data-test-realm="Test Workspace B"]');

      assert
        .dom(`[data-test-card-catalog-create-new-button="${testRealm2URL}"]`)
        .exists('create button is shown for writable realm');

      assert
        .dom(`[data-test-card-catalog-create-new-button="${testRealmURL}"]`)
        .doesNotExist('create button is hidden for read-only realm');

      await triggerKeyEvent(
        '[data-test-card-catalog-modal]',
        'keydown',
        'Escape',
      );
      await waitFor('[data-test-card-catalog]', { count: 0 });
    });

    test('the delete item is not present in "..." menu of stack item', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-more-options-button]');
      assert
        .dom('[data-test-boxel-menu-item-text="Delete"]')
        .doesNotExist('delete menu item is not rendered');
    });

    test('the "..."" menu does not exist for card overlay in index view (since delete is the only item in this menu)', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
        )
        .doesNotExist('"..." menu does not exist');
    });

    test('embedded card from read-only realm does not show pencil icon in edit mode', async (assert) => {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'edit',
            },
          ],
        ],
      });
      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-links-to-editor="pet"] [data-test-field-component-card]`,
        'mouseenter',
      );
      assert
        .dom(`[data-test-overlay-card="${testRealmURL}Pet/mango"]`)
        .exists();
      assert
        .dom(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
        )
        .doesNotExist('edit icon not displayed for linked card');
      await click(
        `[data-test-links-to-editor="pet"] [data-test-field-component-card]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-card-format="isolated"]`,
        )
        .exists(
          'linked card now rendered as a stack item in isolated (non-edit) format',
        );
    });
  });

  module('2 stacks with differing permissions', function (hooks) {
    hooks.beforeEach(async function () {
      setRealmPermissions({
        [testRealmURL]: ['read'],
        [testRealm2URL]: ['read', 'write'],
      });
    });

    test('the edit button respects the realm permissions of the cards in differing realms', async function (assert) {
      assert.expect(6);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealm2URL}Pet/ringo`,
              format: 'isolated',
            },
          ],
        ],
      });

      getService('network').mount(
        async (req) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            let token = req.headers.get('Authorization');
            assert.notStrictEqual(token, null);

            let claims = claimsFromRawToken(token!);
            assert.deepEqual(claims.user, '@testuser:localhost');
            assert.strictEqual(claims.realm, 'http://test-realm/test2/');
            assert.deepEqual(claims.permissions, ['read', 'write']);
          }
          return null;
        },
        { prepend: true },
      );

      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-edit-button]')
        .doesNotExist();
      assert
        .dom('[data-test-operator-mode-stack="1"] [data-test-edit-button]')
        .exists();
      await click(
        '[data-test-operator-mode-stack="1"] [data-test-edit-button]',
      );
      await fillIn(
        '[data-test-operator-mode-stack="1"] [data-test-field="name"] [data-test-boxel-input]',
        'Updated Ringo',
      );
      await click(
        '[data-test-operator-mode-stack="1"] [data-test-edit-button]',
      );
    });

    test('the delete item in "..." menu of stack item respects realm permissions of the cards in differing realms', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealm2URL}Pet/ringo`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
      );
      assert
        .dom('[data-test-boxel-menu-item-text="Delete"]')
        .doesNotExist('delete menu item is not rendered');

      await click(
        '[data-test-operator-mode-stack="1"] [data-test-more-options-button]',
      );
      assert
        .dom('[data-test-boxel-menu-item-text="Delete"]')
        .exists('delete menu is rendered');
    });

    test('the "..."" menu for card overlay in index view respects realm permissions of cards in differing realms', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealm2URL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom(
          `[data-test-operator-mode-stack="0"] [data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
        )
        .doesNotExist('"..." menu does not exist');

      await click(
        '[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]',
      );
      await click(
        '[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]',
      );
      await triggerEvent(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/ringo"] .field-component-card`,
        'mouseenter',
      );
      assert
        .dom(
          `[data-test-operator-mode-stack="1"] [data-test-overlay-card="${testRealm2URL}Pet/ringo"] [data-test-overlay-more-options]`,
        )
        .exists('"..." menu exists');
    });
  });

  module('2 stacks', function () {
    test('restoring the stacks from query param', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert); // 2 stacks from the same realm share the same background

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango');

      // Close the card in the 2nd stack
      await click(
        '[data-test-operator-mode-stack="1"] [data-test-close-button]',
      );
      assert.dom('[data-test-operator-mode-stack="0"]').exists();

      // 2nd stack is removed, 1st stack remains
      assert.dom('[data-test-operator-mode-stack="1"]').doesNotExist();
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      // Close the last card in the last stack that is left
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .doesNotExist();
      assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    });

    test<TestContextWithSave>('can create a card when 2 stacks are present', async function (assert) {
      assert.expect(1);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [{ id: `${testRealmURL}index`, format: 'isolated' }],
        ],
      });
      let petId: string | undefined;
      this.onSave((id, json) => {
        if (id.href.includes('Pet/')) {
          petId = id.href;
          if (typeof json === 'string') {
            throw new Error('expected JSON save data');
          }
        }
      });
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-edit-button]`,
      );
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-links-to-editor="pet"] [data-test-remove-card]`,
      );
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-links-to-editor="pet"] [data-test-add-new]`,
      );
      await click(
        `[data-test-card-catalog-create-new-button="${testRealmURL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"] [data-test-edit-button]`,
      );
      assert
        .dom(`[data-test-stack-card="${petId}"]`)
        .exists('the card is rendered correctly');
    });

    test('visiting 2 stacks from differing realms', async function (assert) {
      setActiveRealms([testRealmURL, 'http://localhost:4202/test/']);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: 'http://localhost:4202/test/hassan',
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert); // 2 stacks from the different realms have different backgrounds

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
    });

    test('Clicking search panel (without left and right buttons activated) replaces all cards in the rightmost stack', async function (assert) {
      // creates a recent search
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Person/fadhlan`);

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Fadhlan');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
      assert
        .dom(
          '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
        )
        .includesText('Fadhlan');
      assert
        .dom(
          '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
    });

    test('card that has already been opened before will reflect its latest state after being mutated through a relationship', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-update-and-save-pet]');

      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-pet]`,
        'mouseenter',
      );

      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
        )
        .hasValue('Updated Pet');
    });
  });

  module('index changes', function () {
    test('stack item live updates when index changes', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('Fadhlan');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              firstName: 'FadhlanXXX',
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('FadhlanXXX');
    });

    test('stack item live updates with error in isolated mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              pet: {
                links: { self: './missing' },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .exists('card error state is displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              pet: { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
    });

    test('stack item live shows stale card when server has an error in edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
      assert.dom('[data-test-field="firstName"] input').hasValue('Fadhlan');

      // TODO should we show a message that the card is currently in an error
      // state on the server? note that this error state did not occur from an
      // auto save, but rather an external event put the server into an error...
    });

    test('stack item edit results in index event that is ignored', async function (assert) {
      assert.expect(6);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      const messageService = getService('message-service');
      const receivedEventDeferred = new Deferred<void>();
      messageService.listenerCallbacks
        .get(testRealmURL)!
        .push((ev: RealmEventContent) => {
          if (
            ev.eventName === 'index' &&
            ev.indexType === 'incremental-index-initiation'
          ) {
            // eslint-disable-next-line qunit/no-early-return
            return; // ignore the index initiation event
          }
          ev = ev as IncrementalIndexEventContent;
          assert.ok(
            ev.clientRequestId,
            'client request ID is included in event',
          );
          assert.strictEqual(
            ev.eventName,
            'index',
            'the event name is "index"',
          );
          assert.strictEqual(
            ev.indexType,
            'incremental',
            'the event type is "incremental"',
          );
          assert.deepEqual(
            ev.invalidations,
            [`${testRealmURL}Person/fadhlan`],
            'invalidations are correct',
          ); // the card that was edited
          receivedEventDeferred.fulfill();
        });
      await click('[data-test-edit-button]');
      fillIn('[data-test-field="firstName"] input', 'FadhlanXXX');
      let inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      inputElement.focus();
      inputElement.select();
      inputElement.setSelectionRange(0, 3);
      await receivedEventDeferred.promise;
      await settled();
      inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      assert.strictEqual(
        document.activeElement,
        inputElement,
        'focus is preserved on the input element',
      );
      assert.strictEqual(
        document.getSelection()?.anchorOffset,
        3,
        'select is preserved',
      );
    });
  });

  module('workspace index card', function () {
    test('cannot be deleted', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-more-options-button]');
      assert.dom('[data-test-boxel-menu-item-text="Delete"]').doesNotExist();
    });

    test('opens index card when non-index card is closed and workspace chooser opens when index card is closed', async function (assert) {
      // Start with a non-index card in the stack
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      // Verify the non-index card is displayed
      assert.dom('[data-test-stack-card-index="0"]').includesText('Fadhlan');
      assert.dom('[data-test-workspace-chooser]').doesNotExist();

      // Close the non-index card
      await click('[data-test-stack-card-index="0"] [data-test-close-button]');

      // Verify that an index card is automatically added to the stack
      assert.dom('[data-test-stack-card-index="0"]').exists();
      assert
        .dom(
          '[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]',
        )
        .hasText('Workspace - Test Workspace B');
      assert.dom('[data-test-workspace-chooser]').doesNotExist();

      // Close the index card
      await click('[data-test-stack-card-index="0"] [data-test-close-button]');

      // Verify that the workspace chooser opens
      await waitFor('[data-test-workspace-chooser]');
      assert.dom('[data-test-workspace-chooser]').exists();
      assert.dom('[data-test-operator-mode-stack]').doesNotExist();
    });

    test('displays highlights filter with special layout and community cards', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        selectAllCardsFilter: false,
      });

      assert.dom('[data-test-selected-filter="Highlights"]').exists();
      assert.dom('[data-test-highlights-layout]').exists();

      // Verify the NEW FEATURE section with AI App Generator
      assert
        .dom('[data-test-section-header="new-feature"]')
        .containsText('NEW FEATURE');
      assert
        .dom('[data-test-highlights-card-container="ai-app-generator"]')
        .exists();
      assert
        .dom(
          '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
        )
        .hasValue(
          'Create a sprint-planning tool that lets users define backlogs, estimate stories, assign owners, and track burndown.',
        );
      await click('[data-test-boxel-button][title="About Me"]');
      assert
        .dom(
          '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
        )
        .hasValue(
          'Build a personal portfolio page with your background, skills, and contact information',
        );
      await click('[data-test-create-this-for-me]');
      await waitFor('[data-test-room-settled]');
      assertMessages(assert, [
        {
          from: 'testuser',
          message:
            'Build a personal portfolio page with your background, skills, and contact information',
          cards: [{ id: `${testRealmURL}index`, title: 'Test Workspace B' }],
        },
      ]);
      assert
        .dom('[data-test-llm-mode-option="act"]')
        .hasClass('selected', 'LLM mode starts in act mode');

      // Verify the GETTING STARTED section with Welcome to Boxel
      assert
        .dom('[data-test-section-header="getting-started"]')
        .containsText('GETTING STARTED');
      assert
        .dom('[data-test-highlights-card-container="welcome-to-boxel"]')
        .exists();

      // Verify the JOIN THE COMMUNITY section
      assert.dom('[data-test-highlights-section="join-community"]').exists();

      // Verify that the specific sections are displayed
      assert.dom('[data-test-highlights-section]').exists({ count: 3 });
      assert.dom('[data-test-highlights-card-container]').exists({ count: 2 }); // AI App Generator and Welcome to Boxel

      // Verify social media links exist
      assert.dom('[data-test-community-link]').exists({ count: 4 }); // Discord, Twitter, YouTube, Reddit

      // Take a snapshot of the highlights layout
      await click('[data-test-close-ai-assistant]');
      await percySnapshot(assert);

      // Verify the community cards have the correct content
      assert
        .dom('[data-test-community-title="Discord"]')
        .containsText('Discord');
      assert
        .dom('[data-test-community-title="Twitter"]')
        .containsText('Twitter');
      assert
        .dom('[data-test-community-title="YouTube"]')
        .containsText('YouTube');
      assert.dom('[data-test-community-title="Reddit"]').containsText('Reddit');

      // Verify the filter icon is displayed
      assert.dom('.content-icon').exists();

      // Verify the content header has the border bottom
      assert
        .dom('.content-header')
        .hasStyle({ 'border-bottom': '1px solid rgb(226, 226, 226)' });

      // Test switching to "All Cards" filter to verify highlights layout is hidden
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      assert.dom('[data-test-highlights-layout]').doesNotExist();
      assert.dom('[data-test-section-header]').doesNotExist();
      assert.dom('[data-test-community-link]').doesNotExist();

      // Switch back to Highlights filter
      await click('[data-test-boxel-filter-list-button="Highlights"]');
      assert.dom('[data-test-highlights-layout]').exists();
      assert.dom('[data-test-section-header]').exists({ count: 3 });
      assert.dom('[data-test-community-link]').exists({ count: 4 });
    });

    test('sends typed prompt to ask ai when creating app', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        selectAllCardsFilter: false,
      });

      await click('[data-test-boxel-button][title="About Me"]');
      let typedPrompt =
        'Design a travel planner dashboard that tracks itineraries, bookings, and budgets';

      await fillIn(
        '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
        typedPrompt,
      );
      assert
        .dom(
          '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
        )
        .hasValue(typedPrompt);

      await click('[data-test-create-this-for-me]');
      await waitFor('[data-test-room-settled]');
      assertMessages(assert, [
        {
          from: 'testuser',
          message: typedPrompt,
          cards: [{ id: `${testRealmURL}index`, title: 'Test Workspace B' }],
        },
      ]);
    });
  });
});
