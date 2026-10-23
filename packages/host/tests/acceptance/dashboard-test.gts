import {
  click,
  find,
  findAll,
  focus,
  settled,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupFeatureFlag } from '../helpers/feature-flags';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  getRealmServerRoute,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { setupApplicationTest } from '../helpers/setup';

const realmURL = 'http://test-realm/testuser/workspace-a/';

// Clicks the option's visible label, as a user does; the radio inside it is
// visually hidden.
async function clickScopeOption(value: 'all' | 'hosted') {
  let radio = find(
    `[data-test-dashboard-filter] [data-test-pretui-segmented-option="${value}"]`,
  );
  let label = radio?.closest('label');
  if (!label) {
    throw new Error(`no label for the ${value} scope option`);
  }
  await click(label);
}

// Publishing is what makes a workspace hosted.
function markHosted(url: string) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    lastPublishedAt: { 'https://published.example.com/': String(Date.now()) },
  });
}

// A write to a workspace is what moves its update time.
function markUpdated(url: string, updatedAt: Date) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    updatedAt: updatedAt.toISOString(),
  });
}

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

function ringName() {
  return find('[data-test-workspace-ring]')?.getAttribute(
    'data-test-workspace-ring',
  );
}

async function pressKey(key: string) {
  let target = document.activeElement;
  if (!(target instanceof HTMLElement)) {
    throw new Error('nothing has focus');
  }
  await triggerKeyEvent(target, 'keydown', key);
}

