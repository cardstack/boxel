import {
  click,
  find,
  findAll,
  focus,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import { ri, testRealmInfo } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  APP_BOXEL_CATALOG_REALMS_EVENT_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupPublicReadableRealms,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupFeatureFlag } from '../helpers/feature-flags';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { suspendGlobalErrorHook } from '../helpers/uncaught-exceptions';

const realmAURL = 'http://test-realm/testuser/workspace-a/';
const realmBURL = 'http://test-realm/testuser/workspace-b/';

const cardsGridIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      },
    },
  },
};

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

// A desk's counts load from `/_federated-index-counts` into a tracked map on
// the realm service, keyed by realm URL. Seeding the map directly keeps the
// assertions independent of a fixture realm's incidental contents.
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

async function pressKey(key: string) {
  let target = document.activeElement;
  if (!(target instanceof HTMLElement)) {
    throw new Error('nothing has focus');
  }
  await triggerKeyEvent(target, 'keydown', key);
}

module('Acceptance | dashboard workspace', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);
  setupFeatureFlag(hooks, 'DASHBOARD_V2');

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [realmAURL, realmBURL],
  });

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
        'index.json': cardsGridIndex,
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
        'index.json': cardsGridIndex,
      },
    });
    realmA = realm;
  });

  test('Favorite in the options menu adds the workspace to Favorites', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    assert.dom('[data-test-dashboard]').exists();

    await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
    await click('[data-test-boxel-menu-item-text="Favorite"]');

    assert
      .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
      .exists('the workspace shows in Favorites');
    assert.deepEqual(
      (getService('matrix-service') as MatrixService).workspaceFavorites,
      [realmAURL],
      'the favorite is saved',
    );
  });

  // Only desks show counts; tiles and rows show the name and visibility
  // instead.
  module('desk counts', function () {
    // Favorites are set after the app boots: logging in resets the matrix
    // service, which would drop an earlier assignment.
    async function openDashboardWithFavorite() {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();
      await waitFor('[data-test-favorites-list] [data-test-workspace]');
    }

    const STATS = `[data-test-favorites-list] [data-test-workspace-stats="${realmAURL}"]`;

    function deskStat(label: string) {
      return `${STATS} [data-test-workspace-stat="${label}"]`;
    }

    test('a desk shows its Cards, Files and Definitions counts', async function (assert) {
      await openDashboardWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      assert.dom(deskStat('Cards')).hasText('Cards 12');
      assert.dom(deskStat('Files')).hasText('Files 34');
      assert.dom(deskStat('Definitions')).hasText('Definitions 5');
      assert
        .dom(`${STATS} [data-test-workspace-stat]`)
        .exists({ count: 3 }, 'all three counts show, and no pin count');
    });

    test('a desk leaves out a count of zero or one that is unknown', async function (assert) {
      await openDashboardWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 7,
        fileCount: 0,
        definitionCount: null,
      });
      await settled();

      assert.dom(deskStat('Cards')).hasText('Cards 7');
      assert
        .dom(deskStat('Files'))
        .doesNotExist('a zero count is left out, not shown as "Files 0"');
      assert
        .dom(deskStat('Definitions'))
        .doesNotExist('an unknown count is left out');
    });

    test("a desk's counts fill space kept for them, without changing its height", async function (assert) {
      await openDashboardWithFavorite();

      assert.dom(STATS).exists('the counts line is there before they load');
      assert
        .dom(`${STATS} [data-test-workspace-stat]`)
        .doesNotExist('but shows no counts yet');

      let heightBefore = find(STATS)!.getBoundingClientRect().height;
      assert.ok(
        heightBefore > 0,
        `the empty line still keeps its height, got ${heightBefore}px`,
      );

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      let heightAfter = find(STATS)!.getBoundingClientRect().height;
      assert.strictEqual(
        heightAfter,
        heightBefore,
        `the line does not grow when the counts arrive (${heightBefore}px -> ${heightAfter}px)`,
      );
    });

    test("a desk's counts refresh after the realm re-indexes, without blanking first", async function (assert) {
      await openDashboardWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();
      assert.dom(deskStat('Cards')).hasText('Cards 12');

      // Stands in for the realm server's answer changing after a write.
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
          'the stale realm is requested again exactly once',
        );
        assert
          .dom(deskStat('Cards'))
          .hasText('Cards 13', 'the desk shows the refreshed count');
      } finally {
        realmServerService.fetchRealmIndexCounts = originalFetch;
      }
    });

    test('a desk keeps its previous counts while they are fetched again', async function (assert) {
      await openDashboardWithFavorite();

      withIndexCounts(realmAURL, {
        cardCount: 12,
        fileCount: 34,
        definitionCount: 5,
      });
      await settled();

      // Holds the fetch open, so the counts in the meantime can be seen.
      let realmServerService = getService('realm-server') as any;
      let originalFetch = realmServerService.fetchRealmIndexCounts;
      let fetches = 0;
      realmServerService.fetchRealmIndexCounts = () => {
        fetches++;
        return new Promise(() => {});
      };

      try {
        (getService('realm') as any).markIndexCountsStale(realmAURL);
        await settled();

        assert.strictEqual(fetches, 1, 'the counts are being fetched again');
        assert
          .dom(deskStat('Cards'))
          .hasText('Cards 12', 'the previous counts stay while fetching');
      } finally {
        realmServerService.fetchRealmIndexCounts = originalFetch;
      }
    });

    test('only desks show counts', async function (assert) {
      await openDashboardWithFavorite();

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
        .doesNotExist('the Your Workspaces tile shows no counts');
    });
  });

  // Ordering needs two catalogs to compare. The environment's own catalog
  // realm URL is unset in tests, so a pair of public realms stand in for the
  // catalogs.
  module('catalog order', function (hooks) {
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
            'index.json': cardsGridIndex,
          },
        });
      }
    });

    // Listed as catalogs on the realm-server service rather than through the
    // `/_catalog-realms` mock: `fetchCatalogRealms` returns early once any
    // catalog is known, and `resetState()` keeps catalog realms across
    // logins, so a mock override would never be fetched.
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

    // The skills realm is listed as a catalog too; only the two realms this
    // module controls are compared.
    function orderOfOurCatalogs(): string[] {
      return findAll('[data-test-catalog-list] [data-test-workspace]')
        .map((el) => el.getAttribute('data-test-workspace') ?? '')
        .filter((name) => name === 'Catalog One' || name === 'Catalog Two');
    }

    test('catalogs are ordered newest created first', async function (assert) {
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

      // Swapped dates: the order follows createdAt, not the order the realm
      // server listed the catalogs in.
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
        'swapping the creation dates swaps the order',
      );

      restoreTwo();
      restoreOne();
    });

    test('a catalog with no creation date comes after the dated ones', async function (assert) {
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
        'a realm with no creation date comes after a dated one',
      );

      restoreTwo();
      restoreOne();
    });
  });

  module('choosing catalogs', function (hooks) {
    const publicGalleryURL = 'http://test-realm/someone-else/public-gallery/';
    const GALLERY_CATALOG =
      '[data-test-catalog-list] [data-test-workspace="Public Gallery"]';

    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        realmURL: publicGalleryURL,
        mockMatrixUtils,
        permissions: { '*': ['read'] },
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Public Gallery' }),
          'index.json': cardsGridIndex,
        },
      });
      // Workspace A is public too, but it's one of the user's own realms, so
      // the picker must not offer it.
      setupPublicReadableRealms([
        { url: publicGalleryURL, name: 'Public Gallery' },
        { url: realmAURL, name: 'Workspace A' },
      ]);
    });

    // The picker's own checkbox for a realm's row.
    function realmCheckbox(url: string) {
      return `[data-test-pretui-list-row]:has([data-test-public-realm="${url}"]) [data-test-pretui-list-select]`;
    }

    async function storedCatalogRealms() {
      let matrixService = getService('matrix-service') as MatrixService;
      let content = (await (
        matrixService as any
      ).client.getAccountDataFromServer(
        APP_BOXEL_CATALOG_REALMS_EVENT_TYPE,
      )) as { realms: string[] } | null;
      return content?.realms ?? [];
    }

    test('a public realm can be added to Catalogs', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      assert
        .dom(GALLERY_CATALOG)
        .doesNotExist('the public realm is not a catalog to begin with');

      await click('[data-test-manage-catalogs]');
      await waitFor(`[data-test-public-realm="${publicGalleryURL}"]`);
      assert
        .dom(`[data-test-public-realm="${realmAURL}"]`)
        .doesNotExist("a realm of the user's own is not offered");
      assert.dom(realmCheckbox(publicGalleryURL)).isNotChecked();

      await click(realmCheckbox(publicGalleryURL));
      assert.dom(realmCheckbox(publicGalleryURL)).isChecked();
      await click('[data-test-save-manage-catalogs]');

      assert.dom('[data-test-manage-catalogs-error]').doesNotExist();
      assert.dom('[data-test-manage-catalogs-modal]').doesNotExist();
      await waitFor(GALLERY_CATALOG);
      assert.dom(GALLERY_CATALOG).exists('the chosen realm shows in Catalogs');
      assert.deepEqual(
        await storedCatalogRealms(),
        [publicGalleryURL],
        'the choice is saved to the account data',
      );
    });

    test('a public realm the user added can be taken out of Catalogs', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.setUserCatalogRealms([publicGalleryURL]);
      await waitFor(GALLERY_CATALOG);

      await click('[data-test-manage-catalogs]');
      await waitFor(`[data-test-public-realm="${publicGalleryURL}"]`);
      assert
        .dom(realmCheckbox(publicGalleryURL))
        .isChecked('the realm the user added is checked');

      // A click anywhere on the row toggles it, like its checkbox.
      await click(`[data-test-public-realm="${publicGalleryURL}"]`);
      assert.dom(realmCheckbox(publicGalleryURL)).isNotChecked();
      await click('[data-test-save-manage-catalogs]');

      assert
        .dom(GALLERY_CATALOG)
        .doesNotExist('the realm is gone from Catalogs');
      assert.deepEqual(await storedCatalogRealms(), []);
      let realmServer = getService('realm-server') as RealmServerService;
      assert.deepEqual(realmServer.userCatalogRealmIdentifiers, []);
    });

    test('canceling the catalog picker changes nothing', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await click('[data-test-manage-catalogs]');
      await waitFor(`[data-test-public-realm="${publicGalleryURL}"]`);
      await click(realmCheckbox(publicGalleryURL));
      await click('[data-test-cancel-manage-catalogs]');

      assert.dom('[data-test-manage-catalogs-modal]').doesNotExist();
      assert.dom(GALLERY_CATALOG).doesNotExist();
      assert.deepEqual(await storedCatalogRealms(), []);
    });

    test('a pick another list shows survives a save and comes back when that list stops showing it', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let matrixService = getService('matrix-service') as MatrixService;
      let realmServer = getService('realm-server') as RealmServerService;
      await matrixService.setUserCatalogRealms([publicGalleryURL]);
      let ownRealms = realmServer.userRealmIdentifiers;

      // The realm is shared with the user, so Your Workspaces shows it.
      await realmServer.setAvailableRealmIdentifiers([
        ...ownRealms,
        ri(publicGalleryURL),
      ]);
      await settled();
      assert
        .dom(GALLERY_CATALOG)
        .doesNotExist('the realm is listed with the user’s own realms');

      await click('[data-test-manage-catalogs]');
      await waitFor('[data-test-public-realm-list]');
      assert
        .dom(`[data-test-public-realm="${publicGalleryURL}"]`)
        .doesNotExist('the picker does not offer it');
      await click('[data-test-save-manage-catalogs]');
      assert.deepEqual(
        await storedCatalogRealms(),
        [publicGalleryURL],
        'saving keeps the pick',
      );

      // The share is revoked.
      await realmServer.setAvailableRealmIdentifiers(ownRealms);
      await waitFor(GALLERY_CATALOG);
      assert.dom(GALLERY_CATALOG).exists('the pick is back in Catalogs');
    });

    test('a favorited public realm that no list shows becomes a catalog pick', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let matrixService = getService('matrix-service') as MatrixService;
      let unreachableURL = 'http://test-realm/someone-else/private/';
      matrixService.workspaceFavorites = [publicGalleryURL, unreachableURL];

      await matrixService.adoptUnlistedFavoritesAsCatalogs();

      assert.deepEqual(
        await storedCatalogRealms(),
        [publicGalleryURL],
        'only the public realm is added to the picks',
      );
      await waitFor(
        '[data-test-favorites-list] [data-test-workspace="Public Gallery"]',
      );
      assert.dom(GALLERY_CATALOG).exists('the realm shows in Catalogs');
      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace="Public Gallery"]',
        )
        .exists('and stays among the favorites');
    });

    test('an empty Catalogs section points at the gear', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let realmServer = getService('realm-server') as any;
      for (let i = realmServer.availableRealms.length - 1; i >= 0; i--) {
        if (realmServer.availableRealms[i].type === 'catalog') {
          realmServer.availableRealms.splice(i, 1);
        }
      }
      await settled();

      assert
        .dom('[data-test-catalog-empty]')
        .hasText('No catalogs yet. Add public realms with the gear.');
      assert.dom('[data-test-manage-catalogs]').exists();
    });
  });

  module('options menu footer', function () {
    test('shows when the workspace was updated and created, relative to now', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restore = withUpdatedRealmInfo(realmAURL, {
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });
      try {
        await settled();

        await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);

        assert
          .dom(`[data-test-workspace-menu-footer="${realmAURL}"]`)
          .includesText('Updated 5 min ago')
          .includesText('Created')
          .includesText('3 hrs ago');
      } finally {
        restore();
      }
    });

    test('is left out when neither time is known', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restore = withUpdatedRealmInfo(realmAURL, {
        createdAt: null,
        updatedAt: null,
      });
      try {
        await settled();

        await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);

        assert
          .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
          .exists('the menu itself is open');
        assert
          .dom(`[data-test-workspace-menu-footer="${realmAURL}"]`)
          .doesNotExist('no footer without a time to show');
      } finally {
        restore();
      }
    });
  });

  module('realm rename', function () {
    test("a workspace's new name shows after its re-index, without a reload", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]',
        )
        .hasText('Workspace A', 'the workspace shows its original name');

      // Renamed as a user would: by editing the RealmConfig card at
      // realm.json. The re-index that follows sends an index event, which
      // refreshes the realm info.
      await realmA.write(
        'realm.json',
        realmConfigCardJSON({ name: 'Renamed Workspace A' }),
      );
      await settled();

      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace="Renamed Workspace A"] [data-test-workspace-name]',
        )
        .hasText('Renamed Workspace A', 'the new name shows');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .doesNotExist('the old name is gone');
    });

    test("re-indexing an unrelated card keeps the workspace's publish state", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]',
        )
        .hasText('Workspace A');

      // Publishing and unpublishing set lastPublishedAt on the realm
      // resource; this stands in for them.
      let realmService = getService('realm') as any;
      let resource = realmService.realms.get(realmAURL);
      resource.info.lastPublishedAt = {
        'https://example.com/published/': '123',
      };

      // An incremental re-index that leaves the RealmConfig card alone must
      // not fetch the realm info again, which would overwrite the publish
      // state the publish flow keeps on the client.
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
        'the publish state is kept',
      );
      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-name]',
        )
        .hasText('Workspace A', 'the name is unchanged');
    });
  });

  module('realms with the same name', function () {
    async function hoverForRealmURL(section: string, realmURL: string) {
      let trigger = `${section} [data-test-realm-url-tooltip-trigger="${realmURL}"]`;
      await triggerEvent(trigger, 'mouseenter');
      let text = find('[data-test-realm-url-tooltip]')?.textContent?.trim();
      await triggerEvent(trigger, 'mouseleave');
      return text;
    }

    test('hovering a workspace icon shows its realm URL, so same-named workspaces can be told apart', async function (assert) {
      let restoreB = withUpdatedRealmInfo(realmBURL, { name: 'Workspace A' });
      try {
        await visitOperatorMode({ workspaceChooserOpened: true });

        assert
          .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
          .exists({ count: 2 });
        assert.strictEqual(
          await hoverForRealmURL('[data-test-workspace-list]', realmAURL),
          'test-realm/testuser/workspace-a',
        );
        assert.strictEqual(
          await hoverForRealmURL('[data-test-workspace-list]', realmBURL),
          'test-realm/testuser/workspace-b',
        );

        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [realmAURL, realmBURL];
        await settled();
        await waitFor('[data-test-favorites-list] [data-test-workspace]');

        assert.strictEqual(
          await hoverForRealmURL('[data-test-favorites-list]', realmBURL),
          'test-realm/testuser/workspace-b',
        );
      } finally {
        restoreB();
      }
    });

    test("a tile's button is named by its workspace, with the realm URL kept out of the name", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let button = find(
        '[data-test-workspace-list] [data-test-workspace-button="Workspace B"]',
      );
      assert.ok(button, 'the tile button renders');
      // Text inside a button joins its accessible name, so the URL must not
      // be in it, or the tile would no longer be found as "Workspace B".
      assert.notOk(
        button!.textContent?.includes('test-realm/testuser/workspace-b'),
        'the realm URL is not part of the button',
      );
      assert
        .dom('[role="img"]', button!)
        .hasAttribute('aria-label', 'Workspace B');
    });

    test('the delete and archive confirmations show the realm URL', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmBURL}"]`);
      await click('[data-test-boxel-menu-item-text="Delete Workspace"]');
      await waitFor(`[data-test-delete-modal="${realmBURL}"]`);
      assert
        .dom('[data-test-delete-modal-workspace-url]')
        .hasText('test-realm/testuser/workspace-b');
      await click('[data-test-cancel-delete-button]');

      await click(`[data-test-workspace-menu-trigger="${realmBURL}"]`);
      await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
      await waitFor('[data-test-archive-modal-workspace-url]');
      assert
        .dom('[data-test-archive-modal-workspace-url]')
        .hasText('test-realm/testuser/workspace-b');
    });
  });

  module('long realm names', function () {
    const longName =
      'A Workspace Name Long Enough To Run Well Past The Width Of Any Tile Or Desk';

    function widthOf(selector: string) {
      let el = find(selector);
      if (!el) {
        throw new Error(`nothing at ${selector}`);
      }
      return el.getBoundingClientRect().width;
    }

    test('a long name widens neither its tile nor its desk', async function (assert) {
      let restoreA = withUpdatedRealmInfo(realmAURL, { name: longName });
      try {
        await visitOperatorMode({ workspaceChooserOpened: true });
        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [realmAURL, realmBURL];
        await settled();
        await waitFor(
          `[data-test-favorites-list] [data-test-workspace="${longName}"]`,
        );

        for (let list of [
          '[data-test-workspace-list]',
          '[data-test-favorites-list]',
        ]) {
          let long = `${list} [data-test-workspace="${longName}"]`;
          let short = `${list} [data-test-workspace="Workspace B"]`;
          assert.ok(
            Math.abs(widthOf(long) - widthOf(short)) < 1,
            `in ${list}, the long-named workspace is as wide as its short-named neighbor`,
          );
          assert.ok(
            widthOf(`${long} [data-test-workspace-name]`) <= widthOf(long),
            `in ${list}, the name stays within its workspace`,
          );
        }
      } finally {
        restoreA();
      }
    });
  });

  module('keyboard', function () {
    test('with no favorites and nothing open, the first workspace takes focus on open', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let firstTile = find(
        '[data-test-workspace-recent-list] [data-test-workspace]',
      );
      assert.ok(firstTile, 'a workspace tile is shown');
      let name = firstTile!.getAttribute('data-test-workspace');
      assert
        .dom(
          `[data-test-workspace-recent-list] [data-test-workspace-selected="${name}"]`,
        )
        .exists('the first workspace is selected');
      assert
        .dom(
          `[data-test-workspace-recent-list] [data-test-workspace-button="${name}"]`,
        )
        .isFocused('the first workspace holds focus, so Enter works at once');
    });

    test('Enter on New Workspace opens the create-workspace form without submitting it', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      // New Workspace leads the recent tiles, right before the first one.
      let firstTile = find(
        '[data-test-workspace-recent-list] [data-test-workspace]',
      );
      assert.ok(firstTile, 'a workspace tile is shown');
      let name = firstTile!.getAttribute('data-test-workspace');

      await focus(
        `[data-test-workspace-recent-list] [data-test-workspace-button="${name}"]`,
      );
      // The first arrow key shows the cursor; the next moves it.
      await pressKey('ArrowLeft');
      await pressKey('ArrowLeft');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('New Workspace is selected');

      await pressKey('Enter');

      await waitFor('[data-test-create-workspace-modal]');
      assert
        .dom('[data-test-create-workspace-modal]')
        .exists('Enter opens the create-workspace modal');
      assert
        .dom('[data-test-display-name-field]')
        .exists('the modal shows its form rather than submitting on open');
    });

    test("keys from a workspace's own controls do not move the cursor or open the workspace", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let selected = find(
        '[data-test-workspace-list] [data-test-workspace-selected]',
      );
      assert.ok(selected, 'a workspace is selected on open');
      let name = selected!.getAttribute('data-test-workspace-selected')!;
      let star = `[data-test-workspace-list] [data-test-workspace="${name}"] [data-test-workspace-favorite-btn]`;

      await focus(star);
      await triggerKeyEvent(star, 'keydown', 'ArrowRight');
      await triggerKeyEvent(star, 'keydown', 'ArrowRight');
      assert
        .dom(`[data-test-workspace-selected="${name}"]`)
        .exists('arrow keys from the star do not move the cursor');

      await triggerKeyEvent(star, 'keydown', 'Enter');
      assert
        .dom('[data-test-dashboard]')
        .exists('Enter from the star does not open a workspace');
      assert.true(
        (getService('operator-mode-state-service') as OperatorModeStateService)
          .workspaceChooserOpened,
        'the dashboard stays open',
      );
    });
  });

  test('a workspace that is not hosted has no site menu', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .exists();
    assert
      .dom(`[data-test-host-trigger="${realmAURL}"]`)
      .doesNotExist('no site menu on a workspace that is not hosted');
  });

  // Each workspace fills in its realm session and metadata from a background
  // load that nothing awaits. An unconsumed ember-concurrency task error is
  // reported through `Ember.onerror`, or thrown from a run-loop timer, so an
  // escaping rejection would fail whichever test happens to be running.
  // `suspendGlobalErrorHook` collects what would be that global failure so it
  // can be asserted on.
  module('background workspace loads', function (hooks) {
    let { capturedExceptions } = suspendGlobalErrorHook(hooks);

    test('a rejected realm load does not surface as a global error', async function (assert) {
      let realmService = getService('realm') as any;
      let originalLogin = realmService.login.bind(realmService);
      let rejectedLoads = 0;
      realmService.login = async (realmURL: string) => {
        if (realmURL === realmAURL) {
          rejectedLoads++;
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

      // An empty capture proves nothing unless the load it stands for ran.
      assert.ok(
        rejectedLoads > 0,
        `the workspace's realm load ran and rejected, ${rejectedLoads} time(s)`,
      );
      assert.deepEqual(
        capturedExceptions.map((error) => String(error)),
        [],
        'the rejected load raised nothing globally',
      );
      assert
        .dom('[data-test-workspace-list] [data-test-workspace]')
        .exists('the dashboard still shows its workspaces');
    });
  });
});
