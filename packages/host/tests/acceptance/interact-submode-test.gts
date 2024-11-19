import { on } from '@ember/modifier';
import {
  currentURL,
  click,
  fillIn,
  triggerKeyEvent,
} from '@ember/test-helpers';

import { triggerEvent } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  type LooseSingleCardDocument,
  Deferred,
  SingleCardDocument,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { claimsFromRawToken } from '@cardstack/host/services/realm';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';

import {
  percySnapshot,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  type TestContextWithSSE,
  type TestContextWithSave,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  lookupLoaderService,
  lookupNetworkService,
  setupRealmServerEndpoints,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const testRealm2URL = `http://test-realm/test2/`;
const testRealm3URL = `http://test-realm/test3/`;

module('Acceptance | interact submode tests', function (hooks) {
  let realm: Realm;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  let { setRealmPermissions, setActiveRealms } = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
    activeRealms: [testRealmURL, testRealm2URL, testRealm3URL],
  });
  setupRealmServerEndpoints(hooks);

  hooks.beforeEach(async function () {
    let loader = lookupLoaderService().loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let catalogEntry: typeof import('https://cardstack.com/base/catalog-entry');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    catalogEntry = await loader.import(`${baseRealm.url}catalog-entry`);
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
    let { CatalogEntry } = catalogEntry;
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
            <h2><@fields.title /></h2>
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
              address is editable.
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
            this.args.context?.actions?.saveCard(pet);
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
          <@fields.pet />
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
        </template>
      };
    }

    class Personnel extends Person {
      static displayName = 'Personnel';
    }

    let generateCatalogEntry = (
      fileName: string,
      title: string,
      ref: { module: string; name: string },
    ) => ({
      [`${fileName}.json`]: new CatalogEntry({
        title,
        description: `Catalog entry for ${title}`,
        isField: false,
        ref,
      }),
    });
    let catalogEntries = {};
    for (let i = 0; i < 5; i++) {
      let entry = generateCatalogEntry(`p-${i + 1}`, `Personnel-${i + 1}`, {
        module: `${testRealmURL}personnel`,
        name: 'Personnel',
      });
      catalogEntries = { ...catalogEntries, ...entry };
    }

    let mangoPet = new Pet({ name: 'Mango' });

    ({ realm } = await setupAcceptanceTestRealm({
      contents: {
        'address.gts': { Address },
        'person.gts': { Person },
        'personnel.gts': { Personnel },
        'pet.gts': { Pet, Puppy },
        'shipping-info.gts': { ShippingInfo },
        'README.txt': `Hello World`,
        'person-entry.json': new CatalogEntry({
          title: 'Person Card',
          description: 'Catalog entry for Person Card',
          isField: false,
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        }),
        'pet-entry.json': new CatalogEntry({
          title: 'Pet Card',
          description: 'Catalog entry for Pet Card',
          isField: false,
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        }),
        ...catalogEntries,
        'puppy-entry.json': new CatalogEntry({
          title: 'Puppy Card',
          description: 'Catalog entry for Puppy Card',
          isField: false,
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
      realmURL: testRealm2URL,
      contents: {
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
      realmURL: testRealm3URL,
      contents: {
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
      await click('[data-test-search-field]');

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
      assert.dom('[data-test-search-field]').hasValue('');
    });

    test('Can search for an index card by URL (without "index" in path)', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-search-field]');

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

      await click('[data-test-search-field]');
      await fillIn('[data-test-search-field]', `${testRealmURL}person-entry`);

      await click('[data-test-card="http://test-realm/test/person-entry"]');

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .containsText('Test Workspace B');

      // Close the card, find it in recent cards, and reopen it
      await click(
        `[data-test-stack-card="${testRealmURL}person-entry"] [data-test-close-button]`,
      );

      await click('[data-test-search-field]');
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
          fileView: 'inspector',
          openDirs: {},
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
          })!,
        )}`,
      );
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

      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;
      let recentCardsService = this.owner.lookup(
        'service:recent-cards-service',
      ) as RecentCardsService;

      let firstStack = operatorModeStateService.state.stacks[0];
      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      recentCardsService.recentCards = firstStack.map((item) => item.card);

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
      await click('[data-test-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There is still only 1 stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
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

      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;
      let recentCardsService = this.owner.lookup(
        'service:recent-cards-service',
      ) as RecentCardsService;

      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      recentCardsService.recentCards =
        operatorModeStateService.state.stacks[0].map((item) => item.card);

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-search-field]');

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
      await click('[data-test-search-field]');

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
      this.onSave((_, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        if (json.data.attributes?.firstName === null) {
          // Because we create an empty card, upon choosing a catalog item, we must skip the scenario where attributes null
          return;
        }
        assert.strictEqual(json.data.attributes?.firstName, 'Hassan');
        assert.strictEqual(json.data.meta.realmURL, testRealmURL);
        deferred.fulfill();
      });
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .doesNotExist('No card is pre-selected');
      assert.dom('[data-test-card-catalog-item]').exists({ count: 7 });
      assert
        .dom('[data-test-show-more-cards]')
        .containsText('3 not shown', 'Entries are paginated');
      await click(`[data-test-select="${testRealmURL}person-entry"]`);
      await click('[data-test-card-catalog-go-button]');

      await fillIn(`[data-test-field="firstName"] input`, 'Hassan');
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      await deferred.promise;
    });

    test<TestContextWithSave>('card-catalog can pre-select the current filtered card type', async function (assert) {
      assert.expect(12);
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });
      let deferred: Deferred<SingleCardDocument<string>> | undefined;
      this.onSave((_, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        deferred?.fulfill(json);
      });

      await click('[data-test-boxel-filter-list-button="Person"]');
      await click('[data-test-create-new-card-button]');
      assert.dom('[data-test-card-catalog-item]').exists({ count: 10 });
      assert
        .dom('[data-test-show-more-cards]')
        .doesNotExist('All cards are visible');
      assert
        .dom(
          `[data-test-card-catalog-item="${testRealmURL}person-entry"][data-test-card-catalog-item-selected]`,
        )
        .exists('Person catalog entry is pre-selected');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .exists({ count: 1 }, 'Only 1 card is selected');

      await click('[data-test-card-catalog-cancel-button]');
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .doesNotExist(
          'Pre-selection is cleared when filter does not specify card type',
        );
      assert.dom('[data-test-card-catalog-item]').exists({ count: 7 });
      assert
        .dom('[data-test-show-more-cards]')
        .containsText('3 not shown', 'Entries are paginated');
      await click('[data-test-card-catalog-cancel-button]');

      await click('[data-test-boxel-filter-list-button="Puppy"]');
      await click('[data-test-create-new-card-button]');
      assert
        .dom(
          `[data-test-card-catalog-item="${testRealmURL}puppy-entry"][data-test-card-catalog-item-selected]`,
        )
        .exists('Puppy catalog entry is pre-selected');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .exists({ count: 1 }, 'Only 1 card is selected');
      await click('[data-test-card-catalog-go-button]');

      deferred = new Deferred<SingleCardDocument<string>>();
      await fillIn(`[data-test-field="name"] input`, 'Snoopy');
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      let json = await deferred.promise;
      assert.strictEqual(json.data.attributes?.name, 'Snoopy');
      assert.strictEqual(json.data.meta.realmURL, testRealmURL);
      assert.deepEqual(
        json.data.meta.adoptsFrom,
        {
          module: '../pet',
          name: 'Puppy',
        },
        'Created card type is correct',
      );
    });

    test<TestContextWithSave>('can change selection on card catalog after a card was pre-selected', async function (assert) {
      assert.expect(10);
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      let deferred: Deferred<SingleCardDocument<string>> | undefined;
      this.onSave((_, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        deferred?.fulfill(json);
      });

      await click('[data-test-boxel-filter-list-button="Puppy"]');
      await click('[data-test-create-new-card-button]');
      assert.dom('[data-test-card-catalog-item]').exists({ count: 10 });
      assert
        .dom('[data-test-show-more-cards]')
        .doesNotExist('All cards are visible');
      assert
        .dom(
          `[data-test-card-catalog-item="${testRealmURL}puppy-entry"][data-test-card-catalog-item-selected]`,
        )
        .exists('Puppy catalog entry is pre-selected');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .exists({ count: 1 }, 'Only 1 card is selected');

      await click(`[data-test-select="${baseRealm.url}types/card"]`); // changing card selection
      assert
        .dom(
          `[data-test-card-catalog-item="${baseRealm.url}types/card"][data-test-card-catalog-item-selected]`,
        )
        .exists('Card selection has changed');
      assert
        .dom('[data-test-card-catalog-item-selected]')
        .exists({ count: 1 }, 'Only 1 card is selected');
      assert
        .dom('[data-test-card-catalog-item]')
        .exists({ count: 10 }, 'All cards are still visible');
      await click('[data-test-card-catalog-go-button]');

      deferred = new Deferred<SingleCardDocument<string>>();
      await fillIn(`[data-test-field="title"] input`, 'Hello World');
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      let json = await deferred.promise;
      assert.strictEqual(json.data.attributes?.title, 'Hello World');
      assert.strictEqual(json.data.meta.realmURL, testRealmURL);
      assert.deepEqual(
        json.data.meta.adoptsFrom,
        {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        'Created card type is correct',
      );
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
      await Promise.all([
        click(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`,
        ),
        click(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`,
        ),
      ]);

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
      await click('[data-test-create-new-card-button]');
      // Select a card from catalog entries
      await click(
        `[data-test-select="https://cardstack.com/base/fields/skill-card"]`,
      );

      await click(`[data-test-card-catalog-go-button]`);

      // When edit view of new card opens, fill in a field and press the Pencil icon to finish editing
      await fillIn(
        '[data-test-field="instructions"] textarea',
        'Do this and that and this and that',
      );
      await click('[data-test-stack-card-index="1"] [data-test-edit-button]');
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
      await click('[data-test-add-new]');
      await click(
        `[data-test-card-catalog-create-new-button="${testRealmURL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
    });

    test<TestContextWithSave>('new card is created in the realm that has no results from card chooser', async function (assert) {
      assert.expect(2);
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
            url.href.startsWith(testRealm3URL),
            `The pet card is saved in the selected realm ${testRealm3URL}`,
          );
        }
      });
      await click('[data-test-add-new]');
      assert
        .dom(`[data-test-realm="Test Workspace C"] header`)
        .containsText('Test Workspace C No results');
      await click(
        `[data-test-card-catalog-create-new-button="${testRealm3URL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
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

      lookupNetworkService().mount(
        async (req) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            let token = req.headers.get('Authorization');
            assert.notStrictEqual(token, null);

            let claims = claimsFromRawToken(token!);
            assert.deepEqual(claims.user, '@testuser:staging');
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
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/ringo"]`,
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

      assert.dom('[data-test-workspace-chooser]').exists();
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
      window.localStorage.setItem(
        'recent-cards',
        JSON.stringify([`${testRealmURL}Person/fadhlan`]),
      );

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
      await click('[data-test-search-field]');

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
  });

  module('index changes', function () {
    test<TestContextWithSSE>('stack item live updates when index changes', async function (assert) {
      assert.expect(3);
      let expectedEvents = [
        {
          type: 'index',
          data: {
            type: 'incremental-index-initiation',
            realmURL: testRealmURL,
            updatedFile: `${testRealmURL}Person/fadhlan`,
          },
        },
        {
          type: 'index',
          data: {
            type: 'incremental',
            invalidations: [`${testRealmURL}Person/fadhlan`],
          },
        },
      ];
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
      await this.expectEvents({
        assert,
        realm,
        expectedEvents,
        callback: async () => {
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
        },
      });

      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('FadhlanXXX');
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
  });
});
