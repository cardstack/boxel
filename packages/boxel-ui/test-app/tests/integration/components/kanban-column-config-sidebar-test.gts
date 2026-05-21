import { module, test } from 'qunit';
import {
  click,
  fillIn,
  focus,
  render,
  triggerEvent,
  typeIn,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { tracked } from '@glimmer/tracking';
import {
  KanbanColumnConfigSidebar,
  type KanbanColumnConfig,
} from '@cardstack/boxel-ui/components';

// sortOrders are 0-indexed so boundary checks (=== 0, >= length - 1) work correctly.
function makeColumns(): KanbanColumnConfig[] {
  return [
    {
      key: 'backlog',
      label: 'Backlog',
      color: '#64748b',
      wipLimit: 0,
      collapsed: false,
      sortOrder: 0,
    },
    {
      key: 'in-progress',
      label: 'In Progress',
      color: '#d97706',
      wipLimit: 2,
      collapsed: false,
      sortOrder: 1,
    },
    {
      key: 'done',
      label: 'Done',
      color: '#15803d',
      wipLimit: null,
      collapsed: false,
      sortOrder: 2,
    },
  ];
}

module(
  'Integration | Component | kanban-column-config-sidebar',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders one row per column with label and wip values', async function (assert) {
      let columns = makeColumns();
      await render(
        <template><KanbanColumnConfigSidebar @columns={{columns}} /></template>,
      );

      assert.dom('[data-test-col-config-row]').exists({ count: 3 });
      assert.dom('[data-test-col-config-label="backlog"]').hasValue('Backlog');
      assert
        .dom('[data-test-col-config-label="in-progress"]')
        .hasValue('In Progress');
      assert.dom('[data-test-col-config-label="done"]').hasValue('Done');
      assert.dom('[data-test-col-config-wip="backlog"]').hasValue('0');
      assert.dom('[data-test-col-config-wip="in-progress"]').hasValue('2');
    });

    test('close button is hidden without onClose; shown and functional with it', async function (assert) {
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      let columns = makeColumns();

      await render(
        <template><KanbanColumnConfigSidebar @columns={{columns}} /></template>,
      );
      assert.dom('.sidebar-close').doesNotExist('hidden when no onClose');

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onClose={{onClose}}
          />
        </template>,
      );
      assert
        .dom('[aria-label="Close column settings"]')
        .exists('shown when onClose provided');
      await click('[aria-label="Close column settings"]');
      assert.true(closed, 'onClose invoked on click');
    });

    test('reorder buttons: disabled at boundaries; move-down and move-up swap correctly', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      assert
        .dom(
          '[data-test-col-config-row="backlog"] [aria-label="Move column up"]',
        )
        .isDisabled('first row: up disabled');
      assert
        .dom(
          '[data-test-col-config-row="backlog"] [aria-label="Move column down"]',
        )
        .isNotDisabled('first row: down enabled');
      assert
        .dom('[data-test-col-config-row="done"] [aria-label="Move column up"]')
        .isNotDisabled('last row: up enabled');
      assert
        .dom(
          '[data-test-col-config-row="done"] [aria-label="Move column down"]',
        )
        .isDisabled('last row: down disabled');

      // Move backlog down — callback receives columns sorted by sortOrder.
      await click(
        '[data-test-col-config-row="backlog"] [aria-label="Move column down"]',
      );
      assert.strictEqual(
        result![0]!.key,
        'in-progress',
        'move-down: in-progress is now first in sorted result',
      );
      assert.strictEqual(result![0]!.sortOrder, 0, 'in-progress sortOrder = 0');
      assert.strictEqual(result![1]!.key, 'backlog', 'backlog is second');
      assert.strictEqual(result![1]!.sortOrder, 1, 'backlog sortOrder = 1');
      assert.strictEqual(result![2]!.key, 'done', 'done unchanged');
      assert.strictEqual(result![2]!.sortOrder, 2, 'done sortOrder = 2');

      // Move up on in-progress (currently sortOrder 0 after swap) — should be
      // disabled since it's now first. Verify with a fresh set of columns.
      let columns2 = makeColumns();
      let result2: KanbanColumnConfig[] | undefined;
      const onChange2 = (cols: KanbanColumnConfig[]) => {
        result2 = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns2}}
            @onColumnsChange={{onChange2}}
          />
        </template>,
      );

      await click(
        '[data-test-col-config-row="in-progress"] [aria-label="Move column up"]',
      );
      assert.strictEqual(
        result2![0]!.key,
        'in-progress',
        'move-up on in-progress: in-progress is now first in sorted result',
      );
      assert.strictEqual(
        result2![0]!.sortOrder,
        0,
        'in-progress sortOrder = 0',
      );
      assert.strictEqual(result2![1]!.key, 'backlog');
      assert.strictEqual(result2![1]!.sortOrder, 1);
    });

    test('label input fires onColumnsChange with the updated label only', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-label="backlog"]', 'Queue');

      assert.strictEqual(result![0]!.label, 'Queue');
      assert.strictEqual(
        result![1]!.label,
        'In Progress',
        'other cols unchanged',
      );
    });

    test('WIP input: updates limit; clamps negative values to 0', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-wip="in-progress"]', '5');
      assert.strictEqual(result![1]!.wipLimit, 5, 'valid value accepted');

      await fillIn('[data-test-col-config-wip="backlog"]', '-3');
      assert.strictEqual(result![0]!.wipLimit, 0, 'negative clamped to 0');
    });

    test('visibility toggle flips collapsed in both directions', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await click('[data-test-col-config-visible="backlog"]');
      assert.true(result![0]!.collapsed, 'visible → hidden');
      assert.false(result![1]!.collapsed, 'other columns unaffected');

      let collapsedFirst = makeColumns().map((c, i) =>
        i === 0 ? { ...c, collapsed: true } : c,
      );
      let result2: KanbanColumnConfig[] | undefined;
      const onChange2 = (cols: KanbanColumnConfig[]) => {
        result2 = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{collapsedFirst}}
            @onColumnsChange={{onChange2}}
          />
        </template>,
      );

      await click('[data-test-col-config-visible="backlog"]');
      assert.false(result2![0]!.collapsed, 'hidden → visible');
    });

    test('color change event fires onColumnsChange with the new color', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      let input = document.querySelector(
        '[data-test-col-config-color="backlog"]',
      ) as HTMLInputElement;
      input.value = '#ff0000';
      await triggerEvent(input, 'change');

      assert.strictEqual(result![0]!.color, '#ff0000');
      assert.strictEqual(result![1]!.color, '#d97706', 'other cols unchanged');
    });

    test('re-renders when the columns arg is updated externally', async function (assert) {
      class State {
        @tracked cols = makeColumns();
      }
      const state = new State();

      await render(
        <template>
          <KanbanColumnConfigSidebar @columns={{state.cols}} />
        </template>,
      );

      assert.dom('[data-test-col-config-label="backlog"]').hasValue('Backlog');

      state.cols = [
        { ...state.cols[0]!, label: 'Queue' },
        ...state.cols.slice(1),
      ];
      await new Promise((r) => requestAnimationFrame(r));

      assert.dom('[data-test-col-config-label="backlog"]').hasValue('Queue');
    });

    test('label input accumulates all typed characters without losing focus between keystrokes', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      let input = document.querySelector(
        '[data-test-col-config-label="backlog"]',
      ) as HTMLInputElement;

      await focus(input);
      assert.strictEqual(
        document.activeElement,
        input,
        'input is focused before typing',
      );

      input.value = '';
      await typeIn(input, 'New Label');

      assert.strictEqual(
        document.activeElement,
        input,
        'input retains focus after typing all characters',
      );
      assert.strictEqual(
        result?.[0]?.label,
        'New Label',
        'full typed string is accumulated in the onChange result',
      );
    });
  },
);
