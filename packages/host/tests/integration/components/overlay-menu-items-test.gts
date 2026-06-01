import {
  waitFor,
  waitUntil,
  click,
  triggerEvent,
  find,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import { baseRealm, getMenuItems } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type { GetMenuItemParams } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  testModuleRealm,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
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
    let markdownFileDef: typeof import('https://cardstack.com/base/markdown-file-def');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    markdownFileDef = await loader.import(`${baseRealm.url}markdown-file-def`);

    let { field, contains, linksTo, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    let { MarkdownDef } = markdownFileDef;

    class CardWithCustomMenu extends CardDef {
      static displayName = 'Card With Custom Menu';
      @field title = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: CardWithCustomMenu) {
          return this.title;
        },
      });
      [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
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

    class ParentWithFile extends CardDef {
      static displayName = 'Parent With File';
      @field name = contains(StringField);
      @field markdown = linksTo(MarkdownDef);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: ParentWithFile) {
          return this.name;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-parent-with-file={{@model.name}}><@fields.name /></h2>
          <@fields.markdown />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'card-with-custom-menu.gts': { CardWithCustomMenu },
        'parent-card.gts': { ParentCard },
        'parent-with-file.gts': { ParentWithFile },
        'ParentWithFile/notes.md':
          '# Hello\n\nMarkdown content for the FileDef overlay test.',
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
        'ParentWithFile/1.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'My Parent With File',
            },
            relationships: {
              markdown: {
                links: {
                  self: './notes.md',
                },
                data: {
                  type: 'file-meta',
                  id: './notes.md',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../parent-with-file',
                name: 'ParentWithFile',
              },
            },
          },
        },
        'realm.json': realmConfigCardJSON({
          name: 'Test Workspace 1',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        }),
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

  test('linked FileDef overlay menu uses file-specific labels', async function (assert) {
    setCardInOperatorModeState([`${testRealmURL}ParentWithFile/1`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let fileURL = `${testRealmURL}ParentWithFile/notes.md`;
    // The overlay strips the file extension from cardId for its data-test
    // attributes (removeFileExtension), so data-test-overlay-card lacks `.md`.
    let fileCardSelector = `[data-test-overlay-card="${testRealmURL}ParentWithFile/notes"]`;
    await waitFor(`[data-test-card="${fileURL}"]`);
    await triggerEvent(`[data-test-card="${fileURL}"]`, 'mouseenter');
    await waitFor(`${fileCardSelector} [data-test-overlay-more-options]`);

    assert
      .dom(`${fileCardSelector} [data-test-overlay-label]`)
      .containsText(
        'Markdown',
        "type-label tab uses the FileDef's displayName, not the generic 'Card' fallback",
      );

    await click(`${fileCardSelector} [data-test-overlay-more-options]`);
    assert
      .dom('[data-test-boxel-menu-item-text="View file"]')
      .exists('menu shows View file, not View card');
    assert
      .dom('[data-test-boxel-menu-item-text="View card"]')
      .doesNotExist('the card-flavored label is suppressed for file targets');
    assert
      .dom('[data-test-boxel-menu-item-text="Copy File URL"]')
      .exists('menu shows Copy File URL, not Copy Card URL');
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Card URL"]')
      .doesNotExist(
        'the card-flavored URL label is suppressed for file targets',
      );
  });

  test('hover type-label tab anchors left while it fits and clamps to the corner radius when it overflows, and stays inside the containing card', async function (assert) {
    setCardInOperatorModeState([`${testRealmURL}ParentCard/1`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let cardSelector = `[data-test-card="${testRealmURL}CardWithCustomMenu/1"]`;
    let parentSelector = `[data-test-card="${testRealmURL}ParentCard/1"]`;
    let overlaySelector = `[data-test-overlay-card="${testRealmURL}CardWithCustomMenu/1"]`;
    await waitFor(cardSelector);
    await triggerEvent(cardSelector, 'mouseenter');
    let label = (await waitFor(
      `${overlaySelector} [data-test-overlay-label]`,
    )) as HTMLElement;
    let card = find(cardSelector) as HTMLElement;
    let boundary = find(parentSelector) as HTMLElement;

    // trackLabelOverflow sets `style.left = '0'` synchronously at
    // setup, then writes the computed `Npx` value when its update
    // runs. The label has its natural content width as soon as it's
    // inserted (so `width > 0` is not a strong-enough signal), but
    // the inline `left` is in `px` form only after the positioner
    // has fired. Wait on that to know the JS positioning has landed.
    await waitUntil(() => label.style.left.endsWith('px'), {
      timeout: 1000,
    });

    let labelRect = label.getBoundingClientRect();
    let cardRect = card.getBoundingClientRect();
    let boundaryRect = boundary.getBoundingClientRect();
    let radius = parseFloat(window.getComputedStyle(card).borderTopRightRadius);

    if (label.hasAttribute('data-overflow')) {
      // Long-name case: right edge sits at the start of the card's
      // top-right corner radius (with the 4px stroke bleed), and the
      // extra width spills off the card's left edge.
      assert.ok(
        Math.abs(cardRect.right - labelRect.right - (radius - 4)) <= 2,
        "overflowing label's right edge sits at the card's corner-radius point",
      );
      assert.ok(
        labelRect.left < cardRect.left,
        'overflowing label extends past the card left edge',
      );
    } else {
      // Short-name case: hugs the card's left edge with the 4px bleed.
      assert.ok(
        Math.abs(labelRect.left - (cardRect.left - 4)) <= 2,
        "fitting label is anchored to the card's left edge",
      );
      assert.ok(
        labelRect.right <= cardRect.right - radius + 2,
        "fitting label's right edge stays before the corner-radius point",
      );
    }

    // Either way the label stays inside the visible stack-item frame
    // (a few pixels of slop for sub-pixel rounding and the
    // drop-shadow's render box).
    assert.ok(
      labelRect.left >= boundaryRect.left - 4,
      'label left edge stays inside the containing card',
    );
    assert.ok(
      labelRect.right <= boundaryRect.right + 4,
      'label right edge stays inside the containing card',
    );
  });
});
