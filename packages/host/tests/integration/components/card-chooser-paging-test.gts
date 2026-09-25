import { waitFor, waitUntil, click, fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  chooseCard,
  Deferred,
  rri,
} from '@cardstack/runtime-common';

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
// Titled to sort ahead of every widget, and not matched by a "Widget" search.
const gizmoCount = 2;
const totalCount = specCount + gizmoCount;
const section = `[data-test-realm="${realmName}"]`;

function widgetName(n: number) {
  return `Widget ${String(n).padStart(3, '0')}`;
}

function widgetSpecId(n: number) {
  return `${testRealmURL}cards/widgets/Spec/widget-${String(n).padStart(3, '0')}`;
}

function gizmoSpecId(n: number) {
  return `${testRealmURL}cards/gizmos/Spec/gizmo-${n}`;
}

function isSearchRequest(request: Request) {
  let path = new URL(request.url).pathname;
  return path.endsWith('/_federated-search') || path.endsWith('/_search');
}

// A realm section's own extended fetch is the only search sized past the
// first page.
async function isExtendedPageFetch(request: Request) {
  if (!isSearchRequest(request)) {
    return false;
  }
  let wire = decodeURIComponent(request.url) + (await request.clone().text());
  return /"size":\s*(2|3)00\b|size\]=(2|3)00\b/.test(wire);
}

async function openCreateChooser() {
  await click('[data-test-boxel-filter-list-button="All Cards"]');
  await click('[data-test-create-new-card-button]');
  await waitFor(section);
}

async function showAllInSection() {
  await click(`${section} [data-test-search-sheet-show-only]`);
  await waitUntil(() => shownIds().length === 100);
  await click(`${section} [data-test-show-more-cards]`);
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
    class Gizmo extends CardDef {
      static displayName = 'Gizmo';
      @field label = contains(StringField);
    }

    let contents: RealmContents = {
      'cards/widgets/widget.gts': { Widget },
      'cards/gizmos/gizmo.gts': { Gizmo },
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
    for (let n = 1; n <= gizmoCount; n++) {
      contents[`cards/gizmos/Spec/gizmo-${n}.json`] = new Spec({
        cardTitle: `Gizmo ${n}`,
        specType: 'card',
        ref: { module: `${testRealmURL}cards/gizmos/gizmo`, name: 'Gizmo' },
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
  });

  hooks.afterEach(function () {
    for (let handler of mountedHandlers) {
      getService('network').virtualNetwork.unmount(handler);
    }
    mountedHandlers = [];
  });

  let mountedHandlers: ((request: Request) => Promise<Response | null>)[] = [];
  function interceptSearch(
    handler: (request: Request) => Promise<Response | null>,
  ) {
    mountedHandlers.push(handler);
    getService('network').virtualNetwork.mount(handler, { prepend: true });
  }

  test('a realm section reports its full match count and pages past the first page', async function (assert) {
    await openCreateChooser();
    assert
      .dom(`${section} [data-test-results-count]`)
      .hasText(`${totalCount} results`);

    await click(`${section} [data-test-search-sheet-show-only]`);
    assert.strictEqual(shownIds().length, 100, 'focus shows the first page');
    assert
      .dom(`${section} [data-test-show-more-cards]`)
      .containsText('Show 5 more results (5 not shown)');

    await click(`${section} [data-test-show-more-cards]`);
    await waitUntil(() => shownIds().length === totalCount);
    let ids = shownIds();
    assert.strictEqual(
      ids[ids.length - 1],
      widgetSpecId(specCount),
      'the last card alphabetically is reachable',
    );
    assert.strictEqual(new Set(ids).size, totalCount, 'no row appears twice');
    assert.dom(`${section} [data-test-show-more-cards]`).doesNotExist();
  });

  test('Select All keeps a row selected from past the first page', async function (assert) {
    void chooseCard(
      {
        filter: { type: { module: rri(`${baseRealm.url}spec`), name: 'Spec' } },
      },
      { multiSelect: true },
    );
    await waitFor(section);
    await showAllInSection();
    let lastId = widgetSpecId(specCount);
    await waitFor(`${section} [data-test-item-button="${lastId}"]`);
    await click(`${section} [data-test-item-button="${lastId}"]`);
    assert
      .dom(`${section} [data-test-item-button="${lastId}"]`)
      .hasAttribute('data-test-item-button-selected', 'true');

    await click('[data-test-selection-dropdown-trigger]');
    await waitFor('[data-test-boxel-menu-item-text="Select All"]');
    await click('[data-test-boxel-menu-item-text="Select All"]');

    assert
      .dom(`${section} [data-test-item-button="${lastId}"]`)
      .hasAttribute(
        'data-test-item-button-selected',
        'true',
        'the paged row stays selected',
      );
    assert
      .dom(`${section} [data-test-item-button-selected]`)
      .exists({ count: totalCount }, 'every loaded row is selected');
  });

  test('a failed page fetch can be retried from the show-more button', async function (assert) {
    await openCreateChooser();
    let failing = true;
    interceptSearch(async (request) =>
      failing && (await isExtendedPageFetch(request))
        ? new Response('unavailable', { status: 500 })
        : null,
    );
    await showAllInSection();
    await waitFor(`${section} [data-test-show-more-failed]`);
    assert
      .dom(`${section} [data-test-show-more-cards]`)
      .containsText('Retry', 'the failure is shown on the button');
    assert.strictEqual(shownIds().length, 100, 'the first page stays shown');

    failing = false;
    await click(`${section} [data-test-show-more-cards]`);
    await waitUntil(() => shownIds().length === totalCount);
    assert.dom(`${section} [data-test-show-more-cards]`).doesNotExist();
  });

  test('a changed search does not show the previous search rows while paging catches up', async function (assert) {
    await openCreateChooser();
    await fillIn('[data-test-search-field]', 'Widget');
    await waitUntil(
      () =>
        document
          .querySelector(`${section} [data-test-results-count]`)
          ?.textContent?.trim() === `${specCount} results`,
    );
    await showAllInSection();
    await waitUntil(() => shownIds().length === specCount);
    assert.strictEqual(shownIds()[0], widgetSpecId(1));

    let release = new Deferred<void>();
    interceptSearch(async (request) => {
      if (await isExtendedPageFetch(request)) {
        await release.promise;
      }
      return null;
    });
    // The held fetch keeps the app unsettled, so don't wait on the fill.
    let cleared = fillIn('[data-test-search-field]', '');
    await waitUntil(
      () =>
        document
          .querySelector(`${section} [data-test-results-count]`)
          ?.textContent?.trim() === `${totalCount} results`,
      { timeout: 10000 },
    );
    assert.strictEqual(
      shownIds()[0],
      gizmoSpecId(1),
      'the rows are the new search, not the previous one',
    );
    assert.strictEqual(shownIds().length, 100, 'the new first page is shown');

    release.fulfill();
    await cleared;
    await waitUntil(() => shownIds().length === specCount);
    assert.strictEqual(shownIds()[0], gizmoSpecId(1));
  });
});
