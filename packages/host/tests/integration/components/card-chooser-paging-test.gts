import { waitFor, waitUntil, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  type RealmContents,
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const realmName = 'Local Workspace';
const specCount = 103;
const section = `[data-test-realm="${realmName}"]`;

function widgetName(n: number) {
  return `Widget ${String(n).padStart(3, '0')}`;
}

function widgetSpecId(n: number) {
  return `${testRealmURL}cards/widgets/Spec/widget-${String(n).padStart(3, '0')}`;
}

function shownIds() {
  return [
    ...document.querySelectorAll(`${section} [data-test-item-button]`),
  ].map((n) => n.getAttribute('data-test-item-button'));
}

module('Integration | card-chooser | paging', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const noop = () => {};

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string');
    let cardsGrid: typeof import('@cardstack/base/cards-grid');
    let spec: typeof import('@cardstack/base/spec');
    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');
    cardsGrid = await loader.import('@cardstack/base/cards-grid');
    spec = await loader.import('@cardstack/base/spec');

    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
    let { CardsGrid } = cardsGrid;
    let { Spec } = spec;

    class Widget extends CardDef {
      static displayName = 'Widget';
      @field label = contains(StringField);
    }

    let contents: RealmContents = {
      'cards/widgets/widget.gts': { Widget },
      'realm.json': realmConfigCardJSON({ name: realmName }),
      'index.json': new CardsGrid(),
    };
    for (let n = 1; n <= specCount; n++) {
      contents[`cards/widgets/Spec/widget-${String(n).padStart(3, '0')}.json`] =
        new Spec({
          cardTitle: widgetName(n),
          specType: 'card',
          ref: {
            module: `${testRealmURL}cards/widgets/widget`,
            name: 'Widget',
          },
        });
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents,
    });

    getService('operator-mode-state-service').restore({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click('[data-test-create-new-card-button]');
    await waitFor(section);
  });

  test('a realm section reports its full match count and pages past the first page', async function (assert) {
    assert
      .dom(`${section} [data-test-results-count]`)
      .hasText(`${specCount} results`);

    await click(`${section} [data-test-search-sheet-show-only]`);
    assert.strictEqual(shownIds().length, 100, 'focus shows the first page');
    assert
      .dom(`${section} [data-test-show-more-cards]`)
      .containsText('Show 3 more results (3 not shown)');

    await click(`${section} [data-test-show-more-cards]`);
    await waitUntil(() => shownIds().length === specCount);
    let ids = shownIds();
    assert.strictEqual(
      ids[ids.length - 1],
      widgetSpecId(specCount),
      'the last card alphabetically is reachable',
    );
    assert.strictEqual(new Set(ids).size, specCount, 'no row appears twice');
    assert.dom(`${section} [data-test-show-more-cards]`).doesNotExist();
  });
});
