import { module, test } from 'qunit';
import {
  click,
  fillIn,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
} from '@ember/test-helpers';

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
const issueTrackerModule: string = new URL('./issue-tracker', import.meta.url)
  .href;

const projectId = `${testRealmURL}Projects/test-project`;
const boardId = `${testRealmURL}Boards/test-board`;

function makeIssue(
  issueId: string,
  status: string,
  filename: string,
): Record<string, Record<string, unknown>> {
  return {
    [filename]: {
      data: {
        type: 'card',
        attributes: { issueId, summary: `${issueId} issue`, status },
        relationships: { project: { links: { self: projectId } } },
        meta: { adoptsFrom: { module: issueTrackerModule, name: 'Issue' } },
      },
    },
  };
}

function makeProject(
  issueStatusOptions?: { value: string; label: string }[],
): Record<string, Record<string, unknown>> {
  return {
    'Projects/test-project.json': {
      data: {
        type: 'card',
        attributes: {
          projectCode: 'IT',
          projectName: 'Issue Tracker Test',
          projectStatus: 'active',
          ...(issueStatusOptions ? { issueStatusOptions } : {}),
        },
        meta: { adoptsFrom: { module: issueTrackerModule, name: 'Project' } },
      },
    },
  };
}

function makeBoard(
  columns?: {
    key: string;
    label: string | null;
    color: string | null;
    wipLimit: number | null;
    collapsed: boolean;
    sortOrder: number;
  }[],
): Record<string, Record<string, unknown>> {
  return {
    'Boards/test-board.json': {
      data: {
        type: 'card',
        attributes: {
          boardTitle: 'Test Board',
          ...(columns ? { columns } : {}),
        },
        relationships: { project: { links: { self: projectId } } },
        meta: {
          adoptsFrom: { module: issueTrackerModule, name: 'IssueTracker' },
        },
      },
    },
  };
}

