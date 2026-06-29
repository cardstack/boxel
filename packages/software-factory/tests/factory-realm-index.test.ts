import QUnit from 'qunit';
const { module, test } = QUnit;

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  inferRealmDashboardModuleUrl,
  linkBoardToRealmIndex,
  writeRealmDashboardCard,
} from '../src/factory-realm-index.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const REALM = 'https://realms.example.test/me/proj/';
const DARKFACTORY = 'https://realms.example.test/software-factory/darkfactory';

function clientFindingBoards(
  boards: Record<string, unknown>[],
  capture?: (realmUrls: unknown, query: Record<string, unknown>) => void,
): BoxelCLIClient {
  return {
    search: async (realmUrls: unknown, query: Record<string, unknown>) => {
      capture?.(realmUrls, query);
      return { ok: true, data: boards };
    },
  } as unknown as BoxelCLIClient;
}

module('factory-realm-index', function (hooks) {
  let workspace: ReturnType<typeof createTestWorkspace>;

  hooks.beforeEach(function () {
    workspace = createTestWorkspace();
  });

  hooks.afterEach(function () {
    workspace.cleanup();
  });

  test('inferRealmDashboardModuleUrl resolves against the realm origin', function (assert) {
    assert.strictEqual(
      inferRealmDashboardModuleUrl('https://realms.example.test/me/proj/'),
      'https://realms.example.test/software-factory/realm-dashboard',
    );
    // Realm endpoint and path are ignored — only the origin matters.
    assert.strictEqual(
      inferRealmDashboardModuleUrl('http://localhost:4201/user/deep/realm/'),
      'http://localhost:4201/software-factory/realm-dashboard',
    );
  });

  test('writeRealmDashboardCard writes an index.json adopting RealmDashboard linked to a CardsGrid', async function (assert) {
    await writeRealmDashboardCard(
      workspace.dir,
      'https://realms.example.test/me/proj/',
    );

    let index = JSON.parse(workspace.read('index.json'));
    assert.deepEqual(index, {
      data: {
        type: 'card',
        relationships: {
          cardsGrid: {
            links: {
              self: './cards-grid',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module:
              'https://realms.example.test/software-factory/realm-dashboard',
            name: 'RealmDashboard',
          },
        },
      },
    });

    let cardsGrid = JSON.parse(workspace.read('cards-grid.json'));
    assert.deepEqual(cardsGrid, {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    });
  });

  test('linkBoardToRealmIndex patches the index board link to the found IssueTracker', async function (assert) {
    await writeRealmDashboardCard(workspace.dir, REALM);

    let capturedQuery: Record<string, unknown> | undefined;
    let modified = await linkBoardToRealmIndex({
      client: clientFindingBoards(
        [{ id: `${REALM}Boards/proj-board` }],
        (_realms, query) => {
          capturedQuery = query;
        },
      ),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.true(modified, 'reports the index was modified');
    // Searches for IssueTracker in the sibling issue-tracker module.
    assert.deepEqual(capturedQuery?.filter, {
      type: {
        module: 'https://realms.example.test/software-factory/issue-tracker',
        name: 'IssueTracker',
      },
    });

    let index = JSON.parse(workspace.read('index.json'));
    assert.deepEqual(
      index.data.relationships.board,
      { links: { self: './Boards/proj-board' } },
      'board link points at the found board',
    );
    // The cardsGrid link written at bootstrap is preserved.
    assert.deepEqual(index.data.relationships.cardsGrid, {
      links: { self: './cards-grid' },
    });
  });

  test('linkBoardToRealmIndex is a no-op when no board exists yet', async function (assert) {
    await writeRealmDashboardCard(workspace.dir, REALM);

    let modified = await linkBoardToRealmIndex({
      client: clientFindingBoards([]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.false(modified, 'reports no modification');
    let index = JSON.parse(workspace.read('index.json'));
    assert.strictEqual(
      index.data.relationships.board,
      undefined,
      'board link stays unset',
    );
  });

  test('linkBoardToRealmIndex retries an empty search and links once the board is indexed', async function (assert) {
    await writeRealmDashboardCard(workspace.dir, REALM);

    // The board sync is fire-and-forget, so the first searches can race the
    // indexer and come back empty before the board appears.
    let searchCount = 0;
    let raceyClient = {
      search: async () => {
        searchCount++;
        return searchCount < 3
          ? { ok: true, data: [] }
          : { ok: true, data: [{ id: `${REALM}Boards/proj-board` }] };
      },
    } as unknown as BoxelCLIClient;

    let modified = await linkBoardToRealmIndex({
      client: raceyClient,
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
      searchRetries: 5,
      searchRetryDelayMs: 0,
    });

    assert.true(modified, 'links once the board shows up on a later search');
    assert.strictEqual(searchCount, 3, 'polled until the board was indexed');
    let index = JSON.parse(workspace.read('index.json'));
    assert.deepEqual(index.data.relationships.board, {
      links: { self: './Boards/proj-board' },
    });
  });

  test('linkBoardToRealmIndex gives up after exhausting retries', async function (assert) {
    await writeRealmDashboardCard(workspace.dir, REALM);

    let searchCount = 0;
    let emptyClient = {
      search: async () => {
        searchCount++;
        return { ok: true, data: [] };
      },
    } as unknown as BoxelCLIClient;

    let modified = await linkBoardToRealmIndex({
      client: emptyClient,
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
      searchRetries: 3,
      searchRetryDelayMs: 0,
    });

    assert.false(
      modified,
      'reports no modification when the board never appears',
    );
    assert.strictEqual(searchCount, 4, 'one initial search plus three retries');
    let index = JSON.parse(workspace.read('index.json'));
    assert.strictEqual(index.data.relationships.board, undefined);
  });

  test('linkBoardToRealmIndex is idempotent when the board link is already correct', async function (assert) {
    await writeRealmDashboardCard(workspace.dir, REALM);

    let options = {
      client: clientFindingBoards([{ id: `${REALM}Boards/proj-board` }]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    };

    assert.true(await linkBoardToRealmIndex(options), 'first run links');
    assert.false(
      await linkBoardToRealmIndex(options),
      'second run is a no-op once the link is set',
    );
  });
});
