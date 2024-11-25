import {
  visit,
  currentURL,
  click,
  waitFor,
  fillIn,
  waitUntil,
} from '@ember/test-helpers';

import { getPageTitle } from 'ember-page-title/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { FieldContainer } from '@cardstack/boxel-ui/components';

import { baseRealm, primitive } from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import {
  tokenRefreshPeriodSec,
  sessionLocalStorageKey,
} from '@cardstack/host/services/realm';

import {
  percySnapshot,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  lookupLoaderService,
  lookupNetworkService,
  createJWT,
  testRealmSecretSeed,
  setupRealmServerEndpoints,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let matrixRoomId: string;
module('Acceptance | operator mode tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  let { setExpiresInSec, createAndJoinRoom, simulateRemoteMessage } =
    setupMockMatrix(hooks, {
      loggedInAs: '@testuser:staging',
      activeRealms: [testRealmURL],
    });

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom('@testuser:staging', 'room-test');
    setExpiresInSec(60 * 60);

    let loader = lookupLoaderService().loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let {
      field,
      contains,
      deserialize,
      linksTo,
      linksToMany,
      BaseDef,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let { default: StringField } = string;
    type BaseDefConstructor = typeof BaseDef;
    type BaseInstanceType<T extends BaseDefConstructor> = T extends {
      [primitive]: infer P;
    }
      ? P
      : InstanceType<T>;

    class Pet extends CardDef {
      static displayName = 'Pet';
      static headerColor = '#355e3b';
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
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div class='pet-isolated'>
            <h2 data-test-pet-isolated={{@model.name}}>
              <@fields.name />
            </h2>
          </div>
          <style scoped>
            .pet-isolated {
              height: 100%;
              background-color: #355e3b;
            }
            h2 {
              margin: 0;
              padding: 20px;
              color: white;
            }
          </style>
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

    class CountryWithNoEmbedded extends CardDef {
      static displayName = 'Country';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia(this: CountryWithNoEmbedded) {
          return this.name;
        },
      });
    }

    class AddressWithNoEmbedded extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      @field shippingInfo = contains(ShippingInfo);

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
      @field addressWithNoEmbedded = contains(AddressWithNoEmbedded);
      @field countryWithNoEmbedded = linksTo(CountryWithNoEmbedded);
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
          <div data-test-address-with-no-embedded>
            Address With No Embedded:
            <@fields.addressWithNoEmbedded />
          </div>
          <div data-test-country-with-no-embedded>Country With No Embedded:
            <@fields.countryWithNoEmbedded />
          </div>
        </template>
      };
    }

    class BoomField extends FieldDef {
      static [primitive]: string;
      static async [deserialize]<T extends BaseDefConstructor>(
        this: T,
      ): Promise<BaseInstanceType<T>> {
        throw new Error('Boom!');
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          {{@model}}
        </template>
      };
    }

    class BoomPerson extends CardDef {
      static displayName = 'Boom Person';
      @field firstName = contains(StringField);
      @field boom = contains(BoomField);
      @field title = contains(StringField, {
        computeVia: function (this: BoomPerson) {
          return this.firstName;
        },
      });
    }

    await setupAcceptanceTestRealm({
      contents: {
        'address.gts': { Address },
        'boom-field.gts': { BoomField },
        'boom-person.gts': { BoomPerson },
        'country-with-no-embedded-template.gts': { CountryWithNoEmbedded },
        'address-with-no-embedded-template.gts': { AddressWithNoEmbedded },
        'person.gts': { Person },
        'pet.gts': { Pet },
        'shipping-info.gts': { ShippingInfo },
        'README.txt': `Hello World`,
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Person Card',
              description: 'Catalog entry for Person Card',
              isField: false,
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
      },
    });
  });

  test('visiting operator mode', async function (assert) {
    await visit('/');
    await click('[data-test-workspace="Test Workspace B"]');

    assert.dom('[data-test-operator-mode-stack]').exists();
    assert.dom('[data-test-stack-card-index="0"]').exists(); // Index card opens in the stack
    assert.strictEqual(getPageTitle(), 'Test Workspace B');
    await click('[data-test-boxel-filter-list-button="All Cards"]');

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
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}index"]`)
      .doesNotExist('grid cards do not show other grid cards');
    // this was an unspelled, but very valid assertion that percy is making
    // that I'm now making concrete
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}grid"]`)
      .doesNotExist('grid cards do not show other grid cards');

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

    await click(`[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`);
    await percySnapshot(assert); /* snapshot for special styling */
    assert.operatorModeParametersMatch(currentURL(), {
      stacks: [
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
      submode: Submodes.Interact,
    });
    assert.strictEqual(getPageTitle(), 'Mango');
  });

  test('can open code submode when card or field has no embedded template', async function (assert) {
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

    await waitFor(
      '[data-test-stack-card="http://test-realm/test/Person/fadhlan"]',
    );
    await waitFor('[data-test-address-with-no-embedded]');
    await waitFor(
      '[data-test-address-with-no-embedded] [data-test-open-code-submode]',
    );
    await percySnapshot(assert);
    assert
      .dom(
        '[data-test-address-with-no-embedded] [data-test-missing-embedded-template-text]',
      )
      .hasText('Missing embedded component for FieldDef: Address');
    assert
      .dom('[data-test-country-with-no-embedded] [data-test-empty-field]')
      .exists();

    await click(
      '[data-test-address-with-no-embedded] [data-test-open-code-submode]',
    );
    await waitUntil(() =>
      currentURL().includes('address-with-no-embedded-template.gts'),
    );
    assert.operatorModeParametersMatch(currentURL(), {
      codePath: `${testRealmURL}address-with-no-embedded-template.gts`,
    });
    assert.strictEqual(
      getPageTitle(),
      `address-with-no-embedded-template.gts in Test Workspace B`,
    );
  });

  test('open workspace chooser when boxel icon is clicked', async function (assert) {
    lookupNetworkService().mount(
      async (req: Request) => {
        let isOnWorkspaceChooser = document.querySelector(
          '[data-test-workspace-chooser]',
        );
        if (isOnWorkspaceChooser && req.url.includes('_info')) {
          assert
            .dom(
              `[data-test-workspace-list] [data-test-workspace-loading-indicator]`,
            )
            .exists();
        }
        return null;
      },
      { prepend: true },
    );

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
      .exists();
    assert.dom('[data-test-submode-layout-title]').doesNotExist();
    assert.dom('[data-test-workspace-chooser]').doesNotExist();
    let url = currentURL().split('?')[1].replace(/^\/\?/, '') ?? '';
    let urlParameters = new URLSearchParams(url);
    assert.false(Boolean(urlParameters.get('workspaceChooserOpened')));

    await click('[data-test-workspace-chooser-toggle]');

    assert.dom('[data-test-submode-layout-title]').exists();
    assert.dom('[data-test-workspace-chooser]').exists();
    assert
      .dom(`[data-test-workspace-list] [data-test-workspace-loading-indicator]`)
      .doesNotExist();

    url = currentURL().split('?')[1].replace(/^\/\?/, '') ?? '';
    urlParameters = new URLSearchParams(url);
    assert.true(Boolean(urlParameters.get('workspaceChooserOpened')));
    await percySnapshot(assert);
  });

  test('check code mode states when switching between workspaces', async function (assert) {
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
      .exists();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');

    await click('[data-test-file-browser-toggle]');
    assert.dom(`[data-test-realm-name]`).hasText('In Test Workspace B');

    await click('[data-test-file="boom-person.gts"]');
    await click('[data-test-file="Person/fadhlan.json"]');
    await click('[data-test-directory="Pet/"]');
    await click('[data-test-file="Pet/mango.json"]');
    await click('[data-test-file="Pet/vangogh.json"]');
    assert.dom('[data-test-recent-file]').exists({ count: 3 });
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Pet/mango.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Person/fadhlan.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}boom-person.gts"]`)
      .exists();

    await click('[data-test-workspace-chooser-toggle]');
    await click('[data-test-workspace="Boxel Catalog"]');
    assert.dom(`[data-test-realm-name]`).hasText('In Boxel Catalog');
    assert.dom(`[data-test-file="index.json"]`).hasClass('selected');
    assert.dom('[data-test-recent-file]').exists({ count: 4 });
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Pet/vangogh.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Pet/mango.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Person/fadhlan.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}boom-person.gts"]`)
      .exists();

    await click('[data-test-workspace-chooser-toggle]');
    await click('[data-test-workspace="Test Workspace B"]');
    assert.dom(`[data-test-realm-name]`).hasText('In Test Workspace B');
    assert.dom(`[data-test-file="Pet/vangogh.json"]`).hasClass('selected');
    assert.dom('[data-test-recent-file]').exists({ count: 4 });
    assert
      .dom(`[data-test-recent-file="http://localhost:4201/catalog/index.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Pet/mango.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}Person/fadhlan.json"]`)
      .exists();
    assert
      .dom(`[data-test-recent-file="${testRealmURL}boom-person.gts"]`)
      .exists();
  });

  module('2 stacks', function () {
    test('Toggling submode will open code submode and toggling back will restore the stack', async function (assert) {
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

      // Toggle from interact (default) to code submode
      await waitFor('[data-test-submode-switcher]');
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Code"]');

      await waitFor('[data-test-submode-switcher]');
      assert.dom('[data-test-code-mode]').exists();
      assert.dom('[data-test-submode-switcher] button').hasText('Code');

      // Submode is reflected in the URL
      assert.operatorModeParametersMatch(currentURL(), {
        submode: Submodes.Code,
        codePath: `${testRealmURL}Pet/mango.json`,
        fileView: 'inspector',
        openDirs: { [testRealmURL]: ['Pet/'] },
      });

      // Toggle back to interactive mode
      await waitFor('[data-test-submode-switcher]');
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Interact"]');

      // Stacks are restored
      await waitFor('[data-test-operator-mode-stack]');
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

      // Submode is reflected in the URL
      assert.operatorModeParametersMatch(currentURL(), {
        submode: Submodes.Interact,
      });
    });
  });

  module('realm session expiration', function (hooks) {
    let refreshInSec = 2;

    hooks.beforeEach(async function () {
      setExpiresInSec(tokenRefreshPeriodSec + refreshInSec);
    });

    test('realm session refreshes within 5 minute window of expiration', async function (assert) {
      await visit('/');

      let originalToken = window.localStorage.getItem(sessionLocalStorageKey);
      await waitUntil(
        () =>
          window.localStorage.getItem(sessionLocalStorageKey) !== originalToken,
        { timeout: refreshInSec * 3 * 1000 },
      );

      let newToken = window.localStorage.getItem(sessionLocalStorageKey);
      assert.ok(newToken, 'new session token obtained');
      assert.notEqual(
        originalToken,
        newToken,
        'new session token is different than original session token',
      );
    });
  });

  module('account popover', function (hooks) {
    let userResponseBody = {
      data: {
        type: 'user',
        id: 1,
        attributes: {
          matrixUserId: '@testuser:staging',
          stripeCustomerId: 'stripe-id-1',
          creditsAvailableInPlanAllowance: 1000,
          creditsIncludedInPlanAllowance: 1000,
          extraCreditsAvailableInBalance: 100,
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscription',
              id: 1,
            },
          },
        },
      },
      included: [
        {
          type: 'subscription',
          id: 1,
          attributes: {
            startedAt: '2024-10-15T03:42:11.000Z',
            endedAt: '2025-10-15T03:42:11.000Z',
            status: 'active',
          },
          relationships: {
            plan: {
              data: {
                type: 'plan',
                id: 1,
              },
            },
          },
        },
        {
          type: 'plan',
          id: 1,
          attributes: {
            name: 'Free',
            monthlyPrice: 0,
            creditsIncluded: 1000,
          },
        },
      ],
    };

    setupRealmServerEndpoints(hooks, [
      {
        route: '_user',
        getResponse: async (_req: Request) => {
          return new Response(JSON.stringify(userResponseBody));
        },
      },
      {
        route: '_server-session',
        getResponse: async (req: Request) => {
          let data = await req.json();
          if (!data.challenge) {
            return new Response(
              JSON.stringify({
                challenge: 'test',
                room: matrixRoomId,
              }),
              {
                status: 401,
              },
            );
          } else {
            return new Response('Ok', {
              status: 200,
              headers: {
                Authorization: createJWT(
                  {
                    user: '@testuser:staging',
                    sessionRoom: matrixRoomId,
                  },
                  '1d',
                  testRealmSecretSeed,
                ),
              },
            });
          }
        },
      },
    ]);

    test('can access and save settings via profile info popover', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      })!;

      await click('[data-test-profile-icon-button]');
      await click('[data-test-settings-button]');

      assert.dom('[data-test-profile-popover]').doesNotExist();
      assert.dom('[data-test-settings-modal]').exists();

      assert.dom('[data-test-profile-icon]').hasText('T'); // "T", from first letter of: @testuser:staging
      assert.dom('[data-test-profile-display-name]').hasText(''); // No display name set yet
      assert
        .dom('[data-test-profile-icon]')
        .hasStyle({ backgroundColor: 'rgb(34, 221, 152)' });
      assert
        .dom('[data-test-profile-icon-handle]')
        .hasText('@testuser:staging');

      await fillIn('[data-test-display-name-field]', '');
      assert
        .dom('[data-test-boxel-input-error-message]')
        .hasText('Name is required');

      await fillIn('[data-test-display-name-field]', 'MAKEMECRASH');

      assert.dom('[data-test-boxel-input-error-message]').doesNotExist();

      await click('[data-test-profile-settings-save-button]');

      assert
        .dom('[data-test-profile-save-error]')
        .hasText('Failed to save profile. Please try again.');

      await fillIn('[data-test-display-name-field]', 'John');
      await click('[data-test-profile-settings-save-button]');

      assert.dom('[data-test-profile-save-error]').doesNotExist();

      await waitUntil(
        () =>
          // @ts-ignore
          document
            .querySelector('[data-test-profile-display-name]')
            .textContent.trim() === 'John',
      );

      assert.dom('[data-test-profile-icon]').hasText('J'); // From display name "John"
    });

    test(`displays credit info in account popover`, async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        codePath: `${testRealmURL}employee.gts`,
      });

      await waitFor('[data-test-profile-icon-button]');
      assert.dom('[data-test-profile-icon]').hasText('T');
      assert
        .dom('[data-test-profile-icon]')
        .hasStyle({ backgroundColor: 'rgb(34, 221, 152)' });

      assert.dom('[data-test-profile-popover]').doesNotExist();

      await click('[data-test-profile-icon-button]');

      assert.dom('[data-test-profile-popover]').exists();
      assert.dom('[data-test-subscription-data="plan"]').hasText('Free');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasText('1000 of 1000 left');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasNoClass('out-of-credit');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasText('100');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasNoClass('out-of-credit');
      assert.dom('[data-test-upgrade-plan-button]').exists();
      assert.dom('[data-test-buy-more-credits]').exists();
      assert.dom('[data-test-buy-more-credits]').hasNoClass('out-of-credit');

      await click('[data-test-upgrade-plan-button]');
      assert.dom('[data-test-profile-popover]').doesNotExist();
      assert
        .dom('[data-test-boxel-card-container]')
        .hasClass('profile-settings');

      await click('[aria-label="close modal"]');
      await click('[data-test-profile-icon-button]');
      assert.dom('[data-test-profile-popover]').exists();
      await click('[data-test-buy-more-credits] button');
      assert.dom('[data-test-profile-popover]').doesNotExist();
      assert
        .dom('[data-test-boxel-card-container]')
        .hasClass('profile-settings');

      // out of credit
      await click('[aria-label="close modal"]');

      // out of monthly credit
      userResponseBody.data.attributes.creditsAvailableInPlanAllowance = 0;
      simulateRemoteMessage(matrixRoomId, '@realm-server:localhost', {
        msgtype: 'org.boxel.realm-server-event',
        body: JSON.stringify({ eventType: 'billing-notification' }),
      });

      await click('[data-test-profile-icon-button]');
      assert.dom('[data-test-subscription-data="plan"]').hasText('Free');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasText('0 of 1000 left');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasClass('out-of-credit');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasText('100');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasNoClass('out-of-credit');
      assert.dom('[data-test-buy-more-credits]').hasNoClass('out-of-credit');
      await click('[data-test-profile-icon-button]');

      // out of monthly credit and additional credit
      userResponseBody.data.attributes.extraCreditsAvailableInBalance = 0;
      simulateRemoteMessage(matrixRoomId, '@realm-server:localhost', {
        msgtype: 'org.boxel.realm-server-event',
        body: JSON.stringify({ eventType: 'billing-notification' }),
      });
      await click('[data-test-profile-icon-button]');
      assert.dom('[data-test-subscription-data="plan"]').hasText('Free');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasText('0 of 1000 left');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasClass('out-of-credit');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasText('0');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasClass('out-of-credit');
      assert.dom('[data-test-buy-more-credits]').hasClass('out-of-credit');
      await click('[data-test-profile-icon-button]');

      // out of additional credit
      userResponseBody.data.attributes.creditsAvailableInPlanAllowance = 1000;
      simulateRemoteMessage(matrixRoomId, '@realm-server:localhost', {
        msgtype: 'org.boxel.realm-server-event',
        body: JSON.stringify({ eventType: 'billing-notification' }),
      });
      await click('[data-test-profile-icon-button]');
      assert.dom('[data-test-subscription-data="plan"]').hasText('Free');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasText('1000 of 1000 left');
      assert
        .dom('[data-test-subscription-data="monthly-credit"]')
        .hasNoClass('out-of-credit');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasText('0');
      assert
        .dom('[data-test-subscription-data="additional-credit"]')
        .hasNoClass('out-of-credit');
      assert.dom('[data-test-buy-more-credits]').hasNoClass('out-of-credit');
    });
  });
});
