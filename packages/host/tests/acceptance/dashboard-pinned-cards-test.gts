import {
  click,
  findAll,
  settled,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import SetWorkspacePinTool from '@cardstack/host/tools/set-workspace-pin';

import {
  setupAcceptanceTestRealm,
  visitOperatorMode,
  realmConfigCardJSON,
  withholdRealmSession,
} from '../helpers';
import {
  realmURL,
  setupDashboardTest,
  type DashboardRealm,
  operatorModeState,
} from '../helpers/dashboard';

module('Acceptance | dashboard pinned cards', function (hooks) {
  let mainRealm: DashboardRealm;
  let mockMatrixUtils = setupDashboardTest(hooks, {
    onRealm: (realm) => (mainRealm = realm),
  });

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
      .hasText('Pinned 5', 'every pinned card is counted once, drawn or not');
    assert
      .dom('[data-test-workspace="Pinned Workspace"]')
      .exists({ count: 2 }, 'it is listed as a desk and again below');
    assert
      .dom('[data-test-pinned-cards]')
      .exists({ count: 1 }, 'only the desk shows pins');
  });

  test('a pin saved to the Workspace card shows on its desk without a reload', async function (assert) {
    const deskPins =
      '[data-test-favorites-list] [data-test-workspace="Workspace A"] [data-test-pinned-card]';
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitWithFavorites([realmURL]);
    assert.dom(deskPins).doesNotExist();

    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './notes' } },
        }),
      ),
    );
    await waitUntil(() => findAll(deskPins).length === 1);

    assert
      .dom(deskPins)
      .hasAttribute('aria-label', 'Open Notes')
      .hasAttribute('data-test-pinned-card', `${realmURL}notes`);
  });

  test("a write to another card doesn't search for the desk's pins again", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './notes' } },
        }),
      ),
    );
    let pinSearches = 0;
    let { virtualNetwork } = getService('network');
    let countPinSearches = async (request: Request) => {
      if (
        request.url.endsWith('/_federated-search') &&
        JSON.stringify(await request.clone().json()).includes(
          'item.entryPoints',
        )
      ) {
        pinSearches++;
      }
      return null;
    };
    virtualNetwork.mount(countPinSearches, { prepend: true });
    try {
      await visitWithFavorites([realmURL]);
      await waitUntil(
        () =>
          findAll(
            '[data-test-favorites-list] [data-test-workspace="Workspace A"] [data-test-pinned-card]',
          ).length === 1,
      );
      let searchesBefore = pinSearches;

      await mainRealm.write('other.json', JSON.stringify(cardJSON('Other')));
      await settled();

      assert.true(searchesBefore > 0, 'the desk searched for its pins');
      assert.strictEqual(
        pinSearches,
        searchesBefore,
        'the pins are not searched again',
      );
    } finally {
      virtualNetwork.unmount(countPinSearches);
    }
  });

  // The ids in the stack a pin opens, from the bottom.
  function openedStack() {
    let { stacks } = operatorModeState().state;
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

  const PIN = '[data-test-boxel-menu-item-text="Pin to Workspace"]';
  const UNPIN = '[data-test-boxel-menu-item-text="Unpin from Workspace"]';
  const COPY_URL = '[data-test-boxel-menu-item-text="Copy Card URL"]';
  const WORKSPACE_A_PINS =
    '[data-test-favorites-list] [data-test-workspace="Workspace A"] [data-test-pinned-card]';

  async function openCardMenu(cardId: string) {
    await click(
      `[data-test-stack-card="${cardId}"] [data-test-more-options-button]`,
    );
    await waitFor(COPY_URL);
  }

  async function openDashboard(favorites: string[]) {
    (getService('matrix-service') as MatrixService).workspaceFavorites =
      favorites;
    await click('[data-test-workspace-chooser-toggle]');
    await waitFor('[data-test-dashboard]');
  }

  test("a card's menu pins it to its workspace, and its desk shows it without a reload", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
    });

    await openCardMenu(`${realmURL}notes`);
    await waitFor(PIN);
    assert.dom(UNPIN).doesNotExist();
    await click(PIN);

    await openDashboard([realmURL]);
    await waitUntil(() => findAll(WORKSPACE_A_PINS).length === 1);
    assert
      .dom(WORKSPACE_A_PINS)
      .hasAttribute('data-test-pinned-card', `${realmURL}notes`);
  });

  test("pinning a card keeps the workspace's other pins, even one whose card is missing", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('roadmap.json', JSON.stringify(cardJSON('Roadmap')));
    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './roadmap' } },
          'entryPoints.1': { links: { self: './missing' } },
        }),
      ),
    );
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
    });

    await openCardMenu(`${realmURL}notes`);
    await waitFor(PIN);
    await click(PIN);
    // The menu offers Unpin once the saved pin is indexed.
    await openCardMenu(`${realmURL}notes`);
    await waitFor(UNPIN);

    let source = await (
      await (getService('network') as NetworkService).authedFetch(
        `${realmURL}index.json`,
        { headers: { Accept: SupportedMimeType.CardSource } },
      )
    ).json();
    let relationships = source.data.relationships;
    assert.deepEqual(
      [0, 1, 2].map((i) => relationships[`entryPoints.${i}`]?.links?.self),
      ['./roadmap', './missing', './notes'],
    );
  });

  test("a pinned card's menu unpins it, and its desk drops it without a reload", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './notes' } },
        }),
      ),
    );
    await visitWithFavorites([realmURL]);
    await waitUntil(() => findAll(WORKSPACE_A_PINS).length === 1);
    await click(`[data-test-pinned-card="${realmURL}notes"]`);

    await openCardMenu(`${realmURL}notes`);
    await waitFor(UNPIN);
    assert.dom(PIN).doesNotExist();
    await click(UNPIN);

    await openDashboard([realmURL]);
    await waitFor(
      '[data-test-favorites-list] [data-test-workspace="Workspace A"]',
    );
    await waitUntil(() => findAll(WORKSPACE_A_PINS).length === 0);
    assert.dom(WORKSPACE_A_PINS).doesNotExist();
  });

  async function savedPins(count: number) {
    let source = await (
      await (getService('network') as NetworkService).authedFetch(
        `${realmURL}index.json`,
        { headers: { Accept: SupportedMimeType.CardSource } },
      )
    ).json();
    let relationships = source.data.relationships ?? {};
    return [...Array(count).keys()].map(
      (i) => relationships[`entryPoints.${i}`]?.links?.self,
    );
  }

  test('unpinning removes a pin whose card fails to load', async function (assert) {
    await mainRealm.write('roadmap.json', JSON.stringify(cardJSON('Roadmap')));
    await mainRealm.write(
      'broken.json',
      JSON.stringify({
        data: {
          meta: { adoptsFrom: { module: './no-such-module', name: 'Nothing' } },
        },
      }),
    );
    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './roadmap' } },
          'entryPoints.1': { links: { self: './broken' } },
        }),
      ),
    );
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}roadmap`, format: 'isolated' }]],
    });

    let { toolContext } = getService('tool-service');
    await new SetWorkspacePinTool(toolContext).execute({
      cardId: `${realmURL}broken`,
      pinned: false,
    });

    assert.deepEqual(await savedPins(2), ['./roadmap', undefined]);
  });

  test("a pin that can't be saved reports the failure, and trying again saves it", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
    });
    let { virtualNetwork } = getService('network') as NetworkService;
    let failing = true;
    let failIndexSave = async (request: Request) =>
      failing &&
      request.method === 'PATCH' &&
      request.url.replace(/\.json$/, '') === `${realmURL}index`
        ? new Response(
            JSON.stringify({
              errors: [{ status: 500, title: 'Save failed' }],
            }),
            { status: 500 },
          )
        : null;
    virtualNetwork.mount(failIndexSave, { prepend: true });
    try {
      let { toolContext } = getService('tool-service');
      await assert.rejects(
        new SetWorkspacePinTool(toolContext).execute({
          cardId: `${realmURL}notes`,
          pinned: true,
        }),
        /couldn't be saved/,
      );

      failing = false;
      await new SetWorkspacePinTool(toolContext).execute({
        cardId: `${realmURL}notes`,
        pinned: true,
      });
      assert.deepEqual(await savedPins(1), ['./notes']);
    } finally {
      virtualNetwork.unmount(failIndexSave);
    }
  });

  test('two pins made at once are both kept', async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('roadmap.json', JSON.stringify(cardJSON('Roadmap')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
    });

    let { toolContext } = getService('tool-service');
    await Promise.all([
      new SetWorkspacePinTool(toolContext).execute({
        cardId: `${realmURL}notes`,
        pinned: true,
      }),
      new SetWorkspacePinTool(toolContext).execute({
        cardId: `${realmURL}roadmap`,
        pinned: true,
      }),
    ]);

    assert.deepEqual((await savedPins(2)).sort(), ['./notes', './roadmap']);
  });

  test("a workspace's root URL can't be pinned to it", async function (assert) {
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
    });

    let { toolContext } = getService('tool-service');
    await assert.rejects(
      new SetWorkspacePinTool(toolContext).execute({
        cardId: realmURL,
        pinned: true,
      }),
      /index card can't be one of its pins/,
    );
    assert.deepEqual(await savedPins(1), [undefined]);
  });

  test("the Workspace Home's unpin keeps the other pins, even one whose card is missing", async function (assert) {
    await mainRealm.write('roadmap.json', JSON.stringify(cardJSON('Roadmap')));
    await mainRealm.write(
      'index.json',
      JSON.stringify(
        workspaceIndexJSON({
          'entryPoints.0': { links: { self: './roadmap' } },
          'entryPoints.1': { links: { self: './missing' } },
        }),
      ),
    );
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
    });

    await click('[data-test-door-unpin="0"]');

    assert.deepEqual(await savedPins(2), ['./missing', undefined]);
  });

  test("the code mode preview's menu pins a card to its workspace", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    // A stack keeps the dashboard toggle enabled.
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
      submode: 'code',
      codePath: `${realmURL}notes.json`,
    });

    await click('[data-test-more-options-button]');
    await waitFor(PIN);
    await click(PIN);

    await openDashboard([realmURL]);
    await waitUntil(() => findAll(WORKSPACE_A_PINS).length === 1);
    assert
      .dom(WORKSPACE_A_PINS)
      .hasAttribute('data-test-pinned-card', `${realmURL}notes`);
  });

  test("a card's menu in its workspace's card grid pins it", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
    });

    let gridItem = `[data-test-cards-grid-item="${realmURL}notes"]`;
    await click('[data-test-workspace-tab="library"]');
    await waitFor(gridItem);
    await triggerEvent(`${gridItem} [data-test-hydratable-card]`, 'mouseenter');
    await click(
      `[data-test-overlay-card="${realmURL}notes"] [data-test-overlay-more-options]`,
    );
    await waitFor(PIN);
    await click(PIN);

    await openDashboard([realmURL]);
    await waitUntil(() => findAll(WORKSPACE_A_PINS).length === 1);
    assert
      .dom(WORKSPACE_A_PINS)
      .hasAttribute('data-test-pinned-card', `${realmURL}notes`);
  });

  test("a card's menu offers no pin to a user who can't write to its workspace", async function (assert) {
    const readOnlyRealmURL = 'http://test-realm/testuser/read-only/';
    await setupAcceptanceTestRealm({
      realmURL: readOnlyRealmURL,
      mockMatrixUtils,
      permissions: { '@testuser:localhost': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Read-only Workspace' }),
        'notes.json': cardJSON('Notes'),
        'index.json': workspaceIndexJSON({}),
      },
    });
    await visitOperatorMode({
      stacks: [[{ id: `${readOnlyRealmURL}notes`, format: 'isolated' }]],
    });

    await openCardMenu(`${readOnlyRealmURL}notes`);
    await settled();
    assert.dom(PIN).doesNotExist();
    assert.dom(UNPIN).doesNotExist();
  });

  test("a card's menu offers no pin when its realm's index card isn't a Workspace", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(cardJSON('Home')));
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}notes`, format: 'isolated' }]],
    });

    await openCardMenu(`${realmURL}notes`);
    await settled();
    assert.dom(PIN).doesNotExist();
    assert.dom(UNPIN).doesNotExist();
  });

  test("the Workspace card's own menu offers no pin", async function (assert) {
    await mainRealm.write('notes.json', JSON.stringify(cardJSON('Notes')));
    await mainRealm.write('index.json', JSON.stringify(workspaceIndexJSON({})));
    await visitOperatorMode({
      stacks: [
        [{ id: `${realmURL}index`, format: 'isolated' }],
        [{ id: `${realmURL}notes`, format: 'isolated' }],
      ],
    });
    // The other card in the workspace can be pinned, so the workspace's pins
    // have loaded by the time the index card's menu is read.
    await openCardMenu(`${realmURL}notes`);
    await waitFor(PIN);

    await openCardMenu(`${realmURL}index`);
    assert.dom(PIN).doesNotExist();
    assert.dom(UNPIN).doesNotExist();
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
    assert.dom(`${desk} [data-test-workspace-stat="Pinned"]`).doesNotExist();
  });
});
