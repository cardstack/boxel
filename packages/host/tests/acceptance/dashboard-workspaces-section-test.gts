import {
  click,
  find,
  findAll,
  focus,
  settled,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import pluralize from 'pluralize';
import { module, test } from 'qunit';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';

import {
  setupAcceptanceTestRealm,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import {
  realmURL,
  clickScopeOption,
  markHosted,
  markUpdated,
  descriptionOf,
  pressKey,
  sectionOrder,
  railOrder,
  setupDashboardTest,
  operatorModeState,
} from '../helpers/dashboard';
import { TEST_CLOCK_INSTANT } from '../helpers/test-clock';
import { stubWindowOpen } from '../helpers/window-open';

const RECENT_TILES = '[data-test-workspace-recent-list] [data-test-workspace]';

const ROWS = '[data-test-workspace-rows] [data-test-workspace]';

const TOGGLE = '[data-test-workspace-list-toggle]';

function workspaceNames(selector: string) {
  return findAll(selector).map((el) => el.getAttribute('data-test-workspace'));
}

function columnCount(selector: string) {
  let grid = find(selector);
  if (!grid) {
    throw new Error(`no grid at ${selector}`);
  }
  return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
}

function selectedName() {
  return find('[data-test-workspace-selected]')?.getAttribute(
    'data-test-workspace-selected',
  );
}

// Wholly inside the dashboard's scroller and the window.
function isInView(el: Element) {
  let { top, bottom } = el.getBoundingClientRect();
  let scroller = find(
    '[data-test-dashboard-scroller]',
  )!.getBoundingClientRect();
  // Half a pixel of slack, since layout can leave an edge a fraction past.
  return (
    top >= Math.max(scroller.top, 0) - 0.5 &&
    bottom <= Math.min(scroller.bottom, window.innerHeight) + 0.5
  );
}

function ringName() {
  return find('[data-test-workspace-ring]')?.getAttribute(
    'data-test-workspace-ring',
  );
}

module('Acceptance | dashboard workspaces section', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks);

  let moreRealmURLs: string[] = [];
  let testingRoot: HTMLElement | null;
  let originalWidth = '';

  // Adds `count` workspaces beside Workspace A, and narrows the dashboard
  // to `width`, which sets the columns the tiles and rows lay out in. Each
  // workspace is a realm, so a module adds no more than its tests need.
  function setupWorkspaces(hooks: NestedHooks, count: number, width: string) {
    hooks.beforeEach(async function () {
      moreRealmURLs = Array.from(
        { length: count },
        (_, i) => `http://test-realm/testuser/workspace-${i + 1}/`,
      );
      for (let [i, url] of moreRealmURLs.entries()) {
        await setupAcceptanceTestRealm({
          realmURL: url,
          mockMatrixUtils,
          permissions: {
            '@testuser:localhost': ['read', 'write', 'realm-owner'],
          },
          contents: {
            'realm.json': realmConfigCardJSON({
              name: `Workspace ${String(i + 1).padStart(2, '0')}`,
            }),
          },
        });
      }
      mockMatrixUtils.setActiveRealms([realmURL, ...moreRealmURLs]);
      testingRoot = document.querySelector<HTMLElement>('#ember-testing');
      originalWidth = testingRoot?.style.width ?? '';
      testingRoot?.style.setProperty('width', width);
    });

    hooks.afterEach(function () {
      testingRoot?.style.setProperty('width', originalWidth);
    });
  }

  function urlFor(name: string) {
    let index = moreRealmURLs.findIndex(
      (_, i) => name === `Workspace ${String(i + 1).padStart(2, '0')}`,
    );
    if (index < 0) {
      throw new Error(`no fixture workspace named ${name}`);
    }
    return moreRealmURLs[index];
  }

  async function visitDashboard(assert: Assert, columns: number) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await settled();
    assert.strictEqual(
      columnCount('[data-test-workspace-recent-list]'),
      columns,
      `the recent tiles lay out in ${pluralize('column', columns, true)}`,
    );
    assert.strictEqual(
      columnCount('[data-test-workspace-rows]'),
      columns,
      `the rows lay out in ${pluralize('column', columns, true)}`,
    );
  }

  // One column, so ten grid rows of rows overflow with a small fixture:
  // New Workspace and 2 tiles, then 10 rows, then 3 more.
  module('more rows than are shown', function (hooks) {
    setupWorkspaces(hooks, 14, '20rem');

    test('recent workspaces fill three grid rows with New Workspace, and the rest are rows', async function (assert) {
      await visitDashboard(assert, 1);

      assert
        .dom('[data-test-workspace-recent-list] [data-test-add-workspace]')
        .exists();
      assert.dom(RECENT_TILES).exists({ count: 2 });
      assert
        .dom(`${RECENT_TILES}[data-test-workspace-variant="tile"]`)
        .exists({ count: 2 });
      assert
        .dom(`${ROWS}[data-test-workspace-variant="row"]`)
        .exists({ count: 10 }, 'ten grid rows of rows are shown');
      let shown = new Set([
        ...workspaceNames(RECENT_TILES),
        ...workspaceNames(ROWS),
      ]);
      assert.strictEqual(shown.size, 12, 'no workspace is shown twice');
    });

    test('choosing Workspaces in the section rail brings the page back to its top', async function (assert) {
      await visitDashboard(assert, 1);
      let scroller = find('[data-test-dashboard-scroller]') as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
      await triggerEvent(scroller, 'scroll');
      assert.true(scroller.scrollTop > 0, 'the page is scrolled down');

      await click('[data-test-section-rail-entry="workspaces"]');
      // A smooth scroll this long takes over a second.
      await waitUntil(() => scroller.scrollTop === 0, { timeout: 3000 });

      assert.strictEqual(scroller.scrollTop, 0, 'the page is at its top');
      assert
        .dom('[data-test-section-rail-entry="workspaces"]')
        .hasAttribute('aria-current', 'location');
    });

    test('Show N more shows the rest of the rows, and Show fewer hides them again', async function (assert) {
      await visitDashboard(assert, 1);

      assert
        .dom(TOGGLE)
        .hasText('Show 3 more')
        .hasAttribute('aria-expanded', 'false');
      assert
        .dom(ROWS)
        .exists({ count: 10 }, 'the hidden rows are not rendered');

      await click(TOGGLE);

      assert.dom(ROWS).exists({ count: 13 });
      assert
        .dom(TOGGLE)
        .hasText('Show fewer')
        .hasAttribute('aria-expanded', 'true')
        .isFocused('focus stays on the button');

      await click(TOGGLE);

      assert.dom(ROWS).exists({ count: 10 });
      assert.dom(TOGGLE).hasText('Show 3 more').isFocused();
    });

    test('changing the filter hides the extra rows again', async function (assert) {
      await visitDashboard(assert, 1);
      await click(TOGGLE);
      assert.dom(ROWS).exists({ count: 13 });

      await clickScopeOption('hosted');
      await clickScopeOption('all');

      assert.dom(ROWS).exists({ count: 10 });
      assert.dom(TOGGLE).hasText('Show 3 more');
    });

    test('reopened over a workspace in the hidden rows, every row is shown and the cursor rests on it without focus', async function (assert) {
      await visitDashboard(assert, 1);
      await click(TOGGLE);
      let hiddenName = workspaceNames(ROWS).at(-1)!;
      await click(`[data-test-workspace-button="${hiddenName}"]`);
      assert.dom('[data-test-dashboard]').doesNotExist();

      await click('[data-test-workspace-chooser-toggle]');

      assert.dom(ROWS).exists({ count: 13 });
      assert.dom(TOGGLE).hasText('Show fewer');
      assert.strictEqual(selectedName(), hiddenName);
      assert
        .dom(`[data-test-workspace-button="${hiddenName}"]`)
        .isNotFocused('focus out of view would hand Enter to a hidden row');
      let scroller = find('[data-test-dashboard-scroller]') as HTMLElement;
      let row = find(
        `[data-test-workspace-button="${hiddenName}"]`,
      ) as HTMLElement;
      assert.true(
        row.getBoundingClientRect().top >
          scroller.getBoundingClientRect().bottom,
        'the row is below the fold',
      );
      assert.strictEqual(
        scroller.scrollTop,
        0,
        'the page opens at its top, not scrolled to the cursor',
      );
      assert
        .dom('[data-test-dashboard]')
        .isFocused('the dashboard holds focus for the arrow keys');

      await pressKey('Enter');
      assert
        .dom('[data-test-dashboard]')
        .exists('Enter does not open a row nobody can see');

      await pressKey('ArrowRight');

      assert.true(
        scroller.scrollTop > 0,
        'the first arrow key brings the cursor into view',
      );
      assert.dom(`[data-test-workspace-button="${hiddenName}"]`).isFocused();
      assert.strictEqual(selectedName(), hiddenName);
      assert
        .dom('[data-test-dashboard]')
        .doesNotHaveAttribute(
          'tabindex',
          'once focus leaves it, a click on the page cannot focus it',
        );
    });

    test('reopened over a hidden row, Enter after scrolling to it shows and focuses it rather than opening it', async function (assert) {
      await visitDashboard(assert, 1);
      await click(TOGGLE);
      let hiddenName = workspaceNames(ROWS).at(-1)!;
      await click(`[data-test-workspace-button="${hiddenName}"]`);
      await click('[data-test-workspace-chooser-toggle]');
      assert.dom('[data-test-dashboard]').isFocused();

      let row = find(
        `[data-test-workspace-button="${hiddenName}"]`,
      ) as HTMLElement;
      row.scrollIntoView({ block: 'nearest' });
      assert.true(isInView(row), 'the row is scrolled into view');

      await pressKey('Enter');

      assert.dom('[data-test-dashboard]').exists('nothing opens');
      assert.dom(row).isFocused();
      assert.strictEqual(ringName(), hiddenName, 'the ring marks it');
    });

    test('Right from the last row shown moves past the hidden rows', async function (assert) {
      await visitDashboard(assert, 1);
      let rows = workspaceNames(ROWS);
      await focus(`[data-test-workspace-button="${rows.at(-1)}"]`);
      await pressKey('ArrowRight');
      assert.strictEqual(ringName(), rows.at(-1));

      await pressKey('ArrowRight');

      assert
        .dom('[data-test-catalog-list] [data-test-workspace-selected]')
        .exists('the cursor moves on to the catalogs');
    });
  });

  module('three workspaces of their own', function (hooks) {
    setupWorkspaces(hooks, 2, '40rem');

    test('Workspaces comes first, and Catalogs follows them', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.deepEqual(sectionOrder(), ['workspaces', 'catalogs', 'agents']);
      assert.deepEqual(
        railOrder(),
        ['workspaces', 'catalogs', 'agents'],
        'the rail follows the page',
      );
    });
  });

  // Two columns: New Workspace and 5 tiles, then 2 grid rows of rows. The
  // width leaves room for two rows beside the section rail's column.
  module('a few rows', function (hooks) {
    setupWorkspaces(hooks, 8, '40rem');

    test('the most recently updated workspaces are the tiles', async function (assert) {
      await visitDashboard(assert, 2);

      let rowName = workspaceNames(ROWS)
        .filter((name) => name !== 'Workspace A')
        .at(-1)!;
      let tileNames = workspaceNames(RECENT_TILES);
      markUpdated(urlFor(rowName), new Date(TEST_CLOCK_INSTANT));
      await settled();

      assert.strictEqual(
        workspaceNames(RECENT_TILES)[0],
        rowName,
        'the workspace updated last leads the tiles',
      );
      assert.deepEqual(
        workspaceNames(RECENT_TILES).slice(1),
        tileNames.slice(0, 4),
        'the other tiles follow in order',
      );
      assert.notOk(
        workspaceNames(ROWS).includes(rowName),
        'it is no longer a row',
      );
      assert.notOk(
        workspaceNames(RECENT_TILES).includes(tileNames[4]),
        'the last tile goes back to the rows',
      );
    });

    test('Enter on a row opens that workspace', async function (assert) {
      await visitDashboard(assert, 2);
      let rowName = workspaceNames(ROWS)[2]!;

      await focus(`[data-test-workspace-button="${rowName}"]`);
      await pressKey('Enter');

      assert.dom('[data-test-dashboard]').doesNotExist();
      let operatorModeStateService = operatorModeState();
      assert.strictEqual(
        (getService('realm') as any).info(operatorModeStateService.realmURL)
          .name,
        rowName,
      );
    });

    test("a click on a row's visibility chip opens that workspace, as anywhere on the row does", async function (assert) {
      await visitDashboard(assert, 2);
      let rowName = workspaceNames(ROWS).find(
        (name) => name !== 'Workspace A',
      )!;

      // The chip takes no click of its own: the pointer reaches the row's
      // hit area over it, so the test clicks whatever is hit there.
      let chip = find(
        `[data-test-workspace="${rowName}"] [data-test-workspace-visibility]`,
      )!;
      chip.scrollIntoView({ block: 'center' });
      let box = chip.getBoundingClientRect();
      let target = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      if (!(target instanceof HTMLElement)) {
        throw new Error('no element is hit over the visibility chip');
      }
      assert
        .dom(target)
        .hasAttribute(
          'data-test-workspace-button',
          rowName,
          "the row's button receives the pointer over its chip",
        );

      await click(target);

      assert.dom('[data-test-dashboard]').doesNotExist();
      assert.strictEqual(operatorModeState().realmURL, urlFor(rowName));
    });

    test("each star's tooltip opens into its tile or row", async function (assert) {
      await visitDashboard(assert, 2);
      let workspaces = [
        ...findAll(RECENT_TILES),
        ...findAll(ROWS),
      ] as HTMLElement[];
      assert.true(
        workspaces.some(
          (el) => el.getAttribute('data-test-workspace-variant') === 'tile',
        ),
        'tiles are shown',
      );
      assert.true(
        workspaces.some(
          (el) => el.getAttribute('data-test-workspace-variant') === 'row',
        ),
        'rows are shown',
      );
      for (let workspace of workspaces) {
        let name = workspace.getAttribute('data-test-workspace');
        let isRow =
          workspace.getAttribute('data-test-workspace-variant') === 'row';
        let star = workspace.querySelector<HTMLElement>(
          '[data-test-workspace-favorite-btn]',
        );
        let wrap = star?.closest<HTMLElement>('[data-test-pretui-tooltip]');
        let tip = wrap?.querySelector<HTMLElement>(
          '[data-test-pretui-tooltip-bubble]',
        );
        assert.ok(tip, `${name}'s star has a tooltip`);
        if (!star || !wrap || !tip) {
          continue;
        }
        await triggerEvent(wrap, 'mouseenter');
        assert.true(tip.matches(':popover-open'), `${name}'s tip is shown`);
        // The tip is in the top layer, outside the test container's
        // scaling, so it's measured against the star, not the workspace.
        let starBox = star.getBoundingClientRect();
        let tipBox = tip.getBoundingClientRect();
        if (isRow) {
          assert.true(
            tipBox.right <= starBox.left,
            `${name}'s tip opens left, into the row`,
          );
        } else {
          assert.true(
            tipBox.left >= starBox.right,
            `${name}'s tip opens right, into the tile`,
          );
        }
        await triggerEvent(wrap, 'mouseleave');
      }
    });

    test("a hosted row's globe opens the same site menu as a tile's chin", async function (assert) {
      await visitDashboard(assert, 2);
      let rowName = workspaceNames(ROWS).find(
        (name) => name !== 'Workspace A',
      )!;
      let now = TEST_CLOCK_INSTANT;
      markHosted(urlFor(rowName), {
        'https://older.example.com/': String(now - 60_000),
        'https://newer.example.com/': String(now),
      });
      await settled();

      let row = `${ROWS}[data-test-workspace="${rowName}"]`;
      let menuItems = `${row} [data-test-pretui-menu-panel] [role="menuitem"]`;
      assert.dom(`${row}[data-test-workspace-variant="row"]`).exists();
      assert
        .dom(`${row} [data-test-host-trigger]`)
        .hasAttribute('aria-label', 'Hosted at newer.example.com');
      assert.dom(menuItems).doesNotExist('the menu starts closed');

      let windowOpen = stubWindowOpen(window);
      try {
        await click(`${row} [data-test-host-trigger]`);

        assert.deepEqual(
          findAll(menuItems).map((item) => item.textContent?.trim()),
          ['newer.example.com', 'older.example.com'],
          'every published site is listed, most recently published first',
        );

        await click(findAll(menuItems)[1]);

        assert.deepEqual(windowOpen.calls, [
          {
            url: 'https://older.example.com/',
            target: '_blank',
            features: 'noopener,noreferrer',
          },
        ]);
      } finally {
        windowOpen.restore();
      }
      assert
        .dom('[data-test-dashboard]')
        .exists('choosing a site does not open the workspace');
    });

    test("a row's button is described by its full visibility, its update time and its address", async function (assert) {
      await visitDashboard(assert, 2);
      let hour = 60 * 60 * 1000;
      for (let [i, url] of [realmURL, ...moreRealmURLs].entries()) {
        markUpdated(url, new Date(TEST_CLOCK_INSTANT - (i + 1) * hour));
      }
      await settled();
      let rowName = workspaceNames(ROWS).at(-1)!;
      assert.strictEqual(
        rowName,
        'Workspace 08',
        'the last row is the workspace updated 9 hours ago',
      );
      assert
        .dom(
          `[data-test-workspace-rows] [data-test-workspace="${rowName}"] [data-test-workspace-updated]`,
        )
        .includesText('9 hrs ago', 'the row shows the short form');

      let description = descriptionOf(
        `[data-test-workspace-button="${rowName}"]`,
      );
      assert.deepEqual(
        description,
        [
          'Private workspace',
          'Updated 9 hours ago',
          'test-realm/testuser/workspace-8',
        ],
        'the full visibility and the time in words, not only the chip and the short time',
      );
    });

    test("a tile's button is described by its full visibility and its address", async function (assert) {
      await visitDashboard(assert, 2);
      let tileName = workspaceNames(RECENT_TILES).find(
        (name) => name !== 'Workspace A',
      )!;

      let description = descriptionOf(
        `[data-test-workspace-button="${tileName}"]`,
      );
      assert.deepEqual(description, [
        'Private workspace',
        urlFor(tileName).replace(/^http:\/\/|\/$/g, ''),
      ]);
    });

    module('keyboard cursor', function () {
      test('reopened, the cursor rests on the workspace just left, with no ring', async function (assert) {
        await visitDashboard(assert, 2);
        // A workspace below the fold reopens without focus, so this one
        // must be in view.
        let workspace = findAll(`${RECENT_TILES}, ${ROWS}`).find(isInView);
        assert.ok(workspace, 'a workspace is in view');
        let name = workspace!.getAttribute('data-test-workspace')!;
        await click(`[data-test-workspace-button="${name}"]`);
        assert.dom('[data-test-dashboard]').doesNotExist();

        await click('[data-test-workspace-chooser-toggle]');

        assert.strictEqual(selectedName(), name);
        assert
          .dom(`[data-test-workspace-button="${name}"]`)
          .isFocused('the workspace holds focus, so Enter works at once');
        assert.strictEqual(ringName(), undefined, 'no ring shows');
      });

      test('opened with nothing open, the cursor rests on the first favorite, not the default workspace', async function (assert) {
        let favoriteName = 'Workspace 03';
        mockMatrixUtils.setWorkspaceFavorites([urlFor(favoriteName)]);
        await visitDashboard(assert, 2);
        assert.notStrictEqual(
          (getService('realm') as RealmService).defaultReadableRealm.info.name,
          favoriteName,
        );

        assert.strictEqual(selectedName(), favoriteName);
        let favorite = `[data-test-favorites-list] [data-test-workspace-button="${favoriteName}"]`;
        assert.true(isInView(find(favorite)!), 'the favorite is in view');
        assert.dom(favorite).isFocused('Enter works at once');
      });

      test('a favorite added while the dashboard is open takes the cursor', async function (assert) {
        await visitDashboard(assert, 2);
        let defaultName = (getService('realm') as RealmService)
          .defaultReadableRealm.info.name;
        let favoriteName = workspaceNames(ROWS).find(
          (name) => name !== defaultName,
        )!;
        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [urlFor(favoriteName)];
        await settled();

        assert.strictEqual(selectedName(), favoriteName);
        assert
          .dom(
            `[data-test-favorites-list] [data-test-workspace-button="${favoriteName}"]`,
          )
          .isFocused();
      });

      test('the first arrow key shows the ring without moving the cursor, and a pointer press hides it', async function (assert) {
        await visitDashboard(assert, 2);
        let tileName = workspaceNames(RECENT_TILES)[2]!;
        await focus(`[data-test-workspace-button="${tileName}"]`);
        assert.strictEqual(ringName(), undefined);

        await pressKey('ArrowRight');
        assert.strictEqual(ringName(), tileName);

        await pressKey('ArrowRight');
        assert.strictEqual(
          ringName(),
          workspaceNames(RECENT_TILES)[3],
          'the next arrow key moves it',
        );

        await triggerEvent('[data-test-dashboard-greeting]', 'pointerup');
        assert.strictEqual(ringName(), undefined);
      });

      test('Down moves from the recent tiles into the rows below, and Up comes back the same way', async function (assert) {
        await visitDashboard(assert, 2);
        // New Workspace leads the tiles, so the third grid row starts with
        // the fourth tile.
        let tiles = workspaceNames(RECENT_TILES);
        let rows = workspaceNames(ROWS);
        await focus(`[data-test-workspace-button="${tiles[3]}"]`);
        await pressKey('ArrowDown');
        assert.strictEqual(ringName(), tiles[3]);

        await pressKey('ArrowDown');
        assert.strictEqual(ringName(), rows[0], 'onto the first row');

        await pressKey('ArrowDown');
        assert.strictEqual(ringName(), rows[2], 'down the same column');

        await pressKey('ArrowRight');
        assert.strictEqual(ringName(), rows[3], 'across the grid row');

        await pressKey('ArrowUp');
        assert.strictEqual(ringName(), rows[1]);

        await pressKey('ArrowUp');
        assert.strictEqual(ringName(), tiles[4], 'back onto the tiles');
        assert.dom(`[data-test-workspace-button="${tiles[4]}"]`).isFocused();
      });

      test('the cursor stays on its workspace when a favorite adds a desk ahead of it', async function (assert) {
        await visitDashboard(assert, 2);
        let tileName = workspaceNames(RECENT_TILES)[2]!;
        await focus(`[data-test-workspace-button="${tileName}"]`);
        await pressKey('ArrowRight');
        assert.strictEqual(ringName(), tileName);

        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [realmURL];
        await settled();

        assert
          .dom('[data-test-favorites-list] [data-test-workspace]')
          .exists({ count: 1 });
        assert.dom('[data-test-workspace-ring]').exists({ count: 1 });
        assert.strictEqual(ringName(), tileName);
      });

      test('when Hosted hides the workspace under the cursor, the cursor moves to the one that takes its place', async function (assert) {
        await visitDashboard(assert, 2);
        let tiles = workspaceNames(RECENT_TILES);
        // New Workspace leads the walk, so the third tile is at index 3.
        await focus(`[data-test-workspace-button="${tiles[2]}"]`);
        assert.strictEqual(selectedName(), tiles[2]);

        for (let name of [tiles[0], tiles[1], tiles[3], tiles[4]]) {
          markHosted(name === 'Workspace A' ? realmURL : urlFor(name!));
        }
        await settled();
        await clickScopeOption('hosted');

        assert.deepEqual(
          workspaceNames(RECENT_TILES),
          [tiles[0], tiles[1], tiles[3], tiles[4]],
          'only the hosted workspaces are shown',
        );
        assert.dom('[data-test-workspace-selected]').exists({ count: 1 });
        assert.strictEqual(
          selectedName(),
          tiles[3],
          'the cursor holds its place in the walk',
        );
      });

      test('favoriting the workspace the cursor opened on keeps the cursor on it', async function (assert) {
        await visitDashboard(assert, 2);
        let name = selectedName()!;
        await focus(
          `[data-test-workspace="${name}"] [data-test-workspace-favorite-btn]`,
        );

        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [
          name === 'Workspace A' ? realmURL : urlFor(name),
        ];
        await settled();

        assert
          .dom('[data-test-favorites-list] [data-test-workspace]')
          .exists({ count: 1 });
        assert.dom('[data-test-workspace-selected]').exists({ count: 1 });
        assert
          .dom('[data-test-workspace-list] [data-test-workspace-selected]')
          .exists('the cursor stays in Your Workspaces, not on the new desk');
      });

      test("focusing a workspace's star moves the cursor to that workspace", async function (assert) {
        await visitDashboard(assert, 2);
        let [first, , third] = workspaceNames(RECENT_TILES);
        await focus(`[data-test-workspace-button="${first}"]`);
        await pressKey('ArrowRight');
        assert.strictEqual(ringName(), first);

        await focus(
          `[data-test-workspace="${third}"] [data-test-workspace-favorite-btn]`,
        );

        assert.strictEqual(selectedName(), third);
        assert.dom('[data-test-workspace-ring]').exists({ count: 1 });
        assert.strictEqual(ringName(), third);
      });
    });
  });
});
