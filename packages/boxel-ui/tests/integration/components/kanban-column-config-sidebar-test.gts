import {
  type KanbanColumnConfig,
  KanbanColumnConfigSidebar,
} from '@cardstack/boxel-ui/components';
import {
  click,
  fillIn,
  focus,
  render,
  triggerEvent,
  typeIn,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { setupRenderingTest } from '#tests/helpers';

function makeColumns(): TrackedArray<KanbanColumnConfig> {
  return new TrackedArray([
    new TrackedObject({
      key: 'backlog',
      label: 'Backlog',
      color: '#64748b',
      wipLimit: 0,
      collapsed: false,
      sortOrder: 1,
    }) as KanbanColumnConfig,
    new TrackedObject({
      key: 'in-progress',
      label: 'In Progress',
      color: '#d97706',
      wipLimit: 2,
      collapsed: false,
      sortOrder: 2,
    }) as KanbanColumnConfig,
    new TrackedObject({
      key: 'done',
      label: 'Done',
      color: '#15803d',
      wipLimit: null,
      collapsed: false,
      sortOrder: 3,
    }) as KanbanColumnConfig,
  ]);
}

const onLabelChange = (col: KanbanColumnConfig | null, val: string): void => {
  if (col) col['label'] = val;
};
const onColorChange = (col: KanbanColumnConfig | null, val: string): void => {
  if (col) col['color'] = val;
};
const onWipLimitChange = (
  col: KanbanColumnConfig | null,
  val: string,
): void => {
  if (col) {
    let raw = parseInt(val, 10);
    col['wipLimit'] = isNaN(raw) || raw < 0 ? 0 : raw;
  }
};
const onToggleCollapsed = (col: KanbanColumnConfig | null): void => {
  if (col) col['collapsed'] = !col.collapsed;
};

module(
  'Integration | Component | kanban-column-config-sidebar',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders one row per column with label and wip values', async function (assert) {
      let columns = makeColumns();
      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onLabelChange={{onLabelChange}}
            @onWipLimitChange={{onWipLimitChange}}
          />
        </template>,
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
      class State {
        @tracked cols = makeColumns();
      }
      const state = new State();
      const onReorder = (newCols: KanbanColumnConfig[]) => {
        state.cols = new TrackedArray(
          newCols,
        ) as TrackedArray<KanbanColumnConfig>;
      };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{state.cols}}
            @onReorder={{onReorder}}
          />
        </template>,
      );

      assert
        .dom('[data-test-move-col-up-btn="backlog"]')
        .isDisabled('first row: up disabled');
      assert
        .dom('[data-test-move-col-down-btn="backlog"]')
        .isNotDisabled('first row: down enabled');
      assert
        .dom('[data-test-move-col-up-btn="done"]')
        .isNotDisabled('last row: up enabled');
      assert
        .dom('[data-test-move-col-down-btn="done"]')
        .isDisabled('last row: down disabled');

      await click('[data-test-move-col-down-btn="backlog"]');
      assert.strictEqual(
        state.cols[0]!.key,
        'in-progress',
        'in-progress is now first',
      );
      assert.strictEqual(state.cols[1]!.key, 'backlog', 'backlog is second');
      assert.strictEqual(state.cols[2]!.key, 'done', 'done unchanged');
      assert.strictEqual(
        state.cols[0]!.sortOrder,
        1,
        'in-progress sortOrder updated to 1',
      );
      assert.strictEqual(
        state.cols[1]!.sortOrder,
        2,
        'backlog sortOrder updated to 2',
      );
      assert.strictEqual(
        state.cols[2]!.sortOrder,
        3,
        'done sortOrder unchanged at 3',
      );

      state.cols = makeColumns();
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      await new Promise((r) => requestAnimationFrame(r));

      await click(
        '[data-test-col-config-row="in-progress"] [data-test-move-col-up-btn]',
      );
      assert.strictEqual(
        state.cols[0]!.key,
        'in-progress',
        'move-up on in-progress: in-progress is now first',
      );
      assert.strictEqual(state.cols[1]!.key, 'backlog');
      assert.strictEqual(
        state.cols[0]!.sortOrder,
        1,
        'in-progress sortOrder updated to 1',
      );
      assert.strictEqual(
        state.cols[1]!.sortOrder,
        2,
        'backlog sortOrder updated to 2',
      );
    });

    test('label input mutates only the targeted label', async function (assert) {
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onLabelChange={{onLabelChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-label="backlog"]', 'Queue');

      assert.strictEqual(columns[0]!.label, 'Queue');
      assert.strictEqual(
        columns[1]!.label,
        'In Progress',
        'other cols unchanged',
      );
    });

    test('WIP input mutates limit; clamps negative values to 0', async function (assert) {
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onWipLimitChange={{onWipLimitChange}}
          />
        </template>,
      );

      await fillIn('[data-test-col-config-wip="in-progress"]', '5');
      assert.strictEqual(columns[1]!.wipLimit, 5, 'valid value accepted');

      await fillIn('[data-test-col-config-wip="backlog"]', '-3');
      assert.strictEqual(columns[0]!.wipLimit, 0, 'negative clamped to 0');
    });

    test('visibility toggle is disabled for empty columns when hideEmpty is on', async function (assert) {
      let columns = makeColumns();
      let cardCounts = { backlog: 0, 'in-progress': 2, done: 1 };

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @cardCounts={{cardCounts}}
            @hideEmpty={{true}}
            @onToggleCollapsed={{onToggleCollapsed}}
          />
        </template>,
      );

      assert
        .dom('[data-test-col-config-toggle-visible="backlog"]')
        .isDisabled('toggle disabled for empty column when hideEmpty is on');
      assert
        .dom('[data-test-col-config-toggle-visible="in-progress"]')
        .isNotDisabled('toggle enabled for non-empty column');
      assert
        .dom('[data-test-col-config-toggle-visible="done"]')
        .isNotDisabled('toggle enabled for non-empty column');
    });

    test('visibility toggle flips collapsed in both directions', async function (assert) {
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onToggleCollapsed={{onToggleCollapsed}}
          />
        </template>,
      );

      await click(
        '[data-test-col-config-row="backlog"] [aria-label="Hide column"]',
      );
      assert.true(columns[0]!.collapsed, 'visible → hidden');
      assert.false(columns[1]!.collapsed, 'other columns unaffected');

      let collapsedFirst = makeColumns().map((c, i) =>
        i === 0 ? { ...c, collapsed: true } : c,
      );

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{collapsedFirst}}
            @onToggleCollapsed={{onToggleCollapsed}}
          />
        </template>,
      );

      await click(
        '[data-test-col-config-row="backlog"] [aria-label="Show column"]',
      );
      assert.false(collapsedFirst[0]!.collapsed, 'hidden → visible');
    });

    test('color change mutates the targeted color', async function (assert) {
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onColorChange={{onColorChange}}
          />
        </template>,
      );

      let input = document.querySelector(
        '[data-test-col-config-color="backlog"]',
      ) as HTMLInputElement;
      input.value = '#ff0000';
      await triggerEvent(input, 'input');

      assert.strictEqual(columns[0]!.color, '#ff0000');
      assert.strictEqual(columns[1]!.color, '#d97706', 'other cols unchanged');
    });

    test('re-renders when the columns arg is updated externally', async function (assert) {
      class State {
        @tracked cols = makeColumns();
      }
      const state = new State();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{state.cols}}
            @onLabelChange={{onLabelChange}}
          />
        </template>,
      );

      assert.dom('[data-test-col-config-label="backlog"]').hasValue('Backlog');

      state.cols = new TrackedArray([
        new TrackedObject({
          ...state.cols[0]!,
          label: 'Queue',
        }) as KanbanColumnConfig,
        ...state.cols.slice(1),
      ]);
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      await new Promise((r) => requestAnimationFrame(r));

      assert.dom('[data-test-col-config-label="backlog"]').hasValue('Queue');
    });

    test('label input accumulates all typed characters without losing focus between keystrokes', async function (assert) {
      let columns = makeColumns();

      await render(
        <template>
          <KanbanColumnConfigSidebar
            @columns={{columns}}
            @onLabelChange={{onLabelChange}}
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
        columns[0]?.label,
        'New Label',
        'full typed string is accumulated on the mutated column',
      );
    });
  },
);
