import { module, test } from 'qunit';

import {
  autoPlaceKanban,
  cardsInColumn,
  columnCount,
  resolveInsertion,
  type KanbanPlacement,
} from '../realm/kanban/engine';

module('cardsInColumn', function () {
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
});

module('columnCount', function () {
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

module('resolveInsertion', function () {
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
    const orders = result
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
    assert.deepEqual(orders, [2, 0, 1]);
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
    const orders = result
      .filter((p) => p.column === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.index);
    assert.deepEqual(orders, [1, 2, 0]);
  });

  test('does not mutate the original placements array', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
    ];
    const snapshot = placements.map((p) => ({ ...p }));
    resolveInsertion(0, { column: 1, insertBeforeIndex: -1, position: 2 }, placements);
    assert.deepEqual(placements, snapshot);
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
});

module('autoPlaceKanban', function () {
  test('returns [] when itemCount is 0', function (assert) {
    assert.deepEqual(autoPlaceKanban(0, 3), []);
  });

  test('even distribution — 4 cards across 2 columns', function (assert) {
    const result = autoPlaceKanban(4, 2);
    const col0 = result.filter((p) => p.column === 0).sort((a, b) => a.sortOrder - b.sortOrder);
    const col1 = result.filter((p) => p.column === 1).sort((a, b) => a.sortOrder - b.sortOrder);
    assert.strictEqual(col0.length, 2);
    assert.strictEqual(col1.length, 2);
    assert.deepEqual(col0.map((p) => p.sortOrder), [1, 2]);
    assert.deepEqual(col1.map((p) => p.sortOrder), [1, 2]);
  });

  test('uneven distribution — 3 cards across 2 columns', function (assert) {
    const result = autoPlaceKanban(3, 2);
    const col0 = result.filter((p) => p.column === 0);
    const col1 = result.filter((p) => p.column === 1);
    assert.strictEqual(col0.length, 2);
    assert.strictEqual(col1.length, 1);
  });

  test('uses round-robin column assignment with 1-based sortOrder', function (assert) {
    const result = autoPlaceKanban(6, 3);
    assert.strictEqual(result.length, 6);
    for (const p of result) {
      assert.strictEqual(p.column, p.index % 3);
      assert.strictEqual(p.sortOrder, Math.floor(p.index / 3) + 1);
    }
  });
});
