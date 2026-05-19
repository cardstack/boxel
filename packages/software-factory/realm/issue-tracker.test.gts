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

// Default status column indices (issueStatusOptions order in kanban-config.gts):
//   0: backlog  1: in_progress  2: blocked  3: review  4: done
const COL = { backlog: 0, in_progress: 1, blocked: 2, review: 3, done: 4 };

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

function makeBoard(): Record<string, Record<string, unknown>> {
  return {
    'Boards/test-board.json': {
      data: {
        type: 'card',
        attributes: { boardTitle: 'Test Board' },
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
          .dom(`[data-kanban-column="${COL.backlog}"] [data-test-issue-id]`)
          .hasText('IT-1', 'backlog issue is in the Backlog column');
        assert
          .dom(`[data-kanban-column="${COL.in_progress}"] [data-test-issue-id]`)
          .hasText('IT-2', 'in-progress issue is in the In Progress column');
        assert
          .dom(`[data-kanban-column="${COL.done}"] [data-test-issue-id]`)
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

        await click('[role="switch"]');

        assert
          .dom('[data-kanban-column]')
          .exists(
            { count: 3 },
            'only 3 non-empty columns visible after toggle',
          );
        assert
          .dom(`[data-kanban-column="${COL.blocked}"]`)
          .doesNotExist('blocked column hidden');
        assert
          .dom(`[data-kanban-column="${COL.review}"]`)
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

        assert.dom(`[data-kanban-column="${COL.backlog}"]`).exists();

        await click(
          `[data-kanban-column="${COL.backlog}"] [data-test-column-collapse-button]`,
        );
        await waitFor('[aria-label="Show Backlog"]');

        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
          .doesNotExist('backlog column is hidden after collapsing');
        assert
          .dom('[aria-label="Show Backlog"]')
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
        await click('[data-test-col-config-visible="0"]');
        await waitFor('[aria-label="Show Backlog"]');

        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
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

        await click('[data-test-col-config-visible="0"]');
        await waitFor(`[data-kanban-column="${COL.backlog}"]`);

        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
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
          .dom(`[data-kanban-column="${COL.blocked}"]`)
          .exists('blocked starts visible while hide-empty is off');

        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-visible="2"]');
        await waitFor('[aria-label="Show Blocked"]');

        assert
          .dom(`[data-kanban-column="${COL.blocked}"]`)
          .doesNotExist('blocked is hidden after sidebar toggle');

        await click('.column-visibility-toggle input[role="switch"]');
        await click('.column-visibility-toggle input[role="switch"]');

        assert
          .dom(`[data-kanban-column="${COL.blocked}"]`)
          .exists(
            'blocked is visible again after hide-empty is turned back off',
          );
      });

      test<TestContextWithSave>('turning hide-empty off saves hideEmptyColumns as false', async function (assert) {
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
        await click('.column-visibility-toggle input[role="switch"]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('.column-visibility-toggle [data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on');

        // Turn hide-empty back off
        await click('.column-visibility-toggle input[role="switch"]');
        await settled();

        assert
          .dom('.column-visibility-toggle [data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'off', 'switch is off');
        assert
          .dom('[data-kanban-column]')
          .exists({ count: 5 }, 'all columns visible again');
        assert
          .dom('[data-test-hidden-columns]')
          .doesNotExist('hidden tray gone');

        let lastSave = boardSaves[boardSaves.length - 1];
        assert.false(
          lastSave?.data.attributes.hideEmptyColumns,
          'hideEmptyColumns persisted as false after turning off the filter',
        );
      });

      test('collapsing one column from the header leaves all other columns visible', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert.dom('[data-kanban-column]').exists({ count: 5 });

        await click(
          `[data-kanban-column="${COL.backlog}"] [data-test-column-collapse-button]`,
        );
        await waitFor('[aria-label="Show Backlog"]');

        assert
          .dom('[data-kanban-column]')
          .exists({ count: 4 }, 'only the collapsed column is removed');
        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
          .doesNotExist('backlog is hidden');
        assert
          .dom(`[data-kanban-column="${COL.in_progress}"]`)
          .exists('in_progress still visible');
        assert
          .dom(`[data-kanban-column="${COL.done}"]`)
          .exists('done still visible');
      });

      test('can hide a column from the header and reveal it from the sidebar, and vice versa', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        // Hide backlog from the column header
        await click(
          `[data-kanban-column="${COL.backlog}"] [data-test-column-collapse-button]`,
        );
        await waitFor('[aria-label="Show Backlog"]');
        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
          .doesNotExist('backlog hidden via column header');

        // Reveal backlog from the sidebar toggle
        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-visible="0"]');
        await waitFor(`[data-kanban-column="${COL.backlog}"]`);
        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
          .exists('backlog revealed via sidebar toggle');

        // Hide in-progress from the sidebar toggle
        await click('[data-test-col-config-visible="1"]');
        await waitFor('[aria-label="Show In Progress"]');
        assert
          .dom(`[data-kanban-column="${COL.in_progress}"]`)
          .doesNotExist('in-progress hidden via sidebar toggle');

        // Reveal in-progress from the hidden-columns tray in the header
        await click('[aria-label="Show In Progress"]');
        await waitFor(`[data-kanban-column="${COL.in_progress}"]`);
        assert
          .dom(`[data-kanban-column="${COL.in_progress}"]`)
          .exists('in-progress revealed via hidden-columns tray');
        assert.dom('[data-test-hidden-columns]').doesNotExist('tray gone');
      });

      test('after hiding columns from both header and sidebar, hide-empty toggle is on; turning it off reveals only the empty-hidden columns', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        // Turn on hide-empty — blocked (col 2) and review (col 3) are empty
        await click('.column-visibility-toggle input[role="switch"]');
        await waitFor('[data-test-hidden-columns]');

        assert
          .dom('.column-visibility-toggle [data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on', 'switch is on');
        assert
          .dom('[data-kanban-column]')
          .exists({ count: 3 }, 'two empty columns hidden');

        // Also collapse backlog from the column header
        await click(
          `[data-kanban-column="${COL.backlog}"] [data-test-column-collapse-button]`,
        );
        await waitFor('[data-test-hidden-column-count]');
        assert
          .dom('[data-test-hidden-column-count]')
          .hasText('3', '3 columns hidden total');

        // Also collapse in-progress from the sidebar
        await click('[data-test-configure-columns-btn]');
        await click('[data-test-col-config-visible="1"]');
        await waitFor('[aria-label="Show In Progress"]');
        assert
          .dom('[data-test-hidden-column-count]')
          .hasText('4', '4 columns hidden total');

        // Switch must still appear ON
        assert
          .dom('.column-visibility-toggle [data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'on', 'switch still on');

        // Turn off hide-empty — reveals only the empty-hidden columns
        await click('.column-visibility-toggle input[role="switch"]');
        await settled();

        assert
          .dom('.column-visibility-toggle [data-test-switch-checked]')
          .hasAttribute('data-test-switch-checked', 'off', 'switch now off');
        assert
          .dom(`[data-kanban-column="${COL.blocked}"]`)
          .exists('blocked is visible again (was empty-hidden)');
        assert
          .dom(`[data-kanban-column="${COL.review}"]`)
          .exists('review is visible again (was empty-hidden)');
        assert
          .dom(`[data-kanban-column="${COL.backlog}"]`)
          .doesNotExist(
            'backlog stays hidden (was manually collapsed, has cards)',
          );
        assert
          .dom(`[data-kanban-column="${COL.in_progress}"]`)
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
        let resolveLabelSave: (doc: any) => void;
        let labelSavePromise = new Promise<any>((r) => {
          resolveLabelSave = r;
        });
        let resolveColorSave: (doc: any) => void;
        let colorSavePromise = new Promise<any>((r) => {
          resolveColorSave = r;
        });
        let labelSaveSeen = false;
        this.onSave((url, doc) => {
          if (url.href !== projectId) return;
          if (!labelSaveSeen) {
            labelSaveSeen = true;
            resolveLabelSave!(doc);
          } else {
            resolveColorSave!(doc);
          }
        });

        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-kanban-column]');

        // Open sidebar and rename "To Do" → "Planning"
        await click('[data-test-configure-columns-btn]');
        await fillIn('[data-test-col-config-label="0"]', 'Planning');

        let labelSaveDoc = await labelSavePromise;
        let updatedOptions = labelSaveDoc.data.attributes.issueStatusOptions;
        assert.strictEqual(
          updatedOptions[0].label,
          'Planning',
          'project issueStatusOption label updated to match sidebar rename',
        );
        assert.strictEqual(
          updatedOptions[1].label,
          'Doing',
          'other project options unchanged',
        );

        // Recolor the first column and verify the project option color syncs
        let colorInput = document.querySelector(
          '[data-test-col-config-color="0"]',
        ) as HTMLInputElement;
        colorInput.value = '#ff0000';
        await triggerEvent(colorInput, 'change');

        let colorSaveDoc = await colorSavePromise;
        assert.strictEqual(
          colorSaveDoc.data.attributes.issueStatusOptions[0].color,
          '#ff0000',
          'project issueStatusOption color updated to match sidebar recolor',
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
          .dom(`[data-kanban-column="${COL.backlog}"] [data-test-issue-id]`)
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
          .dom('[data-kanban-column="0"] [data-test-issue-id]')
          .hasText('IT-1', 'IT-1 in first custom column (todo)');
        assert
          .dom('[data-kanban-column="2"] [data-test-issue-id]')
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
          .dom(`[data-kanban-column="${COL.backlog}"] [data-test-issue-id]`)
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
            `[data-test-stack-card-index="0"] [data-kanban-column="${COL.in_progress}"] [data-test-issue-id]`,
          )
          .hasText('IT-1', 'IT-1 moved to In Progress after status edit');
        assert
          .dom(
            `[data-test-stack-card-index="0"] [data-kanban-column="${COL.backlog}"] [data-test-issue-id]`,
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
            ...makeIssue('IT-1', 'backlog', 'Issues/issue-backlog.json'),
            ...makeBoard(),
          },
        });
      });

      test('moving a card to another column updates its status', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: boardId, format: 'isolated' }]],
        });
        await waitFor('[data-test-issue-id]');

        assert
          .dom(`[data-kanban-column="${COL.backlog}"] [data-test-issue-id]`)
          .hasText('IT-1', 'IT-1 starts in backlog');

        await triggerKeyEvent('[data-card-index="0"]', 'keydown', ' ');
        await triggerKeyEvent(
          '[role="region"][aria-label="Kanban board"]',
          'keydown',
          'ArrowRight',
        );
        await triggerKeyEvent(
          '[role="region"][aria-label="Kanban board"]',
          'keydown',
          ' ',
        );
        await settled();

        assert
          .dom(`[data-kanban-column="${COL.in_progress}"] [data-test-issue-id]`)
          .hasText('IT-1', 'IT-1 moved to In Progress column');
        assert
          .dom(`[data-kanban-column="${COL.backlog}"] [data-test-issue-id]`)
          .doesNotExist('IT-1 no longer in backlog');
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

        await click(
          `[data-kanban-column="${COL.in_progress}"] [data-test-column-add-button]`,
        );
        await waitFor('[data-test-stack-card-index="1"]');

        assert
          .dom('[data-test-stack-card-index="1"] [data-test-issue-edit]')
          .exists('new Issue opened in edit mode');

        await fillIn('[data-test-summary-field] input', 'Issue 1');
        await click('[data-test-close-button]');

        assert.dom('[data-test-issue-tracker-card]').exists({ count: 1 });
        assert
          .dom(
            `[data-kanban-column="${COL.in_progress}"] [data-test-issue-tracker-card="0"]`,
          )
          .containsText('Issue 1');
      });
    });
  });
}
