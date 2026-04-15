// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Kanban Engine — Pure insertion logic for Kanban boards.
// Thinks in columns and sort order, not grid cells.
// Cards insert BETWEEN other cards, not INTO wells/slots.

// ── Types ────────────────────────────────────────────────────────────── // ²

export interface KanbanPlacement { // ³
  index: number;       // card index in linksToMany
  column: number;      // which lane (0-based)
  sortOrder: number;   // position within column (1, 2, 3...)
}

export interface InsertionPoint { // ⁴
  column: number;           // target lane
  insertBeforeIndex: number; // card index to insert before (-1 = end)
  position: number;         // sort position for shift calculations
}

// ── Column Queries ───────────────────────────────────────────────────── // ⁵

/** Get cards in a column, sorted by sortOrder. */
export function cardsInColumn(column: number, placements: KanbanPlacement[]): KanbanPlacement[] { // ⁶
  return placements
    .filter(p => p.column === column)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Count cards in a column. */
export function columnCount(column: number, placements: KanbanPlacement[]): number { // ⁷
  return placements.filter(p => p.column === column).length;
}

// ── Insertion Resolution ─────────────────────────────────────────────── // ⁸

/**
 * Resolve an insertion: move card to a new column+position.
 * Renumbers sort orders in both source and target columns.
 * Returns new placements array (immutable).
 */
export function resolveInsertion( // ⁹
  dragIndex: number,
  insertion: InsertionPoint,
  placements: KanbanPlacement[],
): KanbanPlacement[] {
  const result = placements.map(p => ({ ...p }));
  const dragCard = result.find(p => p.index === dragIndex);
  if (!dragCard) return result;

  const sourceColumn = dragCard.column;
  const targetColumn = insertion.column;

  // Move drag card to target column
  dragCard.column = targetColumn;

  // Get target column cards (excluding drag card) in current order
  const targetCards = result
    .filter(p => p.column === targetColumn && p.index !== dragIndex)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Find insertion index by card identity (immune to renumbering)
  let insertAt = targetCards.length; // default: end
  if (insertion.insertBeforeIndex !== -1) {
    const idx = targetCards.findIndex(p => p.index === insertion.insertBeforeIndex);
    if (idx !== -1) insertAt = idx;
  }

  // Renumber: cards before insertAt, then drag card, then cards after
  for (let i = 0; i < targetCards.length; i++) {
    if (i < insertAt) {
      targetCards[i].sortOrder = i + 1;
    } else {
      targetCards[i].sortOrder = i + 2; // leave gap for drag card
    }
  }
  dragCard.sortOrder = insertAt + 1;

  // Renumber source column if different
  if (sourceColumn !== targetColumn) {
    const sourceCards = result
      .filter(p => p.column === sourceColumn && p.index !== dragIndex)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    sourceCards.forEach((p, i) => { p.sortOrder = i + 1; });
  }

  return result;
}

// ── Insertion Point from Pointer ─────────────────────────────────────── // ¹⁰

/**
 * Find which column the pointer is over and where between cards
 * the insertion should happen. Uses DOM measurement exclusively.
 *
 * @param clientX/Y - pointer screen position
 * @param container - the kanban board DOM element
 * @param placements - current card positions
 * @param dragIndex - card being dragged (excluded from hit test)
 * @returns InsertionPoint or null if pointer is outside all columns
 */
export function findInsertionFromPointer( // ¹¹
  clientX: number,
  clientY: number,
  container: HTMLElement,
  placements: KanbanPlacement[],
  dragIndex: number,
  columnCount: number,
): InsertionPoint | null {
  // Find which column the pointer is over
  const columnEls = container.querySelectorAll('[data-kanban-column]');
  let targetColumn: number | null = null;

  for (let i = 0; i < columnEls.length; i++) {
    const el = columnEls[i] as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      targetColumn = parseInt(el.getAttribute('data-kanban-column')!, 10);
      break;
    }
  }

  if (targetColumn === null) return null;

  // Find insertion position within the column by checking card midpoints
  const columnCards = cardsInColumn(targetColumn, placements)
    .filter(p => p.index !== dragIndex);

  if (columnCards.length === 0) {
    return { column: targetColumn, insertBeforeIndex: -1, position: 1 };
  }

  // Check each card's visual midpoint (pointer is in screen space)
  for (let i = 0; i < columnCards.length; i++) {
    const cardEl = container.querySelector(
      `[data-card-index="${columnCards[i].index}"]`
    ) as HTMLElement | null;
    if (!cardEl) continue;

    const rect = cardEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (clientY < midY) {
      return {
        column: targetColumn,
        insertBeforeIndex: columnCards[i].index,
        position: columnCards[i].sortOrder,
      };
    }
  }

  const lastCard = columnCards[columnCards.length - 1];
  return { column: targetColumn, insertBeforeIndex: -1, position: lastCard.sortOrder + 1 };
}

// ── Auto-Place ───────────────────────────────────────────────────────── // ¹²

/** Distribute N cards across columns evenly. */
export function autoPlaceKanban(
  itemCount: number,
  columnCount: number,
): KanbanPlacement[] {
  const placements: KanbanPlacement[] = [];
  for (let i = 0; i < itemCount; i++) {
    const col = i % columnCount;
    const row = Math.floor(i / columnCount) + 1;
    placements.push({ index: i, column: col, sortOrder: row });
  }
  return placements;
}
