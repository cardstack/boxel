import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  KanbanDragManager,
  KanbanPlane,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

module('Integration | Component | kanban-plane', function (hooks) {
  setupRenderingTest(hooks);

  test('it hides empty and collapsed columns while showing WIP overflow state', async function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 1, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 2 },
      { index: 2, column: 2, sortOrder: 1 },
    ];
    const columns: KanbanColumnConfig[] = [
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
      {
        key: 'done',
        label: 'Done',
        color: null,
        wipLimit: null,
        collapsed: true,
        sortOrder: 2,
      },
    ];
    const manager = new KanbanDragManager(this.owner, {
      placements: () => placements,
      columnCount: () => columns.length,
      isColumnVisible: (index: number) => {
        let column = columns[index];
        return !!column && !column.collapsed && placements.some((p) => p.column === index);
      },
      containerElement: () => null,
      onChange: () => {},
    });

    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
          @manager={{manager}}
          @hideEmpty={{true}}
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

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('.col-name').hasText('Doing');
    assert.dom('.column.is-over-wip').exists();
    assert.dom('.col-wip.over').hasText('Max 1');
    assert.dom('[data-card-index]').exists({ count: 2 });
    assert.dom('[data-kanban-column="0"]').doesNotExist();
    assert.dom('[data-kanban-column="2"]').doesNotExist();
    assert.dom('.empty-col').doesNotExist();
  });

  test('it shows empty columns when hideEmpty is false', async function (assert) {
    const placements: KanbanPlacement[] = [];
    const columns: KanbanColumnConfig[] = [
      {
        key: 'todo',
        label: 'Todo',
        color: null,
        wipLimit: null,
        collapsed: null,
        sortOrder: 0,
      },
    ];
    const manager = new KanbanDragManager(this.owner, {
      placements: () => placements,
      columnCount: () => columns.length,
      containerElement: () => null,
      onChange: () => {},
    });

    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
          @manager={{manager}}
          @hideEmpty={{false}}
        >
          <:card as |placement|>
            <div>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    assert.dom('[data-kanban-column]').exists({ count: 1 });
    assert.dom('.empty-col').hasText('No cards');
  });

  test('hideEmpty with all-empty board renders no columns', async function (assert) {
    const placements: KanbanPlacement[] = [];
    const columns: KanbanColumnConfig[] = [
      {
        key: 'a',
        label: 'Alpha',
        color: null,
        wipLimit: null,
        collapsed: null,
        sortOrder: 0,
      },
      {
        key: 'b',
        label: 'Beta',
        color: null,
        wipLimit: null,
        collapsed: null,
        sortOrder: 1,
      },
    ];
    const manager = new KanbanDragManager(this.owner, {
      placements: () => placements,
      columnCount: () => columns.length,
      containerElement: () => null,
      onChange: () => {},
    });

    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
          @manager={{manager}}
          @hideEmpty={{true}}
        >
          <:card as |placement|>
            <div>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    assert.dom('[data-kanban-column]').doesNotExist();
  });

  test('onAddCard fires with the column key when the add button is clicked', async function (assert) {
    let addedColumnKey: string | null | undefined;

    const columns: KanbanColumnConfig[] = [
      {
        key: 'todo',
        label: 'Todo',
        color: null,
        wipLimit: null,
        collapsed: null,
        sortOrder: 0,
      },
    ];
    const placements: KanbanPlacement[] = [];
    const onAddCard = (key: string | null) => {
      addedColumnKey = key;
    };
    const manager = new KanbanDragManager(this.owner, {
      placements: () => placements,
      columnCount: () => columns.length,
      containerElement: () => null,
      onChange: () => {},
    });

    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
          @manager={{manager}}
          @hideEmpty={{false}}
          @onAddCard={{onAddCard}}
        >
          <:card as |placement|>
            <div>Card {{placement.index}}</div>
          </:card>
          <:ghost as |index|>
            <div>Ghost {{index}}</div>
          </:ghost>
        </KanbanPlane>
      </template>,
    );

    assert.dom('.col-add-btn').exists();
    await click('.col-add-btn');
    assert.strictEqual(addedColumnKey, 'todo');
  });
});
