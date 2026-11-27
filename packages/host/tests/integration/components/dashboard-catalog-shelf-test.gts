import { find, render, settled, waitFor, waitUntil } from '@ember/test-helpers';

import {
  CardDef,
  contains,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CatalogShelf from '@cardstack/host/components/operator-mode/dashboard/catalog-shelf';
import type NetworkService from '@cardstack/host/services/network';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The shelf's searches, told apart by what each asks for.
type ShelfSearch = 'index' | 'others' | 'featured' | 'art';

function shelfSearchOf(body: {
  cardUrls?: string[];
  filter?: unknown;
  fields?: { entry?: string[] };
}): ShelfSearch | undefined {
  let entry = body.fields?.entry ?? [];
  if (entry.includes('item.featured')) {
    return 'index';
  }
  if (JSON.stringify(body.filter ?? {}).includes('isolated')) {
    return 'art';
  }
  if (entry.includes('item.examples')) {
    return body.cardUrls ? 'featured' : 'others';
  }
  return undefined;
}

const THUMBNAIL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

module('Integration | dashboard | catalog shelf', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    class Listing extends CardDef {
      static displayName = 'Listing';
      @field name = contains(StringField);
      @field summary = contains(StringField);
      @field examples = linksToMany(() => CardDef);
    }
    class CatalogIndex extends CardDef {
      static displayName = 'Catalog Index';
      @field featured = linksToMany(() => Listing);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'listing.gts': { Listing },
        'catalog-index.gts': { CatalogIndex },
        'examples/cellar.json': {
          data: {
            attributes: { cardInfo: { name: 'Cellar' } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'listings/wine-cellar.json': {
          data: {
            attributes: {
              name: 'Wine Cellar',
              summary: 'Track the bottles you keep.',
              cardInfo: { cardThumbnailURL: THUMBNAIL },
            },
            relationships: {
              'examples.0': { links: { self: '../examples/cellar' } },
            },
            meta: {
              adoptsFrom: { module: testRRI('listing'), name: 'Listing' },
            },
          },
        },
        'index.json': {
          data: {
            relationships: {
              'featured.0': { links: { self: './listings/wine-cellar' } },
            },
            meta: {
              adoptsFrom: {
                module: testRRI('catalog-index'),
                name: 'CatalogIndex',
              },
            },
          },
        },
      },
    });
  });

  // Records each shelf search as it is sent, and holds the one named back
  // until stopped, so a test can see what goes out while it waits.
  function watchShelfSearches(hold?: ShelfSearch) {
    let network = getService('network') as NetworkService;
    let sent = new Set<ShelfSearch>();
    let release = () => {};
    let held = new Promise<void>((resolve) => (release = resolve));
    let spy = async (request: Request) => {
      if (!new URL(request.url).pathname.endsWith('/_federated-search')) {
        return null;
      }
      let search = shelfSearchOf(await request.clone().json());
      if (search) {
        sent.add(search);
        if (search === hold) {
          await held;
        }
      }
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });
    return {
      sent,
      stop() {
        release();
        network.virtualNetwork.unmount(spy);
      },
    };
  }

  test('asks for the other listings without waiting for the index card', async function (assert) {
    let searches = watchShelfSearches('index');
    let rendered = render(
      <template><CatalogShelf @realmURL={{testRealmURL}} /></template>,
    );
    try {
      await waitUntil(() => searches.sent.has('others'));
      assert.true(
        searches.sent.has('others'),
        'the other listings are asked for while the index card is unanswered',
      );
    } finally {
      searches.stop();
      await rendered;
    }
  });

  test('asks for the featured listings without waiting for the other listings', async function (assert) {
    let searches = watchShelfSearches('others');
    let rendered = render(
      <template><CatalogShelf @realmURL={{testRealmURL}} /></template>,
    );
    try {
      await waitUntil(() => searches.sent.has('featured'));
      assert.true(
        searches.sent.has('featured'),
        'the featured listings are asked for while the other listings are unanswered',
      );
    } finally {
      searches.stop();
      await rendered;
    }
  });

  test('asks for story art as soon as it renders when the shelf starts on screen', async function (assert) {
    let searches = watchShelfSearches();
    try {
      await render(
        <template>
          <div data-dashboard-scroller>
            <CatalogShelf @realmURL={{testRealmURL}} />
          </div>
        </template>,
      );
      assert.true(
        searches.sent.has('art'),
        'the art is asked for by the time rendering settles',
      );
    } finally {
      searches.stop();
    }
  });

  test('asks for story art only once the shelf comes near the screen', async function (assert) {
    let searches = watchShelfSearches();
    try {
      await render(
        <template>
          {{! template-lint-disable no-inline-styles }}
          <div
            style='height: 300px; overflow-y: auto;'
            data-dashboard-scroller
            data-test-scroller
          >
            <div style='height: 3000px;'></div>
            <CatalogShelf @realmURL={{testRealmURL}} />
          </div>
        </template>,
      );
      await waitFor('[data-test-catalog-story]');
      await settled();
      assert.false(
        searches.sent.has('art'),
        'no art is asked for while the shelf is far below the screen',
      );
      assert
        .dom('[data-test-catalog-story-thumbnail]')
        .exists('the story shows its thumbnail meanwhile');

      // The shelf stays half a screen below what the scroller shows.
      find('[data-test-scroller]')!.scrollTop = 2550;
      await waitUntil(() => searches.sent.has('art'));
      assert.true(
        searches.sent.has('art'),
        'the art is asked for once the shelf is near the screen',
      );
    } finally {
      searches.stop();
    }
  });
});
