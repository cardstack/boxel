import { module, test } from 'qunit';

import {
  autoPlaceKanban,
  cardsInColumn,
  kanbanColumnCount as columnCount,
  findInsertionFromPointer,
  resolveInsertion,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

function stubRect(
  element: Element,
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON() {
        return this;
      },
    }),
  });
}

// ── cardsInColumn ─────────────────────────────────────────────────────── //

module('Unit | kanban-engine | cardsInColumn', function () {
  test('returns [] for empty placements', function (assert) {
    assert.deepEqual(cardsInColumn(0, []), []);
  });

  test('filters to only cards in the requested column', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 0, sortOrder: 2 },
    ];
    const result = cardsInColumn(0, placements);
    assert.strictEqual(result.length, 2);
    assert.ok(result.every((p: KanbanPlacement) => p.column === 0));
    assert.ok(result.some((p: KanbanPlacement) => p.index === 0));
    assert.ok(result.some((p: KanbanPlacement) => p.index === 2));
  });

  test('returns results sorted by sortOrder ascending regardless of input order', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 2, column: 0, sortOrder: 3 },
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
    ];
    const result = cardsInColumn(0, placements);
    assert.deepEqual(
      result.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
    );
  });

  test('returns [] for a column with no cards', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
    ];
    assert.deepEqual(cardsInColumn(2, placements), []);
  });
});

// ── columnCount ───────────────────────────────────────────────────────── //

module('Unit | kanban-engine | columnCount', function () {
  test('returns 0 for empty placements', function (assert) {
    assert.strictEqual(columnCount(0, []), 0);
  });

  test('counts only cards in the specified column', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 0, sortOrder: 2 },
    ];
    assert.strictEqual(columnCount(0, placements), 2);
    assert.strictEqual(columnCount(1, placements), 1);
  });

  test('returns 0 for a column not present in placements', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
    ];
    assert.strictEqual(columnCount(2, placements), 0);
  });
});

// ── resolveInsertion ──────────────────────────────────────────────────── //

