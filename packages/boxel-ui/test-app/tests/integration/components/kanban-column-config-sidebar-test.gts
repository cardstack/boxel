import { module, test } from 'qunit';
import { click, fillIn, render, triggerEvent } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { tracked } from '@glimmer/tracking';
import {
  KanbanColumnConfigSidebar,
  type KanbanColumnConfig,
} from '@cardstack/boxel-ui/components';

const BASE_COLUMNS: KanbanColumnConfig[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    color: '#64748b',
    wipLimit: 0,
    collapsed: false,
    sortOrder: 1,
  },
  {
    key: 'in-progress',
    label: 'In Progress',
    color: '#d97706',
    wipLimit: 2,
    collapsed: false,
    sortOrder: 2,
  },
  {
    key: 'done',
    label: 'Done',
    color: '#15803d',
    wipLimit: null,
    collapsed: false,
    sortOrder: 3,
  },
];

module(
  'Integration | Component | kanban-column-config-sidebar',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders one row per column with label and wip values', async function (assert) {
      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{(noop)}}
          />
        </template>,
      );

      assert.dom('[data-test-col-config-row]').exists({ count: 3 });
      assert.dom('[data-test-col-config-label="0"]').hasValue('Backlog');
      assert.dom('[data-test-col-config-label="1"]').hasValue('In Progress');
      assert.dom('[data-test-col-config-label="2"]').hasValue('Done');
      assert.dom('[data-test-col-config-wip="0"]').hasValue('0');
      assert.dom('[data-test-col-config-wip="1"]').hasValue('2');
    });

    test('close button is hidden without onClose; shown and functional with it', async function (assert) {
      let closed = false;
      const onClose = () => {
        closed = true;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{(noop)}}
          />
        </template>,
      );
      assert.dom('.sidebar-close').doesNotExist('hidden when no onClose');

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{(noop)}}
            @onClose={{onClose}}
          />
        </template>,
      );
      assert.dom('[aria-label="Close column settings"]').exists('shown when onClose provided');
      await click('[aria-label="Close column settings"]');
      assert.true(closed, 'onClose invoked on click');
    });

    test('reorder buttons: disabled at boundaries; move-down and move-up swap correctly', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      assert.dom('[data-test-col-config-row="0"] [aria-label="Move column up"]').isDisabled('first row: up disabled');
      assert.dom('[data-test-col-config-row="0"] [aria-label="Move column down"]').isNotDisabled('first row: down enabled');
      assert.dom('[data-test-col-config-row="2"] [aria-label="Move column up"]').isNotDisabled('last row: up enabled');
      assert.dom('[data-test-col-config-row="2"] [aria-label="Move column down"]').isDisabled('last row: down disabled');

      await click('[data-test-col-config-row="0"] [aria-label="Move column down"]');
      assert.strictEqual(result![0]!.key, 'in-progress', 'move-down: in-progress is now first');
      assert.strictEqual(result![1]!.key, 'backlog', 'move-down: backlog moved to second');
      assert.strictEqual(result![0]!.sortOrder, 1, 'sortOrders renumbered');
      assert.strictEqual(result![1]!.sortOrder, 2);

      await click('[data-test-col-config-row="1"] [aria-label="Move column up"]');
      assert.strictEqual(result![0]!.key, 'in-progress', 'move-up: same result from opposite direction');
      assert.strictEqual(result![1]!.key, 'backlog');
    });

    test('label input fires onColumnsChange with the updated label only', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-label="0"]', 'Queue');

      assert.strictEqual(result![0]!.label, 'Queue');
      assert.strictEqual(result![1]!.label, 'In Progress', 'other cols unchanged');
    });

    test('WIP input: updates limit; clamps negative values to 0', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-wip="1"]', '5');
      assert.strictEqual(result![1]!.wipLimit, 5, 'valid value accepted');

      await fillIn('[data-test-col-config-wip="0"]', '-3');
      assert.strictEqual(result![0]!.wipLimit, 0, 'negative clamped to 0');
    });

    test('visibility toggle flips collapsed in both directions', async function (assert) {
      const collapsedFirst: KanbanColumnConfig[] = BASE_COLUMNS.map((c, i) =>
        i === 0 ? { ...c, collapsed: true } : c,
      );
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await click('[data-test-col-config-visible="0"]');
      assert.true(result![0]!.collapsed, 'visible → hidden');
      assert.false(result![1]!.collapsed, 'other columns unaffected');

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{collapsedFirst}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      await click('[data-test-col-config-visible="0"]');
      assert.false(result![0]!.collapsed, 'hidden → visible');
    });

    test('color change event fires onColumnsChange with the new color', async function (assert) {
      let result: KanbanColumnConfig[] | undefined;
      const onChange = (cols: KanbanColumnConfig[]) => {
        result = cols;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{BASE_COLUMNS}}
            @onColumnsChange={{onChange}}
          />
        </template>,
      );

      let input = document.querySelector(
        '[data-test-col-config-color="0"]',
      ) as HTMLInputElement;
      input.value = '#ff0000';
      await triggerEvent(input, 'change');

      assert.strictEqual(result![0]!.color, '#ff0000');
      assert.strictEqual(result![1]!.color, '#d97706', 'other cols unchanged');
    });

    test('re-renders when the columns arg is updated externally', async function (assert) {
      class State {
        @tracked cols = BASE_COLUMNS;
      }
      const state = new State();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{state.cols}}
            @onColumnsChange={{(noop)}}
          />
        </template>,
      );

      assert.dom('[data-test-col-config-label="0"]').hasValue('Backlog');

      state.cols = [{ ...BASE_COLUMNS[0]!, label: 'Queue' }, ...BASE_COLUMNS.slice(1)];
      await new Promise((r) => requestAnimationFrame(r));

      assert.dom('[data-test-col-config-label="0"]').hasValue('Queue');
    });
  },
);

function noop() {}
