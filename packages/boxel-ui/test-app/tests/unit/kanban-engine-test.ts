import { module, test } from 'qunit';

import {
  autoPlaceKanban,
  cardsInColumn,
  kanbanColumnCount as columnCount,
  findInsertionFromPointer,
  resolveInsertion,
  type KanbanColumnConfig,
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

function makeColumnConfig(key: string): KanbanColumnConfig {
  return { key, label: key, color: null, wipLimit: null, collapsed: false };
}

const COL_0 = 'col-0';
const COL_1 = 'col-1';
const COL_2 = 'col-2';

// ── cardsInColumn ─────────────────────────────────────────────────────── //

module('Unit | kanban-engine | cardsInColumn', function () {
  test('filters and sorts cards for the requested column', function (assert) {
    assert.deepEqual(cardsInColumn(COL_0, []), [], 'empty placements');

    const placements: KanbanPlacement[] = [
      { index: 2, columnId: COL_0, sortOrder: 3 },
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
      { index: 3, columnId: COL_0, sortOrder: 2 },
    ];
    const result = cardsInColumn(COL_0, placements);
    assert.strictEqual(result.length, 3);
    assert.ok(result.every((p: KanbanPlacement) => p.columnId === COL_0));
    assert.deepEqual(
      result.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
      'sorted by sortOrder ascending',
    );
    assert.deepEqual(
      cardsInColumn('missing', placements),
      [],
      'missing column returns []',
    );
  });
});

// ── columnCount ───────────────────────────────────────────────────────── //

module('Unit | kanban-engine | columnCount', function () {
  test('counts cards in the specified column', function (assert) {
    assert.strictEqual(columnCount(COL_0, []), 0, 'empty placements');

    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
      { index: 2, columnId: COL_0, sortOrder: 2 },
    ];
    assert.strictEqual(columnCount(COL_0, placements), 2);
    assert.strictEqual(columnCount(COL_1, placements), 1);
    assert.strictEqual(
      columnCount('missing', placements),
      0,
      'missing column returns 0',
    );
  });
});

// ── resolveInsertion ──────────────────────────────────────────────────── //

