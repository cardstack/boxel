import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { setupRenderingTest } from '#tests/helpers';
import {
  KanbanPlane,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

module('Integration | Component | kanban-plane', function (hooks) {
  setupRenderingTest(hooks);

  test('it can hide a column from the header and restore it from the hidden tray', async function (assert) {
    class State {
      @tracked hideEmpty = false;
      @tracked columns: KanbanColumnConfig[] = [
        {
          key: 'todo',
          label: 'Todo',
          color: null,
          wipLimit: null,
          collapsed: null,
          sortOrder: 0,
        },
        {
          key: 'doing',
          label: 'Doing',
          color: null,
          wipLimit: 1,
          collapsed: null,
          sortOrder: 1,
        },
      ];
      @tracked placements: KanbanPlacement[] = [
        { index: 0, column: 0, sortOrder: 1 },
        { index: 1, column: 1, sortOrder: 1 },
        { index: 2, column: 1, sortOrder: 2 },
      ];

      restoreColumn = (columnKey: string | null, collapsed: boolean): void => {
        this.columns = this.columns.map((column) =>
          column.key === columnKey ? { ...column, collapsed } : column,
        );
      };

      showEmptyColumns = (): void => {
        this.hideEmpty = false;
      };
    }

    let state = new State();

    await render(
      <template>
        <KanbanPlane
          @columns={{state.columns}}
          @placements={{state.placements}}
          @hideEmpty={{state.hideEmpty}}
          @onToggleCollapsed={{state.restoreColumn}}
          @onShowEmptyColumns={{state.showEmptyColumns}}
        >
          <:card as |placement|>
            <div data-test-card-content>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div data-test-ghost-content>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-test-column-is-over-wip]').exists();
    assert.dom('[data-test-kanban-col-wip]').hasText('Max 1');
    assert.dom('[data-card-index]').exists({ count: 3 });
    assert.dom('[data-kanban-column="0"]').exists();
    assert.dom('[data-kanban-column="1"]').exists();
    assert.dom('[data-test-hidden-columns]').doesNotExist();

    await click('[data-kanban-column="0"] [data-test-column-collapse-button]');

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('[data-kanban-column="0"]').doesNotExist();
    assert.dom('[data-test-hidden-columns]').containsText('Hidden');
    assert.dom('[data-test-hidden-column-count]').hasText('1');
    assert.dom('[aria-label="Show Todo"]').exists();
    assert.dom('[data-test-hidden-column-row="0"]').includesText('Todo');
    assert.dom('[data-test-hidden-column-row="0"]').includesText('1');

    await click('[aria-label="Show Todo"]');

    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-kanban-column="0"]').exists();
    assert.dom('[data-test-hidden-columns]').doesNotExist();
  });

  test('it can hide empty columns and restore them from the hidden tray', async function (assert) {
    class State {
      @tracked hideEmpty = false;
      @tracked columns: KanbanColumnConfig[] = [
        {
          key: 'todo',
          label: 'Todo',
          color: null,
          wipLimit: null,
          collapsed: null,
          sortOrder: 0,
        },
        {
          key: 'doing',
          label: 'Doing',
          color: null,
          wipLimit: null,
          collapsed: null,
          sortOrder: 1,
        },
      ];
      @tracked placements: KanbanPlacement[] = [
        { index: 0, column: 1, sortOrder: 1 },
      ];

      showEmptyColumns = (): void => {
        this.hideEmpty = false;
      };

      toggleHideEmpty = (): void => {
        this.hideEmpty = !this.hideEmpty;
      };
    }

    let state = new State();

    await render(
      <template>
        <button type="button" {{on "click" state.toggleHideEmpty}}>
          Hide empty columns
        </button>
        <KanbanPlane
          @columns={{state.columns}}
          @placements={{state.placements}}
          @hideEmpty={{state.hideEmpty}}
          @onShowEmptyColumns={{state.showEmptyColumns}}
        >
          <:card as |placement|>
            <div data-test-card-content>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div data-test-ghost-content>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-kanban-column="0"]').exists();
    assert.dom('[data-test-empty-column="0"]').hasText('No cards');
    assert.dom('[data-test-hidden-columns]').doesNotExist();

    await click('button');

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('[data-kanban-column="0"]').doesNotExist();
    assert.dom('[data-test-hidden-column-count]').hasText('1');
    assert.dom('[aria-label="Show Todo"]').exists();
    assert.dom('[data-test-hidden-column-row="0"]').includesText('Todo');
    assert.dom('[data-test-hidden-columns]').includesText('0');

    await click('[aria-label="Show Todo"]');

    assert.dom('[data-kanban-column="0"]').exists();
    assert.dom('[data-test-empty-column="0"]').hasText('No cards');
    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-test-hidden-columns]').doesNotExist();
  });

  test('restoring a collapsed empty column also clears the hideEmpty filter', async function (assert) {
    class State {
      @tracked hideEmpty = true;
      @tracked columns: KanbanColumnConfig[] = [
        {
          key: 'todo',
          label: 'Todo',
          color: null,
          wipLimit: null,
          collapsed: true,
          sortOrder: 0,
        },
        {
          key: 'doing',
          label: 'Doing',
          color: null,
          wipLimit: null,
          collapsed: null,
          sortOrder: 1,
        },
      ];
      @tracked placements: KanbanPlacement[] = [
        { index: 0, column: 1, sortOrder: 1 },
      ];

      toggleCollapsed = (
        columnKey: string | null,
        collapsed: boolean,
      ): void => {
        this.columns = this.columns.map((col) =>
          col.key === columnKey ? { ...col, collapsed } : col,
        );
      };

      showEmptyColumns = (): void => {
        this.hideEmpty = false;
      };
    }

    let state = new State();

    await render(
      <template>
        <KanbanPlane
          @columns={{state.columns}}
          @placements={{state.placements}}
          @hideEmpty={{state.hideEmpty}}
          @onToggleCollapsed={{state.toggleCollapsed}}
          @onShowEmptyColumns={{state.showEmptyColumns}}
        >
          <:card as |placement|>
            <div data-test-card-content>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div data-test-ghost-content>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    // Todo is collapsed and has no cards — hidden by both collapsed and hideEmpty
    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('[data-test-hidden-column-count]').hasText('1');
    assert.dom('[aria-label="Show Todo"]').exists();

    await click('[aria-label="Show Todo"]');

    // Both collapsed=false and hideEmpty=false must have been applied —
    // the Todo column should now be visible despite having no cards
    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-kanban-column="0"]').exists();
    assert.dom('[data-test-empty-column="0"]').hasText('No cards');
    assert.dom('[data-test-hidden-columns]').doesNotExist();
  });
});
