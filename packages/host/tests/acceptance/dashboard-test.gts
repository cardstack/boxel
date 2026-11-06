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

import { module, test } from 'qunit';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  setupAcceptanceTestRealm,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import {
  realmURL,
  clickScopeOption,
  markHosted,
  nameFromTip,
  descriptionOf,
  pressKey,
  sectionOrder,
  railOrder,
  operatorModeState,
  setupDashboardTest,
} from '../helpers/dashboard';
import {
  getRealmServerRoute,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { stubWindowOpen } from '../helpers/window-open';

module('Acceptance | dashboard', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks);

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
      .dom('[data-test-dashboard-section="catalogs"] [data-test-catalog-list]')
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
      .dom(`${workspaces} [data-test-workspace-list] [data-test-add-workspace]`)
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
        {
          url: 'https://older.example.com/',
          target: '_blank',
          features: 'noopener,noreferrer',
        },
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

    let desk = '[data-test-favorites-list] [data-test-workspace="Workspace A"]';
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
        {
          url: 'https://older.example.com/',
          target: '_blank',
          features: 'noopener,noreferrer',
        },
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
  module('removing the workspace open behind the dashboard', function (hooks) {
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
      await click(`[data-test-workspace-menu-trigger="${removedRealmURL}"]`);
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
      await click(`[data-test-workspace-menu-trigger="${removedRealmURL}"]`);
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
      assert.dom('[data-test-dashboard]').exists('the dashboard stays open');
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
          stacks: [[{ id: `${removedRealmURL}Person/1`, format: 'isolated' }]],
        });

        await click(`[data-test-workspace-menu-trigger="${removedRealmURL}"]`);
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
          stacks: [[{ id: `${removedRealmURL}Person/1`, format: 'isolated' }]],
        });

        await click(`[data-test-workspace-menu-trigger="${removedRealmURL}"]`);
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
  });
});