module('Acceptance | dashboard', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    displayName: 'Ada Lovelace',
    activeRealms: [realmURL],
    dashboardState: {
      agent: 'codex',
      agentSetup: { codex: 2 },
    },
  });

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();
    await setupAcceptanceTestRealm({
      realmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
      },
    });
  });

  module('state', function (hooks) {
    setupFeatureFlag(hooks, 'DASHBOARD_V2');

    test('loads the stored state at login', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        agent: 'codex',
        agentSetup: { codex: 2 },
      });
    });

    test('a failed read at login leaves the state empty', async function (assert) {
      mockMatrixUtils.setDashboardStateReadError(new Error('server down'));
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {});
      assert.dom('[data-test-dashboard]').exists('login still completes');
    });

    test('drops stored fields that do not match the current shape', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        onboardingDismissed: 'yes',
        agent: 'clippy',
        agentSetup: { claude: 2, clippy: 5, codex: -1, grok: 1.5 },
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        agentSetup: { claude: 2 },
      });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agentSetup: { clippy: 5 },
      });
      await settled();
      assert.deepEqual(
        matrixService.dashboardState,
        {},
        'agentSetup with no valid entry is dropped like any other invalid field',
      );
    });

    test('follows writes made in another tab', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        onboardingDismissed: true,
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        onboardingDismissed: true,
      });
    });

    test('a write keeps stored fields, including ones this app does not know', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'grok',
        agentSetup: { grok: 3 },
        futureField: 'kept',
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.updateDashboardState({ onboardingDismissed: true });

      assert.deepEqual(
        mockMatrixUtils.getDashboardState(),
        {
          agent: 'grok',
          agentSetup: { grok: 3 },
          futureField: 'kept',
          onboardingDismissed: true,
        },
        'the stored copy keeps the other write, including fields this app does not know',
      );
      assert.deepEqual(matrixService.dashboardState, {
        onboardingDismissed: true,
        agent: 'grok',
        agentSetup: { grok: 3 },
      });
    });

    test('overlapping writes from one tab all land', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let bump = (stored: typeof matrixService.dashboardState) => ({
        agentSetup: {
          ...stored.agentSetup,
          claude: (stored.agentSetup?.claude ?? 0) + 1,
        },
      });
      await Promise.all([
        matrixService.updateDashboardState(bump),
        matrixService.updateDashboardState(bump),
        matrixService.updateDashboardState({ agent: 'claude' }),
        matrixService.updateDashboardState(bump),
      ]);

      assert.deepEqual(matrixService.dashboardState.agentSetup, {
        codex: 2,
        claude: 3,
      });
      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert.deepEqual(
        (mockMatrixUtils.getDashboardState() as any).agentSetup,
        { codex: 2, claude: 3 },
        'the stored copy has every write',
      );
    });

    test("setting one agent's progress keeps the other agents'", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agentSetup: { codex: 2, gemini: 4 },
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.updateDashboardState({ agentSetup: { claude: 1 } });

      assert.deepEqual(
        (mockMatrixUtils.getDashboardState() as any).agentSetup,
        { codex: 2, gemini: 4, claude: 1 },
        'the stored copy keeps every agent, including ones this app does not know',
      );
      assert.deepEqual(matrixService.dashboardState.agentSetup, {
        codex: 2,
        claude: 1,
      });
    });

    test("an earlier write's late echo does not revert a later write", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      mockMatrixUtils.holdDashboardEchoes();
      await matrixService.updateDashboardState({ agentSetup: { claude: 1 } });
      await matrixService.updateDashboardState({ agentSetup: { claude: 2 } });
      assert.strictEqual(matrixService.dashboardState.agentSetup?.claude, 2);

      await mockMatrixUtils.releaseDashboardEcho(0);
      assert.strictEqual(
        matrixService.dashboardState.agentSetup?.claude,
        2,
        'the first write echoing after the second is ignored',
      );

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agentSetup: { claude: 2, grok: 1 },
      });
      await settled();
      assert.deepEqual(
        matrixService.dashboardState.agentSetup,
        { claude: 2, grok: 1 },
        "another tab's write, stored before the second write, applies while an echo is pending",
      );

      await mockMatrixUtils.releaseDashboardEcho(1);
      assert.deepEqual(
        matrixService.dashboardState.agentSetup,
        { codex: 2, claude: 2 },
        "the second write's echo applies, since the server stored it last",
      );
    });

    test('a failed write does not block later writes', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let failed = matrixService.updateDashboardState(() => {
        throw new Error('boom');
      });
      let next = matrixService.updateDashboardState({ agent: 'boxel' });

      await assert.rejects(failed, /boom/);
      await next;
      assert.strictEqual(matrixService.dashboardState.agent, 'boxel');
    });

    test('a write queued before logout does not reach the next session', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let write = matrixService.updateDashboardState({ agent: 'claude' });
      // Not awaited first: logout tears down the session synchronously, while
      // the write is still waiting on its read.
      let logout = matrixService.logout();
      await write;
      await logout;

      assert.deepEqual(matrixService.dashboardState, {});
      assert.strictEqual(
        (mockMatrixUtils.getDashboardState() as any).agent,
        'codex',
      );
    });
  });

  module('feature flag off', function () {
    test('the workspace chooser opens', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.dom('[data-test-workspace-chooser]').exists();
      assert.dom('[data-test-dashboard]').doesNotExist();
    });

    test('the stored state is not read at login', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {});
    });
  });

  module('feature flag on', function (hooks) {
    setupFeatureFlag(hooks, 'DASHBOARD_V2');

    test('the dashboard opens in place of the workspace chooser', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      assert.dom('[data-test-dashboard]').exists();
      assert.dom('[data-test-workspace-chooser]').doesNotExist();
    });

    test('greets the user by first name', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await settled();

      assert
        .dom('[data-test-dashboard-greeting]')
        .hasText(/^Good (morning|afternoon|evening), Ada$/);
    });

    test('shows the Workspaces, Catalogs and Agents sections in order', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let sections = [
        ...document.querySelectorAll('[data-test-dashboard-section]'),
      ].map((section) => section.getAttribute('data-test-dashboard-section'));
      assert.deepEqual(sections, ['workspaces', 'catalogs', 'agents']);
      assert
        .dom('[data-test-dashboard-section="workspaces"] h2')
        .hasText('Workspaces');
      assert
        .dom('[data-test-dashboard-section="catalogs"] h2')
        .includesText('Catalogs');
      assert.dom('[data-test-dashboard-section="agents"] h2').hasText('Agents');
    });

    test('the Workspaces section holds favorites, your workspaces and archived', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let workspaces = '[data-test-dashboard-section="workspaces"]';
      assert.dom(`${workspaces} [data-test-favorites-section]`).exists();
      assert
        .dom(
          `${workspaces} [data-test-workspace-list] [data-test-add-workspace]`,
        )
        .exists();
      assert
        .dom(
          `${workspaces} [data-test-workspace-list] [data-test-workspace="Workspace A"]`,
        )
        .exists();
      assert.dom(`${workspaces} [data-test-archived-section]`).exists();
    });

    test('a failed archived list says so and can be retried', async function (assert) {
      let archivedRoute = getRealmServerRoute(
        new URL('http://test-realm/_archived-realms'),
      );
      if (!archivedRoute) {
        throw new Error('no default archived-realms route');
      }
      registerRealmServerRoute({
        path: '/_archived-realms',
        handler: async () => new Response(null, { status: 500 }),
      });
      try {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await click(
          '[data-test-archived-section] [data-test-pretui-collapsible-trigger]',
        );
      } finally {
        registerRealmServerRoute(archivedRoute);
      }

      assert.dom('[data-test-archived-error]').exists();
      assert.dom('[data-test-archived-empty]').doesNotExist();

      await click('[data-test-archived-retry]');

      assert.dom('[data-test-archived-error]').doesNotExist();
      assert.dom('[data-test-archived-empty]').exists();
    });

    test('Enter opens the selected workspace', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-workspace-selected="Workspace A"]')
        .exists('the first workspace is selected on open');
      await triggerKeyEvent(
        '[data-test-workspace-button="Workspace A"]',
        'keydown',
        'Enter',
      );

      assert.dom('[data-test-dashboard]').doesNotExist();
      assert.strictEqual(
        (getService('operator-mode-state-service') as OperatorModeStateService)
          .realmURL,
        realmURL,
        'Workspace A is the open workspace',
      );
    });

    test('All is selected by default', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(
          '[data-test-dashboard-filter] [data-test-pretui-segmented-option="all"]',
        )
        .isChecked();
      assert
        .dom(
          '[data-test-dashboard-filter] [data-test-pretui-segmented-option="hosted"]',
        )
        .isNotChecked();
    });

    test('Hosted keeps only hosted workspaces in Favorites, Your Workspaces and Catalogs', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [realmURL];
      await settled();

      await clickScopeOption('hosted');

      assert
        .dom(
          '[data-test-dashboard-filter] [data-test-pretui-segmented-option="hosted"]',
        )
        .isChecked();
      assert
        .dom(
          '[data-test-dashboard-filter] [data-test-pretui-segmented-option="all"]',
        )
        .isNotChecked();
      assert.dom('[data-test-favorites-empty]').hasText('No matching results');
      assert.dom('[data-test-workspaces-empty]').hasText('No matching results');
      assert.dom('[data-test-catalog-empty]').hasText('No matching results');

      markHosted(realmURL);
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('a hosted favorite stays');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists('a hosted workspace stays');
    });

    test('a favorite that is no longer listed counts as no favorites under either filter', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [
        'http://test-realm/testuser/archived-workspace/',
      ];
      await settled();

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');

      await clickScopeOption('hosted');

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');
    });

    test('All brings back the workspaces Hosted hid', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await clickScopeOption('hosted');
      assert.dom('[data-test-workspaces-empty]').exists();

      await clickScopeOption('all');
      assert.dom('[data-test-workspaces-empty]').doesNotExist();
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists();
    });

    module('workspaces', function (hooks) {
      // With Workspace A, enough for the recent tiles, ten grid rows of rows
      // and a few more, at two columns.
      const moreRealmURLs = Array.from(
        { length: 27 },
        (_, i) => `http://test-realm/testuser/workspace-${i + 1}/`,
      );
      let testingRoot: HTMLElement | null;
      let originalWidth = '';

      hooks.beforeEach(async function () {
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
        // Narrow enough for two columns of tiles and of rows, so a small
        // fixture fills the recent tiles and overflows the rows.
        testingRoot = document.querySelector<HTMLElement>('#ember-testing');
        originalWidth = testingRoot?.style.width ?? '';
        testingRoot?.style.setProperty('width', '37rem');
      });

      hooks.afterEach(function () {
        testingRoot?.style.setProperty('width', originalWidth);
      });

      function urlFor(name: string) {
        let index = moreRealmURLs.findIndex(
          (_, i) => name === `Workspace ${String(i + 1).padStart(2, '0')}`,
        );
        if (index < 0) {
          throw new Error(`no fixture workspace named ${name}`);
        }
        return moreRealmURLs[index];
      }

      async function visitDashboard(assert: Assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await settled();
        assert.strictEqual(
          columnCount('[data-test-workspace-recent-list]'),
          2,
          'the recent tiles lay out in two columns',
        );
        assert.strictEqual(
          columnCount('[data-test-workspace-rows]'),
          2,
          'the rows lay out in two columns',
        );
      }

      test('recent workspaces fill three grid rows beside New Workspace, and the rest are rows', async function (assert) {
        await visitDashboard(assert);

        assert
          .dom('[data-test-workspace-recent-list] [data-test-add-workspace]')
          .exists();
        assert.dom(RECENT_TILES).exists({ count: 5 });
        assert
          .dom(`${RECENT_TILES}[data-test-workspace-variant="tile"]`)
          .exists({ count: 5 });
        assert
          .dom(`${ROWS}[data-test-workspace-variant="row"]`)
          .exists({ count: 20 }, 'ten grid rows of rows are shown');
        let shown = new Set([
          ...workspaceNames(RECENT_TILES),
          ...workspaceNames(ROWS),
        ]);
        assert.strictEqual(shown.size, 25, 'no workspace is shown twice');
      });

      test('the most recently updated workspaces are the tiles', async function (assert) {
        await visitDashboard(assert);

        let rowName = workspaceNames(ROWS)
          .filter((name) => name !== 'Workspace A')
          .at(-1)!;
        let tileNames = workspaceNames(RECENT_TILES);
        markUpdated(urlFor(rowName), new Date());
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

      test('Show N more shows the rest of the rows, and Show fewer hides them again', async function (assert) {
        await visitDashboard(assert);

        assert
          .dom(TOGGLE)
          .hasText('Show 3 more')
          .hasAttribute('aria-expanded', 'false');
        assert
          .dom(ROWS)
          .exists({ count: 20 }, 'the hidden rows are not rendered');

        await click(TOGGLE);

        assert.dom(ROWS).exists({ count: 23 });
        assert
          .dom(TOGGLE)
          .hasText('Show fewer')
          .hasAttribute('aria-expanded', 'true')
          .isFocused('focus stays on the button');

        await click(TOGGLE);

        assert.dom(ROWS).exists({ count: 20 });
        assert.dom(TOGGLE).hasText('Show 3 more').isFocused();
      });

      test('changing the filter hides the extra rows again', async function (assert) {
        await visitDashboard(assert);
        await click(TOGGLE);
        assert.dom(ROWS).exists({ count: 23 });

        await clickScopeOption('hosted');
        await clickScopeOption('all');

        assert.dom(ROWS).exists({ count: 20 });
        assert.dom(TOGGLE).hasText('Show 3 more');
      });

      test('Enter on a row opens that workspace', async function (assert) {
        await visitDashboard(assert);
        let rowName = workspaceNames(ROWS)[2]!;

        await focus(`[data-test-workspace-button="${rowName}"]`);
        await pressKey('Enter');

        assert.dom('[data-test-dashboard]').doesNotExist();
        let operatorModeStateService = getService(
          'operator-mode-state-service',
        ) as OperatorModeStateService;
        assert.strictEqual(
          (getService('realm') as any).info(operatorModeStateService.realmURL)
            .name,
          rowName,
        );
      });

      module('keyboard cursor', function () {
        test('reopened, the cursor rests on the workspace just left, with no ring', async function (assert) {
          await visitDashboard(assert);
          let rowName = workspaceNames(ROWS)[6]!;
          await click(`[data-test-workspace-button="${rowName}"]`);
          assert.dom('[data-test-dashboard]').doesNotExist();

          (
            getService(
              'operator-mode-state-service',
            ) as OperatorModeStateService
          ).openWorkspaceChooser();
          await settled();

          assert.strictEqual(selectedName(), rowName);
          assert
            .dom(`[data-test-workspace-button="${rowName}"]`)
            .isFocused('the workspace holds focus, so Enter works at once');
          assert.strictEqual(ringName(), undefined, 'no ring shows');
        });

        test('the first arrow key shows the ring without moving the cursor, and a pointer press hides it', async function (assert) {
          await visitDashboard(assert);
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
          await visitDashboard(assert);
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
          await visitDashboard(assert);
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

        test("focusing a workspace's star moves the cursor to that workspace", async function (assert) {
          await visitDashboard(assert);
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

        test('Right from the last row shown moves past the hidden rows', async function (assert) {
          await visitDashboard(assert);
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
    });
  });
});
