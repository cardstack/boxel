import {
  visit,
  currentURL,
  click,
  triggerEvent,
  waitFor,
} from '@ember/test-helpers';

import percySnapshot from '@percy/ember';
import { setupApplicationTest } from 'ember-qunit';

import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import { Realm } from '@cardstack/runtime-common/realm';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import type LoaderService from '@cardstack/host/services/loader-service';

import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
} from '../helpers';

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
        import { FieldContainer } from '@cardstack/boxel-ui/components';

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
              if (!this.firstName) {
                return;
              }
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
      'boom-field.gts': `
        import {
          FieldDef,
          Component,
          primitive,
          deserialize,
          BaseDefConstructor,
          BaseInstanceType,
        } from 'https://cardstack.com/base/card-api';

        export class BoomField extends FieldDef {
          static [primitive]: string;
          static async [deserialize]<T extends BaseDefConstructor>(
            this: T,
            value: any,
          ): Promise<BaseInstanceType<T>> {
            throw new Error('Boom!');
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              {{@model}}
            </template>
          };
        }
      `,
      'boom-person.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { BoomField } from "./boom-field";

        export class BoomPerson extends CardDef {
          static displayName = 'Boom Person';
          @field firstName = contains(StringCard);
          @field boom = contains(BoomField);
          @field title = contains(StringCard, {
            computeVia: function (this: BoomPerson) {
              return this.firstName;
            },
          });
        }
      `,
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
      'boom.json': {
        data: {
          attributes: {
            firstName: 'Boom!',
          },
          meta: {
            adoptsFrom: {
              module: './boom-person',
              name: 'BoomPerson',
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
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Pet/vangogh"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`)
      .exists();
    // this asserts that cards that throw errors during search
    // query deserialization (boom.json) are handled gracefully
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}boom"]`)
      .doesNotExist('card with deserialization errors is skipped');
    await percySnapshot(assert);

    assert.operatorModeParametersMatch(currentURL(), {
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      submode: Submodes.Interact,
    });
  });

  module('2 stacks', function () {
    test('Toggling submode will open code submode and toggling back will restore the stack', async function (assert) {
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

      // Toggle from interact (default) to code submode
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Code"]');

      assert.dom('[data-test-submode-switcher] button').hasText('Code');
      assert.dom('[data-test-code-mode]').exists();

      // Submode is reflected in the URL
      assert.operatorModeParametersMatch(currentURL(), {
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
        submode: Submodes.Code,
        codePath: `${testRealmURL}Pet/mango.json`,
        fileView: 'inheritance',
        openDirs: { [testRealmURL]: ['Pet/'] },
        codeSelection: {},
      });

      // Toggle back to interactive mode
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Interact"]');

      // Stacks are restored
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

      // Submode is reflected in the URL
      assert.operatorModeParametersMatch(currentURL(), {
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
        submode: Submodes.Interact,
        fileView: 'inheritance',
        openDirs: { [testRealmURL]: ['Pet/'] },
        codeSelection: {},
      });
    });
  });
});
