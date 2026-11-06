import {
  click,
  find,
  findAll,
  focus,
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

import { Deferred, rri } from '@cardstack/runtime-common';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
  withholdRealmSession,
} from '../helpers';
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

// The realm server marks a workspace publishable; a published copy isn't.
function markPublishable(url: string) {
  let realmResource = (getService('realm') as any).realms.get(url);
  realmResource.info = new TrackedObject({
    ...realmResource.info,
    publishable: true,
  });
}

const PUBLISH_MODAL = '[data-test-publish-realm-modal]';

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

// An IconButton whose tip matches its label is named by the tip.
function nameFromTip(selector: string) {
  let id = find(selector)?.getAttribute('aria-labelledby') ?? '';
  return document.getElementById(id)?.textContent?.trim();
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

// The text of each element a button's aria-describedby points at, in order.
function descriptionOf(selector: string) {
  let ids = find(selector)?.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent?.trim());
}

async function pressKey(key: string) {
  let target = document.activeElement;
  if (!(target instanceof HTMLElement)) {
    throw new Error('nothing has focus');
  }
  await triggerKeyEvent(target, 'keydown', key);
}

function sectionOrder() {
  return findAll('[data-test-dashboard-section]').map((section) =>
    section.getAttribute('data-test-dashboard-section'),
  );
}