export function runTests() {
  module('Issue Tracker | board interactions', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    // ── issue placement ───────────────────────────────────────────────────────
    module('issue placement', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeIssue('IT-1', 'backlog', 'Issues/issue-backlog.json'),
            ...makeIssue(
              'IT-2',
              'in_progress',
              'Issues/issue-in-progress.json',
            ),
            ...makeIssue('IT-3', 'done', 'Issues/issue-done.json'),
            ...makeBoard(),
          },
        });
      });

      test('issues appear in the correct column based on status', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert.dom('[data-test-issue-tracker-card-count]').hasText('3 cards');
        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id]`)
          .hasText('IT-1', 'backlog issue is in the Backlog column');
        assert
          .dom(`[data-kanban-column="in_progress"] [data-test-issue-id]`)
          .hasText('IT-2', 'in-progress issue is in the In Progress column');
        assert
          .dom(`[data-kanban-column="done"] [data-test-issue-id]`)
          .hasText('IT-3', 'done issue is in the Done column');
      });

      test('"hide empty" toggle hides columns with no cards', async function (assert) {
        // backlog, in_progress, done have 1 card each; blocked and review are empty
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 5 }, 'all 5 status columns visible before toggle');

        await click('[data-test-hide-empty-switch]');

        assert
          .dom('[data-kanban-column]')
          .exists(
            { count: 3 },
            'only 3 non-empty columns visible after toggle',
          );
        assert
          .dom(`[data-kanban-column="blocked"]`)
          .doesNotExist('blocked column hidden');
        assert
          .dom(`[data-kanban-column="review"]`)
          .doesNotExist('review column hidden');
      });

      test<TestContextWithSave>('collapsing a column updates the persisted collapsed state', async function (assert) {
        let savedBoardDocPromise = new Promise<any>((resolve) => {
          this.onSave((url, doc) => {
            if (url.href === boardId) {
              resolve(doc);
            }
          });
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert.dom(`[data-kanban-column="backlog"]`).exists();

        await click(`[data-test-column-collapse-button="backlog"]`);
        await waitFor('[data-test-show-hidden-column="backlog"]');

        assert
          .dom(`[data-kanban-column="backlog"]`)
          .doesNotExist('backlog column is hidden after collapsing');
        assert
          .dom('[data-test-show-hidden-column="backlog"]')
          .exists('hidden tray contains the collapsed backlog column');

        let savedBoardDoc = await savedBoardDocPromise;
        let savedColumns = savedBoardDoc.data.attributes.columns;
        let backlogColumn = savedColumns.find(
          (column: { key: string }) => column.key === 'backlog',
        );

        assert.true(
          backlogColumn?.collapsed,
          'backlog collapsed state is persisted on the board model',
        );
      });

      test<TestContextWithSave>('sidebar visibility toggle persists collapsed state and can reveal the column again', async function (assert) {
        let savedBoardDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) {
            savedBoardDocs.push(doc);
          }
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-toggle-visible="backlog"]');
        await waitFor('[data-test-show-hidden-column="backlog"]');

        assert
          .dom(`[data-kanban-column="backlog"]`)
          .doesNotExist(
            'backlog column is hidden after collapsing from the sidebar',
          );

        let collapsedSave = savedBoardDocs[savedBoardDocs.length - 1];
        let collapsedBacklog = collapsedSave.data.attributes.columns.find(
          (column: { key: string }) => column.key === 'backlog',
        );
        assert.true(
          collapsedBacklog?.collapsed,
          'sidebar collapse persists backlog as collapsed',
        );

        await click('[data-test-col-config-toggle-visible="backlog"]');
        await waitFor(`[data-kanban-column="backlog"]`);

        assert
          .dom(`[data-kanban-column="backlog"]`)
          .exists(
            'backlog column is shown again after revealing from the sidebar',
          );

        let revealedSave = savedBoardDocs[savedBoardDocs.length - 1];
        let revealedBacklog = revealedSave.data.attributes.columns.find(
          (column: { key: string }) => column.key === 'backlog',
        );
        assert.false(
          revealedBacklog?.collapsed,
          'sidebar reveal persists backlog as expanded',
        );
      });

      test('turning hide empty off reveals empty columns even if they were hidden from the sidebar', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="blocked"]`)
          .exists('blocked starts visible while hide-empty is off');

        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-toggle-visible="blocked"]');
        await waitFor('[data-test-show-hidden-column="blocked"]');

        assert
          .dom(`[data-kanban-column="blocked"]`)
          .doesNotExist('blocked is hidden after sidebar toggle');

        await click('[data-test-hide-empty-switch]');
        await click('[data-test-hide-empty-switch]');

        assert
          .dom(`[data-kanban-column="blocked"]`)
          .exists(
            'blocked is visible again after hide-empty is turned back off',
          );
      });

      test<TestContextWithSave>('turning hide-empty off uncollapses the previously-hidden empty columns', async function (assert) {
        let boardSaves: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) {
            boardSaves.push(doc);
          }
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        // Turn on hide-empty — blocked and review (empty) disappear
        await click('[data-test-hide-empty-switch]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('[data-test-hide-empty-switch][data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on');

        // Turn hide-empty back off
        await click('[data-test-hide-empty-switch]');
        await settled();

        assert
          .dom('[data-test-hide-empty-switch][data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'off', 'switch is off');
        assert
          .dom('[data-kanban-column]')
          .exists({ count: 5 }, 'all columns visible again');
        assert
          .dom('[data-test-hidden-columns]')
          .doesNotExist('hidden tray gone');

        let lastSave = boardSaves[boardSaves.length - 1];
        let savedColumns = lastSave?.data.attributes.columns;
        let blockedColumn = savedColumns?.find(
          (c: { key: string }) => c.key === 'blocked',
        );
        let reviewColumn = savedColumns?.find(
          (c: { key: string }) => c.key === 'review',
        );
        assert.false(
          blockedColumn?.collapsed,
          'blocked column is no longer collapsed after turning off hide-empty',
        );
        assert.false(
          reviewColumn?.collapsed,
          'review column is no longer collapsed after turning off hide-empty',
        );
      });

      test('collapsing one column from the header leaves all other columns visible', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert.dom('[data-kanban-column]').exists({ count: 5 });

        await click(`[data-test-column-collapse-button="backlog"]`);
        await waitFor('[data-test-show-hidden-column="backlog"]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 4 }, 'only the collapsed column is removed');
        assert
          .dom(`[data-kanban-column="backlog"]`)
          .doesNotExist('backlog is hidden');
        assert
          .dom(`[data-kanban-column="in_progress"]`)
          .exists('in_progress still visible');
        assert.dom(`[data-kanban-column="done"]`).exists('done still visible');
      });

      test('can hide a column from the header and reveal it from the sidebar, and vice versa', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        // Hide backlog from the column header
        await click(`[data-test-column-collapse-button="backlog"]`);
        await waitFor('[data-test-show-hidden-column="backlog"]');
        assert
          .dom(`[data-kanban-column="backlog"]`)
          .doesNotExist('backlog hidden via column header');

        // Reveal backlog from the sidebar toggle
        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-toggle-visible="backlog"]');
        await waitFor(`[data-kanban-column="backlog"]`);
        assert
          .dom(`[data-kanban-column="backlog"]`)
          .exists('backlog revealed via sidebar toggle');

        // Hide in-progress from the sidebar toggle
        await click('[data-test-col-config-toggle-visible="in_progress"]');
        await waitFor('[data-test-show-hidden-column="in_progress"]');
        assert
          .dom(`[data-kanban-column="in_progress"]`)
          .doesNotExist('in-progress hidden via sidebar toggle');

        // Reveal in-progress from the hidden-columns tray in the header
        await click('[data-test-show-hidden-column="in_progress"]');
        await waitFor(`[data-kanban-column="in_progress"]`);
        assert
          .dom(`[data-kanban-column="in_progress"]`)
          .exists('in-progress revealed via hidden-columns tray');
        assert.dom('[data-test-hidden-columns]').doesNotExist('tray gone');
      });

      test('after hiding columns from both header and sidebar, hide-empty toggle is on; turning it off reveals only the empty-hidden columns', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        // Turn on hide-empty — blocked (col 2) and review (col 3) are empty
        await click('[data-test-hide-empty-switch]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('[data-test-hide-empty-switch][data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on', 'switch is on');
        assert
          .dom('[data-kanban-column]')
          .exists({ count: 3 }, 'two empty columns hidden');

        // Also collapse backlog from the column header
        await click(`[data-test-column-collapse-button="backlog"]`);
        await waitFor('[data-test-hidden-column-count]');
        assert
          .dom('[data-test-hidden-column-count]')
          .hasText('3', '3 columns hidden total');

        // Also collapse in-progress from the sidebar
        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-toggle-visible="in_progress"]');
        await waitFor('[data-test-show-hidden-column="in_progress"]');
        assert
          .dom('[data-test-hidden-column-count]')
          .hasText('4', '4 columns hidden total');

        // Switch must still appear ON
        assert
          .dom('[data-test-hide-empty-switch][data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on', 'switch still on');

        // Turn off hide-empty — reveals only the empty-hidden columns
        await click('[data-test-hide-empty-switch]');
        await settled();

        assert
          .dom('[data-test-hide-empty-switch][data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'off', 'switch now off');
        assert
          .dom(`[data-kanban-column="blocked"]`)
          .exists('blocked is visible again (was empty-hidden)');
        assert
          .dom(`[data-kanban-column="review"]`)
          .exists('review is visible again (was empty-hidden)');
        assert
          .dom(`[data-kanban-column="backlog"]`)
          .doesNotExist(
            'backlog stays hidden (was manually collapsed, has cards)',
          );
        assert
          .dom(`[data-kanban-column="in_progress"]`)
          .doesNotExist(
            'in-progress stays hidden (was manually collapsed, has cards)',
          );
      });
    });

    // ── column config sync ────────────────────────────────────────────────────
    module('column config sync', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject([
              { value: 'todo', label: 'To Do' },
              { value: 'doing', label: 'Doing' },
              { value: 'done', label: 'Done' },
            ]),
            ...makeBoard(),
          },
        });
      });

      test<TestContextWithSave>('renaming a column in the sidebar updates the matching project issueStatusOption label, and recoloring updates its color', async function (assert) {
        let savedBoardDocs: any[] = [];
        let savedProjectDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) savedBoardDocs.push(doc);
          if (url.href === projectId) savedProjectDocs.push(doc);
        });

        await visitOperatorMode({
          stacks: [
            [{ id: boardId, format: 'isolated' }],
            [{ id: projectId, format: 'isolated' }],
          ],
        });
        await waitFor('[data-kanban-column]');
        await waitFor('[data-test-operator-mode-stack="1"]');

        // Open sidebar and rename "To Do" → "Planning"
        await click('[data-test-configure-columns-btn]');
        await fillIn('[data-test-col-config-label="todo"]', 'Planning');
        await settled();

        let afterLabelDoc = savedBoardDocs[savedBoardDocs.length - 1];
        let columnsAfterRename = afterLabelDoc?.data?.attributes?.columns;
        let todoColumn = columnsAfterRename?.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.strictEqual(
          todoColumn?.label,
          'Planning',
          'board column label updated to match sidebar rename',
        );
        let doingColumn = columnsAfterRename?.find(
          (c: { key: string }) => c.key === 'doing',
        );
        assert.strictEqual(
          doingColumn?.label,
          'Doing',
          'other column labels unchanged',
        );

        // Recolor the first column and verify the board column color syncs
        let colorInput = document.querySelector(
          '[data-test-col-config-color="todo"]',
        ) as HTMLInputElement;
        colorInput.value = '#ff0000';
        await triggerEvent(colorInput, 'input');
        await settled();

        let afterColorDoc = savedBoardDocs[savedBoardDocs.length - 1];
        let columnsAfterRecolor = afterColorDoc?.data?.attributes?.columns;
        let todoColumnAfterRecolor = columnsAfterRecolor?.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.strictEqual(
          todoColumnAfterRecolor?.color,
          '#ff0000',
          'board column color updated to match sidebar recolor',
        );
        assert.strictEqual(
          todoColumnAfterRecolor?.label,
          'Planning',
          'label is preserved after recolor',
        );

        // The project card is open in the second stack — verify its
        // issueStatusOptions were synced and saved.
        let projectDoc = savedProjectDocs[savedProjectDocs.length - 1];
        let projectOptions = projectDoc?.data?.attributes?.issueStatusOptions;
        assert.strictEqual(
          projectOptions?.[0]?.label,
          'Planning',
          'project issueStatusOption label synced and persisted',
        );
        assert.strictEqual(
          projectOptions?.[0]?.color,
          '#ff0000',
          'project issueStatusOption color synced and persisted',
        );
      });
      test<TestContextWithSave>('reordering a column in the sidebar persists the new order and is respected on reload', async function (assert) {
        let savedBoardDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) savedBoardDocs.push(doc);
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        await click('[data-test-configure-columns-btn]');
        await click('[data-test-move-col-down-btn="todo"]');
        await settled();

        let savedDoc = savedBoardDocs[savedBoardDocs.length - 1];
        let savedColumns = savedDoc?.data?.attributes?.columns;
        assert.strictEqual(
          savedColumns?.[0]?.key,
          'doing',
          'doing is first in saved columns after reorder',
        );
        assert.strictEqual(
          savedColumns?.[1]?.key,
          'todo',
          'todo moved to second position in saved columns',
        );
        assert.strictEqual(
          savedColumns?.[0]?.sortOrder,
          1,
          'doing sortOrder updated to 1',
        );
        assert.strictEqual(
          savedColumns?.[1]?.sortOrder,
          2,
          'todo sortOrder updated to 2',
        );
        assert.strictEqual(
          savedColumns?.[2]?.sortOrder,
          3,
          'done sortOrder unchanged at 3',
        );

        // Reload the board and verify the stored order is respected
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        let colEls = document.querySelectorAll('[data-kanban-column]');
        assert.strictEqual(
          colEls[0]?.getAttribute('data-kanban-column'),
          'doing',
          'doing appears first after reload',
        );
        assert.strictEqual(
          colEls[1]?.getAttribute('data-kanban-column'),
          'todo',
          'todo appears second after reload',
        );
      });

      test<TestContextWithSave>('changing the WIP limit in the sidebar persists to the board', async function (assert) {
        let savedBoardDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === boardId) savedBoardDocs.push(doc);
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        await click('[data-test-configure-columns-btn]');
        await fillIn('[data-test-col-config-wip="todo"]', '3');
        await settled();

        let savedDoc = savedBoardDocs[savedBoardDocs.length - 1];
        let savedColumns = savedDoc?.data?.attributes?.columns;
        let todoColumn = savedColumns?.find(
          (c: { key: string }) => c.key === 'todo',
        );
        assert.strictEqual(
          todoColumn?.wipLimit,
          3,
          'todo WIP limit persisted as 3',
        );

        let doingColumn = savedColumns?.find(
          (c: { key: string }) => c.key === 'doing',
        );
        assert.strictEqual(
          doingColumn?.wipLimit,
          0,
          'other column WIP limits unchanged',
        );
      });
    });

    // ── unknown status ────────────────────────────────────────────────────────
    module('unknown status', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeIssue('IT-1', 'unknown_xyz', 'Issues/issue-unknown.json'),
            ...makeBoard(),
          },
        });
      });

      test('issue with unrecognised status falls to column 0', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id]`)
          .hasText(
            'IT-1',
            'unknown status falls back to first column (index 0)',
          );
      });
    });

    // ── custom project columns ────────────────────────────────────────────────
    module('custom project status options', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject([
              { value: 'todo', label: 'To Do' },
              { value: 'doing', label: 'Doing' },
              { value: 'done', label: 'Done' },
            ]),
            ...makeIssue('IT-1', 'todo', 'Issues/issue-todo.json'),
            ...makeIssue('IT-2', 'done', 'Issues/issue-done.json'),
            ...makeBoard(),
          },
        });
      });

      test('board columns are driven by project issueStatusOptions', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 3 }, 'exactly 3 custom columns rendered');
        assert
          .dom('[data-kanban-column="todo"] [data-test-issue-id]')
          .hasText('IT-1', 'IT-1 in first custom column (todo)');
        assert
          .dom('[data-kanban-column="done"] [data-test-issue-id]')
          .hasText('IT-2', 'IT-2 in last custom column (done)');
      });
    });

    // ── status edit from issue view ───────────────────────────────────────────
    module('status edit from issue view', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeIssue('IT-1', 'backlog', 'Issues/issue-backlog.json'),
            ...makeBoard(),
          },
        });
      });

      test('editing status in the issue view moves the card to the new column', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id]`)
          .hasText('IT-1', 'IT-1 starts in backlog');

        await click(`[data-test-card="${testRealmURL}Issues/issue-backlog"]`);
        await waitFor('[data-test-stack-card-index="1"]');
        await click('[data-test-stack-card-index="1"] [data-test-edit-button]');
        await waitFor('[data-test-issue-edit]');
        await click(
          '[data-test-issue-edit-status] .ember-power-select-trigger',
        );
        await waitFor('.ember-power-select-option');

        let inProgressOption = Array.from(
          document.querySelectorAll('.ember-power-select-option'),
        ).find((el) => el.textContent?.includes('In Progress'));
        await click(inProgressOption as HTMLElement);
        await settled();

        assert
          .dom(
            `[data-test-stack-card-index="0"] [data-kanban-column="in_progress"] [data-test-issue-id]`,
          )
          .hasText('IT-1', 'IT-1 moved to In Progress after status edit');
        assert
          .dom(
            `[data-test-stack-card-index="0"] [data-kanban-column="backlog"] [data-test-issue-id]`,
          )
          .doesNotExist('IT-1 no longer in backlog');
      });
    });

    // ── keyboard drag ─────────────────────────────────────────────────────────
    module('keyboard drag', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeIssue('IT-1', 'backlog', 'Issues/issue-backlog-1.json'),
            ...makeIssue('IT-2', 'backlog', 'Issues/issue-backlog-2.json'),
            ...makeBoard(),
          },
        });
      });

      test<TestContextWithSave>('moving a card to another column updates its status', async function (assert) {
        let savedIssueDocs: any[] = [];
        this.onSave((url, doc) => {
          if (url.href === `${testRealmURL}Issues/issue-backlog-1`) {
            savedIssueDocs.push(doc);
          }
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id]`)
          .hasText('IT-1', 'IT-1 starts in backlog');

        await triggerKeyEvent('[data-card-index="0"]', 'keydown', ' ');
        await triggerKeyEvent(
          '[data-test-kanban-board]',
          'keydown',
          'ArrowRight',
        );
        await triggerKeyEvent('[data-test-kanban-board]', 'keydown', ' ');
        await settled();

        assert
          .dom(`[data-kanban-column="in_progress"] [data-test-issue-id]`)
          .hasText('IT-1', 'IT-1 moved to In Progress column');
        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id="IT-1"]`)
          .doesNotExist('IT-1 no longer in backlog');

        let savedIssueDoc = savedIssueDocs[savedIssueDocs.length - 1];
        assert.strictEqual(
          savedIssueDoc?.data?.attributes?.status,
          'in_progress',
          'issue status is persisted as in_progress',
        );
      });

      test('moving a card down within the same column reorders it', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        let backlogIds = () =>
          [
            ...document.querySelectorAll(
              '[data-kanban-column="backlog"] [data-test-issue-id]',
            ),
          ].map((el) => el.textContent?.trim());

        assert.deepEqual(
          backlogIds(),
          ['IT-1', 'IT-2'],
          'IT-1 appears before IT-2 initially',
        );

        await triggerKeyEvent('[data-card-index="0"]', 'keydown', ' ');
        await triggerKeyEvent(
          '[data-test-kanban-board]',
          'keydown',
          'ArrowDown',
        );
        await triggerKeyEvent('[data-test-kanban-board]', 'keydown', ' ');
        await settled();

        assert.deepEqual(
          backlogIds(),
          ['IT-2', 'IT-1'],
          'IT-2 appears before IT-1 after moving IT-1 down',
        );
      });
    });

    // ── add card button ───────────────────────────────────────────────────────
    module('"add card" button', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeBoard(),
          },
        });
      });

      test('creates a new Issue in selected column', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        assert.dom('[data-test-issue-tracker-card]').doesNotExist();

        await click(`[data-test-column-add-button="in_progress"]`);
        await waitFor('[data-test-stack-card-index="1"]');

        assert
          .dom('[data-test-stack-card-index="1"] [data-test-issue-edit]')
          .exists('new Issue opened in edit mode');

        await fillIn('[data-test-summary-field] input', 'Issue 1');
        await click('[data-test-close-button]');

        assert.dom('[data-test-issue-tracker-card]').exists({ count: 1 });
        assert
          .dom(
            `[data-kanban-column="in_progress"] [data-test-issue-tracker-card="0"]`,
          )
          .containsText('Issue 1');
      });
    });

    // ── autoplace fallback ────────────────────────────────────────────────────
    module('autoplace fallback', function (hooks) {
      hooks.beforeEach(async function () {
        await setupAcceptanceTestRealm({
          realmURL: testRealmURL,
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...makeProject(),
            ...makeIssue(
              'IT-99',
              'nonexistent_status',
              'Issues/issue-unknown.json',
            ),
            ...makeBoard(),
          },
        });
      });

      test('a card with an unknown status is placed in the first column', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="backlog"] [data-test-issue-id]`)
          .hasText(
            'IT-99',
            'card with unknown status lands in the first column',
          );
      });
    });
  });
}
