import { module, test } from 'qunit';
import {
  visit,
  currentURL,
  click,
  triggerEvent,
  waitFor,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupMockMessageService,
  testRealmURL,
} from '../helpers';
import stringify from 'safe-stable-stringify';
import { Realm } from '@cardstack/runtime-common/realm';
import type LoaderService from '@cardstack/host/services/loader-service';
import percySnapshot from '@percy/ember';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { type CardStackItem } from '@cardstack/host/components/operator-mode/container';

module('Acceptance | operator mode tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupMockMessageService(hooks);

  hooks.afterEach(async function () {
    localStorage.removeItem('recent-cards');
  });

  hooks.beforeEach(async function () {
    localStorage.removeItem('recent-cards');

    adapter = new TestRealmAdapter({
      'pet.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends Card {
          static displayName = 'Pet';
          @field name = contains(StringCard);
          @field title = contains(StringCard, {
            computeVia: function (this: Pet) {
              return this.name;
            },
          });
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-pet={{@model.name}}>
                <@fields.name/>
              </h3>
            </template>
          }
        }
      `,
      'shipping-info.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class ShippingInfo extends Card {
          static displayName = 'Shipping Info';
          @field preferredCarrier = contains(StringCard);
          @field remarks = contains(StringCard);
          @field title = contains(StringCard, {
            computeVia: function (this: ShippingInfo) {
              return this.preferredCarrier;
            },
          });
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <span data-test-preferredCarrier={{@model.preferredCarrier}}></span>
              <@fields.preferredCarrier/>
            </template>
          }
        }
      `,
      'address.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { ShippingInfo } from "./shipping-info";
        import { FieldContainer } from '@cardstack/boxel-ui';

        export class Address extends Card {
          static displayName = 'Address';
          @field city = contains(StringCard);
          @field country = contains(StringCard);
          @field shippingInfo = contains(ShippingInfo);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-city={{@model.city}}>
                <@fields.city/>
              </h3>
              <h3 data-test-country={{@model.country}}>
                <@fields.country/>
              </h3>
              <div data-test-shippingInfo-field><@fields.shippingInfo/></div>
            </template>
          }

          static edit = class Edit extends Component<typeof this> {
            <template>
              <FieldContainer @label='city' @tag='label' data-test-boxel-input-city>
                <@fields.city />
              </FieldContainer>
              <FieldContainer @label='country' @tag='label' data-test-boxel-input-country>
                <@fields.country />
              </FieldContainer>
              <div data-test-shippingInfo-field><@fields.shippingInfo/></div>
            </template>
          };
        }
      `,
      'person.gts': `
        import { contains, linksTo, field, Component, Card, linksToMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";

        export class Person extends Card {
          static displayName = 'Person';
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          @field friends = linksToMany(Pet);
          @field firstLetterOfTheName = contains(StringCard, {
            computeVia: function (this: Chain) {
              return this.firstName[0];
            },
          });
          @field title = contains(StringCard, {
            computeVia: function (this: Person) {
              return this.firstName;
            },
          });
          @field address = contains(Address);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}>
                <@fields.firstName/>
              </h2>
              <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
                <@fields.firstLetterOfTheName/>
              </p>
              Pet: <@fields.pet/>
              Friends: <@fields.friends/>
              Address: <@fields.address/>
            </template>
          }
        }
      `,
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

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
    });
    await realm.ready;
  });

  module('1 stack', function () {
    test('visiting index card and entering operator mode', async function (assert) {
      await visit('/');

      assert.strictEqual(currentURL(), '/');

      // Enter operator mode
      await triggerEvent(document.body, 'keydown', {
        code: 'Key.',
        key: '.',
        ctrlKey: true,
      });

      assert.dom('[data-test-operator-mode-stack]').exists();
      assert.dom('[data-test-stack-card-index="0"]').exists(); // Index card opens in the stack

      await waitFor(
        '[data-test-cards-grid-item="http://test-realm/test/Pet/mango"]',
      );
      await percySnapshot(assert);

      // In the URL, operatorModeEnabled is set to true and operatorModeState is set to the current stack
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/index',
                  format: 'isolated',
                },
              ],
            ],
          })!,
        )}`,
      );
    });

    test('restoring the stack from query param', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
            {
              type: 'card',
              id: 'http://test-realm/test/Pet/mango',
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
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
              ],
            ],
          })!,
        )}`,
      );

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
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
                {
                  type: 'card',
                  id: 'http://test-realm/test/Pet/mango',
                  format: 'isolated',
                },
              ],
            ],
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
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
                {
                  type: 'card',
                  id: 'http://test-realm/test/Pet/mango',
                  format: 'edit',
                },
              ],
            ],
          })!,
        )}`,
      );
    });

    test('restoring the stack from query param with nested contained cards', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
            {
              type: 'contained',
              fieldOfIndex: 0,
              fieldName: 'address',
              format: 'isolated',
            },
            {
              type: 'contained',
              fieldOfIndex: 1,
              fieldName: 'shippingInfo',
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
        .includesText('Address');
      assert
        .dom('[data-test-stack-card-index="2"] [data-test-boxel-header-title]')
        .includesText('Shipping Info');

      await click('[data-test-stack-card-index="2"] [data-test-close-button]');

      // The stack should be updated in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
                {
                  type: 'contained',
                  fieldName: 'address',
                  fieldOfIndex: 0,
                  format: 'isolated',
                },
              ],
            ],
          })!,
        )}`,
      );

      await waitFor(
        '[data-test-shippinginfo-field] [data-test-field-component-card]',
      );
      await click(
        '[data-test-shippinginfo-field] [data-test-field-component-card]',
      );

      // The stack should be reflected in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
                {
                  type: 'contained',
                  fieldOfIndex: 0,
                  fieldName: 'address',
                  format: 'isolated',
                },
                {
                  type: 'contained',
                  fieldOfIndex: 1,
                  fieldName: 'shippingInfo',
                  format: 'isolated',
                },
              ],
            ],
          })!,
        )}`,
      );

      // Click Edit on the top card
      await click('[data-test-stack-card-index="2"] [data-test-edit-button]');

      // The edit format should be reflected in the URL
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'edit',
                },
                {
                  type: 'contained',
                  fieldOfIndex: 0,
                  fieldName: 'address',
                  format: 'edit',
                },
                {
                  type: 'contained',
                  fieldOfIndex: 1,
                  fieldName: 'shippingInfo',
                  format: 'edit',
                },
              ],
            ],
          })!,
        )}`,
      );
    });

    test('restoring the stack from query param when card is in edit format', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
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
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
            {
              type: 'card',
              id: 'http://test-realm/test/Pet/mango',
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

      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      operatorModeStateService.recentCards = (
        operatorModeStateService.state.stacks[0].filter(
          (item) => item.type === 'card',
        ) as CardStackItem[]
      ).map((item) => item.card);

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Add a card to the left stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(
        '[data-test-search-result="http://test-realm/test/Pet/mango"]',
      );

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

      await click(
        '[data-test-search-result="http://test-realm/test/Person/fadhlan"]',
      );

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There are now 2 stacks
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango'); // Mango gets move onto the right stack

      // Buttons to add a neighbor stack are gone
      assert.dom('[data-test-add-card-left-stack]').doesNotExist();
      assert.dom('[data-test-add-card-right-stack]').doesNotExist();
    });
    test('Clicking search panel (without left and right buttons activated) replaces open card on existing stack', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
            {
              type: 'card',
              id: 'http://test-realm/test/Pet/mango',
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

      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      operatorModeStateService.recentCards = (
        operatorModeStateService.state.stacks[0].filter(
          (item) => item.type === 'card',
        ) as CardStackItem[]
      ).map((item) => item.card);

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-search-input] input');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(
        '[data-test-search-result="http://test-realm/test/Pet/mango"]',
      );

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
  });

  module('2 stacks', function () {
    test('restoring the stacks from query param', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
          ],
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Pet/mango',
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
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  type: 'card',
                  id: 'http://test-realm/test/Person/fadhlan',
                  format: 'isolated',
                },
              ],
            ],
          })!,
        )}`,
      );

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
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
          ],
          [
            {
              type: 'card',
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
      localStorage.setItem(
        'recent-cards',
        JSON.stringify(['http://test-realm/test/Person/fadhlan']),
      );

      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              type: 'card',
              id: 'http://test-realm/test/Person/fadhlan',
              format: 'isolated',
            },
          ],
          [
            {
              type: 'card',
              id: 'http://test-realm/test/index',
              format: 'isolated',
            },
            {
              type: 'card',
              id: 'http://test-realm/test/Pet/mango',
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
      await click('[data-test-search-input] input');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(
        '[data-test-search-result="http://test-realm/test/Person/fadhlan"]',
      );
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
});
