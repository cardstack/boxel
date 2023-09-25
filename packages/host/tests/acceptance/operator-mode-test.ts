import { module, test } from 'qunit';
import {
  visit,
  currentURL,
  click,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
  fillIn,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  getMonacoContent,
  setMonacoContent,
  waitForSyntaxHighlighting,
  type TestContextWithSSE,
  type TestContextWithSave,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
} from '../helpers';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import stringify from 'safe-stable-stringify';
import { Realm } from '@cardstack/runtime-common/realm';
import type LoaderService from '@cardstack/host/services/loader-service';
import percySnapshot from '@percy/ember';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { setupWindowMock } from 'ember-window-mock/test-support';
import window from 'ember-window-mock';

module('Acceptance | operator mode tests', function (hooks) {
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

    adapter = new TestRealmAdapter({
      'pet.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
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
        import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class ShippingInfo extends FieldDef {
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
        import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { ShippingInfo } from "./shipping-info";
        import { FieldContainer } from '@cardstack/boxel-ui';

        export class Address extends FieldDef {
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
        import { contains, linksTo, field, Component, CardDef, linksToMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";

        export class Person extends CardDef {
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
      'README.txt': `Hello World`,
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

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

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

      await waitFor(`[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`);
      await percySnapshot(assert);

      // In the URL, operatorModeEnabled is set to true and operatorModeState is set to the current stack
      assert.strictEqual(
        currentURL(),
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          stringify({
            stacks: [
              [
                {
                  id: `${testRealmURL}index`,
                  format: 'isolated',
                },
              ],
            ],
            submode: 'interact',
          })!,
        )}`,
      );
    });

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
              ],
            ],
            submode: 'interact',
            fileView: 'inheritance',
            openDirs: [],
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
            fileView: 'inheritance',
            openDirs: [],
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
            fileView: 'inheritance',
            openDirs: [],
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

      let firstStack = operatorModeStateService.state.stacks[0];
      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      operatorModeStateService.recentCards = firstStack.map(
        (item) => item.card,
      );

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

      // @ts-ignore Property '#private' is missing in type 'Card[]' but required in type 'TrackedArray<Card>'.glint(2741) - don't care about this error here, just stubbing
      operatorModeStateService.recentCards =
        operatorModeStateService.state.stacks[0].map((item) => item.card);

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-search-input] input');

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
      await click('[data-test-search-input] input');

      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await triggerKeyEvent(
        '[data-test-search-sheet] input',
        'keydown',
        'Escape',
      );

      assert.dom('[data-test-search-sheet]').hasClass('closed');
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
              ],
            ],
            submode: 'interact',
            fileView: 'inheritance',
            openDirs: [],
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
      await click('[data-test-search-input] input');

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

    test('Toggling submode will open code mode and toggling back will restore the stack', async function (assert) {
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

      // Toggle from interactive (default) to code mode
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Code"]');

      assert.dom('[data-test-submode-switcher] button').hasText('Code');
      assert.dom('[data-test-code-mode]').exists();

      // Submode is reflected in the URL
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
              ],
              [
                {
                  id: `${testRealmURL}Pet/mango`,
                  format: 'isolated',
                },
              ],
            ],
            submode: 'code',
            codePath: `${testRealmURL}Pet/mango.json`,
            fileView: 'inheritance',
            openDirs: ['Pet/'],
          })!,
        )}`,
      );

      // Toggle back to interactive mode
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Interact"]');

      // Stacks are restored
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

      // Submode is reflected in the URL
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
              ],
              [
                {
                  id: `${testRealmURL}Pet/mango`,
                  format: 'isolated',
                },
              ],
            ],
            submode: 'interact',
            fileView: 'inheritance',
            openDirs: ['Pet/'],
          })!,
        )}`,
      );
    });

    test('card preview will show in the 3rd column when submode is set to code', async function (assert) {
      let operatorModeStateParam = stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        codePath: `${testRealmURL}Person/fadhlan.json`,
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );

      await waitFor('[data-test-card-resource-loaded]');

      assert.dom('[data-test-code-mode-card-preview-header]').hasText('Person');
      assert
        .dom('[data-test-code-mode-card-preview-body]')
        .includesText('Fadhlan');

      assert
        .dom('[data-test-preview-card-footer-button-isolated]')
        .hasClass('active');

      await click('[data-test-preview-card-footer-button-embedded]');
      assert
        .dom('[data-test-preview-card-footer-button-embedded]')
        .hasClass('active');
      assert
        .dom('[data-test-code-mode-card-preview-body ] .embedded-card')
        .exists();

      await click('[data-test-preview-card-footer-button-edit]');
      assert
        .dom('[data-test-preview-card-footer-button-edit]')
        .hasClass('active');

      assert
        .dom('[data-test-code-mode-card-preview-body ] .edit-card')
        .exists();

      // Only preview is shown in the right column when viewing an instance, no schema editor
      assert.dom('[data-test-card-schema]').doesNotExist();
    });
  });

  test<TestContextWithSSE>('stack item live updates when index changes', async function (assert) {
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
    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
      .hasText('Fadhlan');
    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
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
    );
    await waitUntil(() => operatorModeStateService.reloadItem.isIdle);
    assert
      .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
      .hasText('FadhlanXXX');
  });

  test<TestContextWithSSE>('card preview live updates when index changes', async function (assert) {
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
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-card-resource-loaded]');
    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
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
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-code-mode-card-preview-body]')
          ?.textContent?.includes('FadhlanXXX'),
    );
    assert
      .dom('[data-test-code-mode-card-preview-body]')
      .includesText('FadhlanXXX');
  });

  test('card instance JSON displayed in monaco editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
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
    });
    await waitForSyntaxHighlighting('"Pet"', 'rgb(4, 81, 165)');
    await percySnapshot(assert);
  });

  test<TestContextWithSave>('card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(2);

    let expected: LooseSingleCardDocument = {
      data: {
        attributes: {
          name: 'MangoXXX',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        },
      },
    };
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.name, 'MangoXXX');
    });

    setMonacoContent(JSON.stringify(expected));

    await waitFor('[data-test-save-idle]');

    assert
      .dom('[data-test-code-mode-card-preview-body] [data-test-field="name"]')
      .containsText('MangoXXX');
  });

  test<
    TestContextWithSave & TestContextWithSSE
  >('card instance change made in card editor is auto-saved', async function (assert) {
    assert.expect(3);

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Pet/mango`],
        },
      },
    ];
    let expected: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          name: 'MangoXXX',
          description: null,
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: `../pet`,
            name: 'Pet',
          },
        },
      },
    };
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.name, 'MangoXXX');
    });

    await click('[data-test-preview-card-footer-button-edit]');
    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await fillIn('[data-test-field="name"] input', 'MangoXXX');
      },
    );
    await waitFor('[data-test-save-idle]');
    assert.strictEqual(
      getMonacoContent(),
      JSON.stringify(expected, null, 2),
      'monaco content has updated',
    );
  });

  test<TestContextWithSave>('non-card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(1);
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave((content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(content, 'Hello Mars');
    });

    setMonacoContent('Hello Mars');

    await waitFor('[data-test-save-idle]');

    await percySnapshot(assert);
  });

  test<TestContextWithSave>('unsaved changes made in monaco editor are saved when switching out of code mode', async function (assert) {
    assert.expect(1);
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave((content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(content, 'Hello Mars');
    });

    setMonacoContent('Hello Mars');
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
  });

  test<TestContextWithSave>('unsaved changes made in card editor are saved when switching out of code mode', async function (assert) {
    assert.expect(1);

    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.name, 'MangoXXX');
    });

    await click('[data-test-preview-card-footer-button-edit]');
    await fillIn('[data-test-field="name"] input', 'MangoXXX');
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
  });

  test<TestContextWithSave>('invalid JSON card instance change made in monaco editor is NOT auto-saved', async function (assert) {
    assert.expect(1);
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    this.onSave(() => {
      assert.ok(false, `save should never happen`);
    });
    setMonacoContent(`{ this is not actual JSON }`);

    // autosave happens 500ms after inactivity, so we wait 1s to make sure save
    // doesn't occur
    await new Promise((res) => setTimeout(res, 1000));

    assert.strictEqual(getMonacoContent(), `{ this is not actual JSON }`);
  });

  test<
    TestContextWithSave & TestContextWithSSE
  >('card definition change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(2);

    let expected = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends CardDef {
        static displayName = 'PetXXX';  // this is the change
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
    `;
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [
            `${testRealmURL}pet.gts`,
            `${testRealmURL}Pet/mango`,
            `${testRealmURL}Pet/vangogh`,
            `${testRealmURL}Person/fadhlan`,
            `${testRealmURL}person`,
          ],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-editor]');

    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        setMonacoContent(expected);
        await waitFor('[data-test-save-idle]');
      },
    );

    await percySnapshot(assert);

    let fileRef = await adapter.openFile('pet.gts');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      fileRef.content as string,
      expected,
      'pet.gts changes were saved',
    );
  });

  test<TestContextWithSSE>('Can delete a card instance from code mode with no recent files to fall back on', async function (assert) {
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Pet/vangogh`],
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
          {
            id: `${testRealmURL}Pet/vangogh`,
            format: 'isolated',
          },
        ],
      ],
    })!;
    window.localStorage.setItem(
      'recent-cards',
      JSON.stringify([
        `${testRealmURL}Pet/vangogh`,
        `${testRealmURL}Person/fadhlan`,
      ]),
    );
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([`${testRealmURL}Pet/vangogh.json`]),
    );
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"`)
      .exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`).exists();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-editor]');
    assert.strictEqual(
      window.localStorage.getItem('recent-files'),
      JSON.stringify([`${testRealmURL}Pet/vangogh.json`]),
    );

    await waitFor(`[data-test-action-button="Delete"]`);
    await click('[data-test-action-button="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/vangogh"]`);
    await percySnapshot(assert);
    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await click('[data-test-confirm-delete-button]');
      },
    );
    await waitFor('[data-test-empty-code-mode]');
    await percySnapshot(
      'Acceptance | operator mode tests | Can delete a card instance from code mode with no recent files - empty code mode',
    );
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"`)
      .exists();
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`)
      .doesNotExist('stack item removed');
    assert.deepEqual(
      window.localStorage.getItem('recent-cards'),
      JSON.stringify([`${testRealmURL}Person/fadhlan`]),
      'the deleted card has been removed from recent cards',
    );
    assert.deepEqual(
      window.localStorage.getItem('recent-files'),
      '[]',
      'the deleted card has been removed from recent files',
    );

    let notFound = await adapter.openFile('Pet/vangogh.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test<TestContextWithSSE>('Can delete a card instance from code mode and fall back to recent file', async function (assert) {
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Pet/vangogh`],
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
          {
            id: `${testRealmURL}Pet/vangogh`,
            format: 'isolated',
          },
        ],
      ],
    })!;
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        `${testRealmURL}Pet/vangogh.json`,
        `${testRealmURL}Pet/mango.json`,
      ]),
    );
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"`)
      .exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`).exists();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-editor]');
    assert.strictEqual(
      window.localStorage.getItem('recent-files'),
      JSON.stringify([
        `${testRealmURL}Pet/vangogh.json`,
        `${testRealmURL}Pet/mango.json`,
      ]),
    );

    await waitFor(`[data-test-action-button="Delete"]`);
    await click('[data-test-action-button="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/vangogh"]`);
    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await click('[data-test-confirm-delete-button]');
      },
    );
    await waitFor('[data-test-editor]');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assert.dom('[data-test-definition-name]').hasText('Mango');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
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
    });
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"`)
      .exists();
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`)
      .doesNotExist('stack item removed');
    assert.deepEqual(
      window.localStorage.getItem('recent-files'),
      JSON.stringify([`${testRealmURL}Pet/mango.json`]),
      'the deleted card has been removed from recent files',
    );
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
      await click('[data-test-search-input] input');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-input] input', 'Mango');

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
      assert.dom('[data-test-search-input] input').hasValue('');
    });
  });
});
