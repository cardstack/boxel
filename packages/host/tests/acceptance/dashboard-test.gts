import {
  click,
  find,
  findAll,
  focus,
  rerender,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import pluralize from 'pluralize';
import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import { Deferred } from '@cardstack/runtime-common';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

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
function markHosted(
  url: string,
  lastPublishedAt: Record<string, string> = {
    'https://published.example.com/': String(Date.now()),
  },
) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    lastPublishedAt,
  });
}

// Records window.open calls instead of opening windows, until restored.
function stubWindowOpen() {
  let original = window.open;
  let calls: Parameters<typeof window.open>[] = [];
  window.open = ((...args: Parameters<typeof window.open>) => {
    calls.push(args);
    return null;
  }) as typeof window.open;
  return {
    calls,
    restore() {
      window.open = original;
    },
  };
}

// Records what is copied instead of writing the clipboard, until restored.
// With `fail` set, a copy is refused, as a browser does without permission.
function stubClipboard() {
  let clipboard = navigator.clipboard;
  let stub = {
    copied: [] as string[],
    fail: false,
    restore() {
      delete (clipboard as { writeText?: unknown }).writeText;
    },
  };
  clipboard.writeText = async (text: string) => {
    if (stub.fail) {
      throw new Error('clipboard refused');
    }
    stub.copied.push(text);
  };
  return stub;
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

function operatorModeState() {
  return getService('operator-mode-state-service') as OperatorModeStateService;
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

    test("a desk's name opens its workspace", async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [realmURL];
      await settled();

      await click(
        '[data-test-favorites-list] [data-test-workspace-button="Workspace A"]',
      );

      assert.dom('[data-test-dashboard]').doesNotExist();
      assert.strictEqual(
        (getService('operator-mode-state-service') as OperatorModeStateService)
          .realmURL,
        realmURL,
        'Workspace A is the open workspace',
      );
    });

    test('the star is a toggle with a fixed label whose pressed state and tooltip follow the favorite', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let star =
        '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-favorite-btn]';
      let deskStar =
        '[data-test-favorites-list] [data-test-workspace="Workspace A"] [data-test-workspace-favorite-btn]';
      let tip =
        '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-pretui-tooltip] [role="tooltip"]';
      assert.dom(tip).hasText('Add to Favorites');
      assert
        .dom(star)
        .hasAttribute('aria-label', 'Favorite')
        .hasAttribute('aria-pressed', 'false')
        .hasAttribute('aria-describedby', find(tip)?.id ?? '')
        .doesNotHaveAttribute('title', 'no native tooltip over the tip');

      await click(star);

      assert
        .dom(star)
        .hasAttribute('aria-label', 'Favorite')
        .hasAttribute('aria-pressed', 'true');
      assert.dom(tip).hasText('Remove from Favorites');
      assert
        .dom(deskStar)
        .hasAttribute('aria-pressed', 'true', "the new desk's star is pressed");

      await click(star);

      assert
        .dom(star)
        .hasAttribute('aria-label', 'Favorite')
        .hasAttribute('aria-pressed', 'false');
      assert.dom(tip).hasText('Add to Favorites');
      assert.dom(deskStar).doesNotExist();
    });

    test("a hosted tile's site menu lists each published site and opens the one chosen", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let now = Date.now();
      markHosted(realmURL, {
        'https://older.example.com/': String(now - 60_000),
        'https://newer.example.com/': String(now),
      });
      await settled();

      let tile =
        '[data-test-workspace-recent-list] [data-test-workspace="Workspace A"]';
      let menuItems = `${tile} [data-test-pretui-menu-panel] [role="menuitem"]`;
      assert.dom(`${tile} [data-test-host-trigger]`).exists();
      assert.dom(menuItems).doesNotExist('the menu starts closed');

      let windowOpen = stubWindowOpen();
      try {
        await click(`${tile} [data-test-host-trigger]`);

        assert.deepEqual(
          findAll(menuItems).map((item) => item.textContent?.trim()),
          ['https://newer.example.com/', 'https://older.example.com/'],
          'every published site is listed, most recently published first',
        );

        await click(findAll(menuItems)[1]);

        assert.deepEqual(windowOpen.calls, [
          ['https://older.example.com/', '_blank', 'noopener,noreferrer'],
        ]);
      } finally {
        windowOpen.restore();
      }
    });

    test("a desk's Hosted at link points at its most recently published site in a new tab", async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [realmURL];
      let now = Date.now();
      markHosted(realmURL, {
        'https://older.example.com/': String(now - 60_000),
        'https://newer.example.com/': String(now),
      });
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-desk-host-link]')
        .hasAttribute('href', 'https://newer.example.com/')
        .hasAttribute('target', '_blank')
        .hasAttribute('rel', 'noopener noreferrer');
    });

    test("Realm Settings opens the workspace's realm card in edit mode and closes the dashboard", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(
        '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-menu-trigger]',
      );
      await click('[data-test-boxel-menu-item-text="Realm Settings"]');

      assert.dom('[data-test-dashboard]').doesNotExist();
      assert.false(operatorModeState().workspaceChooserOpened);
      assert.deepEqual(
        operatorModeState().state.stacks.map((stack) =>
          stack.map(({ id, format }) => ({ id, format })),
        ),
        [
          [
            { id: `${realmURL}index`, format: 'isolated' },
            { id: `${realmURL}realm`, format: 'edit' },
          ],
        ],
        "the realm card opens in edit mode over the workspace's index",
      );
      await waitFor(`[data-test-stack-card="${realmURL}realm"]`);
      assert.dom(`[data-test-stack-card="${realmURL}realm"]`).exists();
    });

    test('Restore in Archived unarchives the workspace and returns it to Your Workspaces', async function (assert) {
      let unarchiveRoute = getRealmServerRoute(
        new URL('http://test-realm/_unarchive-realm'),
      );
      if (!unarchiveRoute) {
        throw new Error('no default unarchive-realm route');
      }
      let unarchived: (string | undefined)[] = [];
      registerRealmServerRoute({
        path: '/_unarchive-realm',
        handler: async (req, url, state) => {
          let body = (await req.clone().json()) as { data?: { id?: string } };
          unarchived.push(body.data?.id);
          return unarchiveRoute.handler(req, url, state);
        },
      });
      try {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click(
          '[data-test-workspace-list] [data-test-workspace="Workspace A"] [data-test-workspace-menu-trigger]',
        );
        await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
        await click('[data-test-confirm-archive-button]');
        assert
          .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
          .doesNotExist('archiving takes it out of Your Workspaces');

        await click(
          '[data-test-archived-section] [data-test-pretui-collapsible-trigger]',
        );
        await waitFor(
          '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
        );

        await click(
          '[data-test-archived-workspace="Workspace A"] [data-test-restore-workspace-btn]',
        );
        await waitFor(
          '[data-test-workspace-list] [data-test-workspace="Workspace A"]',
        );
      } finally {
        registerRealmServerRoute(unarchiveRoute);
      }

      assert.deepEqual(
        unarchived,
        [realmURL],
        'the unarchive endpoint is called',
      );
      assert
        .dom('[data-test-archived-workspace="Workspace A"]')
        .doesNotExist('it leaves the Archived list');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists('it is back in Your Workspaces');
    });

    // Removing the workspace open behind the dashboard clears the stacks and
    // the code path. Each test opens the removed workspace one way only, with
    // another workspace's card holding the rest of the state.
    module(
      'removing the workspace open behind the dashboard',
      function (hooks) {
        const removedRealmURL = 'http://test-realm/testuser/removed-workspace/';
        const keptRealmURL = 'http://test-realm/testuser/kept-workspace/';

        function workspaceContents(name: string) {
          return {
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
            'Person/1.json': {
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: '@cardstack/base/card-api',
                    name: 'CardDef',
                  },
                },
              },
            },
          };
        }

        hooks.beforeEach(async function () {
          for (let [url, name] of [
            [removedRealmURL, 'Removed Workspace'],
            [keptRealmURL, 'Kept Workspace'],
          ]) {
            await setupAcceptanceTestRealm({
              realmURL: url,
              mockMatrixUtils,
              permissions: {
                '@testuser:localhost': ['read', 'write', 'realm-owner'],
              },
              contents: workspaceContents(name),
            });
          }
          mockMatrixUtils.setActiveRealms([
            realmURL,
            removedRealmURL,
            keptRealmURL,
          ]);
        });

        async function archiveRemovedWorkspace() {
          await click(
            `[data-test-workspace-menu-trigger="${removedRealmURL}"]`,
          );
          await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
          await click('[data-test-confirm-archive-button]');
          // The row goes before the archive returns; the Archived list is
          // filled last, so the dashboard's handling of it follows from here.
          await waitUntil(() =>
            getService('realm-server').archivedRealms.some(
              ({ url }) => url === removedRealmURL,
            ),
          );
          await settled();
        }

        async function deleteRemovedWorkspace() {
          await click(
            `[data-test-workspace-menu-trigger="${removedRealmURL}"]`,
          );
          await click('[data-test-boxel-menu-item-text="Delete Workspace"]');
          await click('[data-test-confirm-delete-button]');
          await waitUntil(
            () =>
              !find(
                '[data-test-workspace-list] [data-test-workspace="Removed Workspace"]',
              ),
          );
        }

        async function assertLeftRemovedWorkspace(assert: Assert) {
          await waitUntil(
            () =>
              operatorModeState().getOpenCardIds().length === 0 &&
              operatorModeState().state.codePath === null,
            { timeoutMessage: 'the removed workspace is left' },
          );
          assert.deepEqual(
            operatorModeState().getOpenCardIds(),
            [],
            'the stacks are cleared',
          );
          assert.strictEqual(
            operatorModeState().state.codePath,
            null,
            'the code path is cleared',
          );
          assert
            .dom('[data-test-dashboard]')
            .exists('the dashboard stays open');
        }

        test('archiving it clears the stacks when one of its cards is open', async function (assert) {
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [
              [{ id: `${removedRealmURL}Person/1`, format: 'isolated' }],
              [{ id: `${keptRealmURL}index`, format: 'isolated' }],
            ],
          });
          assert.strictEqual(operatorModeState().realmURL, keptRealmURL);
          assert.strictEqual(operatorModeState().state.codePath, null);

          await archiveRemovedWorkspace();

          await assertLeftRemovedWorkspace(assert);
        });

        test('deleting it clears the stacks and the code path when the code path is in it', async function (assert) {
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [[{ id: `${keptRealmURL}index`, format: 'isolated' }]],
            codePath: `${removedRealmURL}Person/1.json`,
          });
          assert.strictEqual(operatorModeState().realmURL, keptRealmURL);
          assert.deepEqual(operatorModeState().getOpenCardIds(), [
            `${keptRealmURL}index`,
          ]);
          assert.strictEqual(
            operatorModeState().state.codePath,
            `${removedRealmURL}Person/1.json`,
          );

          await deleteRemovedWorkspace();

          await assertLeftRemovedWorkspace(assert);
        });

        test('deleting it clears the stacks when it is the current realm', async function (assert) {
          // A stack based on its index card makes it the current realm, while
          // the card on top comes from another workspace.
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [
              [
                { id: `${removedRealmURL}index`, format: 'isolated' },
                { id: `${keptRealmURL}Person/1`, format: 'isolated' },
              ],
            ],
          });
          assert.strictEqual(operatorModeState().realmURL, removedRealmURL);
          assert.deepEqual(operatorModeState().getOpenCardIds(), [
            `${keptRealmURL}Person/1`,
          ]);
          assert.strictEqual(operatorModeState().state.codePath, null);

          await deleteRemovedWorkspace();

          await assertLeftRemovedWorkspace(assert);
        });

        test('archiving it clears the stacks when it is the current realm', async function (assert) {
          // A stack based on its index card makes it the current realm, while
          // the card on top comes from another workspace.
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [
              [
                { id: `${removedRealmURL}index`, format: 'isolated' },
                { id: `${keptRealmURL}Person/1`, format: 'isolated' },
              ],
            ],
          });
          assert.strictEqual(operatorModeState().realmURL, removedRealmURL);
          assert.deepEqual(operatorModeState().getOpenCardIds(), [
            `${keptRealmURL}Person/1`,
          ]);

          await archiveRemovedWorkspace();

          await assertLeftRemovedWorkspace(assert);
        });

        test('archiving it clears the stacks when the Archived list then fails to load', async function (assert) {
          let archivedRoute = getRealmServerRoute(
            new URL('http://test-realm/_archived-realms'),
          );
          if (!archivedRoute) {
            throw new Error('no default archived-realms route');
          }
          let archivedListRequested = false;
          registerRealmServerRoute({
            path: '/_archived-realms',
            handler: async () => {
              archivedListRequested = true;
              return new Response(null, { status: 500 });
            },
          });
          try {
            await visitOperatorMode({
              workspaceChooserOpened: true,
              stacks: [
                [{ id: `${removedRealmURL}Person/1`, format: 'isolated' }],
              ],
            });

            await click(
              `[data-test-workspace-menu-trigger="${removedRealmURL}"]`,
            );
            await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
            await click('[data-test-confirm-archive-button]');
          } finally {
            registerRealmServerRoute(archivedRoute);
          }

          assert.true(archivedListRequested, 'the Archived list is requested');
          await assertLeftRemovedWorkspace(assert);
        });

        test('archiving another workspace leaves the stacks and the code path', async function (assert) {
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [[{ id: `${keptRealmURL}index`, format: 'isolated' }]],
            codePath: `${keptRealmURL}Person/1.json`,
          });
          let codePath = operatorModeState().state.codePath;
          assert.ok(codePath, 'a code path is set');

          await archiveRemovedWorkspace();

          assert.deepEqual(operatorModeState().getOpenCardIds(), [
            `${keptRealmURL}index`,
          ]);
          assert.strictEqual(operatorModeState().state.codePath, codePath);
        });

        test('opening another workspace while the archive finishes keeps it open', async function (assert) {
          let archivedRoute = getRealmServerRoute(
            new URL('http://test-realm/_archived-realms'),
          );
          if (!archivedRoute) {
            throw new Error('no default archived-realms route');
          }
          let releaseArchivedList!: () => void;
          let archivedListHeld = new Promise<void>(
            (resolve) => (releaseArchivedList = resolve),
          );
          let archivedListRequested = false;
          registerRealmServerRoute({
            path: '/_archived-realms',
            handler: async (req, url, state) => {
              archivedListRequested = true;
              await archivedListHeld;
              return archivedRoute.handler(req, url, state);
            },
          });
          try {
            await visitOperatorMode({
              workspaceChooserOpened: true,
              stacks: [
                [{ id: `${removedRealmURL}Person/1`, format: 'isolated' }],
              ],
            });

            await click(
              `[data-test-workspace-menu-trigger="${removedRealmURL}"]`,
            );
            await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
            // Not awaited: the click settles only once the held request
            // returns.
            let confirmed = click('[data-test-confirm-archive-button]');
            await waitUntil(() => archivedListRequested);
            await operatorModeState().openWorkspace(keptRealmURL);
            releaseArchivedList();
            // The Archived list is filled last, so the dashboard's handling
            // of the archive follows from here.
            await waitUntil(() =>
              getService('realm-server').archivedRealms.some(
                ({ url }) => url === removedRealmURL,
              ),
            );
            await confirmed;
            await settled();
          } finally {
            releaseArchivedList();
            registerRealmServerRoute(archivedRoute);
          }

          assert.deepEqual(operatorModeState().getOpenCardIds(), [
            `${keptRealmURL}index`,
          ]);
          assert.false(
            operatorModeState().workspaceChooserOpened,
            'the dashboard stays closed',
          );
        });
      },
    );

    module('workspaces', function () {
      let moreRealmURLs: string[] = [];
      let testingRoot: HTMLElement | null;
      let originalWidth = '';

      // Adds `count` workspaces beside Workspace A, and narrows the dashboard
      // to `width`, which sets the columns the tiles and rows lay out in. Each
      // workspace is a realm, so a module adds no more than its tests need.
      function setupWorkspaces(
        hooks: NestedHooks,
        count: number,
        width: string,
      ) {
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
          await waitUntil(() => scroller.scrollTop === 0);

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

        test('reopened over a workspace in the hidden rows, every row is shown and the cursor rests on it', async function (assert) {
          await visitDashboard(assert, 1);
          await click(TOGGLE);
          let hiddenName = workspaceNames(ROWS).at(-1)!;
          await click(`[data-test-workspace-button="${hiddenName}"]`);
          assert.dom('[data-test-dashboard]').doesNotExist();

          await click('[data-test-workspace-chooser-toggle]');

          assert.dom(ROWS).exists({ count: 13 });
          assert.dom(TOGGLE).hasText('Show fewer');
          assert.strictEqual(selectedName(), hiddenName);
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

        test('Enter on a row opens that workspace', async function (assert) {
          await visitDashboard(assert, 2);
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

        test("a click on a row's visibility chip opens that workspace, as anywhere on the row does", async function (assert) {
          await visitDashboard(assert, 2);
          let rowName = workspaceNames(ROWS).find(
            (name) => name !== 'Workspace A',
          )!;

          await click(
            `[data-test-workspace="${rowName}"] [data-test-workspace-visibility]`,
          );

          assert.dom('[data-test-dashboard]').doesNotExist();
          assert.strictEqual(
            (
              getService(
                'operator-mode-state-service',
              ) as OperatorModeStateService
            ).realmURL,
            urlFor(rowName),
          );
        });

        test("a hosted row's globe opens the same site menu as a tile's chin", async function (assert) {
          await visitDashboard(assert, 2);
          let rowName = workspaceNames(ROWS).find(
            (name) => name !== 'Workspace A',
          )!;
          let now = Date.now();
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

          let windowOpen = stubWindowOpen();
          try {
            await click(`${row} [data-test-host-trigger]`);

            assert.deepEqual(
              findAll(menuItems).map((item) => item.textContent?.trim()),
              ['https://newer.example.com/', 'https://older.example.com/'],
              'every published site is listed, most recently published first',
            );

            await click(findAll(menuItems)[1]);

            assert.deepEqual(windowOpen.calls, [
              ['https://older.example.com/', '_blank', 'noopener,noreferrer'],
            ]);
          } finally {
            windowOpen.restore();
          }
          assert
            .dom('[data-test-dashboard]')
            .exists('choosing a site does not open the workspace');
        });

        module('keyboard cursor', function () {
          test('reopened, the cursor rests on the workspace just left, with no ring', async function (assert) {
            await visitDashboard(assert, 2);
            let rowName = workspaceNames(ROWS)[2]!;
            await click(`[data-test-workspace-button="${rowName}"]`);
            assert.dom('[data-test-dashboard]').doesNotExist();

            await click('[data-test-workspace-chooser-toggle]');

            assert.strictEqual(selectedName(), rowName);
            assert
              .dom(`[data-test-workspace-button="${rowName}"]`)
              .isFocused('the workspace holds focus, so Enter works at once');
            assert.strictEqual(ringName(), undefined, 'no ring shows');
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
            assert
              .dom(`[data-test-workspace-button="${tiles[4]}"]`)
              .isFocused();
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
              .exists(
                'the cursor stays in Your Workspaces, not on the new desk',
              );
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

    module('section rail', function () {
      const RAIL = '[data-test-section-rail]';
      const ENTRY = '[data-test-section-rail-entry="workspaces"]';
      const FLYOUT = '[data-test-section-rail-flyout="workspaces"]';

      function favoriteWorkspaceA() {
        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [realmURL];
      }

      // As a browser does for Enter on a focused button: the key, then its
      // click.
      async function pressEntry() {
        await focus(ENTRY);
        await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
        await click(ENTRY);
      }

      function openCardIds() {
        return (
          getService('operator-mode-state-service') as OperatorModeStateService
        ).getOpenCardIds();
      }

      test('lists the sections that register, and marks the one being read', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        assert.deepEqual(
          findAll('[data-test-section-rail-entry]').map((el) =>
            el.getAttribute('data-test-section-rail-entry'),
          ),
          ['workspaces', 'agents'],
        );
        assert.dom(RAIL).isVisible();
        assert.dom(ENTRY).containsText('Workspaces');
        assert
          .dom(`${ENTRY} [data-test-section-rail-count]`)
          .doesNotExist(
            'the Workspaces heading has no count, so neither does its entry',
          );
        assert.dom(ENTRY).hasAttribute('aria-current', 'location');
      });

      test('pressing Enter on the Workspaces entry opens its flyout of favorites, and a favorite opens its workspace', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        favoriteWorkspaceA();

        await focus(ENTRY);
        assert
          .dom(FLYOUT)
          .doesNotExist('focus alone leaves it closed, so Tab passes the rail');

        await pressEntry();

        assert.dom(ENTRY).hasAttribute('aria-expanded', 'true');
        assert.dom(FLYOUT).exists();
        assert.dom(`${FLYOUT} header`).hasText('Favorites');
        assert
          .dom(`${FLYOUT} [data-test-section-rail-favorite]`)
          .exists({ count: 1 });

        await click(
          `${FLYOUT} [data-test-section-rail-favorite="Workspace A"]`,
        );

        assert.dom('[data-test-dashboard]').doesNotExist();
        assert.strictEqual(
          (
            getService(
              'operator-mode-state-service',
            ) as OperatorModeStateService
          ).realmURL,
          realmURL,
          'Workspace A is the open workspace',
        );
      });

      test('with no favorites, the flyout says how to add one', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await pressEntry();

        assert
          .dom(`${FLYOUT} [data-test-section-rail-favorites-empty]`)
          .includesText('Favorite a workspace');
      });

      test('Escape closes the flyout with focus back on its entry, then folds the rail', async function (assert) {
        await visitOperatorMode({
          workspaceChooserOpened: true,
          stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
        });
        favoriteWorkspaceA();
        await pressEntry();
        await focus(
          `${FLYOUT} [data-test-section-rail-favorite="Workspace A"]`,
        );

        await triggerKeyEvent(
          `${FLYOUT} [data-test-section-rail-favorite="Workspace A"]`,
          'keydown',
          'Escape',
        );

        assert.dom(FLYOUT).doesNotExist();
        assert.dom(ENTRY).isFocused('focus goes back to the entry');
        assert.dom(RAIL).hasAttribute('data-test-section-rail-folded', 'false');

        await triggerKeyEvent(ENTRY, 'keydown', 'Escape');

        assert
          .dom(RAIL)
          .hasAttribute(
            'data-test-section-rail-folded',
            'true',
            'the second Escape folds the rail to its icons',
          );
        assert.dom(ENTRY).isFocused('focus stays on the entry');
        assert.deepEqual(
          openCardIds(),
          [`${realmURL}index`],
          'Escape stays in the rail, so the card behind the dashboard stays open',
        );
      });

      test('a tap on an entry toggles its flyout, and a tap outside the rail closes it', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        // As on a touch screen: the press focuses the entry before its click.
        async function tap() {
          await triggerEvent(ENTRY, 'pointerdown', { pointerType: 'touch' });
          await focus(ENTRY);
          await click(ENTRY);
        }

        await tap();
        assert.dom(FLYOUT).exists('the first tap opens the flyout');

        await tap();
        assert.dom(FLYOUT).doesNotExist('the second tap closes it');

        await tap();
        await triggerEvent('[data-test-dashboard-greeting]', 'pointerdown', {
          pointerType: 'touch',
        });
        assert.dom(FLYOUT).doesNotExist('a tap outside the rail closes it');
      });

      test('Escape closes a flyout opened by hover while focus is elsewhere on the page', async function (assert) {
        await visitOperatorMode({
          workspaceChooserOpened: true,
          stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
        });
        await triggerEvent(
          '[data-test-section-rail-item="workspaces"]',
          'pointerenter',
          {
            pointerType: 'mouse',
          },
        );
        assert.dom(FLYOUT).exists();

        await triggerKeyEvent(document.body, 'keydown', 'Escape');

        assert.dom(FLYOUT).doesNotExist();
        assert.deepEqual(
          openCardIds(),
          [`${realmURL}index`],
          'the card behind the dashboard stays open',
        );
      });

      test('a flyout stays open while the pointer comes back within the grace period, and closes once it has passed', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        let item = find('[data-test-section-rail-item="workspaces"]')!;

        await triggerEvent(item, 'pointerenter', { pointerType: 'mouse' });
        assert.dom(FLYOUT).exists('hovering an entry opens its flyout');

        // Dispatched by hand and followed by a render only, so the pointer
        // is back before the grace period ends.
        item.dispatchEvent(
          new PointerEvent('pointerleave', { pointerType: 'mouse' }),
        );
        await rerender();
        assert.dom(FLYOUT).exists('it stays through the grace period');

        await triggerEvent(item, 'pointerenter', { pointerType: 'mouse' });
        assert.dom(FLYOUT).exists('coming back keeps it open');

        await triggerEvent(item, 'pointerleave', {
          pointerType: 'mouse',
          bubbles: false,
        });
        assert.dom(FLYOUT).doesNotExist('it closes after the grace period');
      });
    });

    module('agents', function (hooks) {
      const PANEL = '[data-test-agent-panel]';

      let clipboard: ReturnType<typeof stubClipboard>;
      hooks.beforeEach(function () {
        clipboard = stubClipboard();
      });
      hooks.afterEach(function () {
        clipboard.restore();
      });

      function pickedAgent() {
        return (
          find(
            '[data-test-agent-picker] input:checked',
          ) as HTMLInputElement | null
        )?.value;
      }

      test('lists every agent, with the stored pick chosen and its setup progress', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        assert.deepEqual(
          findAll('[data-test-agent-picker] input').map(
            (input) => (input as HTMLInputElement).value,
          ),
          ['claude', 'codex', 'boxel'],
        );
        for (let agent of ['claude', 'codex', 'boxel']) {
          assert
            .dom(`[data-test-agent-picker] [data-test-agent-mark="${agent}"]`)
            .exists(`${agent} shows its mark`);
        }
        assert.strictEqual(pickedAgent(), 'codex');
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'codex');
        assert.dom('[data-test-agent-panel-title]').hasText('Connect Codex');
        assert
          .dom(`${PANEL} [data-test-agent-mark="codex"]`)
          .exists("the panel shows the picked agent's mark");
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('2 of 6 copied');
        assert
          .dom('[data-test-agent-step="2"]')
          .hasAttribute('data-test-agent-step-copied', 'true');
        assert
          .dom('[data-test-agent-step="3"]')
          .hasAttribute('data-test-agent-step-copied', 'false');
        assert
          .dom('[data-test-agent-step-text]')
          .exists({ count: 1 }, 'only the open step shows its text');
        assert
          .dom('[data-test-agent-step="3"] [data-test-agent-step-text]')
          .hasText('/plugins', 'the next step to copy is open');
      });

      test('each coding agent lists its own setup, then the workspace steps', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        async function stepTexts(count: number) {
          let texts = [];
          for (let step = 1; step <= count; step++) {
            let text = `[data-test-agent-step="${step}"] [data-test-agent-step-text]`;
            // A click on the open step would close it.
            if (!find(text)) {
              await click(
                `[data-test-agent-step="${step}"] [data-test-agent-step-head]`,
              );
            }
            texts.push(find(text)?.textContent?.trim());
          }
          return texts;
        }

        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert.deepEqual(await stepTexts(4), [
          'npm install -g @cardstack/boxel-cli',
          'codex plugin marketplace add cardstack/boxel',
          '/plugins',
          `Work on my Boxel workspace ${realmURL}`,
        ]);

        await click('[data-test-agent-picker] input[value="claude"]');

        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert.deepEqual(await stepTexts(4), [
          'npm install -g @cardstack/boxel-cli',
          '/plugin marketplace add cardstack/boxel',
          '/plugin install boxel-cli@cardstack-boxel',
          `Work on my Boxel workspace ${realmURL}`,
        ]);
      });

      test('a stored pick that is no longer listed falls back to the first agent', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'grok',
          agentSetup: { grok: 1 },
        });
        await settled();

        assert.strictEqual(pickedAgent(), 'claude');
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'claude');
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('0 of 6 copied');
      });

      test('the open workspace step names the workspace', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click('[data-test-agent-step="4"] [data-test-agent-step-head]');

        assert
          .dom('[data-test-agent-step="4"] [data-test-agent-step-text]')
          .hasText(
            `Work on my Boxel workspace ${realmURL}`,
            'the workspace is filled in',
          );
      });

      test('picking an agent saves it and shows its own setup', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click('[data-test-agent-picker] input[value="claude"]');

        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agent, 'claude');
        assert.strictEqual(pickedAgent(), 'claude');
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('0 of 6 copied', 'progress is kept per agent');
        assert
          .dom('[data-test-agent-step="1"] [data-test-agent-step-text]')
          .hasText('npm install -g @cardstack/boxel-cli');
      });

      test('copying a step puts its text on the clipboard and counts it', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        assert
          .dom('[data-test-agent-copy="3"]')
          .doesNotHaveAttribute('aria-label', 'its visible label names it')
          .hasAttribute(
            'aria-describedby',
            find('[data-test-agent-step="3"] [data-test-agent-step-text]')
              ?.id ?? '',
            'the text it copies describes it',
          );

        await click('[data-test-agent-copy="3"]');

        assert.deepEqual(clipboard.copied, ['/plugins']);
        let matrixService = getService('matrix-service') as MatrixService;
        assert.deepEqual(matrixService.dashboardState.agentSetup, {
          codex: 3,
        });
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('3 of 6 copied');
        assert
          .dom('[data-test-agent-step="3"]')
          .hasAttribute('data-test-agent-step-copied', 'true');
      });

      test('copying an earlier step again does not lower the count', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click('[data-test-agent-step="1"] [data-test-agent-step-head]');
        await click('[data-test-agent-copy="1"]');

        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
      });

      test('a copy the browser refuses is not counted', async function (assert) {
        clipboard.fail = true;
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click('[data-test-agent-copy="3"]');

        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('2 of 6 copied');
      });

      test('Boxel AI Assistant shows how it works, and Describe it starts a session', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click('[data-test-agent-picker] input[value="boxel"]');

        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
        assert
          .dom('[data-test-agent-panel-title]')
          .hasText('Build with Boxel AI Assistant');
        assert.dom('[data-test-agent-setup-progress]').doesNotExist();
        assert.dom(PANEL).includesText('Uses credits');

        await click('[data-test-agent-describe-it]');

        assert.dom('[data-test-ai-assistant-panel]').exists();
      });
    });

    module('agents rail entry', function () {
      const ENTRY = '[data-test-section-rail-entry="agents"]';
      const FLYOUT = '[data-test-section-rail-flyout="agents"]';

      test('the flyout lists the agents, and picking one saves it and shows the Agents section', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await focus(ENTRY);
        await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
        await click(ENTRY);

        assert.dom(FLYOUT).exists();
        assert.deepEqual(
          findAll(`${FLYOUT} [data-test-section-rail-agent]`).map((el) =>
            el.getAttribute('data-test-section-rail-agent'),
          ),
          ['claude', 'codex', 'boxel'],
        );
        for (let agent of ['claude', 'codex', 'boxel']) {
          assert
            .dom(
              `${FLYOUT} [data-test-section-rail-agent="${agent}"] [data-test-agent-mark="${agent}"]`,
            )
            .exists(`${agent} shows its mark`);
        }
        assert
          .dom(`${FLYOUT} [data-test-section-rail-agent="codex"]`)
          .includesText('(picked)');
        assert
          .dom(`${FLYOUT} [data-test-section-rail-ai-new-session]`)
          .exists();

        await click(`${FLYOUT} [data-test-section-rail-agent="claude"]`);

        assert.dom(FLYOUT).doesNotExist('a pick closes the flyout');
        assert.dom(ENTRY).isFocused('focus goes back to the entry');
        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agent, 'claude');
        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'claude');
        assert.dom(ENTRY).hasAttribute('aria-current', 'location');
      });

      test('a pick from the flyout shows in the Agents section before its save lands', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        let matrixService = getService('matrix-service') as MatrixService;
        let update = matrixService.updateDashboardState;
        let save = new Deferred<void>();
        matrixService.updateDashboardState = async (change) => {
          await save.promise;
          return update.call(matrixService, change);
        };
        try {
          await triggerEvent(
            '[data-test-section-rail-item="agents"]',
            'pointerenter',
            { pointerType: 'mouse' },
          );
          await click(`${FLYOUT} [data-test-section-rail-agent="claude"]`);

          assert.strictEqual(
            matrixService.dashboardState.agent,
            'codex',
            'the save has not landed',
          );
          assert
            .dom('[data-test-agent-panel]')
            .hasAttribute('data-test-agent-panel', 'claude');
        } finally {
          matrixService.updateDashboardState = update;
          save.fulfill();
        }
        await settled();

        assert.strictEqual(matrixService.dashboardState.agent, 'claude');
        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'claude');
      });

      test('New session in the flyout opens Boxel AI', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await triggerEvent(
          '[data-test-section-rail-item="agents"]',
          'pointerenter',
          {
            pointerType: 'mouse',
          },
        );
        await click(`${FLYOUT} [data-test-section-rail-ai-new-session]`);

        assert.dom(FLYOUT).doesNotExist();
        assert.dom(ENTRY).isFocused('focus goes back to the entry');
        assert.dom('[data-test-ai-assistant-panel]').exists();
      });
    });

    module('get started', function () {
      const GET_STARTED = '[data-test-get-started]';

      function stepDone(id: string) {
        return find(`[data-test-get-started-step="${id}"]`)?.getAttribute(
          'data-test-get-started-step-done',
        );
      }

      // From no progress at all, as a new account starts.
      async function visitAsNewUser() {
        await visitOperatorMode({ workspaceChooserOpened: true });
        (getService('recent-cards-service') as any).resetState();
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();
      }

      // Opens the AI panel from the ask step, which makes an empty session.
      async function openBoxelAiSession() {
        await click('[data-test-get-started-action="ask-ai"]');
        let matrixService = getService('matrix-service') as MatrixService;
        await waitUntil(() => matrixService.currentRoomId);
        await settled();
        return matrixService.currentRoomId!;
      }

      function sendMessage(roomId: string) {
        mockMatrixUtils.simulateRemoteMessage(roomId, '@testuser:localhost', {
          body: 'Make me a card for tracking tasks',
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
        });
      }

      test('a new account sees every step, none done', async function (assert) {
        await visitAsNewUser();

        assert.dom(GET_STARTED).exists();
        assert.dom('[data-test-get-started-count]').hasText('0 of 4 done');
        assert.deepEqual(
          findAll('[data-test-get-started-step]').map((el) =>
            el.getAttribute('data-test-get-started-step'),
          ),
          ['open-card', 'ask-ai', 'publish', 'agent'],
        );
        assert.dom('[data-test-get-started-step-done="true"]').doesNotExist();
        assert
          .dom('[data-test-get-started-toggle]')
          .doesNotExist('nothing to fold yet');
      });

      test('copying an agent setup step ticks the agent step, and the list folds to its next step', async function (assert) {
        await visitAsNewUser();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agentSetup: { claude: 1 },
        });
        await settled();

        assert
          .dom('[data-test-get-started-count]')
          .hasText('1 of 4 done · Next: Open a card in a workspace');
        assert.dom('[data-test-get-started-step]').doesNotExist('folded');

        await click('[data-test-get-started-toggle]');

        assert.strictEqual(stepDone('agent'), 'true');
        assert.strictEqual(stepDone('open-card'), 'false');
        assert.dom('[data-test-get-started-toggle]').hasText('Hide steps');
      });

      test('opening a card and publishing a workspace tick their steps', async function (assert) {
        await visitAsNewUser();

        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        markHosted(realmURL);
        await settled();
        await click('[data-test-get-started-toggle]');

        assert.strictEqual(stepDone('open-card'), 'true');
        assert.strictEqual(stepDone('publish'), 'true');
        assert.strictEqual(stepDone('ask-ai'), 'false');
      });

      test('asking Boxel AI something ticks the ask step, and opening a session does not', async function (assert) {
        await visitAsNewUser();

        let roomId = await openBoxelAiSession();
        assert.strictEqual(
          stepDone('ask-ai'),
          'false',
          'an empty session has not been asked anything',
        );

        sendMessage(roomId);
        await waitUntil(() =>
          find('[data-test-get-started-count]')?.textContent?.includes(
            '1 of 4 done',
          ),
        );

        assert
          .dom('[data-test-get-started-count]')
          .hasText('1 of 4 done · Next: Open a card in a workspace');
      });

      test('finishing every step dismisses it for good', async function (assert) {
        await visitAsNewUser();

        sendMessage(await openBoxelAiSession());
        await waitUntil(() =>
          find('[data-test-get-started-count]')?.textContent?.includes(
            '1 of 4 done',
          ),
        );
        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        markHosted(realmURL);
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agentSetup: { claude: 1 },
        });
        await settled();

        let matrixService = getService('matrix-service') as MatrixService;
        await waitUntil(() => matrixService.dashboardState.onboardingDismissed);
        assert.dom(GET_STARTED).doesNotExist();
        assert
          .dom('[data-test-get-started-dismissed]')
          .doesNotExist('finishing offers no undo');
        assert.true(
          (mockMatrixUtils.getDashboardState() as any).onboardingDismissed,
          'the dismissal is stored',
        );

        (getService('recent-cards-service') as any).resetState();
        await settled();
        assert
          .dom(GET_STARTED)
          .doesNotExist(
            'a step that reads as undone later does not bring it back',
          );
      });

      test("the agent step's action shows the Agents section", async function (assert) {
        await visitAsNewUser();

        await click('[data-test-get-started-action="agent"]');

        assert
          .dom('[data-test-section-rail-entry="agents"]')
          .hasAttribute('aria-current', 'location');
      });

      test('Dismiss hides it and saves that', async function (assert) {
        await visitAsNewUser();

        await click('[data-test-get-started-dismiss]');

        assert.dom(GET_STARTED).doesNotExist();
        let matrixService = getService('matrix-service') as MatrixService;
        assert.true(matrixService.dashboardState.onboardingDismissed);
        assert
          .dom('[data-test-get-started-undo-dismiss]')
          .isFocused('focus moves to Undo, since Dismiss is gone');
      });

      test('Undo brings back a dismissal made here, and saves that', async function (assert) {
        await visitAsNewUser();

        await click('[data-test-get-started-dismiss]');
        await click('[data-test-get-started-undo-dismiss]');

        assert.dom(GET_STARTED).exists();
        assert.dom('[data-test-get-started-dismissed]').doesNotExist();
        let matrixService = getService('matrix-service') as MatrixService;
        assert.false(matrixService.dashboardState.onboardingDismissed);
        assert
          .dom('[data-test-get-started-dismiss]')
          .isFocused('focus goes back to Dismiss');
      });

      test('a dismissal made on another device hides it', async function (assert) {
        await visitAsNewUser();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: true,
        });
        await settled();

        assert.dom(GET_STARTED).doesNotExist();
      });
    });
  });
});
