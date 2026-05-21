// Pure kanban placement logic — no framework dependencies.

// ── Types ────────────────────────────────────────────────────────────── //

export interface KanbanPlacement {
  columnId: string; // column id
  index: number; // card index in linksToMany
  sortOrder: number; // position within column (1, 2, 3...)
}

export interface InsertionPoint {
  columnId: string; // target column id
  insertBeforeIndex: number; // card index to insert before (-1 = end)
  position: number; // sort position for shift calculations
}

export interface DragRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface KanbanColumnConfig {
  collapsed: boolean | null;
  color: string | null;
  key: string;
  label: string | null;
  wipLimit: number | null;
}

// ── Column Queries ───────────────────────────────────────────────────── //

/** Get cards in a column, sorted by sortOrder. */
export function cardsInColumn(
  columnId: string,
  placements: KanbanPlacement[],
): KanbanPlacement[] {
  return placements
    .filter((p) => p.columnId === columnId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Count cards in a column. */
export function columnCount(
  columnId: string,
  placements: KanbanPlacement[],
): number {
  return placements.filter((p) => p.columnId === columnId).length;
}

// ── Insertion Resolution ─────────────────────────────────────────────── //

/**
 * Resolve an insertion: move card to a new column+position.
 * Renumbers sort orders in both source and target columns.
 * Returns new placements array (immutable).
 */
export function resolveInsertion(
  dragIndex: number,
  insertion: InsertionPoint,
  placements: KanbanPlacement[],
): KanbanPlacement[] {
  const result = placements.map((p) => ({ ...p }));
  const dragCard = result.find((p) => p.index === dragIndex);
  if (!dragCard) {
    return result;
  }

  const sourceColumn = dragCard.columnId;
  const targetColumn = insertion.columnId;

  dragCard.columnId = targetColumn;

  const targetCards = result
    .filter((p) => p.columnId === targetColumn && p.index !== dragIndex)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let insertAt = targetCards.length;
  if (insertion.insertBeforeIndex !== -1) {
    const idx = targetCards.findIndex(
      (p) => p.index === insertion.insertBeforeIndex,
    );
    if (idx !== -1) {
      insertAt = idx;
    }
  }

  for (let i = 0; i < targetCards.length; i++) {
    const card = targetCards[i]!;
    if (i < insertAt) {
      card.sortOrder = i + 1;
    } else {
      card.sortOrder = i + 2;
    }
  }
  dragCard.sortOrder = insertAt + 1;

  if (sourceColumn !== targetColumn) {
    const sourceCards = result
      .filter((p) => p.columnId === sourceColumn && p.index !== dragIndex)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    sourceCards.forEach((p, i) => {
      p.sortOrder = i + 1;
    });
  }

  return result;
}

// ── Insertion Point from Pointer ─────────────────────────────────────── //

function resolveInsertionInColumn(
  targetColumnId: string,
  clientY: number,
  container: HTMLElement,
  placements: KanbanPlacement[],
  dragIndex: number,
): InsertionPoint | null {
  const columnCards = cardsInColumn(targetColumnId, placements).filter(
    (p) => p.index !== dragIndex,
  );

  if (columnCards.length === 0) {
    return { columnId: targetColumnId, insertBeforeIndex: -1, position: 1 };
  }

  for (let i = 0; i < columnCards.length; i++) {
    const entry = columnCards[i]!;
    const cardEl = container.querySelector(
      `[data-card-index="${entry.index}"]`,
    ) as HTMLElement | null;
    if (!cardEl) {
      continue;
    }

    const rect = cardEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (clientY < midY) {
      return {
        columnId: targetColumnId,
        insertBeforeIndex: entry.index,
        position: entry.sortOrder,
      };
    }
  }

  const lastCard = columnCards[columnCards.length - 1];
  return {
    columnId: targetColumnId,
    insertBeforeIndex: -1,
    position: (lastCard?.sortOrder ?? 0) + 1,
  };
}

/**
 * Find which column the pointer is over and where between cards
 * the insertion should happen. Uses DOM measurement exclusively.
 */
export function findInsertionFromPointer(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  placements: KanbanPlacement[],
  dragIndex: number,
): InsertionPoint | null {
  const columnEls = container.querySelectorAll('[data-kanban-column]');
  let targetColumnId: string | null = null;

  for (let i = 0; i < columnEls.length; i++) {
    const el = columnEls[i] as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      targetColumnId = el.getAttribute('data-kanban-column')!;
      break;
    }
  }

  if (targetColumnId === null) {
    return null;
  }

  return resolveInsertionInColumn(
    targetColumnId,
    clientY,
    container,
    placements,
    dragIndex,
  );
}

export function findInsertionFromDragRect(
  dragRect: DragRect,
  container: HTMLElement,
  placements: KanbanPlacement[],
  dragIndex: number,
): InsertionPoint | null {
  const columnEls = container.querySelectorAll('[data-kanban-column]');
  let targetColumnId: string | null = null;
  let bestOverlap = 0;

  for (let i = 0; i < columnEls.length; i++) {
    const el = columnEls[i] as HTMLElement;
    const rect = el.getBoundingClientRect();
    const overlap =
      Math.min(dragRect.right, rect.right) - Math.max(dragRect.left, rect.left);

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      targetColumnId = el.getAttribute('data-kanban-column')!;
    }
  }

  if (targetColumnId === null || bestOverlap <= 0) {
    return null;
  }

  const centerY = (dragRect.top + dragRect.bottom) / 2;
  return resolveInsertionInColumn(
    targetColumnId,
    centerY,
    container,
    placements,
    dragIndex,
  );
}

// ── Auto-Place ───────────────────────────────────────────────────────── //

/** Distribute N cards across columns evenly. */
export function autoPlaceKanban(
  itemCount: number,
  columns: KanbanColumnConfig[],
): KanbanPlacement[] {
  let columnCount = columns?.length;
  if (columnCount <= 0) {
    return [];
  }
  const placements: KanbanPlacement[] = [];
  for (let i = 0; i < itemCount; i++) {
    const colIndex = i % columnCount;
    const colId = columns[colIndex]?.key;
    if (!colId) {
      console.error(`Kanban column at index ${colIndex} is missing key.`);
      continue;
    }
    const row = Math.floor(i / columnCount) + 1;
    placements.push({ index: i, columnId: colId, sortOrder: row });
  }
  return placements;
}
