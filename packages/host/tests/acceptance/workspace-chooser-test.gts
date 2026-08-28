import {
  click,
  focus,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import { testRealmInfo } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { suspendGlobalErrorHook } from '../helpers/uncaught-exceptions';

const realmAURL = 'http://test-realm/testuser/workspace-a/';
const realmBURL = 'http://test-realm/testuser/workspace-b/';

let realmA: Realm;

function withUpdatedRealmInfo(
  realmURL: string,
  updates: Partial<typeof testRealmInfo>,
): () => void {
  let realmService = getService('realm') as any;
  let realmResource = realmService.realms.get(realmURL);
  if (!realmResource) {
    throw new Error(`Realm resource for ${realmURL} is not registered`);
  }

  let previousInfo = realmResource.info;
  let baseInfo = previousInfo ? { ...previousInfo } : { ...testRealmInfo };

  realmResource.info = new TrackedObject({
    ...baseInfo,
    ...updates,
  });

  return () => {
    realmResource.info = previousInfo;
  };
}

// Tile counts are loaded lazily from `/_federated-index-counts` into a tracked
// map on the realm service, keyed by realm URL. Seed that map directly so the
// assertions don't depend on a fixture realm's incidental contents.
function withIndexCounts(
  realmURL: string,
  counts: {
    cardCount: number | null;
    fileCount: number | null;
    definitionCount: number | null;
  },
): void {
  let realmService = getService('realm') as any;
  realmService.indexCountsByRealm.set(realmURL, counts);
}

module('Acceptance | workspace-chooser', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [realmAURL, realmBURL],
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();

    let { realm } = await setupAcceptanceTestRealm({
      realmURL: realmAURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: realmBURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace B' }),
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
    realmA = realm;
  });

  module('favorites', function () {
    test('shows empty favorites message when no favorites exist', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');
    });

    test('can favorite a workspace by clicking the star button', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');

      await click(`[data-test-workspace-favorite-btn="${realmAURL}"]`);

      assert.dom('[data-test-favorites-empty]').doesNotExist();
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(
        matrixService.workspaceFavorites,
        [realmAURL],
        'matrix service tracks the favorite',
      );
    });

    test('can unfavorite a workspace by clicking the star button again', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');

      await click(`[data-test-workspace-favorite-btn="${realmAURL}"]`);

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');
      assert.deepEqual(
        matrixService.workspaceFavorites,
        [],
        'favorite was removed from matrix service',
      );
    });

    test('can favorite a workspace via the context menu', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Favorite"]');

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');
    });

    test('the star button tooltip reflects the current favorite state', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let starButton = `[data-test-workspace-favorite-btn="${realmAURL}"]`;

      // Tooltip reveals its content on the wrapping trigger's mouseenter, not
      // the button's.
      let hoverStar = async () =>
        triggerEvent(
          document
            .querySelector(starButton)!
            .closest('[data-tooltip-trigger]')!,
          'mouseenter',
        );

      await hoverStar();
      assert
        .dom('[data-test-tooltip-content]')
        .hasText(
          'Add to Favorites',
          'an unfavorited workspace offers to add it',
        );

      await click(starButton);
      await hoverStar();
      assert
        .dom('[data-test-tooltip-content]')
        .hasText(
          'Remove from Favorites',
          'a favorited workspace offers to remove it',
        );
    });

    test('the star button is labelled for assistive tech', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let starButton = `[data-test-workspace-favorite-btn="${realmAURL}"]`;
      assert.dom(starButton).hasAttribute('aria-label', 'Add to Favorites');

      await click(starButton);
      assert
        .dom(starButton)
        .hasAttribute('aria-label', 'Remove from Favorites');
    });
  });

  // Only the enlarged favorite tiles carry a metadata row; the smaller Your
  // Workspaces tiles show name + visibility instead. The counts arrive
  // separately from the realm info, via `/_federated-index-counts`
  // (`RealmIndexCounts`), and are seeded here by `withIndexCounts` so a fixture
  // realm's incidental contents don't decide what the tile renders.
  module('favorite tile metadata', function () {
    // Favorites have to be set after the app boots — the matrix service is
    // reset during login, which would drop a pre-visit assignment.
    async function openChooserWithFavorite() {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();
      await waitFor('[data-test-favorites-list] [data-test-workspace]');
    }

    function favoriteStat(label: string) {
      return `[data-test-favorites-list] [data-test-workspace-stats="${realmAURL}"] [data-test-workspace-stat="${label}"]`;
    }

    test('renders Cards, Files and Definitions counts', async function (assert) {
      await openChooserWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      assert.dom(favoriteStat('Cards')).hasText('Cards 12');
      assert.dom(favoriteStat('Files')).hasText('Files 34');
      assert.dom(favoriteStat('Definitions')).hasText('Definitions 5');
      assert
        .dom(
          `[data-test-favorites-list] [data-test-workspace-stats="${realmAURL}"] [data-test-workspace-stat]`,
        )
        .exists({ count: 3 }, 'all three stats render');
    });

    test('omits a stat with no count rather than showing zero', async function (assert) {
      await openChooserWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 7,
        fileCount: 0,
        definitionCount: null,
      });
      await settled();

      assert.dom(favoriteStat('Cards')).hasText('Cards 7');
      assert
        .dom(favoriteStat('Files'))
        .doesNotExist('a zero count is dropped, not rendered as "Files 0"');
      assert
        .dom(favoriteStat('Definitions'))
        .doesNotExist('an unavailable count is dropped');
    });

    test('keeps the stats row present, and its height, before counts arrive', async function (assert) {
      // The row is rendered unconditionally so the numbers land in reserved
      // space instead of growing the tile. Measure the row before any counts
      // exist, then again once they do.
      await openChooserWithFavorite();

      let rowSelector = `[data-test-favorites-list] [data-test-workspace-stats="${realmAURL}"]`;
      assert
        .dom(rowSelector)
        .exists('the stats row is present before counts load');
      assert
        .dom(`${rowSelector} [data-test-workspace-stat]`)
        .doesNotExist('but renders no stats yet');

      let heightBefore = (
        document.querySelector(rowSelector) as HTMLElement
      ).getBoundingClientRect().height;
      assert.ok(
        heightBefore > 0,
        `the empty row still reserves height, got ${heightBefore}px`,
      );

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      let heightAfter = (
        document.querySelector(rowSelector) as HTMLElement
      ).getBoundingClientRect().height;
      assert.strictEqual(
        heightAfter,
        heightBefore,
        `the row does not grow when counts arrive (${heightBefore}px -> ${heightAfter}px)`,
      );
    });

    test('counts refresh after the realm re-indexes, without blanking first', async function (assert) {
      await openChooserWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();
      assert.dom(favoriteStat('Cards')).hasText('Cards 12');

      // Stand in for the realm server's answer changing after a write.
      let realmService = getService('realm') as any;
      let requestedRealms: string[][] = [];
      let realmServerService = getService('realm-server') as any;
      let originalFetch = realmServerService.fetchRealmIndexCounts;
      realmServerService.fetchRealmIndexCounts = async (urls: string[]) => {
        requestedRealms.push(urls);
        return [
          {
            id: realmAURL,
            attributes: { cardCount: 13, fileCount: 34, definitionCount: 5 },
          },
        ];
      };

      try {
        realmService.markIndexCountsStale(realmAURL);
        await settled();

        assert.deepEqual(
          requestedRealms,
          [[realmAURL]],
          'the stale realm is re-requested exactly once',
        );
        assert
          .dom(favoriteStat('Cards'))
          .hasText('Cards 13', 'the tile shows the refreshed count');
      } finally {
        realmServerService.fetchRealmIndexCounts = originalFetch;
      }
    });

    test('marking a realm stale keeps its previous counts visible', async function (assert) {
      await openChooserWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      // Hold the refetch open so we can observe the interim state: the tile must
      // keep the old numbers rather than emptying its row on every write.
      let realmServerService = getService('realm-server') as any;
      let originalFetch = realmServerService.fetchRealmIndexCounts;
      realmServerService.fetchRealmIndexCounts = () => new Promise(() => {});

      try {
        (getService('realm') as any).markIndexCountsStale(realmAURL);
        await settled();

        assert
          .dom(favoriteStat('Cards'))
          .hasText('Cards 12', 'stale counts stay on screen while refetching');
      } finally {
        realmServerService.fetchRealmIndexCounts = originalFetch;
      }
    });

    test('the metadata row is only on favorite tiles', async function (assert) {
      await openChooserWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      assert
        .dom(
          `[data-test-workspace-list] [data-test-workspace-stats="${realmAURL}"]`,
        )
        .doesNotExist('the Your Workspaces tile has no metadata row');
    });
  });

  module('tile order', function () {
    test('the New Workspace tile renders ahead of the workspace tiles', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let tiles = [
        ...document.querySelectorAll(
          '[data-test-workspace-list] [data-test-add-workspace], [data-test-workspace-list] [data-test-workspace]',
        ),
      ];
      assert.ok(
        tiles[0]?.hasAttribute('data-test-add-workspace'),
        'the first tile in Your Workspaces is the New Workspace tile',
      );
      assert.ok(tiles.length > 1, 'the workspace tiles render after it');
    });

    test('opening the chooser selects a workspace, not the New Workspace tile', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      // The selected tile takes focus, so landing on New Workspace would make
      // the first Enter create a workspace instead of opening one.
      assert
        .dom('[data-test-add-workspace-selected]')
        .doesNotExist('the New Workspace tile is not selected on open');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace-selected]')
        .exists({ count: 1 }, 'a workspace tile is selected instead');
    });
  });

  // Catalog ordering needs two catalog realms to compare. The environment's own
  // catalog realm URL is unset in tests, so stand up a pair of public realms
  // and have the realm-server mock advertise them as the catalogs.
  module('catalog ordering', function (hooks) {
    const catalogOneURL = 'http://test-realm/catalogs/one/';
    const catalogTwoURL = 'http://test-realm/catalogs/two/';

    hooks.beforeEach(async function () {
      for (let [realmURL, name] of [
        [catalogOneURL, 'Catalog One'],
        [catalogTwoURL, 'Catalog Two'],
      ]) {
        await setupAcceptanceTestRealm({
          realmURL,
          mockMatrixUtils,
          permissions: { '*': ['read'] },
          contents: {
            'realm.json': realmConfigCardJSON({ name }),
            'index.json': {
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: '@cardstack/base/cards-grid',
                    name: 'CardsGrid',
                  },
                },
              },
            },
          },
        });
      }
    });

    // Register the pair as catalogs on the realm-server service rather than
    // through the `/_catalog-realms` mock: `fetchCatalogRealms` early-returns
    // once any catalog is known, and `resetState()` deliberately carries
    // catalog realms across logins, so by this point the list is already
    // populated and a mock override would never be fetched.
    async function showAsCatalogs() {
      let realmServer = getService('realm-server') as any;
      for (let url of [catalogOneURL, catalogTwoURL]) {
        if (!realmServer.availableRealms.find((r: any) => r.url === url)) {
          realmServer.availableRealms.push({ type: 'catalog', url });
        }
      }
      await settled();
      await waitFor('[data-test-catalog-list] [data-test-workspace]');
    }

    // The skills realm is advertised as a catalog too; compare only the two
    // realms this module controls.
    function orderOfOurCatalogs(): string[] {
      return [
        ...document.querySelectorAll(
          '[data-test-catalog-list] [data-test-workspace]',
        ),
      ]
        .map((el) => el.getAttribute('data-test-workspace') ?? '')
        .filter((name) => name === 'Catalog One' || name === 'Catalog Two');
    }

    test('catalogs are ordered newest-created first', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await showAsCatalogs();

      let restoreOne = withUpdatedRealmInfo(catalogOneURL, {
        createdAt: '2024-01-01T00:00:00.000Z',
      });
      let restoreTwo = withUpdatedRealmInfo(catalogTwoURL, {
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await settled();

      assert.deepEqual(
        orderOfOurCatalogs(),
        ['Catalog Two', 'Catalog One'],
        'the more recently created catalog comes first',
      );

      restoreTwo();
      restoreOne();

      // Flip the dates: order must follow createdAt, not the order the realm
      // server happened to enumerate the catalogs in.
      restoreOne = withUpdatedRealmInfo(catalogOneURL, {
        createdAt: '2026-06-01T00:00:00.000Z',
      });
      restoreTwo = withUpdatedRealmInfo(catalogTwoURL, {
        createdAt: '2024-06-01T00:00:00.000Z',
      });
      await settled();

      assert.deepEqual(
        orderOfOurCatalogs(),
        ['Catalog One', 'Catalog Two'],
        'reversing the creation dates reverses the render order',
      );

      restoreTwo();
      restoreOne();
    });

    test('a catalog with no createdAt sorts after the dated ones', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await showAsCatalogs();

      let restoreOne = withUpdatedRealmInfo(catalogOneURL, {
        createdAt: null,
      });
      let restoreTwo = withUpdatedRealmInfo(catalogTwoURL, {
        createdAt: '2024-01-01T00:00:00.000Z',
      });
      await settled();

      assert.deepEqual(
        orderOfOurCatalogs(),
        ['Catalog Two', 'Catalog One'],
        'a realm with no creation date sorts after a dated one',
      );

      restoreTwo();
      restoreOne();
    });
  });

  module('workspace menu footer', function () {
    test('shows relative Updated and Created timestamps', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restore = withUpdatedRealmInfo(realmAURL, {
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });
      await settled();

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);

      assert
        .dom(`[data-test-workspace-menu-footer="${realmAURL}"]`)
        .includesText('Updated 5 min ago')
        .includesText('Created')
        .includesText('3 hrs ago');

      restore();
    });

    test('omits the footer when neither timestamp is known', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restore = withUpdatedRealmInfo(realmAURL, {
        createdAt: null,
        updatedAt: null,
      });
      await settled();

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);

      assert
        .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
        .exists('the menu itself is open');
      assert
        .dom(`[data-test-workspace-menu-footer="${realmAURL}"]`)
        .doesNotExist('no footer without a timestamp to show');

      restore();
    });
  });

  module('realm settings', function () {
    test('opens the realm config card in edit mode and closes the chooser', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Realm Settings"]');

      await waitFor(`[data-test-stack-card="${realmAURL}realm"]`);
      assert
        .dom('[data-test-workspace-chooser]')
        .doesNotExist('workspace chooser is dismissed');
      assert
        .dom(`[data-test-stack-card="${realmAURL}realm"]`)
        .exists('realm config card is opened on the stack');
    });
  });

  module('realm rename', function () {
    test('workspace name updates after a re-index without a browser reload', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(
          `[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]`,
        )
        .hasText('Workspace A', 'workspace shows its original name');

      // Rename the realm the same way a user would: edit the RealmConfig card
      // at realm.json. The resulting re-index broadcasts an index event that
      // should refresh the cached realm info reactively.
      await realmA.write(
        'realm.json',
        realmConfigCardJSON({ name: 'Renamed Workspace A' }),
      );
      await settled();

      assert
        .dom(
          `[data-test-workspace-list] [data-test-workspace="Renamed Workspace A"] [data-test-workspace-name]`,
        )
        .hasText(
          'Renamed Workspace A',
          'workspace label reflects the new name without a reload',
        );
      assert
        .dom(`[data-test-workspace-list] [data-test-workspace="Workspace A"]`)
        .doesNotExist('the stale workspace name is gone');
    });

    test('an unrelated card re-index preserves client-managed publish state', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(
          `[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]`,
        )
        .hasText('Workspace A');

      // publish()/unpublish() manage lastPublishedAt on the realm resource;
      // stand in for that here.
      let realmService = getService('realm') as any;
      let resource = realmService.realms.get(realmAURL);
      resource.info.lastPublishedAt = {
        'https://example.com/published/': '123',
      };

      // An incremental re-index of an unrelated card (the RealmConfig card is
      // NOT invalidated) must not refresh realm info — refetching _info there
      // would clobber the publish state the publish flow owns client-side.
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          realmAURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${realmAURL}index`],
          realmURL: realmAURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await settled();

      assert.deepEqual(
        realmService.info(realmAURL).lastPublishedAt,
        { 'https://example.com/published/': '123' },
        'publish state is preserved when an unrelated card is re-indexed',
      );
      assert
        .dom(
          `[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]`,
        )
        .hasText('Workspace A', 'realm name is unchanged');
    });
  });

  module('sort dropdown', function () {
    test('sort dropdown renders with View All as default', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.dom('[data-test-sort-dropdown-trigger]').includesText('View All');
    });

    test('can switch to Hosted Only filter', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-sort-dropdown-trigger]')
        .includesText('Hosted Only');
    });

    test('can switch back to View All filter', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-sort-dropdown-trigger]')
        .includesText('Hosted Only');

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="0"]');

      assert.dom('[data-test-sort-dropdown-trigger]').includesText('View All');
    });
  });

  module('hosted-only filtering', function () {
    test('hosted-only filter hides non-hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists();
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace B"]')
        .exists();

      // Make workspace A "hosted" by giving it lastPublishedAt
      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://published.example.com/': String(Date.now()),
        },
      });

      // Switch to hosted-only
      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists('hosted workspace remains visible');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace B"]')
        .doesNotExist('non-hosted workspace is hidden');

      restoreA();
    });

    test('hosted-only filter also applies to favorites', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL, realmBURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists();
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace B"]')
        .exists();

      // Make only workspace A hosted
      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://published.example.com/': String(Date.now()),
        },
      });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('hosted favorite remains visible');
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace B"]')
        .doesNotExist('non-hosted favorite is hidden');
      assert
        .dom('[data-test-favorites-empty]')
        .doesNotExist('empty message is not shown when some favorites match');

      restoreA();
    });

    test('shows "No matching results" when all favorites are filtered out', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists();

      // Switch to hosted-only — workspace A is not hosted
      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert.dom('[data-test-favorites-empty]').hasText('No matching results');
    });
  });

  module('delete menu item', function () {
    test('delete menu item opens the delete modal', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Delete Workspace"]');

      await waitFor(`[data-test-delete-modal="${realmAURL}"]`);
      assert.dom(`[data-test-delete-modal="${realmAURL}"]`).exists();
    });
  });

  module('long realm names', function () {
    test('workspace card stays constrained to icon-tile width when the name is long', async function (assert) {
      let longName =
        'A Workspace Name Long Enough To Wrap Onto Multiple Lines For Centering';

      let restoreA = withUpdatedRealmInfo(realmAURL, { name: longName });

      try {
        await visitOperatorMode({ workspaceChooserOpened: true });

        let cardSelector = `[data-test-workspace-list] [data-test-workspace="${longName}"]`;
        let nameSelector = `${cardSelector} [data-test-workspace-name]`;

        // Wait for the chooser to render the card with its full long name
        // text, rather than relying on `settled()` alone — measuring layout
        // before the name has rendered is a known source of flakiness.
        await waitUntil(
          () =>
            document.querySelector(nameSelector)?.textContent?.trim() ===
            longName,
          {
            timeoutMessage:
              'workspace-name element did not render the full long realm name',
          },
        );

        assert
          .dom(cardSelector)
          .exists('workspace card renders with the long realm name');
        assert
          .dom(nameSelector)
          .hasText(
            longName,
            'name element renders the full long name in the DOM',
          );

        let cardEl = document.querySelector(cardSelector) as HTMLElement | null;
        assert.ok(cardEl, 'workspace-card element is present in the DOM');

        // ItemContainer (.workspace button) is hard-pinned to
        // var(--boxel-xxs-container) (250px) in item-container.gts. With the
        // .info > .name 2-line clamp + text-wrap: wrap, the widest child of
        // .workspace-card is the tile, so the column's fit-content width
        // resolves to 250px. Reading the resolved CSS width (rather than
        // comparing two laid-out flex boxes via offsetWidth) is deterministic
        // and doesn't depend on subpixel/flex layout timing.
        let cardWidth = cardEl
          ? parseFloat(window.getComputedStyle(cardEl).width)
          : NaN;
        assert.strictEqual(
          cardWidth,
          250,
          `workspace-card resolves to the tile width (250px) regardless of name length; got ${cardWidth}px`,
        );
      } finally {
        restoreA();
      }
    });
  });

  module('keyboard navigation', function () {
    const urlByName: Record<string, string> = {
      'Workspace A': realmAURL,
      'Workspace B': realmBURL,
    };

    // Workspace names rendered as cards, in DOM (selection) order.
    function orderedWorkspaceNames(): string[] {
      return [
        ...document.querySelectorAll(
          '[data-test-workspace-chooser] [data-test-workspace]',
        ),
      ].map((el) => el.getAttribute('data-test-workspace') ?? '');
    }

    // Keyboard navigation is driven from the focused tile, and the chooser's
    // keydown handler intentionally ignores keys that don't originate from a
    // tile. Fire on the active element so tests exercise the real path.
    async function pressKey(key: string) {
      await triggerKeyEvent(
        document.activeElement as Element,
        'keydown',
        key as any,
      );
    }

    test('the first workspace is selected and focused when the chooser opens', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first] = orderedWorkspaceNames();
      assert
        .dom('[data-test-workspace-selected]')
        .exists({ count: 1 }, 'exactly one workspace is selected');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('the first workspace is the selected one');
      assert
        .dom(`[data-test-workspace-button="${first}"]`)
        .isFocused('the selected workspace button receives focus');
    });

    test('left/right arrows step through the sequence, including the New Workspace tile', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first, second] = orderedWorkspaceNames();

      await pressKey('ArrowRight');
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .exists('ArrowRight selects the next workspace');
      assert.dom('[data-test-workspace-selected]').exists({ count: 1 });

      await pressKey('ArrowLeft');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('ArrowLeft returns to the first workspace');

      // The New Workspace tile renders ahead of the workspace tiles, so it sits
      // to the *left* of the first workspace in the navigation sequence.
      await pressKey('ArrowLeft');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('ArrowLeft reaches the New Workspace tile');
      assert
        .dom('[data-test-workspace-selected]')
        .doesNotExist('no workspace card is selected while New Workspace is');

      await pressKey('ArrowLeft');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('ArrowLeft at the start stays on the New Workspace tile');

      await pressKey('ArrowRight');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('ArrowRight leaves the New Workspace tile');
    });

    test('up/down arrows move vertically between rows', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      // Favoriting a workspace puts a Favorites row directly above the
      // Your Workspaces row, so up/down can cross between them.
      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();
      await waitFor(
        '[data-test-favorites-list] [data-test-workspace-selected]',
      );

      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('the favorited workspace (top row) starts selected');

      // ArrowDown leaves the Favorites row and lands somewhere in the row
      // below (Your Workspaces). The exact tile depends on column alignment,
      // so assert the row, not a specific tile.
      await pressKey('ArrowDown');
      assert
        .dom('[data-test-favorites-list] [data-test-workspace-selected]')
        .doesNotExist('ArrowDown moves the selection out of the Favorites row');
      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace-selected], [data-test-workspace-list] [data-test-add-workspace-selected]',
        )
        .exists('ArrowDown moves the selection into the Your Workspaces row');

      await pressKey('ArrowUp');
      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('ArrowUp moves the selection back up into the Favorites row');
    });

    test('focusing a workspace selects it', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first, second] = orderedWorkspaceNames();
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('first workspace selected initially');

      await focus(`[data-test-workspace-button="${second}"]`);
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .exists('focusing the second workspace selects it');
      assert.dom('[data-test-workspace-selected]').exists({ count: 1 });
    });

    test('Enter opens the selected workspace', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first] = orderedWorkspaceNames();
      let firstURL = urlByName[first];

      await pressKey('Enter');

      await waitFor(`[data-test-stack-card="${firstURL}index"]`);
      assert
        .dom('[data-test-workspace-chooser]')
        .doesNotExist('chooser is dismissed after opening a workspace');
      assert
        .dom(`[data-test-stack-card="${firstURL}index"]`)
        .exists('the selected workspace is opened on the stack');
    });

    test('Enter on the New Workspace tile opens the create-workspace modal', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      // The New Workspace tile sits immediately left of the first workspace.
      await pressKey('ArrowLeft');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('the New Workspace tile is selected');

      await pressKey('Enter');

      await waitFor('[data-test-create-workspace-modal]');
      assert
        .dom('[data-test-create-workspace-modal]')
        .exists('Enter opens the create-workspace modal');
      // The same Enter must not also submit the form: the modal stays on its
      // input fields rather than flipping to the "Creating workspace..." state.
      assert
        .dom('[data-test-display-name-field]')
        .exists('the modal shows its form rather than submitting on open');
    });

    test('right arrow advances past the last workspace into the catalog section', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      // This configuration shows catalog workspaces, so the last user workspace
      // is not the last selectable item.
      assert
        .dom('[data-test-catalog-list]')
        .exists('catalogs are shown in this configuration');

      let [, second] = orderedWorkspaceNames();
      await pressKey('ArrowRight'); // second user workspace — the last of them
      assert
        .dom(`[data-test-workspace-list] [data-test-workspace-selected]`)
        .exists('reached the last workspace in Your Workspaces');

      await pressKey('ArrowRight'); // into the catalog section
      assert
        .dom(`[data-test-workspace-list] [data-test-workspace-selected]`)
        .doesNotExist(
          'ArrowRight advances out of Your Workspaces into the catalogs',
        );
      assert
        .dom('[data-test-catalog-list] [data-test-workspace-selected]')
        .exists('the selection lands on a catalog tile');
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .doesNotExist('the last user workspace is no longer selected');
    });

    test('keys originating from a non-tile control are ignored', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first] = orderedWorkspaceNames();
      let firstURL = urlByName[first];

      // Focus a control inside the chooser that isn't a navigable tile.
      let favoriteBtn = `[data-test-workspace-favorite-btn="${firstURL}"]`;
      await focus(favoriteBtn);

      // Arrow keys here must not drive tile navigation...
      await triggerKeyEvent(favoriteBtn, 'keydown', 'ArrowRight');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists(
          'ArrowRight from a non-tile control does not move the selection',
        );

      // ...and Enter must not open the selected workspace.
      await triggerKeyEvent(favoriteBtn, 'keydown', 'Enter');
      assert
        .dom('[data-test-workspace-chooser]')
        .exists('Enter from a non-tile control does not open a workspace');
      assert
        .dom(`[data-test-stack-card="${firstURL}index"]`)
        .doesNotExist('no workspace was opened');
    });
  });

  module('hosted overlay', function () {
    test('host trigger is not shown for non-hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(`[data-test-host-trigger="${realmAURL}"]`)
        .doesNotExist('no host trigger for non-hosted workspace');
    });

    test('host trigger appears for hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://my-site.example.com/': String(Date.now()),
        },
      });

      await settled();

      assert
        .dom(`[data-test-host-trigger="${realmAURL}"]`)
        .exists('host trigger is rendered');
      assert
        .dom(`[data-test-host-trigger="${realmAURL}"] .trigger-url`)
        .hasText('my-site.example.com');

      restoreA();
    });

    test('clicking host trigger opens dropdown with published URLs', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://site-one.example.com/': String(Date.now()),
          'https://site-two.example.com/': String(Date.now() - 1000),
        },
      });

      await settled();

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .doesNotExist('dropdown not visible initially');

      await click(`[data-test-host-trigger="${realmAURL}"]`);

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .exists('dropdown is open');
      assert
        .dom(
          `[data-test-host-dropdown="${realmAURL}"] [data-test-host-dropdown-option]`,
        )
        .exists({ count: 2 }, 'shows both published URLs');

      restoreA();
    });

    test('dropdown closes on mouseleave', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://my-site.example.com/': String(Date.now()),
        },
      });

      await settled();

      await click(`[data-test-host-trigger="${realmAURL}"]`);
      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .exists('dropdown is open');

      // Trigger mouseleave on the workspace card
      let card = document
        .querySelector(`[data-test-host-trigger="${realmAURL}"]`)
        ?.closest('.workspace-card');
      if (card) {
        card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
      await settled();

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .doesNotExist('dropdown closed on mouseleave');

      restoreA();
    });
  });

  // Each tile fills in its realm session and metadata from a background load
  // started in the component constructor. Nothing awaits that load, and
  // ember-concurrency rethrows an unconsumed task instance's error globally:
  // an escaping rejection lands as `Global error: Uncaught TypeError: Failed
  // to fetch` against whichever test happens to be running, which is not
  // necessarily the one whose tile failed. `suspendGlobalErrorHook` collects
  // what would otherwise be that global failure so it can be asserted on.
  module('background tile loads', function (hooks) {
    let { capturedExceptions } = suspendGlobalErrorHook(hooks);

    test('a rejected realm load does not surface as a global error', async function (assert) {
      let realmService = getService('realm') as any;
      let originalLogin = realmService.login.bind(realmService);
      realmService.login = async (realmURL: string) => {
        if (realmURL === realmAURL) {
          // What a realm-server round trip rejects with when the connection
          // fails outright rather than answering an error status.
          throw new TypeError('Failed to fetch');
        }
        return originalLogin(realmURL);
      };

      try {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await settled();
      } finally {
        realmService.login = originalLogin;
      }

      assert.deepEqual(
        capturedExceptions.map((error) => String(error)),
        [],
        'the rejected load raised nothing globally',
      );
      assert
        .dom('[data-test-workspace-list] [data-test-workspace]')
        .exists('the chooser still renders its workspace tiles');
    });
  });
});
