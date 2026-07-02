import { module, test } from 'qunit';
import { click, settled, waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from '@cardstack/host/tests/helpers/setup';
import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  type TestContextWithSave,
} from '@cardstack/host/tests/helpers';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';

// @ts-expect-error import.meta is ESM, not CJS
const kanbanBoardModule: string = new URL('./kanban-board', import.meta.url)
  .href;

const boardId = `${testRealmURL}Boards/test-board`;
const card1Id = `${testRealmURL}Cards/card-1`;

export function runTests() {
  module('Kanban Board', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    // Shared fixture: "todo" column holds card-1; "done" column is empty.
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        realmURL: testRealmURL,
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'Cards/card-1.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
          'Boards/test-board.json': {
            data: {
              type: 'card',
              attributes: {
                boardTitle: 'Test Board',
                columns: [
                  {
                    key: 'todo',
                    label: 'To Do',
                    color: null,
                    wipLimit: 0,
                    collapsed: false,
                    sortOrder: 0,
                  },
                  {
                    key: 'done',
                    label: 'Done',
                    color: null,
                    wipLimit: 0,
                    collapsed: false,
                    sortOrder: 1,
                  },
                ],
                placements: [
                  { itemId: card1Id, columnKey: 'todo', sortOrder: 0 },
                ],
              },
              relationships: {
                'cards.0': { links: { self: card1Id } },
              },
              meta: {
                adoptsFrom: { module: kanbanBoardModule, name: 'KanbanBoard' },
              },
            },
          },
        },
      });
    });

    // ── placement ─────────────────────────────────────────────────────────────
    module('placement', function () {
      test('card appears in the correct column based on placements', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 2 }, 'both columns render');
        assert
          .dom('[data-kanban-column="todo"] [data-card-index="0"]')
          .exists('card-1 (index 0) is in the todo column');
        assert
          .dom('[data-kanban-column="done"] [data-card-index]')
          .doesNotExist('done column has no cards');
      });
    });

    // ── hide-empty ────────────────────────────────────────────────────────────
    module('hide-empty', function () {
      test('"hide empty" switch hides empty columns and reveals them when turned off', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 2 }, 'both columns visible before toggle');

        await click('[data-test-hide-empty-switch]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('[data-kanban-column="todo"]')
          .exists('non-empty todo column stays visible');
        assert
          .dom('[data-kanban-column="done"]')
          .doesNotExist('empty done column is hidden');

        await click('[data-test-hide-empty-switch]');
        await settled();

        assert
          .dom('[data-kanban-column]')
          .exists(
            { count: 2 },
            'both columns visible again after toggling off',
          );
        assert
          .dom('[data-test-hidden-columns]')
          .doesNotExist('hidden-columns tray is gone');
      });

      test('sidebar toggle is disabled for empty columns when hide-empty is on and cannot re-show them', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        // Open the sidebar before enabling hide-empty so we can verify it
        // reacts correctly to the prop change while already open.
        await click('[data-test-configure-columns-btn]');

        assert
          .dom('[data-test-col-config-toggle-visible="todo"]')
          .isNotDisabled('todo toggle enabled while hide-empty is off');
        assert
          .dom('[data-test-col-config-toggle-visible="done"]')
          .isNotDisabled('done toggle enabled while hide-empty is off');

        await click('[data-test-hide-empty-switch]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('[data-test-col-config-toggle-visible="todo"]')
          .isNotDisabled('non-empty todo toggle stays enabled');
        assert
          .dom('[data-test-col-config-toggle-visible="done"]')
          .isDisabled('empty done toggle is disabled');
        assert
          .dom('[data-kanban-column="done"]')
          .doesNotExist('done column stays hidden');
      });
    });

    // ── column collapse ───────────────────────────────────────────────────────
    module('column collapse', function () {
      test<TestContextWithSave>('collapsing a column from the header persists the collapsed state', async function (assert) {
        let savedDocPromise = new Promise<any>((resolve) => {
          this.onSave((url, doc) => {
            if (url.href === boardId) {
              resolve(doc);
            }
          });
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        assert.dom('[data-kanban-column="todo"]').exists();

        await click('[data-test-column-collapse-button="todo"]');
        await waitFor('[data-test-show-hidden-column="todo"]');

        assert
          .dom('[data-kanban-column="todo"]')
          .doesNotExist('todo column hidden after collapsing');
        assert
          .dom('[data-kanban-column="done"]')
          .exists('done column unaffected');

        let savedDoc = await savedDocPromise;
        let todoColumn = savedDoc.data.attributes.columns.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.true(
          todoColumn?.collapsed,
          'todo collapsed state is persisted to the board model',
        );
      });

      test<TestContextWithSave>('sidebar toggle persists collapsed state and can reveal the column again', async function (assert) {
        let savedDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) {
            savedDocs.push(doc);
          }
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-toggle-visible="todo"]');
        await waitFor('[data-test-show-hidden-column="todo"]');

        assert
          .dom('[data-kanban-column="todo"]')
          .doesNotExist('todo hidden after sidebar collapse');

        let collapseSave = savedDocs[savedDocs.length - 1];
        let collapsedTodo = collapseSave.data.attributes.columns.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.true(
          collapsedTodo?.collapsed,
          'sidebar collapse persists todo as collapsed',
        );

        await click('[data-test-col-config-toggle-visible="todo"]');
        await waitFor('[data-kanban-column="todo"]');

        assert
          .dom('[data-kanban-column="todo"]')
          .exists('todo visible again after sidebar reveal');

        let revealSave = savedDocs[savedDocs.length - 1];
        let revealedTodo = revealSave.data.attributes.columns.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.false(
          revealedTodo?.collapsed,
          'sidebar reveal persists todo as expanded',
        );
      });
    });
  });
}
