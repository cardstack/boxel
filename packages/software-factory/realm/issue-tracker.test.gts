import { module, test } from 'qunit';
import {
  click,
  fillIn,
  settled,
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

      test('collapsing a column updates the persisted collapsed state', async function (assert) {
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
