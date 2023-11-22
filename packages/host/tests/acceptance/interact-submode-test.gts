import {
  visit,
  currentURL,
  click,
  fillIn,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import percySnapshot from '@percy/ember';
import { setupApplicationTest } from 'ember-qunit';

import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import {
  baseRealm,
  type LooseSingleCardDocument,
  Deferred,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';

import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  type TestContextWithSSE,
  type TestContextWithSave,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
} from '../helpers';

import { FieldContainer } from '@cardstack/boxel-ui/components';

module('Acceptance | interact submode tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  setupWindowMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-cards');
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-cards');
    window.localStorage.removeItem('recent-files');

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let {
      field,
      contains,
      linksTo,
      linksToMany,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
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
          Address:
          <@fields.address />
        </template>
      };
    }

    adapter = new TestRealmAdapter({
      'README.txt': `Hello World`,
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person Card',
            description: 'Catalog entry for Person Card',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
              name: 'CatalogEntry',
            },
          },
        },
      },
      'Pet/mango.json': {
        data: {
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
      'Pet/vangogh.json': {
        data: {
          attributes: {
            name: 'Van Gogh',
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
      'index.json': {
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
      '.realm.json': {
        name: 'Test Workspace B',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
      },
    });

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
      overridingHandlers: [
        async (req: Request) => {
          return sourceFetchRedirectHandle(req, adapter, testRealmURL);
        },
        async (req: Request) => {
          return sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm));
        },
      ],
      shimModules: {
        'address.gts': { Address },
        'person.gts': { Person },
        'pet.gts': { Pet },
        'shipping-info.gts': { ShippingInfo },
      },
    });
    await realm.ready;
  });

  module('0 stacks', function () {
    test('Clicking card in search panel opens card on a new stack', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [],
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      assert.dom('[data-test-operator-mode-stack]').doesNotExist();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-field]', 'Mango');

      assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`, {
        timeout: 2000,
      });

      // Click on search result
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('results'); // Search closed

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

    test('Can open a recent card in empty stack', async function (assert) {
      let operatorModeStateParam = stringify({ stacks: [] })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await waitFor('[data-test-add-card-button]');
      await click('[data-test-add-card-button]');

      await waitFor('[data-test-search-field]');
      await click('[data-test-search-field]');
      await fillIn('[data-test-search-field]', `${testRealmURL}person-entry`);

      await waitFor(
        `[data-test-card-catalog-item="${testRealmURL}person-entry"]`,
      );
      await waitFor('[data-test-card-catalog-item]', {
        count: 1,
      });

      assert.dom('[data-test-realm-filter-button]').isDisabled();

      assert
        .dom(`[data-test-realm="Test Workspace B"] [data-test-results-count]`)
        .hasText('1 result');

      assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });
      await click('[data-test-select]');

      await waitFor('[data-test-card-catalog-go-button][disabled]', {
        count: 0,
      });
      await click('[data-test-card-catalog-go-button]');
      await waitFor(`[data-test-stack-card="${testRealmURL}person-entry"]`);

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .containsText('Test Workspace B');

      // Close the card, find it in recent cards, and reopen it
      await click(
        `[data-test-stack-card="${testRealmURL}person-entry"] [data-test-close-button]`,
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}person-entry"]`, {
        count: 0,
      });
      assert.dom('[data-test-add-card-button]').exists('stack is empty');

      await click('[data-test-search-field]');
      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await waitFor(`[data-test-search-result="${testRealmURL}person-entry"]`);
      await click(`[data-test-search-result="${testRealmURL}person-entry"]`);

      await waitFor(`[data-test-stack-card="${testRealmURL}person-entry"]`);
      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .exists();
    });

    test('Handles a URL with no results', async function (assert) {
      let operatorModeStateParam = stringify({ stacks: [] })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await waitFor('[data-test-add-card-button]');
      await click('[data-test-add-card-button]');

      await waitFor('[data-test-search-field]');
      await fillIn(
        '[data-test-search-field]',
        `${testRealmURL}xyz-does-not-exist`,
      );

      await waitFor('[data-test-card-catalog]');
      await waitFor('[data-test-card-catalog-item]', { count: 0 });
      assert.dom(`[data-test-card-catalog]`).hasText('No cards available');
    });
  });

  module('1 stack', function () {
    test('restoring the stack from query param', async function (assert) {
      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await percySnapshot(assert);

      assert
        .dom('[data-test-stack-card-index="0"] [data-test-boxel-header-title]')
        .includesText('Person');

      assert
        .dom('[data-test-stack-card-index="1"] [data-test-boxel-header-title]')
        .includesText('Pet');

      // Remove mango (the dog) from the stack
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      // The stack should be updated in the URL
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
        submode: Submodes.Interact,
        fileView: 'inspector',
        openDirs: {},
        codeSelection: {},
      });

      await waitFor('[data-test-pet="Mango"]');
      await click('[data-test-pet="Mango"]');

      // The stack should be reflected in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
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
            codeSelection: {},
          })!,
        )}`,
      );

      // Click Edit on the top card
      await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

      // The edit format should be reflected in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
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
            codeSelection: {},
          })!,
        )}`,
      );
    });

    test('restoring the stack from query param when card is in edit format', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await percySnapshot(assert);

      assert.dom('[data-test-field="firstName"] input').exists(); // Existence of an input field means it is in edit mode
    });

    test('click left or right add card button will open the search panel and then click on a recent card will open a new stack on the left or right', async function (assert) {
      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

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

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There are now 2 stacks
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Mango'); // Mango goes on the left stack
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Fadhlan');

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

      // Add a card to the right stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There are now 2 stacks
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango'); // Mango gets move onto the right stack

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
      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

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
      let operatorModeStateParam = stringify({
        stacks: [],
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );
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
      assert.expect(4);
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      })!;
      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      let deferred = new Deferred<void>();
      this.onSave((json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(json.data.attributes?.firstName, 'Hassan');
        assert.strictEqual(json.data.meta.realmURL, testRealmURL);
        deferred.fulfill();
      });
      await click('[data-test-create-new-card-button]');
      await waitFor(
        `[data-test-card-catalog-item="${testRealmURL}person-entry"]`,
      );
      await click(`[data-test-select="${testRealmURL}person-entry"]`);
      await click('[data-test-card-catalog-go-button]');

      await waitFor('[data-test-stack-card-index="1"]');
      await fillIn(`[data-test-field="firstName"] input`, 'Hassan');
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      await deferred.promise;
    });
  });

  module('2 stacks', function () {
    test('restoring the stacks from query param', async function (assert) {
      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

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

      // The stack should be updated in the URL
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
        submode: Submodes.Interact,
        fileView: 'inspector',
        openDirs: {},
        codeSelection: {},
      });

      // Close the last card in the last stack that is left - should get the empty state
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      assert.dom('.no-cards').includesText('Add a card to get started');
    });

    test('visiting 2 stacks from differing realms', async function (assert) {
      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await percySnapshot(assert); // 2 stacks from the different realms have different backgrounds

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
    });

    test('Clicking search panel (without left and right buttons activated) replaces all cards in the rightmost stack', async function (assert) {
      // creates a recent search
      window.localStorage.setItem(
        'recent-cards',
        JSON.stringify([`${testRealmURL}Person/fadhlan`]),
      );

      let operatorModeStateParam = stringify({
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
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

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

  test<TestContextWithSSE>('stack item live updates when index changes', async function (assert) {
    assert.expect(3);
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Person/fadhlan`],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/fadhlan`,
            format: 'isolated',
          },
        ],
      ],
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
      .hasText('Fadhlan');
    await this.expectEvents({
      assert,
      realm,
      adapter,
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
    await waitUntil(() =>
      document
        .querySelector('[data-test-operator-mode-stack="0"] [data-test-person]')
        ?.textContent?.includes('FadhlanXXX'),
    );
    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
      .hasText('FadhlanXXX');
  });
});