function railOrder() {
  return findAll('[data-test-section-rail-entry]').map((entry) =>
    entry.getAttribute('data-test-section-rail-entry'),
  );
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

  const ownedRealmURL = 'http://test-realm/testuser/workspace-b/';
  const sharedRealmURL = 'http://test-realm/testuser/workspace-c/';

  // Workspace B, which the user owns too, and Workspace C, which is only
  // shared with them.
  function setupMoreWorkspaces(hooks: NestedHooks) {
    hooks.beforeEach(async function () {
      for (let [url, name, permissions] of [
        [ownedRealmURL, 'Workspace B', ['read', 'write', 'realm-owner']],
        [sharedRealmURL, 'Workspace C', ['read', 'write']],
      ] as const) {
        await setupAcceptanceTestRealm({
          realmURL: url,
          mockMatrixUtils,
          permissions: { '@testuser:localhost': [...permissions] },
          contents: { 'realm.json': realmConfigCardJSON({ name }) },
        });
      }
      mockMatrixUtils.setActiveRealms([
        realmURL,
        ownedRealmURL,
        sharedRealmURL,
      ]);
    });
  }

  module('state', function () {
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

  module('page', function () {
    test('the dashboard opens', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      assert.dom('[data-test-dashboard]').exists();
    });

    test('greets the user by first name', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await settled();

      assert
        .dom('[data-test-dashboard-greeting]')
        .hasText(/^Good (morning|afternoon|evening), Ada$/);
    });

    test('with one workspace and no favorites, Workspaces comes first and Catalogs follows them', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.deepEqual(sectionOrder(), ['workspaces', 'catalogs', 'agents']);
      assert
        .dom('[data-test-favorites-section]')
        .doesNotExist('no empty Favorites box at the top');
      assert
        .dom(
          '[data-test-dashboard-section="catalogs"] [data-test-catalog-list]',
        )
        .exists();
      assert
        .dom('[data-test-dashboard-section="workspaces"] h2')
        .hasText('Workspaces');
      assert
        .dom('[data-test-dashboard-section="catalogs"] h2')
        .includesText('Catalogs');
      assert.dom('[data-test-dashboard-section="agents"] h2').hasText('Agents');
    });

    test('hovering the gear beside Catalogs shows its tooltip', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let gear =
        '[data-test-dashboard-section="catalogs"] [data-test-pretui-tooltip]';

      await triggerEvent(gear, 'mouseenter');

      assert
        .dom(`${gear} [role="tooltip"]`)
        .hasAttribute('data-open', 'true')
        .hasText('Choose Catalogs');
      assert.strictEqual(
        nameFromTip('[data-test-manage-catalogs]'),
        'Choose Catalogs',
        'its tip names it',
      );
    });

    test('with a favorite, Favorites comes first among the sections', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      (getService('matrix-service') as MatrixService).workspaceFavorites = [
        realmURL,
      ];
      await settled();

      assert.deepEqual(sectionOrder(), [
        'favorites',
        'workspaces',
        'catalogs',
        'agents',
      ]);
      assert
        .dom('[data-test-favorites-section] h2')
        .hasText('Favorites 1', 'a heading of its own, with its count');
      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('the new favorite takes the cursor');
    });

    test('the keyboard walks the catalogs after the workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      assert
        .dom('[data-test-workspace-selected="Workspace A"]')
        .exists('the cursor starts on the workspace, not a catalog');
      assert
        .dom('[data-test-catalog-list] [data-test-workspace]')
        .exists('the fixture lists a catalog');

      await focus('[data-test-workspace-button="Workspace A"]');
      await pressKey('ArrowRight');
      await pressKey('ArrowRight');
      assert
        .dom('[data-test-catalog-list] [data-test-workspace-selected]')
        .exists('after the last workspace come the catalogs');

      await pressKey('ArrowLeft');
      assert.dom('[data-test-workspace-selected="Workspace A"]').exists();
      await pressKey('ArrowLeft');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('New Workspace is first, with no catalogs before it');
    });

    test('the Workspaces section holds your workspaces and archived', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let workspaces = '[data-test-dashboard-section="workspaces"]';
      assert.dom(`${workspaces} [data-test-favorites-section]`).doesNotExist();
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
      assert.dom('[data-test-catalog-list]').doesNotExist();
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

      assert.dom('[data-test-favorites-section]').doesNotExist();

      await clickScopeOption('hosted');

      assert.dom('[data-test-favorites-section]').doesNotExist();
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

    test("a desk's name is described by its full visibility and its address", async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [realmURL];
      await settled();

      let description = descriptionOf(
        '[data-test-favorites-list] [data-test-workspace-button="Workspace A"]',
      );
      assert.deepEqual(description, [
        'Private workspace',
        'test-realm/testuser/workspace-a',
      ]);
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
          ['newer.example.com', 'older.example.com'],
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

    test("a desk's +N opens a menu of the sites beyond its link", async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await visitOperatorMode({ workspaceChooserOpened: true });
      matrixService.workspaceFavorites = [realmURL];
      let now = Date.now();
      markHosted(realmURL, {
        'https://older.example.com/': String(now - 60_000),
        'https://newer.example.com/': String(now),
      });
      await settled();

      let desk =
        '[data-test-favorites-list] [data-test-workspace="Workspace A"]';
      let menuItems = `${desk} [data-test-pretui-menu-panel] [role="menuitem"]`;
      assert
        .dom(`${desk} [data-test-desk-host-link]`)
        .hasText(/newer\.example\.com/)
        .hasAttribute('title', 'https://newer.example.com/');
      assert
        .dom(`${desk} [data-test-desk-host-more]`)
        .hasText('+1')
        .hasAttribute('aria-label', '+1 more hosted site');

      // The +N keeps the caption's line height rather than a Button's.
      let linkHeight = find(
        `${desk} [data-test-desk-host-link]`,
      )!.getBoundingClientRect().height;
      let moreHeight = find(
        `${desk} [data-test-desk-host-more]`,
      )!.getBoundingClientRect().height;
      assert.ok(
        moreHeight <= linkHeight + 0.5,
        `the +N (${moreHeight}px) is no taller than the link (${linkHeight}px)`,
      );

      let windowOpen = stubWindowOpen();
      try {
        await click(`${desk} [data-test-desk-host-more]`);

        assert.deepEqual(
          findAll(menuItems).map((item) => item.textContent?.trim()),
          ['older.example.com'],
          'the menu holds as many sites as the +N says',
        );

        await click(findAll(menuItems)[0]);

        assert.deepEqual(windowOpen.calls, [
          ['https://older.example.com/', '_blank', 'noopener,noreferrer'],
        ]);
      } finally {
        windowOpen.restore();
      }
    });

    module('a failed Re-index', function (hooks) {
      const TILE =
        '[data-test-workspace-list] [data-test-workspace="Workspace A"]';

      let reindexError = '';
      // Answers the reindex request alone, leaving auth to the module's
      // endpoints, which make the test user the realm's owner.
      hooks.beforeEach(function () {
        getService('network').mount(
          async (req: Request) =>
            new URL(req.url).pathname === '/testuser/workspace-a/_full-reindex'
              ? new Response(reindexError, { status: 500 })
              : null,
          { prepend: true },
        );
      });

      async function reindexFails(message: string) {
        reindexError = message;
        await visitOperatorMode({ workspaceChooserOpened: true });
        await click(`${TILE} [data-test-workspace-menu-trigger]`);
        await click('[data-test-boxel-menu-item-text="Re-index"]');
        await waitFor(`${TILE} [data-test-reindex-error]`);
      }

      test('a short error adds no Tab stop', async function (assert) {
        await reindexFails('boom');

        assert
          .dom(`${TILE} [data-test-reindex-error-message]`)
          .hasText('Full reindex realm failed: 500 - boom')
          .doesNotHaveAttribute('tabindex');
      });

      test('a long error scrolls within the face, from the keyboard too', async function (assert) {
        await reindexFails('stack trace: '.repeat(200).trim());

        assert
          .dom(`${TILE}[data-test-workspace-variant="tile"]`)
          .exists('Workspace A shows as a tile');
        assert
          .dom(`${TILE} [data-test-reindex-error-message]`)
          .hasAttribute('tabindex', '0');

        let alert = find(`${TILE} [data-test-reindex-error]`)!;
        let face = find(`${TILE} [data-test-workspace-button]`)!;
        assert.ok(
          alert.getBoundingClientRect().bottom <=
            face.getBoundingClientRect().bottom + 0.5,
          'the error stays within the face, off the name and chip below it',
        );
      });
    });

    module('publishing from the menu', function (hooks) {
      setupMoreWorkspaces(hooks);

      function tile(name: string) {
        return `[data-test-workspace-list] [data-test-workspace="${name}"]`;
      }

      async function openMenu(name: string) {
        await click(`${tile(name)} [data-test-workspace-menu-trigger]`);
      }

      test("a publishable workspace's Publish opens the publish dialog for that workspace, on the dashboard", async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await waitFor(tile('Workspace B'));
        markPublishable(realmURL);
        markPublishable(ownedRealmURL);
        await settled();

        // Two workspaces, so the dialog can't be showing the same one for
        // both by chance.
        for (let [name, path] of [
          ['Workspace A', 'workspace-a/'],
          ['Workspace B', 'workspace-b/'],
        ]) {
          await openMenu(name);
          await click('[data-test-boxel-menu-item-text="Publish"]');
          await waitFor(PUBLISH_MODAL);

          assert.dom(PUBLISH_MODAL).containsText(path, `${name}'s dialog`);
          assert.dom('[data-test-dashboard]').exists('the dashboard stays');

          await click(`${PUBLISH_MODAL} [data-test-close-modal]`);
          assert.dom(PUBLISH_MODAL).doesNotExist();
          assert
            .dom(`${tile(name)} [data-test-workspace-menu-trigger]`)
            .isFocused('focus goes back to the menu that opened it');
        }
      });

      test("a workspace that isn't publishable has no Publish", async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await waitFor(tile('Workspace B'));
        markPublishable(realmURL);
        await settled();

        await openMenu('Workspace B');

        assert
          .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
          .exists();
        assert.dom('[data-test-boxel-menu-item-text="Publish"]').doesNotExist();
      });

      test('a publishable workspace the user does not own has no Publish', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await waitFor(tile('Workspace C'));
        markPublishable(sharedRealmURL);
        await settled();

        await openMenu('Workspace C');

        assert
          .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
          .exists();
        assert.dom('[data-test-boxel-menu-item-text="Publish"]').doesNotExist();
      });
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

        test('Catalogs stays after Workspaces once fewer than three workspaces are left', async function (assert) {
          await visitOperatorMode({
            workspaceChooserOpened: true,
            stacks: [[{ id: `${keptRealmURL}index`, format: 'isolated' }]],
          });
          await archiveRemovedWorkspace();

          assert.strictEqual(
            getService('realm-server').userRealmIdentifiers.length,
            2,
            'fewer than three workspaces are left',
          );

          await click('[data-test-workspace-chooser-toggle]');
          assert.dom('[data-test-dashboard]').doesNotExist();
          await click('[data-test-workspace-chooser-toggle]');

          assert.deepEqual(
            sectionOrder(),
            ['workspaces', 'catalogs', 'agents'],
            'reopened, Catalogs still follows Workspaces',
          );
          assert.deepEqual(railOrder(), ['workspaces', 'catalogs', 'agents']);
        });

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

    module('pinned cards', function (hooks) {
      const pinnedRealmURL = 'http://test-realm/testuser/pinned/';
      const unpinnedRealmURL = 'http://test-realm/testuser/unpinned/';
      // Where `@cardstack/catalog/` resolves, so a pin can name it either way.
      let catalogRealmURL: string;

      function cardJSON(name: string) {
        return {
          data: {
            attributes: { cardInfo: { name } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        };
      }

      function workspaceIndexJSON(relationships: Record<string, unknown>) {
        return {
          data: {
            relationships,
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/workspace',
                name: 'Workspace',
              },
            },
          },
        };
      }

      hooks.beforeEach(async function () {
        catalogRealmURL = (
          getService('network') as NetworkService
        ).virtualNetwork.toURL('@cardstack/catalog/').href;
        await setupAcceptanceTestRealm({
          realmURL: pinnedRealmURL,
          mockMatrixUtils,
          permissions: {
            '@testuser:localhost': ['read', 'write', 'realm-owner'],
          },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Pinned Workspace' }),
            'roadmap.json': cardJSON('Roadmap'),
            'launch-notes.json': cardJSON('Launch Notes'),
            'index.json': workspaceIndexJSON({
              'entryPoints.0': { links: { self: './roadmap' } },
              // No such card, so nothing to draw: the next pin takes its place.
              'entryPoints.1': { links: { self: './missing' } },
              'entryPoints.2': { links: { self: './launch-notes' } },
              'entryPoints.3': {
                links: { self: `${catalogRealmURL}style-guide` },
              },
              'entryPoints.4': {
                links: { self: '@cardstack/catalog/glossary' },
              },
              // Pinned twice: drawn and counted once.
              'entryPoints.5': { links: { self: './roadmap' } },
            }),
          },
        });
        await setupAcceptanceTestRealm({
          realmURL: unpinnedRealmURL,
          mockMatrixUtils,
          permissions: {
            '@testuser:localhost': ['read', 'write', 'realm-owner'],
          },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Unpinned Workspace' }),
            'index.json': workspaceIndexJSON({}),
          },
        });
        await setupAcceptanceTestRealm({
          realmURL: catalogRealmURL,
          mockMatrixUtils,
          permissions: {
            '*': ['read'],
          },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Catalog' }),
            'style-guide.json': cardJSON('Style Guide'),
            'glossary.json': cardJSON('Glossary'),
          },
        });
        mockMatrixUtils.setActiveRealms([
          realmURL,
          pinnedRealmURL,
          unpinnedRealmURL,
          catalogRealmURL,
        ]);
      });

      // The Pinned stat waits for the desk's index counts, which fixture
      // realms don't serve, so they're seeded on the realm service.
      async function visitWithFavorites(
        favorites: string[],
        beforeFavorites?: () => void,
      ) {
        let matrixService = getService('matrix-service') as MatrixService;
        await visitOperatorMode({ workspaceChooserOpened: true });
        beforeFavorites?.();
        let realmService = getService('realm') as any;
        for (let favorite of favorites) {
          realmService.indexCountsByRealm.set(favorite, {
            cardCount: 1,
            fileCount: 1,
            definitionCount: null,
          });
        }
        matrixService.workspaceFavorites = favorites;
        await settled();
      }

      const DESK_PINS =
        '[data-test-favorites-list] [data-test-workspace="Pinned Workspace"] [data-test-pinned-card]';

      test("a desk shows its Workspace card's pins in the workspace's order and counts them", async function (assert) {
        await visitWithFavorites([pinnedRealmURL]);
        await waitUntil(() => findAll(DESK_PINS).length === 4);

        assert.deepEqual(
          findAll(DESK_PINS).map((el) => el.getAttribute('aria-label')),
          [
            'Open Roadmap',
            'Open Launch Notes',
            'Open Style Guide',
            'Open Glossary',
          ],
          'a pin with nothing to draw gives its place to the next, and pins in another realm, linked by URL or by its prefix, are read from that realm',
        );
        assert
          .dom(DESK_PINS)
          .hasAttribute(
            'data-test-pinned-card',
            `${pinnedRealmURL}roadmap`,
            'each pin is keyed by its own id',
          );
        let pinnedStat =
          '[data-test-favorites-list] [data-test-workspace="Pinned Workspace"] [data-test-workspace-stat="Pinned"]';
        await waitFor(pinnedStat);
        assert
          .dom(pinnedStat)
          .hasText(
            'Pinned 5',
            'every pinned card is counted once, drawn or not',
          );
        assert
          .dom('[data-test-workspace="Pinned Workspace"]')
          .exists({ count: 2 }, 'it is listed as a desk and again below');
        assert
          .dom('[data-test-pinned-cards]')
          .exists({ count: 1 }, 'only the desk shows pins');
      });

      // The ids in the stack a pin opens, from the bottom.
      function openedStack() {
        let { stacks } = (
          getService('operator-mode-state-service') as OperatorModeStateService
        ).state;
        return stacks.map((stack) => stack.map((item) => item.id));
      }

      test("a pinned card opens over its workspace's Home", async function (assert) {
        await visitWithFavorites([pinnedRealmURL]);
        await waitUntil(() => findAll(DESK_PINS).length === 4);

        await click(`[data-test-pinned-card="${pinnedRealmURL}roadmap"]`);

        assert.dom('[data-test-dashboard]').doesNotExist();
        assert.deepEqual(openedStack(), [
          [`${pinnedRealmURL}index`, `${pinnedRealmURL}roadmap`],
        ]);
      });

      test("a pin in another realm opens by its own id over its workspace's Home", async function (assert) {
        await visitWithFavorites([pinnedRealmURL]);
        await waitUntil(() => findAll(DESK_PINS).length === 4);

        await click('[data-test-pinned-card="@cardstack/catalog/glossary"]');

        assert.deepEqual(
          openedStack(),
          [[`${pinnedRealmURL}index`, '@cardstack/catalog/glossary']],
          'a prefix pin keeps its prefix, and the stack is the workspace the desk is for',
        );
      });

      test("a pin in a realm the app hasn't loaded is drawn once that realm is found", async function (assert) {
        const elsewhereRealmURL = 'http://test-realm/testuser/elsewhere/';
        // Readable by anyone and not one of the user's realms, so the app
        // learns of it only by looking it up.
        const unlistedRealmURL = 'http://test-realm/testuser/unlisted/';
        await setupAcceptanceTestRealm({
          realmURL: unlistedRealmURL,
          mockMatrixUtils,
          permissions: { '*': ['read'] },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Unlisted' }),
            'notes.json': cardJSON('Notes'),
          },
        });
        withholdRealmSession(unlistedRealmURL);
        await setupAcceptanceTestRealm({
          realmURL: elsewhereRealmURL,
          mockMatrixUtils,
          permissions: {
            '@testuser:localhost': ['read', 'write', 'realm-owner'],
          },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Elsewhere Workspace' }),
            'index.json': workspaceIndexJSON({
              'entryPoints.0': { links: { self: `${unlistedRealmURL}notes` } },
            }),
          },
        });
        mockMatrixUtils.setActiveRealms([
          realmURL,
          pinnedRealmURL,
          unpinnedRealmURL,
          catalogRealmURL,
          elsewhereRealmURL,
        ]);

        await visitWithFavorites([elsewhereRealmURL], () => {
          // Indexing its cards can already have taught the app the realm, so
          // it's forgotten here, and only the desk's lookup can find it again.
          let realmService = getService('realm') as RealmService;
          realmService.removeRealm(unlistedRealmURL);
          assert.strictEqual(
            realmService.realmOf(rri(`${unlistedRealmURL}notes`)),
            undefined,
            "the pin's realm isn't known when the desk first searches",
          );
        });
        let pins =
          '[data-test-favorites-list] [data-test-workspace="Elsewhere Workspace"] [data-test-pinned-card]';
        await waitUntil(() => findAll(pins).length === 1);

        assert
          .dom(pins)
          .hasAttribute('data-test-pinned-card', `${unlistedRealmURL}notes`);
        assert.dom(pins).hasAttribute('aria-label', 'Open Notes');
      });

      test('a desk with no pins shows no collage and no pin count', async function (assert) {
        await visitWithFavorites([pinnedRealmURL, unpinnedRealmURL]);
        // `settled()` in `visitWithFavorites` waits for both desks' pin
        // searches, so the unpinned desk has had its answer.
        await waitUntil(() => findAll(DESK_PINS).length === 4);

        let desk =
          '[data-test-favorites-list] [data-test-workspace="Unpinned Workspace"]';
        assert.dom(desk).exists();
        assert.dom(`${desk} [data-test-pinned-cards]`).doesNotExist();
        assert
          .dom(`${desk} [data-test-workspace-stat="Pinned"]`)
          .doesNotExist();
      });
    });

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
          assert
            .dom(`[data-test-workspace-button="${hiddenName}"]`)
            .isFocused();
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

          assert.deepEqual(sectionOrder(), [
            'workspaces',
            'catalogs',
            'agents',
          ]);
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
              ['newer.example.com', 'older.example.com'],
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

        test("a row's button is described by its full visibility, its update time and its address", async function (assert) {
          await visitDashboard(assert, 2);
          let hour = 60 * 60 * 1000;
          for (let [i, url] of [realmURL, ...moreRealmURLs].entries()) {
            markUpdated(url, new Date(Date.now() - (i + 1) * hour));
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
              (getService('realm') as RealmService).defaultReadableRealm.info
                .name,
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
      const FAVORITES_ENTRY = '[data-test-section-rail-entry="favorites"]';
      const FAVORITES_FLYOUT = '[data-test-section-rail-flyout="favorites"]';
      const CATALOGS_ENTRY = '[data-test-section-rail-entry="catalogs"]';
      const CATALOGS_FLYOUT = '[data-test-section-rail-flyout="catalogs"]';
      const ITEM = (id: string) => `[data-test-section-rail-item="${id}"]`;

      function favoriteWorkspaceA() {
        let matrixService = getService('matrix-service') as MatrixService;
        matrixService.workspaceFavorites = [realmURL];
      }

      // As a browser does for Enter on a focused button: the key, then its
      // click.
      async function pressEntry(entry: string) {
        await focus(entry);
        await triggerKeyEvent(entry, 'keydown', 'Enter');
        await click(entry);
      }

      function openCardIds() {
        return (
          getService('operator-mode-state-service') as OperatorModeStateService
        ).getOpenCardIds();
      }

      test('lists the sections that register, and marks the one being read', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        assert.deepEqual(
          railOrder(),
          ['workspaces', 'catalogs', 'agents'],
          'in page order, with no Favorites entry while there are no favorites',
        );
        assert.dom(RAIL).isVisible();
        assert
          .dom(`${ITEM('workspaces')} [role="tooltip"]`)
          .hasText('Workspaces', 'a tooltip names its section, with no count');
        assert.dom(`${ITEM('catalogs')} [role="tooltip"]`).hasText('Catalogs');
        assert
          .dom(ENTRY)
          .hasAttribute('aria-current', 'location', 'the top section is read');
        assert.dom(CATALOGS_ENTRY).doesNotHaveAttribute('aria-current');
      });

      test('with a favorite, the Favorites entry comes first, and its flyout counts the favorites', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        favoriteWorkspaceA();
        await settled();

        assert.deepEqual(
          railOrder(),
          ['favorites', 'workspaces', 'catalogs', 'agents'],
          'the rail follows the page',
        );
        assert
          .dom(`${ITEM('favorites')} [role="tooltip"]`)
          .hasText('Favorites');
        assert
          .dom(FAVORITES_ENTRY)
          .hasAttribute('aria-current', 'location', 'the top section is read');

        await click(FAVORITES_ENTRY);

        assert
          .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-flyout-count]`)
          .hasText('1', 'the header counts the list below it');
      });

      test('the Catalogs entry opens its flyout of catalogs, and a catalog opens its workspace', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        let tileNames = findAll(
          '[data-test-catalog-list] [data-test-workspace]',
        ).map((el) => el.getAttribute('data-test-workspace'));
        assert.true(tileNames.length > 0, 'the fixture lists a catalog');

        await click(CATALOGS_ENTRY);

        assert
          .dom(`${CATALOGS_FLYOUT} [data-test-section-rail-flyout-count]`)
          .hasText(String(tileNames.length));
        assert.deepEqual(
          findAll(`${CATALOGS_FLYOUT} [data-test-section-rail-realm]`).map(
            (el) => el.getAttribute('data-test-section-rail-realm'),
          ),
          tileNames,
          'the catalogs the page lists, in its order',
        );

        await click(
          `${CATALOGS_FLYOUT} [data-test-section-rail-realm="${tileNames[0]}"]`,
        );

        assert.dom('[data-test-dashboard]').doesNotExist();
      });

      test('the Workspaces entry opens its flyout of workspaces, and a workspace opens it', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await pressEntry(ENTRY);

        assert.dom(ENTRY).hasAttribute('aria-expanded', 'true');
        assert
          .dom(`${FLYOUT} [data-test-section-rail-flyout-count]`)
          .hasText('1');
        assert.deepEqual(
          findAll(`${FLYOUT} [data-test-section-rail-realm]`).map((el) =>
            el.getAttribute('data-test-section-rail-realm'),
          ),
          ['Workspace A'],
          'only their own workspaces, not the catalogs',
        );

        await click(`${FLYOUT} [data-test-section-rail-realm="Workspace A"]`);

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

      test('pressing Enter on the Favorites entry opens its flyout of favorites, and a favorite opens its workspace', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        favoriteWorkspaceA();
        await settled();

        await focus(FAVORITES_ENTRY);
        assert
          .dom(FAVORITES_FLYOUT)
          .doesNotExist('focus alone leaves it closed, so Tab passes the rail');

        await pressEntry(FAVORITES_ENTRY);

        assert.dom(FAVORITES_ENTRY).hasAttribute('aria-expanded', 'true');
        assert.dom(FAVORITES_FLYOUT).exists();
        assert.dom(`${FAVORITES_FLYOUT} header`).hasText('Favorites 1');
        assert
          .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-realm]`)
          .exists({ count: 1 });

        await click(
          `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
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

      test('under Hosted, each flyout lists only what the page lists', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        favoriteWorkspaceA();
        await settled();
        await clickScopeOption('hosted');

        function flyoutNames(flyout: string) {
          return findAll(`${flyout} [data-test-section-rail-realm]`).map((el) =>
            el.getAttribute('data-test-section-rail-realm'),
          );
        }

        for (let [entry, flyout] of [
          [FAVORITES_ENTRY, FAVORITES_FLYOUT],
          [ENTRY, FLYOUT],
          [CATALOGS_ENTRY, CATALOGS_FLYOUT],
        ]) {
          await click(entry);
          assert.deepEqual(flyoutNames(flyout), [], `${entry} lists nothing`);
          assert
            .dom(`${flyout} [data-test-section-rail-flyout-empty]`)
            .hasText('No matching results');
          await click(entry);
        }

        markHosted(realmURL);
        await settled();

        await click(FAVORITES_ENTRY);
        assert.deepEqual(
          flyoutNames(FAVORITES_FLYOUT),
          ['Workspace A'],
          'a hosted favorite is listed',
        );
        assert
          .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-flyout-empty]`)
          .doesNotExist();
        await click(FAVORITES_ENTRY);

        await click(ENTRY);
        assert.deepEqual(
          flyoutNames(FLYOUT),
          ['Workspace A'],
          'a hosted workspace is listed',
        );
      });

      test('Escape closes the flyout with focus back on its entry', async function (assert) {
        await visitOperatorMode({
          workspaceChooserOpened: true,
          stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
        });
        favoriteWorkspaceA();
        await settled();
        await pressEntry(FAVORITES_ENTRY);
        await focus(
          `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
        );

        await triggerKeyEvent(
          `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
          'keydown',
          'Escape',
        );

        assert.dom(FAVORITES_FLYOUT).doesNotExist();
        assert.dom(FAVORITES_ENTRY).isFocused('focus goes back to the entry');
        assert.deepEqual(
          openCardIds(),
          [`${realmURL}index`],
          'Escape stays in the rail, so the card behind the dashboard stays open',
        );
      });

      test('Escape closes a flyout opened by a click that left focus elsewhere on the page', async function (assert) {
        await visitOperatorMode({
          workspaceChooserOpened: true,
          stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
        });
        // A click alone, as in a browser whose buttons take no focus on
        // click, so focus stays off the rail.
        await triggerEvent(ENTRY, 'click');
        assert.dom(FLYOUT).exists();
        assert.dom(ENTRY).isNotFocused();

        await triggerKeyEvent(document.body, 'keydown', 'Escape');

        assert.dom(FLYOUT).doesNotExist();
        assert.deepEqual(
          openCardIds(),
          [`${realmURL}index`],
          'the card behind the dashboard stays open',
        );
      });

      test('a tap on an entry toggles its flyout, and a tap outside the rail closes it', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        // As on a touch screen: the press focuses the entry before its click.
        async function tap() {
          await triggerEvent(CATALOGS_ENTRY, 'pointerdown', {
            pointerType: 'touch',
          });
          await focus(CATALOGS_ENTRY);
          await click(CATALOGS_ENTRY);
        }

        await tap();
        assert.dom(CATALOGS_FLYOUT).exists('the first tap opens the flyout');

        await tap();
        assert.dom(CATALOGS_FLYOUT).doesNotExist('the second tap closes it');

        await tap();
        await triggerEvent('[data-test-dashboard-greeting]', 'pointerdown', {
          pointerType: 'touch',
        });
        assert
          .dom(CATALOGS_FLYOUT)
          .doesNotExist('a tap outside the rail closes it');
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
          .dom('[data-test-agent-step="3"] [data-test-agent-step-text]')
          .hasText('/plugins');
      });

      test('each coding agent lists its own setup, then the workspace steps', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        function stepTexts(count: number) {
          let texts = [];
          for (let step = 1; step <= count; step++) {
            texts.push(
              find(
                `[data-test-agent-step="${step}"] [data-test-agent-step-text]`,
              )?.textContent?.trim(),
            );
          }
          return texts;
        }

        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert.deepEqual(stepTexts(4), [
          'npm install -g @cardstack/boxel-cli',
          'codex plugin marketplace add cardstack/boxel',
          '/plugins',
          `Work on my Boxel workspace ${realmURL}`,
        ]);

        await click('[data-test-agent-picker] input[value="claude"]');

        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert.deepEqual(stepTexts(4), [
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
          agentSetup: { grok: 1, claude: 1 },
        });
        await settled();

        assert.strictEqual(pickedAgent(), 'claude');
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'claude');
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('1 of 6 copied');
      });

      test('progress kept only for an agent no longer listed leaves the section minimized', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'grok',
          agentSetup: { grok: 1 },
        });
        await settled();

        assert.dom('[data-test-agent-picker]').doesNotExist();
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
      });

      test('until a coding agent is taken up, the section shows only Boxel AI Assistant and a way to the others', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();

        assert.dom('[data-test-agent-picker]').doesNotExist();
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
        assert.dom('[data-test-agent-describe-it]').exists();
        assert
          .dom('[data-test-agents-show-coding]')
          .hasText('Use Claude Code or Codex?');
      });

      test('opening the coding agents shows the first one, and copying its step takes it up', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();

        await click('[data-test-agents-show-coding]');

        assert.dom('[data-test-agents-show-coding]').doesNotExist();
        assert
          .dom('[data-test-agent-picker] input:checked')
          .isFocused('focus moves to the picked agent in what it opened');
        assert.strictEqual(pickedAgent(), 'claude');
        assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'claude');
        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(
          matrixService.dashboardState.agent,
          undefined,
          'opening the section picks nothing',
        );

        await click('[data-test-agent-copy="1"]');

        assert.deepEqual(clipboard.copied, [
          'npm install -g @cardstack/boxel-cli',
        ]);
        assert.strictEqual(matrixService.dashboardState.agent, 'claude');
        assert.strictEqual(matrixService.dashboardState.agentSetup?.claude, 1);
      });

      test('a copied step keeps the full section, whichever agent is picked', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'boxel',
          agentSetup: { codex: 1 },
        });
        await settled();

        assert.dom('[data-test-agents-show-coding]').doesNotExist();
        assert.dom('[data-test-agent-picker]').exists();
        assert.strictEqual(pickedAgent(), 'boxel');
      });

      test('the workspace pick offers only workspaces the user can write to', async function (assert) {
        const sharedRealmURL = 'http://test-realm/testuser/shared-read-only/';
        await setupAcceptanceTestRealm({
          realmURL: sharedRealmURL,
          mockMatrixUtils,
          permissions: { '@testuser:localhost': ['read'] },
          contents: {
            'realm.json': realmConfigCardJSON({ name: 'Shared Workspace' }),
          },
        });
        mockMatrixUtils.setActiveRealms([sharedRealmURL, realmURL]);
        await visitOperatorMode({ workspaceChooserOpened: true });

        let realmServer = getService('realm-server') as any;
        assert.true(
          realmServer.userRealmIdentifiers.includes(sharedRealmURL),
          "the shared workspace is one of the user's workspaces",
        );

        await click(
          '[data-test-agent-workspace-pick] [data-test-pretui-select-trigger]',
        );

        assert.deepEqual(
          findAll("[role='listbox'] [data-test-pretui-select-option]").map(
            (el) => el.textContent?.trim(),
          ),
          ['Workspace A'],
        );
      });

      test('the workspace step names the workspace', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

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

        assert.strictEqual(
          nameFromTip('[data-test-agent-copy="3"]'),
          'Copy',
          'its tip names it',
        );
        assert.true(
          (
            find('[data-test-agent-copy="3"]')?.getAttribute(
              'aria-describedby',
            ) ?? ''
          )
            .split(' ')
            .includes(
              find('[data-test-agent-step="3"] [data-test-agent-step-text]')
                ?.id ?? '-',
            ),
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

        await click('[data-test-agent-copy="1"]');

        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
      });

      test('a copy the browser refuses is not counted', async function (assert) {
        clipboard.fail = true;
        await visitOperatorMode({ workspaceChooserOpened: true });

        // Not awaited: settling waits out the feedback, which clears the
        // announcement.
        click('[data-test-agent-copy="3"]');
        await waitUntil(() =>
          find('[data-test-agent-copy-status]')?.textContent?.trim(),
        );
        assert
          .dom('[data-test-agent-copy-status]')
          .hasText('Step 3 copy failed', 'the refusal is announced');
        await settled();

        let matrixService = getService('matrix-service') as MatrixService;
        assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('2 of 6 copied');
        assert
          .dom('[data-test-agent-step="3"]')
          .hasAttribute('data-test-agent-step-copied', 'false');
      });

      test('a finished setup folds its steps away behind Show steps', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'codex',
          agentSetup: { codex: 6 },
        });
        await settled();

        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('6 of 6 copied');
        assert.dom('[data-test-agent-step]').doesNotExist();
        assert
          .dom('[data-test-agent-steps-toggle]')
          .hasText('Show steps')
          .hasAttribute('aria-expanded', 'false');

        await click('[data-test-agent-steps-toggle]');

        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert
          .dom('[data-test-agent-steps-toggle]')
          .hasText('Hide steps')
          .hasAttribute('aria-expanded', 'true');
      });

      test('copying the last step keeps the steps in view', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'codex',
          agentSetup: { codex: 5 },
        });
        await settled();

        await click('[data-test-agent-copy="6"]');

        assert
          .dom('[data-test-agent-setup-progress]')
          .includesText('6 of 6 copied');
        assert.dom('[data-test-agent-step]').exists({ count: 6 });
        assert.dom('[data-test-agent-steps-toggle]').hasText('Hide steps');
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
          await click(ENTRY);
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

      test('for a user with no coding agent, the flyout marks Boxel AI Assistant as picked, as the section shows', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();

        await click(ENTRY);

        assert
          .dom(`${FLYOUT} [data-test-section-rail-agent="boxel"]`)
          .includesText('(picked)');
        assert
          .dom(`${FLYOUT} [data-test-section-rail-agent="claude"]`)
          .doesNotIncludeText('(picked)');
        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'boxel');
      });

      test('a pick from the flyout replaces the agent the section opened on', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();
        await click('[data-test-agents-show-coding]');
        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'claude');

        await click(ENTRY);
        await click(`${FLYOUT} [data-test-section-rail-agent="codex"]`);

        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'codex');
      });

      test('New session in the flyout opens Boxel AI Assistant', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });

        await click(ENTRY);
        await click(`${FLYOUT} [data-test-section-rail-ai-new-session]`);

        assert.dom(FLYOUT).doesNotExist();
        assert.dom(ENTRY).isFocused('focus goes back to the entry');
        assert.dom('[data-test-ai-assistant-panel]').exists();
      });

      // Agents sits too near the page's end to reach the top, so the jump
      // must not hand the rest of the scroll to the ancestors around the
      // dashboard, which have no way back.
      test('jumping to Agents scrolls only the dashboard', async function (assert) {
        await visitOperatorMode({ workspaceChooserOpened: true });
        let scroller = find('[data-test-dashboard-scroller]') as HTMLElement;

        await click(ENTRY);
        // The jump is a smooth scroll: wait for it to start and come to rest.
        let last = -1;
        let restingPolls = 0;
        await waitUntil(
          () => {
            let top = scroller.scrollTop;
            restingPolls = top === last ? restingPolls + 1 : 0;
            last = top;
            return top > 0 && restingPolls >= 10;
          },
          { timeout: 3000 },
        );

        let scrolledAncestors: Element[] = [];
        for (let el = scroller.parentElement; el; el = el.parentElement) {
          if (el.scrollTop !== 0) {
            scrolledAncestors.push(el);
          }
        }
        assert.strictEqual(
          scrolledAncestors.length,
          0,
          'no ancestor of the dashboard is scrolled',
        );
        assert.dom(ENTRY).hasAttribute('aria-current', 'location');
      });
    });

    module('get started', function () {
      const GET_STARTED = '[data-test-get-started]';
      const BUTTON = '[data-test-get-started-button]';

      // As `hasText` reads it: the count's markup breaks across lines.
      function countText() {
        return (find('[data-test-get-started-count]')?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function stepDone(id: string) {
        return find(`[data-test-get-started-step="${id}"]`)?.getAttribute(
          'data-test-get-started-step-done',
        );
      }

      // Closes the dashboard and opens it again, where Get started starts
      // closed.
      // The chooser's toggle is disabled with no stack open, so this sets
      // the state it toggles.
      async function reopenDashboard() {
        operatorModeState().workspaceChooserOpened = false;
        await settled();
        operatorModeState().workspaceChooserOpened = true;
        await waitFor('[data-test-dashboard-greeting]');
      }

      // From no progress at all, as a new account starts.
      async function visitAsNewUser() {
        await visitOperatorMode({ workspaceChooserOpened: true });
        (getService('recent-cards-service') as any).resetState();
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
        await settled();
        await reopenDashboard();
      }

      async function openSteps() {
        await click(BUTTON);
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

      test('a new account finds the steps closed, and the button opens them right after the header', async function (assert) {
        await visitAsNewUser();

        assert.dom(BUTTON).hasText('Get started');
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
        assert.dom(GET_STARTED).doesNotExist();

        await openSteps();
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'true');
        assert.dom(GET_STARTED).exists();
        assert.dom('[data-test-get-started-count]').hasText('0 of 3 done');
        assert.deepEqual(
          findAll('[data-test-get-started-step]').map((el) =>
            el.getAttribute('data-test-get-started-step'),
          ),
          ['open-card', 'ask-ai', 'publish'],
        );
        assert.dom('[data-test-get-started-step-done="true"]').doesNotExist();
        assert.strictEqual(
          find('[data-test-dashboard-greeting]')!.closest('header')!
            .nextElementSibling,
          find(GET_STARTED),
          'the steps open right after the header',
        );
      });

      test('the button closes the steps it opened', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        await click(BUTTON);
        assert.dom(GET_STARTED).doesNotExist();
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
      });

      test('the minimize button folds the list to its progress and next step, and expands it again', async function (assert) {
        const TOGGLE = '[data-test-get-started-toggle]';
        await visitAsNewUser();
        await openSteps();
        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        await settled();

        assert.strictEqual(nameFromTip(TOGGLE), 'Minimize steps');
        await click(TOGGLE);

        assert.dom(GET_STARTED).exists('the list stays open, folded');
        assert.dom('[data-test-get-started-step]').doesNotExist();
        assert.strictEqual(
          countText(),
          '1 of 3 done · Next: Ask Boxel AI Assistant to build something',
        );
        assert.strictEqual(nameFromTip(TOGGLE), 'Expand steps');
        assert.dom(TOGGLE).hasAttribute('aria-expanded', 'false');
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'true');

        await click(TOGGLE);
        assert.dom('[data-test-get-started-step]').exists({ count: 3 });
        assert.strictEqual(nameFromTip(TOGGLE), 'Minimize steps');
        assert.dom(TOGGLE).hasAttribute('aria-expanded', 'true');
      });

      test('reopened from the button, a folded list shows its steps again', async function (assert) {
        await visitAsNewUser();
        await openSteps();
        await click('[data-test-get-started-toggle]');

        await click(BUTTON);
        await click(BUTTON);

        assert.dom('[data-test-get-started-step]').exists({ count: 3 });
      });

      test('a step done while the steps are open keeps them open', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agentSetup: { claude: 1 },
        });
        await settled();

        assert.dom('[data-test-get-started-count]').hasText('1 of 3 done');
        assert.strictEqual(stepDone('agent'), 'true');
        assert.strictEqual(stepDone('open-card'), 'false');
      });

      test('opened steps are closed again when the dashboard reopens', async function (assert) {
        await visitAsNewUser();
        await openSteps();
        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        await settled();

        await reopenDashboard();

        assert.dom(GET_STARTED).doesNotExist();
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');

        await openSteps();
        assert.strictEqual(stepDone('open-card'), 'true');
      });

      test('opening a card and publishing a workspace tick their steps', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        markHosted(realmURL);
        await settled();

        assert.strictEqual(stepDone('open-card'), 'true');
        assert.strictEqual(stepDone('publish'), 'true');
        assert.strictEqual(stepDone('ask-ai'), 'false');
      });

      test('with no workspace to publish, the publish step says why instead of offering a button', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        assert.dom('[data-test-get-started-action="publish"]').doesNotExist();
        assert
          .dom('[data-test-get-started-publish-unavailable]')
          .hasText('Publishing needs a workspace you own.');
      });

      module('with workspaces to publish', function (hooks) {
        setupMoreWorkspaces(hooks);

        test('the publish step opens the publish dialog for the most recently updated workspace the user can publish', async function (assert) {
          await visitAsNewUser();
          // Ownership is known once each workspace's session is in.
          let realmService = getService('realm') as RealmService;
          await waitUntil(() =>
            [realmURL, ownedRealmURL].every((url) =>
              realmService.isRealmOwner(url),
            ),
          );
          let now = Date.now();
          for (let url of [realmURL, ownedRealmURL, sharedRealmURL]) {
            markPublishable(url);
          }
          markUpdated(realmURL, new Date(now - 60_000));
          markUpdated(ownedRealmURL, new Date(now - 30_000));
          // The newest, but shared with the user rather than theirs.
          markUpdated(sharedRealmURL, new Date(now));
          await settled();
          await openSteps();

          assert
            .dom('[data-test-get-started-publish-unavailable]')
            .doesNotExist();
          await click('[data-test-get-started-action="publish"]');
          await waitFor(PUBLISH_MODAL);

          assert.dom(PUBLISH_MODAL).containsText('workspace-b/');
          assert.dom(GET_STARTED).exists('the steps stay open behind it');

          await click(`${PUBLISH_MODAL} [data-test-close-modal]`);
          assert.dom(PUBLISH_MODAL).doesNotExist();
          assert
            .dom('[data-test-get-started-action="publish"]')
            .isFocused('focus goes back to the button');
        });
      });

      test('asking Boxel AI Assistant something ticks the ask step, and opening a session does not', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        let roomId = await openBoxelAiSession();
        assert.strictEqual(
          stepDone('ask-ai'),
          'false',
          'an empty session has not been asked anything',
        );

        sendMessage(roomId);
        await waitUntil(() => countText() === '1 of 3 done');

        assert.strictEqual(stepDone('ask-ai'), 'true');
      });

      test('a session the bot has renamed ticks the ask step, before any message loads', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        let roomId = await openBoxelAiSession();
        mockMatrixUtils.setRoomState(roomId, 'm.room.name', {
          name: 'Task tracker',
        });
        await waitUntil(() => countText() === '1 of 3 done');

        assert.strictEqual(stepDone('ask-ai'), 'true');
      });

      test('with every step done, neither the button nor the steps show', async function (assert) {
        await visitAsNewUser();
        await openSteps();
        assert.dom(GET_STARTED).exists();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'claude',
          agentSetup: { claude: 1 },
        });
        (getService('recent-cards-service') as any).add(`${realmURL}index`);
        markHosted(realmURL);
        await settled();

        assert.dom(GET_STARTED).doesNotExist('nothing left to start');
        assert.dom(BUTTON).doesNotExist();

        let matrixService = getService('matrix-service') as MatrixService;
        await waitUntil(() => matrixService.dashboardState.onboardingDismissed);
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
          .dom(BUTTON)
          .doesNotExist(
            'a step that reads as undone later does not bring it back',
          );

        await reopenDashboard();
        assert.dom(BUTTON).doesNotExist('still gone after reopening');
      });

      test('picking a coding agent puts the agent step in place of the ask step', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'codex',
        });
        await settled();

        assert.dom('[data-test-get-started-count]').hasText('0 of 3 done');
        assert.deepEqual(
          findAll('[data-test-get-started-step]').map((el) =>
            el.getAttribute('data-test-get-started-step'),
          ),
          ['open-card', 'agent', 'publish'],
        );
        assert.strictEqual(stepDone('agent'), 'false');
      });

      test("the agent step's action shows the Agents section", async function (assert) {
        await visitAsNewUser();
        await openSteps();
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          agent: 'codex',
        });
        await settled();

        await click('[data-test-get-started-action="agent"]');

        assert
          .dom('[data-test-section-rail-entry="agents"]')
          .hasAttribute('aria-current', 'location');
      });

      test('Dismiss saves that and leaves a note whose Undo brings the list back', async function (assert) {
        await visitAsNewUser();
        await openSteps();

        await click('[data-test-get-started-dismiss]');

        let matrixService = getService('matrix-service') as MatrixService;
        assert.dom(GET_STARTED).doesNotExist();
        assert
          .dom('[data-test-get-started-dismissed]')
          .containsText('Get started won’t show again.');
        assert.true(matrixService.dashboardState.onboardingDismissed);
        assert
          .dom('[data-test-get-started-undo-dismiss]')
          .isFocused('focus moves to Undo, since Dismiss is gone');
        assert.dom(BUTTON).doesNotExist('dismissed, the button goes too');

        await click('[data-test-get-started-undo-dismiss]');

        assert.dom('[data-test-get-started-dismissed]').doesNotExist();
        assert.dom('[data-test-get-started-step]').exists({ count: 3 });
        assert.false(matrixService.dashboardState.onboardingDismissed);
        assert.dom(BUTTON).exists('Undo brings the button back');
        assert.dom('[data-test-get-started-dismiss]').isFocused();
      });

      test('an undo from another device clears the dismissed note', async function (assert) {
        await visitAsNewUser();
        await openSteps();
        await click('[data-test-get-started-dismiss]');
        assert.dom('[data-test-get-started-dismissed]').exists();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: false,
        });
        await settled();

        assert.dom('[data-test-get-started-dismissed]').doesNotExist();
        assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: true,
        });
        await settled();

        assert
          .dom('[data-test-get-started-dismissed]')
          .doesNotExist('a dismissal made elsewhere brings no note here');
      });

      test('a dismissal from another device hides the open steps and the button', async function (assert) {
        await visitAsNewUser();
        await openSteps();
        assert.dom(GET_STARTED).exists();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: true,
        });
        await settled();

        assert.dom(GET_STARTED).doesNotExist();
        assert.dom(BUTTON).doesNotExist();
        assert.dom('[data-test-get-started-dismissed]').doesNotExist();

        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: false,
        });
        await settled();

        assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
        assert
          .dom(GET_STARTED)
          .doesNotExist('an undo made elsewhere leaves the steps closed');
      });

      test('once dismissed, neither the steps nor the button show on open', async function (assert) {
        await visitAsNewUser();
        await mockMatrixUtils.setDashboardStateFromAnotherDevice({
          onboardingDismissed: true,
        });
        await settled();

        await reopenDashboard();

        assert.dom(GET_STARTED).doesNotExist();
        assert.dom(BUTTON).doesNotExist();
        assert.dom('[data-test-get-started-dismissed]').doesNotExist();
      });
    });
  });
});
