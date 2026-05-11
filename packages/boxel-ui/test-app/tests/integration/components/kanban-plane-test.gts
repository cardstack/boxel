import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
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
    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
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
    assert.dom('[data-test-boxel-kanban-col-name]').hasText('Doing');
    assert.dom('[data-test-column-is-over-wip]').exists();
    assert.dom('[data-test-kanban-col-wip]').hasText('Max 1');
    assert.dom('[data-card-index]').exists({ count: 2 });
    assert.dom('[data-kanban-column="0"]').doesNotExist();
    assert.dom('[data-kanban-column="2"]').doesNotExist();
    assert.dom('[data-test-empty-column]').doesNotExist();
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
    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
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
    assert.dom('[data-test-empty-column]').hasText('No cards');
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
    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
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
    await render(
      <template>
        <KanbanPlane
          @columns={{columns}}
          @placements={{placements}}
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

    assert.dom('[data-test-column-add-button]').exists();
    await click('[data-test-column-add-button]');
    assert.strictEqual(addedColumnKey, 'todo');
  });
});
