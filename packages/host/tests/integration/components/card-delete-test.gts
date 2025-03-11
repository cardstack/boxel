import {
  waitUntil,
  waitFor,
  click,
  focus,
  triggerEvent,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RecentCardsService from '@cardstack/host/services/recent-cards-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  setupIntegrationTestRealm,
  lookupLoaderService,
} from '../../helpers';
import { TestRealmAdapter } from '../../helpers/adapter';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;
let cardApi: typeof import('https://cardstack.com/base/card-api');
let setCardInOperatorModeState: (
  leftCards: string[],
  rightCards?: string[],
) => Promise<void>;

module('Integration | card-delete', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;
  let noop = () => {};
  async function loadCard(url: string): Promise<CardDef> {
    let { createFromSerialized, recompute } = cardApi;
    let result = await realm.realmIndexQueryEngine.cardDocument(new URL(url));
    if (!result || result.type === 'error') {
      throw new Error(
        `cannot get instance ${url} from the index: ${
          result ? result.error.errorDetail.message : 'not found'
        }`,
      );
    }
    let card = await createFromSerialized<typeof CardDef>(
      result.doc.data,
      result.doc,
      new URL(url),
    );
    await recompute(card, { loadFields: true });
    return card;
  }
  setupRenderingTest(hooks);
  hooks.beforeEach(async function () {
    loader = lookupLoaderService().loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
  });
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    setCardInOperatorModeState = async (
      leftCards: string[],
      rightCards: string[] = [],
    ) => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      let stacks = [
        leftCards.map((url) => ({
          type: 'card' as const,
          id: url,
          format: 'isolated' as const,
        })),
        rightCards.map((url) => ({
          type: 'card' as const,
          id: url,
          format: 'isolated' as const,
        })),
      ].filter((a) => a.length > 0);
      await operatorModeStateService.restore({ stacks });
    };
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet={{@model.firstName}}><@fields.firstName /></h2>
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.firstName}}><@fields.firstName /></h3>
        </template>
      };
    }
    ({ realm, adapter } = await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
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
        'Pet/mango.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        'Pet/vangogh.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
            },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        '.realm.json': {
          name: 'Test Workspace 1',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    }));
  });

  test('can delete a card from the index card stack item', async function (assert) {
    await setCardInOperatorModeState([`${testRealmURL}index`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await percySnapshot(assert);
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');

    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
  });

  test('can cancel delete', async function (assert) {
    await setCardInOperatorModeState([`${testRealmURL}index`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-cancel-button]');
    await waitUntil(
      () =>
        !document.querySelector(
          '[data-test-delete-modal="${testRealmURL}Pet/mango"]',
        ),
    );
    fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
  });

  test('can delete a card stack item in non-edit mode', async function (assert) {
    await setCardInOperatorModeState([
      `${testRealmURL}index`,
      `${testRealmURL}Pet/mango`,
    ]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await waitFor(`[data-test-operator-mode-stack="0"] [data-test-pet]`);
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .exists();
    await click(
      `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-more-options-button]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        !document.querySelector(
          '[data-test-delete-modal="${testRealmURL}Pet/mango"]',
        ),
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .doesNotExist('stack item removed');
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('can delete a card stack item in edit mode', async function (assert) {
    await setCardInOperatorModeState([
      `${testRealmURL}index`,
      `${testRealmURL}Pet/mango`,
    ]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await waitFor(`[data-test-operator-mode-stack="0"] [data-test-pet]`);
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .exists();
    await click(
      `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-edit-button]`,
    );
    await click(
      `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-more-options-button]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        !document.querySelector(
          '[data-test-delete-modal="${testRealmURL}Pet/mango"]',
        ),
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .doesNotExist('stack item removed');
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('can delete a card that appears in both stacks as a stack item', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`, `${testRealmURL}Pet/mango`],
      [`${testRealmURL}index`, `${testRealmURL}Pet/mango`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await waitFor(`[data-test-operator-mode-stack="0"] [data-test-pet]`);
    await waitFor(`[data-test-operator-mode-stack="1"] [data-test-pet]`);
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .exists();
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-more-options-button]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        !document.querySelector(
          '[data-test-delete-modal="${testRealmURL}Pet/mango"]',
        ),
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .doesNotExist('stack item removed');
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .doesNotExist('stack item removed');
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('can delete a card that appears in both stacks as an element of the index card', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealmURL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('can delete a card that appears in both stacks as an index item and an element of the index card', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealmURL}index`, `${testRealmURL}Pet/mango`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await waitFor(
      `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
    );
    await waitFor(`[data-test-operator-mode-stack="1"] [data-test-pet]`);
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .exists();
    await triggerEvent(
      `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        !document.querySelector(
          '[data-test-delete-modal="${testRealmURL}Pet/mango"]',
        ),
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-stack-card="${testRealmURL}Pet/mango"]`,
      )
      .doesNotExist('stack item removed');
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('can delete a card that is a recent item', async function (assert) {
    // creates a recent item
    let recentCardsService = this.owner.lookup(
      'service:recent-cards-service',
    ) as RecentCardsService;
    let mango = await loadCard(`${testRealmURL}Pet/mango`);
    recentCardsService.add(mango);

    await setCardInOperatorModeState([`${testRealmURL}index`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await waitFor(
      `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
    );
    await focus(`[data-test-search-field]`);
    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    await click('[data-test-search-sheet-cancel-button]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    await focus(`[data-test-search-field]`);
    assert
      .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
      .doesNotExist('recent item removed');
  });

  test('can delete a card that is a selected item', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`http://localhost:4202/test/`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let fileRef = await adapter.openFile('Pet/mango.json');
    assert.ok(fileRef, 'card instance exists in file system');

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-select]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/vangogh"]`,
      'mouseenter',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/vangogh"] [data-test-overlay-select]`,
    );
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 2 Cards', 'button text is correct');
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
    );
    await click('[data-test-boxel-menu-item-text="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/mango"]`)
      .containsText('Delete the card Mango?');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]`,
        ).length === 1,
    );
    let notFound = await adapter.openFile('Pet/mango.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 1 Card', 'button text is correct');
  });
});
