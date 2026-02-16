import { waitFor, click, triggerEvent } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, getMenuItems } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  testModuleRealm,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;
let setCardInOperatorModeState: (leftCards: string[]) => void;

module('Integration | overlay-menu-items', function (hooks) {
  let noop = () => {};
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL, testModuleRealm],
    realmPermissions: {
      [testRealmURL]: ['read', 'write'],
      [testModuleRealm]: ['read', 'write'],
    },
    autostart: true,
  });

  hooks.beforeEach(async function () {
    setCardInOperatorModeState = (leftCards: string[]) => {
      let operatorModeStateService = getService('operator-mode-state-service');
      operatorModeStateService.restore({
        stacks: [
          leftCards.map((url) => ({
            type: 'card' as const,
            id: url,
            format: 'isolated' as const,
          })),
        ],
      });
    };

    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, linksTo, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class CardWithCustomMenu extends CardDef {
      static displayName = 'Card With Custom Menu';
      @field title = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: CardWithCustomMenu) {
          return this.title;
        },
      });
      [getMenuItems](params: any): any[] {
        let menuItems = super[getMenuItems](params);
        menuItems.push({
          label: 'Custom Action',
          action: () => {},
        });
        return menuItems;
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-custom-card={{@model.title}}><@fields.title /></span>
        </template>
      };
    }

    class ParentCard extends CardDef {
      static displayName = 'Parent Card';
      @field name = contains(StringField);
      @field linkedCard = linksTo(CardWithCustomMenu);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: ParentCard) {
          return this.name;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-parent={{@model.name}}><@fields.name /></h2>
          <@fields.linkedCard />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'card-with-custom-menu.gts': { CardWithCustomMenu },
        'parent-card.gts': { ParentCard },
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
        'CardWithCustomMenu/1.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'My Custom Card',
            },
            meta: {
              adoptsFrom: {
                module: '../card-with-custom-menu',
                name: 'CardWithCustomMenu',
              },
            },
          },
        },
        'ParentCard/1.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'My Parent',
            },
            relationships: {
              linkedCard: {
                links: {
                  self: `${testRealmURL}CardWithCustomMenu/1`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../parent-card',
                name: 'ParentCard',
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
    });
  });

  test('linked card overlay menu shows "View card" item', async function (assert) {
    setCardInOperatorModeState([`${testRealmURL}ParentCard/1`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-card="${testRealmURL}CardWithCustomMenu/1"]`);
    await triggerEvent(
      `[data-test-card="${testRealmURL}CardWithCustomMenu/1"]`,
      'mouseenter',
    );
    await waitFor(
      `[data-test-overlay-card="${testRealmURL}CardWithCustomMenu/1"] [data-test-overlay-more-options]`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}CardWithCustomMenu/1"] [data-test-overlay-more-options]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="View card"]')
      .exists('View card menu item is displayed for linked card');
  });

  test('linked card overlay menu shows card-specific custom menu items from getMenuItems()', async function (assert) {
    setCardInOperatorModeState([`${testRealmURL}ParentCard/1`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-card="${testRealmURL}CardWithCustomMenu/1"]`);
    await triggerEvent(
      `[data-test-card="${testRealmURL}CardWithCustomMenu/1"]`,
      'mouseenter',
    );
    await waitFor(
      `[data-test-overlay-card="${testRealmURL}CardWithCustomMenu/1"] [data-test-overlay-more-options]`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}CardWithCustomMenu/1"] [data-test-overlay-more-options]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Custom Action"]')
      .exists(
        'card-specific custom menu item is displayed for linked card in overlay',
      );
    assert
      .dom('[data-test-boxel-menu-item-text="View card"]')
      .exists('View card menu item is also present');
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Card URL"]')
      .exists('Copy Card URL menu item is also present');
  });
});