module('Unit | kanban-engine | resolveInsertion', function () {
  test('moves card to another column — empty target, append, and insert before', function (assert) {
    // into empty column, source renumbered
    let result = resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: -1, position: 1 },
      [
        { index: 0, columnId: COL_0, sortOrder: 1 },
        { index: 1, columnId: COL_0, sortOrder: 2 },
      ],
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 0)!.columnId,
      COL_1,
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 0)!.sortOrder,
      1,
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 1)!.sortOrder,
      1,
      'source column renumbered',
    );

    // append at end of populated column
    result = resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: -1, position: 3 },
      [
        { index: 0, columnId: COL_0, sortOrder: 1 },
        { index: 1, columnId: COL_1, sortOrder: 1 },
        { index: 2, columnId: COL_1, sortOrder: 2 },
      ],
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 0)!.sortOrder,
      3,
    );

    // insert before a specific card, pushing others down
    result = resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: 1, position: 1 },
      [
        { index: 0, columnId: COL_0, sortOrder: 1 },
        { index: 1, columnId: COL_1, sortOrder: 1 },
        { index: 2, columnId: COL_1, sortOrder: 2 },
      ],
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 0)!.sortOrder,
      1,
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 1)!.sortOrder,
      2,
    );
    assert.strictEqual(
      result.find((p: KanbanPlacement) => p.index === 2)!.sortOrder,
      3,
    );
  });

  test('reorders within the same column — front, end, and middle', function (assert) {
    const base: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
      { index: 2, columnId: COL_0, sortOrder: 3 },
      { index: 3, columnId: COL_0, sortOrder: 4 },
    ];
    const orderOf = (result: KanbanPlacement[]) =>
      result
        .filter((p) => p.columnId === COL_0)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => p.index);

    assert.deepEqual(
      orderOf(
        resolveInsertion(
          3,
          { columnId: COL_0, insertBeforeIndex: 0, position: 1 },
          base.map((p) => ({ ...p })),
        ),
      ),
      [3, 0, 1, 2],
      'move to front',
    );
    assert.deepEqual(
      orderOf(
        resolveInsertion(
          0,
          { columnId: COL_0, insertBeforeIndex: -1, position: 4 },
          base.map((p) => ({ ...p })),
        ),
      ),
      [1, 2, 3, 0],
      'move to end',
    );
    assert.deepEqual(
      orderOf(
        resolveInsertion(
          3,
          { columnId: COL_0, insertBeforeIndex: 1, position: 2 },
          base.map((p) => ({ ...p })),
        ),
      ),
      [0, 3, 1, 2],
      'move to middle',
    );
  });

  test('does not mutate the original placements array', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
    ];
    const snapshot = placements.map((p: KanbanPlacement) => ({ ...p }));
    resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    assert.deepEqual(placements, snapshot);
  });

  test('two sequential inserts into the same column give contiguous sortOrders', function (assert) {
    let placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
      { index: 2, columnId: COL_2, sortOrder: 1 },
    ];
    placements = resolveInsertion(
      1,
      { columnId: COL_0, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    placements = resolveInsertion(
      2,
      { columnId: COL_0, insertBeforeIndex: -1, position: 3 },
      placements,
    );
    const col0 = placements
      .filter((p: KanbanPlacement) => p.columnId === COL_0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      );
    assert.deepEqual(
      col0.map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
    );
  });

  test('source column empties and bystander columns are untouched', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
      { index: 2, columnId: COL_2, sortOrder: 1 },
      { index: 3, columnId: COL_2, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    assert.strictEqual(
      result.filter((p: KanbanPlacement) => p.columnId === COL_0).length,
      0,
      'source column is now empty',
    );
    const col2 = result
      .filter((p: KanbanPlacement) => p.columnId === COL_2)
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
      'bystander unchanged',
    );
  });

  test('returns unchanged array when dragIndex is not found', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
    ];
    const result = resolveInsertion(
      99,
      { columnId: COL_1, insertBeforeIndex: -1, position: 1 },
      placements,
    );
    assert.deepEqual(result, placements);
  });

  test('moving a card to the same position is a no-op for sort order', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
    ];
    const result = resolveInsertion(
      1,
      { columnId: COL_0, insertBeforeIndex: -1, position: 2 },
      placements,
    );
    const order = result
      .filter((p: KanbanPlacement) => p.columnId === COL_0)
      .sort(
        (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
      )
      .map((p: KanbanPlacement) => p.index);
    assert.deepEqual(order, [0, 1]);
  });

  test('insertBeforeIndex pointing to a non-existent card falls back to end', function (assert) {
    const placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
    ];
    const result = resolveInsertion(
      0,
      { columnId: COL_1, insertBeforeIndex: 99, position: 1 },
      placements,
    );
    const moved = result.find((p: KanbanPlacement) => p.index === 0)!;
    const existing = result.find((p: KanbanPlacement) => p.index === 1)!;
    assert.strictEqual(moved.columnId, COL_1);
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
    column0.setAttribute('data-kanban-column', COL_0);
    stubRect(column0, { left: 0, top: 0, width: 200, height: 400 });

    let column1 = document.createElement('div');
    column1.setAttribute('data-kanban-column', COL_1);
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
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
      { index: 2, columnId: COL_1, sortOrder: 1 },
    ];

    assert.strictEqual(
      findInsertionFromPointer(500, 50, container, placements, 0),
      null,
    );
  });

  test('returns start position for an empty target column', function (assert) {
    let column0 = document.createElement('div');
    column0.setAttribute('data-kanban-column', COL_0);
    stubRect(column0, { left: 0, top: 0, width: 200, height: 400 });

    let column1 = document.createElement('div');
    column1.setAttribute('data-kanban-column', COL_1);
    stubRect(column1, { left: 220, top: 0, width: 200, height: 400 });

    let card0 = document.createElement('div');
    card0.setAttribute('data-card-index', '0');
    stubRect(card0, { left: 8, top: 10, width: 184, height: 80 });

    column0.append(card0);
    container.append(column0, column1);

    let placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(260, 40, container, placements, 1),
      { columnId: COL_1, insertBeforeIndex: -1, position: 1 },
    );
  });

  test('inserts before the first card when pointer is above its midpoint', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
      { index: 2, columnId: COL_1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(50, 20, container, placements, 2),
      { columnId: COL_0, insertBeforeIndex: 0, position: 1 },
    );
  });

  test('returns end insertion after the last card when pointer is below all midpoints', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
      { index: 2, columnId: COL_1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(50, 300, container, placements, 2),
      { columnId: COL_0, insertBeforeIndex: -1, position: 3 },
    );
  });

  test('ignores the dragged card when computing insertion in its own column', function (assert) {
    buildBoard();

    let placements: KanbanPlacement[] = [
      { index: 0, columnId: COL_0, sortOrder: 1 },
      { index: 1, columnId: COL_0, sortOrder: 2 },
      { index: 2, columnId: COL_1, sortOrder: 1 },
    ];

    assert.deepEqual(
      findInsertionFromPointer(260, 40, container, placements, 2),
      { columnId: COL_1, insertBeforeIndex: -1, position: 1 },
    );
  });
});

// ── autoPlaceKanban ───────────────────────────────────────────────────── //

module('Unit | kanban-engine | autoPlaceKanban', function () {
  test('distributes cards round-robin, respects edge cases, assigns unique indexes', function (assert) {
    assert.deepEqual(
      autoPlaceKanban(0, [makeColumnConfig(COL_0)]),
      [],
      'zero items',
    );
    assert.deepEqual(autoPlaceKanban(3, []), [], 'zero columns');

    const columns3 = [COL_0, COL_1, COL_2].map(makeColumnConfig);
    const result = autoPlaceKanban(6, columns3);
    assert.strictEqual(result.length, 6);
    for (const p of result) {
      assert.strictEqual(
        p.columnId,
        columns3[p.index % 3]!.key,
        `card ${p.index} in correct column`,
      );
      assert.strictEqual(
        p.sortOrder,
        Math.floor(p.index / 3) + 1,
        `card ${p.index} has correct sortOrder`,
      );
    }

    const single = autoPlaceKanban(3, [makeColumnConfig(COL_0)]);
    assert.true(
      single.every((p: KanbanPlacement) => p.columnId === COL_0),
      'all in single column',
    );
    assert.deepEqual(
      single
        .sort(
          (a: KanbanPlacement, b: KanbanPlacement) => a.sortOrder - b.sortOrder,
        )
        .map((p: KanbanPlacement) => p.sortOrder),
      [1, 2, 3],
    );

    const indices = autoPlaceKanban(5, [
      makeColumnConfig(COL_0),
      makeColumnConfig(COL_1),
    ])
      .map((p: KanbanPlacement) => p.index)
      .sort((a: number, b: number) => a - b);
    assert.deepEqual(
      indices,
      [0, 1, 2, 3, 4],
      'unique indexes matching input position',
    );
  });
});
