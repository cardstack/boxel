import {
  type KanbanColumnConfig,
  type KanbanPlacement,
  KanbanPlane,
} from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '#tests/helpers';

module('Integration | Component | kanban-plane', function (hooks) {
  setupRenderingTest(hooks);

  test('it can hide a column from the header and restore it from the hidden tray', async function (assert) {
    class State {
      @tracked columns: KanbanColumnConfig[] = [
        {
          key: 'todo',
          label: 'Todo',
          color: null,
          wipLimit: null,
          collapsed: null,
          sortOrder: 1,
        },
        {
          key: 'doing',
          label: 'Doing',
          color: null,
          wipLimit: 1,
          collapsed: null,
          sortOrder: 2,
        },
      ];
      @tracked placements: KanbanPlacement[] = [
        { index: 0, columnId: 'todo', sortOrder: 1 },
        { index: 1, columnId: 'doing', sortOrder: 1 },
        { index: 2, columnId: 'doing', sortOrder: 2 },
      ];

      onToggleCollapsed = (column: KanbanColumnConfig): void => {
        this.columns = this.columns.map((c) =>
          c.key === column.key ? { ...c, collapsed: !c.collapsed } : c,
        );
      };
    }

    let state = new State();

    await render(
      <template>
        <KanbanPlane
          @columns={{state.columns}}
          @placements={{state.placements}}
          @onToggleCollapsed={{state.onToggleCollapsed}}
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
    assert.dom('[data-kanban-column="todo"]').exists();
    assert.dom('[data-kanban-column="doing"]').exists();
    assert.dom('[data-test-hidden-columns]').doesNotExist();

    await click('[data-test-column-collapse-button="todo"]');

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('[data-kanban-column="todo"]').doesNotExist();
    assert.dom('[data-test-hidden-columns]').containsText('Hidden');
    assert.dom('[data-test-hidden-column-count]').hasText('1');
    assert.dom('[data-test-show-hidden-column="todo"]').exists();
    assert.dom('[data-test-hidden-column-row="0"]').includesText('Todo');
    assert.dom('[data-test-hidden-column-row="0"]').includesText('1');

    await click('[data-test-show-hidden-column="todo"]');

    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-kanban-column="todo"]').exists();
    assert.dom('[data-test-hidden-columns]').doesNotExist();
  });

  test('when hideEmpty is on, empty column rows in the hidden tray are disabled and not restorable by click', async function (assert) {
    class State {
      @tracked hideEmpty = false;
      @tracked columns: KanbanColumnConfig[] = [
        {
          key: 'todo',
          label: 'Todo',
          color: null,
          wipLimit: null,
          collapsed: false,
          sortOrder: 1,
        },
        {
          key: 'doing',
          label: 'Doing',
          color: null,
          wipLimit: null,
          collapsed: false,
          sortOrder: 2,
        },
      ];
      @tracked placements: KanbanPlacement[] = [
        { index: 0, columnId: 'doing', sortOrder: 1 },
      ];

      onToggleCollapsed = (column: KanbanColumnConfig): void => {
        this.columns = this.columns.map((c) =>
          c.key === column.key ? { ...c, collapsed: !c.collapsed } : c,
        );
      };

      toggleHideEmpty = (): void => {
        this.hideEmpty = !this.hideEmpty;
        this.columns = this.columns.map((c) => {
          let isEmpty = !this.placements.some((p) => p.columnId === c.key);
          return isEmpty ? { ...c, collapsed: this.hideEmpty } : c;
        });
      };
    }

    let state = new State();

    await render(
      <template>
        <button type='button' {{on 'click' state.toggleHideEmpty}}>
          Toggle hide empty
        </button>
        <KanbanPlane
          @columns={{state.columns}}
          @placements={{state.placements}}
          @hideEmpty={{state.hideEmpty}}
          @onToggleCollapsed={{state.onToggleCollapsed}}
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
    assert.dom('[data-test-empty-column="todo"]').hasText('No cards');
    assert.dom('[data-test-hidden-columns]').doesNotExist();

    await click('button');

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('[data-kanban-column="todo"]').doesNotExist();
    assert.dom('[data-test-hidden-column-count]').hasText('1');
    assert.dom('[data-test-hidden-column-row="0"]').includesText('Todo');
    assert.dom('[data-test-hidden-columns]').includesText('0');
    assert
      .dom('[data-test-show-hidden-column="todo"]')
      .isDisabled('empty column row is disabled when hideEmpty is on');
    assert
      .dom('[data-kanban-column="todo"]')
      .doesNotExist('column stays hidden');

    await click('button');

    assert.dom('[data-kanban-column]').exists({ count: 2 });
    assert.dom('[data-kanban-column="todo"]').exists();
    assert.dom('[data-test-hidden-columns]').doesNotExist();
  });

  test('columns are rendered in sortOrder order regardless of array order', async function (assert) {
    let columns: KanbanColumnConfig[] = [
      {
        key: 'c',
        label: 'C',
        color: null,
        wipLimit: null,
        collapsed: false,
        sortOrder: 3,
      },
      {
        key: 'a',
        label: 'A',
        color: null,
        wipLimit: null,
        collapsed: false,
        sortOrder: 1,
      },
      {
        key: 'b',
        label: 'B',
        color: null,
        wipLimit: null,
        collapsed: false,
        sortOrder: 2,
      },
    ];
    let placements: KanbanPlacement[] = [];

    await render(
      <template>
        <KanbanPlane @columns={{columns}} @placements={{placements}}>
          <:card as |placement|><div>Card {{placement.index}}</div></:card>
          <:ghost as |index|><div>Ghost {{index}}</div></:ghost>
        </KanbanPlane>
      </template>,
    );

    let rendered = document.querySelectorAll('[data-kanban-column]');
    assert.strictEqual(
      rendered[0]?.getAttribute('data-kanban-column'),
      'a',
      'first column is a (sortOrder 1)',
    );
    assert.strictEqual(
      rendered[1]?.getAttribute('data-kanban-column'),
      'b',
      'second column is b (sortOrder 2)',
    );
    assert.strictEqual(
      rendered[2]?.getAttribute('data-kanban-column'),
      'c',
      'third column is c (sortOrder 3)',
    );
  });
});