module('Unit | kanban-engine | resolveInsertion', function () {
  test('moves card into an empty column, sets sortOrder 1, renumbers source', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: -1, position: 1 },
      placements,
    );
    const moved = result.find((p: KanbanPlacement) => p.index === 0)!;
    const stayed = result.find((p: KanbanPlacement) => p.index === 1)!;
    assert.strictEqual(moved.column, 1);
    assert.strictEqual(moved.sortOrder, 1);
    assert.strictEqual(stayed.column, 0);
    assert.strictEqual(stayed.sortOrder, 1);
  });

  test('inserts card at end of populated column with insertBeforeIndex -1', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 1, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: -1, position: 3 },
      placements,
    );
    const moved = result.find((p: KanbanPlacement) => p.index === 0)!;
    assert.strictEqual(moved.column, 1);
    assert.strictEqual(moved.sortOrder, 3);
  });

  test('inserts card before a specific target card in a different column', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 1, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: 1, position: 1 },
      placements,
    );
    const moved = result.find((p: KanbanPlacement) => p.index === 0)!;
    const pushed1 = result.find((p: KanbanPlacement) => p.index === 1)!;
    const pushed2 = result.find((p: KanbanPlacement) => p.index === 2)!;
    assert.strictEqual(moved.column, 1);
    assert.strictEqual(moved.sortOrder, 1);
    assert.strictEqual(pushed1.sortOrder, 2);
    assert.strictEqual(pushed2.sortOrder, 3);
  });

  test('reorders within same column — move to front', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 0, sortOrder: 3 },
    ];
    const result = resolveInsertion(
      2,
      { column: 0, insertBeforeIndex: 0, position: 1 },
      placements,
    );
    const order = result
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      )
      .map((p: KanbanPlacement) => p.index);
    assert.deepEqual(order, [2, 0, 1]);
  });

  test('reorders within same column — move to end', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 0, sortOrder: 3 },
    ];
    const result = resolveInsertion(
      0,
      { column: 0, insertBeforeIndex: -1, position: 3 },
      placements,
    );
    const order = result
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      )
      .map((p: KanbanPlacement) => p.index);
    assert.deepEqual(order, [1, 2, 0]);
  });

  test('reorders within same column — move to middle', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 0, sortOrder: 3 },
      { index: 3, column: 0, sortOrder: 4 },
    ];
    const result = resolveInsertion(
      3,
      { column: 0, insertBeforeIndex: 1, position: 2 },
      placements,
    );
    const order = result
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      )
      .map((p: KanbanPlacement) => p.index);
    assert.deepEqual(order, [0, 3, 1, 2]);
  });

  test('does not mutate the original placements array', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];
    const snapshot = placements.map((p: KanbanPlacement) => ({ ...p }));
    resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    assert.deepEqual(placements, snapshot);
  });

  test('two sequential inserts into the same column give contiguous sortOrders', function (assert) {
    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 2, sortOrder: 1 },
    ];
    placements = resolveInsertion(
      1,
      { column: 0, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    placements = resolveInsertion(
      2,
      { column: 0, insertBeforeIndex: -1, position: 3 },
      placements,
    );
    const col0 = placements
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      );
    assert.deepEqual(
      col0.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
    );
  });

  test('moving the only card out of a column leaves it empty', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    assert.strictEqual(
      result.filter((p: KanbanPlacement) => p.column === 0).length,
      0,
    );
  });

  test('bystander columns are not affected', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
      { index: 2, column: 2, sortOrder: 1 },
      { index: 3, column: 2, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    const col2 = result
      .filter((p: KanbanPlacement) => p.column === 2)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      );
    assert.deepEqual(
      col2.map((p: KanbanPlacement) => p.index),
      [2, 3],
    );
    assert.deepEqual(
      col2.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2],
    );
  });

  test('returns unchanged array when dragIndex is not found', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
    ];
    const result = resolveInsertion(
      99,
      { column: 1, insertBeforeIndex: -1, position: 1 },
      placements,
    );
    assert.deepEqual(result, placements);
  });

  test('moving a card to the same position is a no-op for sort order', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      1,
      { column: 0, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    const order = result
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      )
      .map((p: KanbanPlacement) => p.index);
    assert.deepEqual(order, [0, 1]);
  });

  test('insertBeforeIndex pointing to a non-existent card falls back to end', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];
    const result = resolveInsertion(
      0,
      { column: 1, insertBeforeIndex: 99, position: 1 },
      placements,
    );
    const moved = result.find((p: KanbanPlacement) => p.index === 0)!;
    const existing = result.find((p: KanbanPlacement) => p.index === 1)!;
    assert.strictEqual(moved.column, 1);
    assert.strictEqual(existing.sortOrder, 1);
    assert.strictEqual(moved.sortOrder, 2);
  });
});

// ── findInsertionFromPointer ─────────────────────────────────────────── //

