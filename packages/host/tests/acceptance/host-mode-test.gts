import { getOwner } from '@ember/owner';
import {
  click,
  currentURL,
  visit,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { getPageTitle } from 'ember-page-title/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common';

import HostModeService from '@cardstack/host/services/host-mode-service';
import type StoreService from '@cardstack/host/services/store';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  testHostModeRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAuthEndpoints,
  setupUserSubscription,
} from '../helpers';
import { viewCardDemoCardSource } from '../helpers/cards/view-card-demo';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let testHostModeRealmURLWithoutRealm = testHostModeRealmURL.replace(
  /\/test\/?$/,
  '',
);

// Overrides to simulate a request to a host mode domain
class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURLWithoutRealm);
  }
}

class StubCustomSubdomainHostModeService extends StubHostModeService {
  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURL);
  }
}

module('Acceptance | host mode tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testHostModeRealmURL],
  });

  let { setActiveRealms, setExpiresInSec, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(function (this) {
    let owner = getOwner(this)!;
    let ownerWithUnregister = owner as {
      unregister?: (fullName: string) => void;
    };
    ownerWithUnregister.unregister?.('service:host-mode-service');
    owner.register('service:host-mode-service', StubHostModeService);
  });

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    setExpiresInSec(60 * 60);

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      static headerColor = '#355e3b';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
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

    await setupAcceptanceTestRealm({
      realmURL: testHostModeRealmURL,
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
      },
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'pet.gts': { Pet },
        'view-card-demo.gts': viewCardDemoCardSource,
        'Pet/mango.json': {
          data: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'ViewCardDemo/index.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Primary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/secondary.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'ViewCardDemo/secondary.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Secondary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/tertiary.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'ViewCardDemo/tertiary.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Tertiary View Demo',
              targetCardURL: `${testHostModeRealmURL}ViewCardDemo/index.json`,
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}view-card-demo`,
                name: 'ViewCardDemo',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
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
          publishable: true,
        },
      },
    });

    setActiveRealms([testHostModeRealmURL]);
  });

  test('visiting a default width card in host mode', async function (assert) {
    await visit('/test/Pet/mango.json');

    assert.dom('[data-test-host-mode-content]').hasStyle({
      'background-image':
        'url("https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg")',
    });

    assert
      .dom(`[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`)
      .exists();
    assert.dom('[data-test-host-mode-content]').hasNoClass('is-wide');
    assert.strictEqual(getPageTitle(), 'Mango');

    await percySnapshot(assert);
  });

  test('visiting a full width card in host mode', async function (assert) {
    await visit('/test');

    assert
      .dom(`[data-test-host-mode-card="${testHostModeRealmURL}index"]`)
      .exists();
    assert.strictEqual(getPageTitle(), 'Test Workspace B');
    assert.dom('[data-test-host-mode-content]').hasClass('is-wide');

    await percySnapshot(assert);
  });

  test('visiting a non-existent card shows an error', async function (assert) {
    let store = getService('store') as StoreService;
    let originalGet = store.get.bind(store);
    let gate = new Deferred<void>();
    let targetId = `${testHostModeRealmURL}Pet/non-existent.json`;
    store.get = async (id: string, ...rest: unknown[]) => {
      if (id === targetId) {
        await gate.promise;
      }
      return originalGet(id, ...(rest as []));
    };

    let visitPromise = visit('/test/Pet/non-existent.json');
    await waitFor('[data-test-host-loading]');
    assert.dom('[data-test-host-loading]').exists();
    gate.fulfill();

    await visitPromise;
    assert
      .dom('[data-test-error="not-found"]')
      .hasText(`Card not found: ${testHostModeRealmURL}Pet/non-existent`);
    assert.strictEqual(
      getPageTitle(),
      `Card not found: ${testHostModeRealmURL}Pet/non-existent`,
    );
    assert.dom('[data-test-host-loading]').doesNotExist();

    store.get = originalGet;
  });

  test('invoking viewCard from a card stacks the linked card', async function (assert) {
    let targetStackId = `${testHostModeRealmURL}ViewCardDemo/secondary`;

    await visit('/test/ViewCardDemo/index.json');

    await waitFor('[data-test-view-card-demo-button]');
    assert
      .dom(`[data-test-host-mode-stack-item="${targetStackId}"]`)
      .doesNotExist();

    await click('[data-test-view-card-demo-button]');
    await waitFor(`[data-test-host-mode-stack-item="${targetStackId}"]`);

    assert.dom(`[data-test-host-mode-stack-item="${targetStackId}"]`).exists();
  });

  test('clicking a card in card list stacks it', async function (assert) {
    await visit('/test'); // Visit the index card (CardsGrid)

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    // Wait for the cards grid to render with cards
    await waitFor('[data-test-cards-grid-item]');

    // Verify the pet card is not in the stack initially
    assert
      .dom(
        `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
      )
      .doesNotExist();

    // Click on the pet card in the list
    await click(
      `[data-test-cards-grid-item="${testHostModeRealmURL}Pet/mango"]`,
    );

    // Wait for the card to be added to the stack
    await waitFor(
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
    );

    // Verify the card is now in the stack
    assert
      .dom(
        `[data-test-host-mode-stack-item="${testHostModeRealmURL}Pet/mango"]`,
      )
      .exists();

    // Verify the card content is rendered
    assert.dom('[data-test-pet-isolated="Mango"]').exists();
  });

  test('viewCard tabs persist after stacking and closing cards in host mode', async function (assert) {
    let primaryCardId = `${testHostModeRealmURL}ViewCardDemo/index`;
    let firstStackCardId = `${testHostModeRealmURL}ViewCardDemo/secondary`;
    let secondStackCardId = `${testHostModeRealmURL}ViewCardDemo/tertiary`;

    await visit('/test/ViewCardDemo/index.json');

    let primaryCardSelector = `[data-test-host-mode-card="${primaryCardId}"]`;
    await waitFor(
      `${primaryCardSelector} [data-test-view-card-demo-active-tab]`,
    );
    await waitFor(`${primaryCardSelector} [data-test-view-card-demo-button]`);
    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

    await click(
      `${primaryCardSelector} [data-test-view-card-demo-tab="details"]`,
    );

    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'details');

    await click(`${primaryCardSelector} [data-test-view-card-demo-button]`);

    let firstStackSelector = `[data-test-host-mode-stack-item="${firstStackCardId}"]`;
    await waitFor(
      `${firstStackSelector} [data-test-view-card-demo-active-tab]`,
    );
    await waitFor(`${firstStackSelector} [data-test-view-card-demo-button]`);
    await waitFor(firstStackSelector);

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

    await click(
      `${firstStackSelector} [data-test-view-card-demo-tab="history"]`,
    );

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'history');

    await click(`${firstStackSelector} [data-test-view-card-demo-button]`);

    let secondStackSelector = `[data-test-host-mode-stack-item="${secondStackCardId}"]`;
    await waitFor(`${secondStackSelector} [data-test-view-card-demo-button]`);
    await waitFor(secondStackSelector);

    await click(`[data-test-host-mode-breadcrumb="${firstStackCardId}"]`);

    await waitUntil(() => {
      return !document.querySelector(secondStackSelector);
    });

    assert
      .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'history');

    await click(`[data-test-host-mode-breadcrumb="${primaryCardId}"]`);

    await waitUntil(() => {
      return !document.querySelector(firstStackSelector);
    });

    assert
      .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
      .hasAttribute('data-test-view-card-demo-active-tab', 'details');
  });

  test('stack state persists in query parameter', async function (assert) {
    let hostModeStackValue = encodeURIComponent(
      JSON.stringify([`${testHostModeRealmURL}index`]),
    );

    await visit(`/test/Pet/mango.json?hostModeStack=${hostModeStackValue}`);

    assert
      .dom(`[data-test-host-mode-stack-item="${testHostModeRealmURL}index"]`)
      .exists();
    await click(
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}index"] .close-button`,
    );

    assert.strictEqual(currentURL(), '/test/Pet/mango.json');
    assert.strictEqual(
      new URL(window.location.href).searchParams.get('hostModeStack'),
      null,
    );
  });

  module('with a custom subdomain', function (hooks) {
    hooks.beforeEach(function (this) {
      let owner = getOwner(this)!;
      let ownerWithUnregister = owner as {
        unregister?: (fullName: string) => void;
      };
      ownerWithUnregister.unregister?.('service:host-mode-service');
      owner.register(
        'service:host-mode-service',
        StubCustomSubdomainHostModeService,
      );
    });

    test('visiting a card in host mode', async function (assert) {
      await visit('/Pet/mango.json');

      assert
        .dom(`[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`)
        .exists();
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
