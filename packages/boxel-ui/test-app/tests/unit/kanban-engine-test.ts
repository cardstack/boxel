import { module, test } from 'qunit';

import {
  autoPlaceKanban,
  cardsInColumn,
  kanbanColumnCount as columnCount,
  resolveInsertion,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

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
    assert.ok(result.every((p) => p.column === 0));
    assert.ok(result.some((p) => p.index === 0));
    assert.ok(result.some((p) => p.index === 2));
  });

  test('returns results sorted by sortOrder ascending regardless of input order', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 2, column: 0, sortOrder: 3 },
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 0, sortOrder: 2 },
    ];
    const result = cardsInColumn(0, placements);
    assert.deepEqual(
      result.map((p) => p.sortOrder),
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
    const moved = result.find((p) => p.index === 0)!;
    const stayed = result.find((p) => p.index === 1)!;
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
    const moved = result.find((p) => p.index === 0)!;
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
    const moved = result.find((p) => p.index === 0)!;
    const pushed1 = result.find((p) => p.index === 1)!;
    const pushed2 = result.find((p) => p.index === 2)!;
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
    assert.deepEqual(order, [0, 3, 1, 2]);
  });

  test('does not mutate the original placements array', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];
    const snapshot = placements.map((p) => ({ ...p }));
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    assert.deepEqual(
      col0.map((p) => p.sortOrder),
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
    assert.strictEqual(result.filter((p) => p.column === 0).length, 0);
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
      .filter((p) => p.column === 2)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    assert.deepEqual(
      col2.map((p) => p.index),
      [2, 3],
    );
    assert.deepEqual(
      col2.map((p) => p.sortOrder),
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
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
    const moved = result.find((p) => p.index === 0)!;
    const existing = result.find((p) => p.index === 1)!;
    assert.strictEqual(moved.column, 1);
    assert.strictEqual(existing.sortOrder, 1);
    assert.strictEqual(moved.sortOrder, 2);
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
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const col1 = result
      .filter((p) => p.column === 1)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    assert.strictEqual(col0.length, 2);
    assert.strictEqual(col1.length, 2);
    assert.deepEqual(
      col0.map((p) => p.sortOrder),
      [1, 2],
    );
    assert.deepEqual(
      col1.map((p) => p.sortOrder),
      [1, 2],
    );
  });

  test('uneven distribution — 3 cards across 2 columns', function (assert) {
    const result = autoPlaceKanban(3, 2);
    assert.strictEqual(result.filter((p) => p.column === 0).length, 2);
    assert.strictEqual(result.filter((p) => p.column === 1).length, 1);
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
    assert.strictEqual(
      result.every((p) => p.column === 0),
      true,
    );
    assert.deepEqual(
      result.sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.sortOrder),
      [1, 2, 3],
    );
  });

  test('each card gets a unique index matching its input position', function (assert) {
    const result = autoPlaceKanban(5, 3);
    const indices = result.map((p) => p.index).sort((a, b) => a - b);
    assert.deepEqual(indices, [0, 1, 2, 3, 4]);
  });
});