module('Unit | kanban-engine | findInsertionFromPointer', function (hooks) {
  let container: HTMLElement;

  hooks.beforeEach(function () {
    container = document.createElement('div');
  });

  hooks.afterEach(function () {
    container.remove();
  });

  function buildBoard() {
    let column0 = document.createElement('div');
    column0.setAttribute('data-kanban-column', '0');
    stubRect(column0, { left: 0, top: 0, width: 200, height: 400 });

    let column1 = document.createElement('div');
    column1.setAttribute('data-kanban-column', '1');
    stubRect(column1, { left: 220, top: 0, width: 200, height: 400 });

    let card0 = document.createElement('div');
    card0.setAttribute('data-card-index', '0');
    stubRect(card0, { left: 8, top: 10, width: 184, height: 80 });

    let card1 = document.createElement('div');
    card1.setAttribute('data-card-index', '1');
    stubRect(card1, { left: 8, top: 100, width: 184, height: 80 });

    let card2 = document.createElement('div');
    card2.setAttribute('data-card-index', '2');
    stubRect(card2, { left: 228, top: 10, width: 184, height: 80 });

    column0.append(card0, card1);
    column1.append(card2);
    container.append(column0, column1);
  }

  test('returns null when pointer is outside all columns', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 1, sortOrder: 1 },
    ];

    assert.strictEqual(
      findInsertionFromPointer(500, 50, container, placements, 0, 2),
      null,
    );
  });

  test('returns start position for an empty target column', function (assert) {
    let column0 = document.createElement('div');
    column0.setAttribute('data-kanban-column', '0');
    stubRect(column0, { left: 0, top: 0, width: 200, height: 400 });

    let column1 = document.createElement('div');
    column1.setAttribute('data-kanban-column', '1');
    stubRect(column1, { left: 220, top: 0, width: 200, height: 400 });

    let card0 = document.createElement('div');
    card0.setAttribute('data-card-index', '0');
    stubRect(card0, { left: 8, top: 10, width: 184, height: 80 });

    column0.append(card0);
    container.append(column0, column1);

    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(260, 40, container, placements, 1, 2),
      { column: 1, insertBeforeIndex: -1, position: 1 },
    );
  });

  test('inserts before the first card when pointer is above its midpoint', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(50, 20, container, placements, 2, 2),
      { column: 0, insertBeforeIndex: 0, position: 1 },
    );
  });

  test('returns end insertion after the last card when pointer is below all midpoints', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(50, 300, container, placements, 2, 2),
      { column: 0, insertBeforeIndex: -1, position: 3 },
    );
  });

  test('ignores the dragged card when computing insertion in its own column', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
      { index: 2, column: 1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(260, 40, container, placements, 2, 2),
      { column: 1, insertBeforeIndex: -1, position: 1 },
    );
  });
});

// ── autoPlaceKanban ───────────────────────────────────────────────────── //

module('Unit | kanban-engine | autoPlaceKanban', function () {
  test('returns [] when itemCount is 0', function (assert) {
    assert.deepEqual(autoPlaceKanban(0, 3), []);
  });

  test('even distribution — 4 cards across 2 columns', function (assert) {
    const result = autoPlaceKanban(4, 2);
    const col0 = result
      .filter((p: KanbanPlacement) => p.column === 0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      );
    const col1 = result
      .filter((p: KanbanPlacement) => p.column === 1)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      );
    assert.strictEqual(col0.length, 2);
    assert.strictEqual(col1.length, 2);
    assert.deepEqual(
      col0.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2],
    );
    assert.deepEqual(
      col1.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2],
    );
  });

  test('uneven distribution — 3 cards across 2 columns', function (assert) {
    const result = autoPlaceKanban(3, 2);
    assert.strictEqual(
      result.filter((p: KanbanPlacement) => p.column === 0).length,
      2,
    );
    assert.strictEqual(
      result.filter((p: KanbanPlacement) => p.column === 1).length,
      1,
    );
  });

  test('uses round-robin column assignment with 1-based sortOrder', function (assert) {
    const result = autoPlaceKanban(6, 3);
    assert.strictEqual(result.length, 6);
    for (const p of result) {
      assert.strictEqual(p.column, p.index % 3);
      assert.strictEqual(p.sortOrder, Math.floor(p.index / 3) + 1);
    }
  });

  test('single column receives all cards in order', function (assert) {
    const result = autoPlaceKanban(3, 1);
    assert.true(result.every((p: KanbanPlacement) => p.column === 0));
    assert.deepEqual(
      result
        .sort(
          (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
        )
        .map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
    );
  });

  test('each card gets a unique index matching its input position', function (assert) {
    const result = autoPlaceKanban(5, 3);
    const indices = result
      .map((p: KanbanPlacement) => p.index)
      .sort((a: number, b: number) => a - b);
    assert.deepEqual(indices, [0, 1, 2, 3, 4]);
  });
});
