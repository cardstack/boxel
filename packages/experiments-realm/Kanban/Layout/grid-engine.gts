// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Grid Engine — Pure computation functions for CSS Grid layout management.
// No DOM, no tracked state, no side effects. The computational core of Layout.
// Includes the displacement resolution engine that evaluates all placement
// options and picks the one a human would choose.

// ── Types ────────────────────────────────────────────────────────────── // ²

export interface GridCell { // ³
  col: number; // 1-based column
  row: number; // 1-based row
}

export interface GridPlacement { // ⁴
  index: number;    // which card in the linksToMany array
  col: number;      // 1-based column start
  row: number;      // 1-based row start
  colSpan: number;  // columns to span (min 1)
  rowSpan: number;  // rows to span (min 1)
}

export interface GridConfig { // ⁵
  columns: number;
  rows: number;
  gap: number;
  padding: number;
  rowHeight?: string; // CSS value e.g. "minmax(200px, 1fr)"
}

export type SpanEdge = 'right' | 'bottom' | 'left' | 'top'; // ⁶

// ── Displacement Plan ────────────────────────────────────────────────── // ⁷

export interface PlacementMove { // ⁸
  index: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface DisplacementPlan { // ⁹
  type: string;          // strategy name for debugging
  moves: PlacementMove[];// all cards that change position/size
  score: number;         // lower = better
}

// ── Score Weights ────────────────────────────────────────────────────── // ¹⁰
const W_DISTANCE = 1;      // per Manhattan cell moved
const W_SHRINK = 2;        // per axis shrunk
const W_CASCADE = 3;       // per extra card displaced
const W_ADD_ROW = 10;      // grid expansion
const BONUS_SAME_ROW = -1; // swap on same row feels natural

// ── Core Helpers ─────────────────────────────────────────────────────── // ¹¹

export function effectiveRows(placements: GridPlacement[], config: GridConfig): number {
  let maxRow = config.rows;
  for (const p of placements) {
    const endRow = p.row + p.rowSpan - 1;
    if (endRow > maxRow) maxRow = endRow;
  }
  return maxRow;
}

function gridDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Check if a span fits at position without overlapping any placements (excluding some indices). */
function spanFitsAt( // ¹²
  col: number, row: number, colSpan: number, rowSpan: number,
  placements: GridPlacement[], config: GridConfig, excludeIndices: Set<number>,
): boolean {
  if (col < 1 || row < 1) return false;
  if (col + colSpan - 1 > config.columns) return false;
  for (const p of placements) {
    if (excludeIndices.has(p.index)) continue;
    // Check overlap
    if (col < p.col + p.colSpan && col + colSpan > p.col &&
        row < p.row + p.rowSpan && row + rowSpan > p.row) {
      return false;
    }
  }
  return true;
}

/** Find all cells covered by a placement. */
function coveredCells(p: GridPlacement): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = p.row; r < p.row + p.rowSpan; r++) {
    for (let c = p.col; c < p.col + p.colSpan; c++) {
      cells.push({ col: c, row: r });
    }
  }
  return cells;
}

/** Find placement at a cell. */
export function placementAtCell(col: number, row: number, placements: GridPlacement[]): GridPlacement | null {
  for (const p of placements) {
    if (col >= p.col && col < p.col + p.colSpan &&
        row >= p.row && row < p.row + p.rowSpan) {
      return p;
    }
  }
  return null;
}

/** Find ALL placements that would be overlapped if a span were placed. */
function findOverlapping( // ¹³
  col: number, row: number, colSpan: number, rowSpan: number,
  placements: GridPlacement[], excludeIndex: number,
): GridPlacement[] {
  const hit = new Map<number, GridPlacement>();
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      const p = placementAtCell(c, r, placements);
      if (p && p.index !== excludeIndex && !hit.has(p.index)) {
        hit.set(p.index, p);
      }
    }
  }
  return Array.from(hit.values());
}

/** Find nearest cell where a span fits. Scans in reading order from origin,
 *  never skipping over a closer empty slot. Prefers same-row, then nearby rows. */ // ¹⁴
function findNearestFit(
  origin: GridCell, colSpan: number, rowSpan: number,
  placements: GridPlacement[], config: GridConfig, excludeIndices: Set<number>,
): GridCell | null {
  const maxRow = effectiveRows(placements, config) + 1; // allow one extra row
  let best: GridCell | null = null;
  let bestDist = Infinity;

  // Scan all positions in reading order, prioritize by distance to origin
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= config.columns; c++) {
      if (spanFitsAt(c, r, colSpan, rowSpan, placements, config, excludeIndices)) {
        const d = gridDistance(origin, { col: c, row: r });
        // Prefer same row (tie-break bonus)
        const adjustedDist = r === origin.row ? d - 0.5 : d;
        if (adjustedDist < bestDist) {
          bestDist = adjustedDist;
          best = { col: c, row: r };
        }
      }
    }
  }
  return best;
}

// ── Displacement Resolution Engine ───────────────────────────────────── // ¹⁵

/**
 * The displacement engine. Given a drag card and target cell, evaluates
 * ALL viable strategies and returns the best plan (lowest score).
 * Always succeeds — worst case adds a row.
 */
export function resolveDisplacement( // ¹⁶
  dragIndex: number,
  targetCell: GridCell,
  placements: GridPlacement[],
  config: GridConfig,
): DisplacementPlan {
  const dragCard = placements.find(p => p.index === dragIndex);
  if (!dragCard) return { type: 'noop', moves: [], score: 999 };

  const sourceCell: GridCell = { col: dragCard.col, row: dragCard.row };

  // What would the drag card look like at the target?
  const dragAtTarget = {
    ...dragCard,
    col: targetCell.col,
    row: targetCell.row,
  };

  // Clamp drag span to grid bounds at target
  dragAtTarget.colSpan = Math.min(dragCard.colSpan, config.columns - targetCell.col + 1);

  // Same cell? No-op
  if (sourceCell.col === targetCell.col && sourceCell.row === targetCell.row) {
    return { type: 'noop', moves: [], score: 999 };
  }

  // Find all cards displaced by placing dragCard at targetCell
  const displaced = findOverlapping(
    dragAtTarget.col, dragAtTarget.row, dragAtTarget.colSpan, dragAtTarget.rowSpan,
    placements, dragIndex,
  );

  const candidates: DisplacementPlan[] = [];
  const exclude = new Set([dragIndex, ...displaced.map(d => d.index)]);

  // ── Strategy 1: Move to empty (no displacement) ────────────────
  if (displaced.length === 0) {
    if (spanFitsAt(dragAtTarget.col, dragAtTarget.row, dragAtTarget.colSpan, dragAtTarget.rowSpan,
        placements, config, new Set([dragIndex]))) {
      candidates.push({
        type: 'move-to-empty',
        moves: [{ index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
                   colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan }],
        score: gridDistance(sourceCell, targetCell) * W_DISTANCE,
      });
    }
  }

  // For each displaced card, generate strategies:
  if (displaced.length === 1) {
    const target = displaced[0];

    // ── Strategy 2: Same-size swap ────────────────────────────────
    if (dragCard.colSpan === target.colSpan && dragCard.rowSpan === target.rowSpan) {
      const sameRow = dragCard.row === target.row;
      candidates.push({
        type: 'same-size-swap',
        moves: [
          { index: dragIndex, col: target.col, row: target.row,
            colSpan: dragCard.colSpan, rowSpan: dragCard.rowSpan },
          { index: target.index, col: sourceCell.col, row: sourceCell.row,
            colSpan: target.colSpan, rowSpan: target.rowSpan },
        ],
        score: gridDistance(sourceCell, { col: target.col, row: target.row }) * W_DISTANCE
             + (sameRow ? BONUS_SAME_ROW : 0),
      });
    }

    // ── Strategy 3: Cross-size swap to source ────────────────────
    if (dragCard.colSpan !== target.colSpan || dragCard.rowSpan !== target.rowSpan) {
      // Can target fit at source position?
      if (spanFitsAt(sourceCell.col, sourceCell.row, target.colSpan, target.rowSpan,
          placements, config, exclude)) {
        candidates.push({
          type: 'cross-swap-to-source',
          moves: [
            { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
              colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
            { index: target.index, col: sourceCell.col, row: sourceCell.row,
              colSpan: target.colSpan, rowSpan: target.rowSpan },
          ],
          score: gridDistance(sourceCell, targetCell) * W_DISTANCE + 1,
        });
      }
    }

    // ── Strategy 4: Shrink target to fit at source ───────────────
    if (target.colSpan > 1 || target.rowSpan > 1) {
      // Try shrinking target to fit at source position
      for (let cs = target.colSpan; cs >= 1; cs--) {
        for (let rs = target.rowSpan; rs >= 1; rs--) {
          if (cs === target.colSpan && rs === target.rowSpan) continue; // skip original size
          if (spanFitsAt(sourceCell.col, sourceCell.row, cs, rs,
              placements, config, exclude)) {
            const shrinkCost = (target.colSpan - cs) + (target.rowSpan - rs);
            candidates.push({
              type: 'shrink-target-to-source',
              moves: [
                { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
                  colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
                { index: target.index, col: sourceCell.col, row: sourceCell.row,
                  colSpan: cs, rowSpan: rs },
              ],
              score: gridDistance(sourceCell, targetCell) * W_DISTANCE
                   + shrinkCost * W_SHRINK + 2,
            });
            break; // take first (largest) shrink that fits
          }
        }
        if (candidates.some(c => c.type === 'shrink-target-to-source')) break;
      }
    }

    // ── Strategy 5: Shrink drag to fit + swap ────────────────────
    if (dragCard.colSpan > 1 || dragCard.rowSpan > 1) {
      // Shrink drag to 1×1 at target, move target to source
      if (spanFitsAt(targetCell.col, targetCell.row, 1, 1,
          placements, config, exclude) &&
          spanFitsAt(sourceCell.col, sourceCell.row, target.colSpan, target.rowSpan,
          placements, config, exclude)) {
        const shrinkCost = (dragCard.colSpan - 1) + (dragCard.rowSpan - 1);
        candidates.push({
          type: 'shrink-drag-swap',
          moves: [
            { index: dragIndex, col: targetCell.col, row: targetCell.row,
              colSpan: 1, rowSpan: 1 },
            { index: target.index, col: sourceCell.col, row: sourceCell.row,
              colSpan: target.colSpan, rowSpan: target.rowSpan },
          ],
          score: gridDistance(sourceCell, targetCell) * W_DISTANCE
               + shrinkCost * W_SHRINK + 3,
        });
      }
    }

    // ── Strategy 7: Target to nearest empty ──────────────────────
    const nearest = findNearestFit(
      { col: target.col, row: target.row },
      target.colSpan, target.rowSpan,
      placements, config, exclude,
    );
    if (nearest) {
      candidates.push({
        type: 'displace-to-nearest',
        moves: [
          { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
            colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
          { index: target.index, col: nearest.col, row: nearest.row,
            colSpan: target.colSpan, rowSpan: target.rowSpan },
        ],
        score: gridDistance({ col: target.col, row: target.row }, nearest) * W_DISTANCE + 4,
      });
    }

    // ── Strategy 8: Shrink target + nearest empty 1×1 ────────────
    if (!nearest && (target.colSpan > 1 || target.rowSpan > 1)) {
      const nearest1 = findNearestFit(
        { col: target.col, row: target.row }, 1, 1,
        placements, config, exclude,
      );
      if (nearest1) {
        const shrinkCost = (target.colSpan - 1) + (target.rowSpan - 1);
        candidates.push({
          type: 'shrink-displace-nearest',
          moves: [
            { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
              colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
            { index: target.index, col: nearest1.col, row: nearest1.row,
              colSpan: 1, rowSpan: 1 },
          ],
          score: gridDistance({ col: target.col, row: target.row }, nearest1) * W_DISTANCE
               + shrinkCost * W_SHRINK + 5,
        });
      }
    }
  }

  // ── Multi-displacement: drag covers 2+ cards ───────────────────
  if (displaced.length > 1) {
    const multiMoves: PlacementMove[] = [
      { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
        colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
    ];
    let totalScore = gridDistance(sourceCell, targetCell) * W_DISTANCE;
    let allPlaced = true;

    // Try to place each displaced card at nearest available position
    const tempExclude = new Set(exclude);
    for (const d of displaced) {
      const near = findNearestFit(
        { col: d.col, row: d.row }, d.colSpan, d.rowSpan,
        placements, config, tempExclude,
      );
      if (near) {
        multiMoves.push({ index: d.index, col: near.col, row: near.row,
                          colSpan: d.colSpan, rowSpan: d.rowSpan });
        totalScore += gridDistance({ col: d.col, row: d.row }, near) * W_DISTANCE + W_CASCADE;
        // Mark this position as occupied for subsequent displaced cards
        tempExclude.delete(d.index); // will be at new pos
      } else {
        allPlaced = false;
        break;
      }
    }

    if (allPlaced) {
      candidates.push({
        type: 'multi-displace',
        moves: multiMoves,
        score: totalScore,
      });
    }
  }

  // ── Strategy 10: Add row (always valid fallback) ───────────────
  {
    const newRow = effectiveRows(placements, config) + 1;
    const moves: PlacementMove[] = [
      { index: dragIndex, col: dragAtTarget.col, row: dragAtTarget.row,
        colSpan: dragAtTarget.colSpan, rowSpan: dragAtTarget.rowSpan },
    ];
    for (const d of displaced) {
      moves.push({ index: d.index, col: d.col, row: newRow,
                    colSpan: d.colSpan, rowSpan: d.rowSpan });
    }
    candidates.push({
      type: 'add-row',
      moves,
      score: W_ADD_ROW + displaced.length * W_CASCADE,
    });
  }

  // ── Pick best ──────────────────────────────────────────────────
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || { type: 'noop', moves: [], score: 999 };
}

/** Apply a displacement plan to produce new placements array. */ // ¹⁷
export function applyPlan(
  plan: DisplacementPlan,
  placements: GridPlacement[],
): GridPlacement[] {
  const result = placements.map(p => ({ ...p }));
  for (const move of plan.moves) {
    const p = result.find(r => r.index === move.index);
    if (p) {
      p.col = move.col;
      p.row = move.row;
      p.colSpan = move.colSpan;
      p.rowSpan = move.rowSpan;
    }
  }
  return result;
}

// ── Overlap Fix ──────────────────────────────────────────────────────── // ¹⁷ᵃ

/**
 * Post-drop overlap check and fix. Detects any overlapping placements
 * and resolves them by moving conflicting cards to the nearest empty cell.
 * Returns the fixed placements (unchanged if no overlaps).
 */
export function fixOverlaps(
  placements: GridPlacement[],
  config: GridConfig,
): GridPlacement[] {
  const result = placements.map(p => ({ ...p }));
  let hasOverlap = true;
  let iterations = 0;

  while (hasOverlap && iterations < 20) {
    hasOverlap = false;
    iterations++;

    // Build occupancy: first card to claim each cell wins
    const claimedBy = new Map<string, number>(); // "col-row" → index
    const conflicting = new Set<number>();

    for (const p of result) {
      for (let r = p.row; r < p.row + p.rowSpan; r++) {
        for (let c = p.col; c < p.col + p.colSpan; c++) {
          const key = `${c}-${r}`;
          if (claimedBy.has(key)) {
            // Conflict: this card overlaps with the first claimer
            conflicting.add(p.index);
            hasOverlap = true;
          } else {
            claimedBy.set(key, p.index);
          }
        }
      }
    }

    if (!hasOverlap) break;

    // Resolve each conflicting card by moving to nearest empty
    for (const idx of conflicting) {
      const p = result.find(r => r.index === idx);
      if (!p) continue;

      const exclude = new Set([idx]);
      const nearest = findNearestFit(
        { col: p.col, row: p.row },
        p.colSpan, p.rowSpan,
        result, config, exclude,
      );

      if (nearest) {
        p.col = nearest.col;
        p.row = nearest.row;
      } else {
        // Shrink to 1×1 and try again
        const nearest1 = findNearestFit(
          { col: p.col, row: p.row },
          1, 1, result, config, exclude,
        );
        if (nearest1) {
          p.col = nearest1.col;
          p.row = nearest1.row;
          p.colSpan = 1;
          p.rowSpan = 1;
        } else {
          // Last resort: new row
          p.col = 1;
          p.row = effectiveRows(result, config) + 1;
          p.colSpan = 1;
          p.rowSpan = 1;
        }
      }
    }
  }

  return result;
}

// ── Remaining Engine Functions ────────────────────────────────────────── // ¹⁸

export function autoPlace(itemCount: number, config: GridConfig): GridPlacement[] {
  const placements: GridPlacement[] = [];
  for (let i = 0; i < itemCount; i++) {
    const col = (i % config.columns) + 1;
    const row = Math.floor(i / config.columns) + 1;
    placements.push({ index: i, col, row, colSpan: 1, rowSpan: 1 });
  }
  return placements;
}

export function resolveSpanResize(
  index: number, edge: SpanEdge, targetCell: GridCell,
  placements: GridPlacement[], config: GridConfig,
): GridPlacement[] {
  const result = placements.map(p => ({ ...p }));
  const placement = result.find(p => p.index === index);
  if (!placement) return result;
  if (edge === 'right') {
    const newSpan = Math.max(1, targetCell.col - placement.col + 1);
    const maxSpan = config.columns - placement.col + 1;
    placement.colSpan = Math.min(newSpan, maxSpan);
  } else {
    placement.rowSpan = Math.max(1, targetCell.row - placement.row + 1);
  }
  return result;
}

export function removePlacement(index: number, placements: GridPlacement[]): GridPlacement[] {
  return placements.filter(p => p.index !== index);
}

export function findFirstEmpty(config: GridConfig, placements: GridPlacement[]): GridCell {
  const maxRow = effectiveRows(placements, config);
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= config.columns; c++) {
      if (!placementAtCell(c, r, placements)) {
        return { col: c, row: r };
      }
    }
  }
  return { col: 1, row: maxRow + 1 };
}

export function cellFromPointer(
  clientX: number, clientY: number,
  containerRect: { left: number; top: number; width: number; height: number },
  config: GridConfig,
  scrollTop = 0,
  scrollLeft = 0,
): GridCell {
  // Account for scroll: convert viewport coords to content coords
  const relX = clientX - containerRect.left + scrollLeft - config.padding;
  const relY = clientY - containerRect.top + scrollTop - config.padding;
  const usableWidth = containerRect.width - config.padding * 2;
  const cellWidth = (usableWidth - (config.columns - 1) * config.gap) / config.columns;
  const cellStepX = cellWidth + config.gap;
  // Use fixed row height matching grid-auto-rows: minmax(200px, 1fr)
  // At minimum, each row is 200px. With gap, step = 200 + gap.
  const cellStepY = 200 + config.gap;
  const col = Math.max(1, Math.min(Math.floor(relX / cellStepX) + 1, config.columns));
  const row = Math.max(1, Math.floor(relY / cellStepY) + 1);
  return { col, row };
}

export function compactPlacements(placements: GridPlacement[], config: GridConfig): GridPlacement[] {
  if (placements.length === 0) return [];
  const result = placements.map(p => ({ ...p }));
  const maxRow = effectiveRows(result, config);
  const occupiedRows = new Set<number>();
  for (const p of result) {
    for (let r = p.row; r < p.row + p.rowSpan; r++) {
      occupiedRows.add(r);
    }
  }
  const rowMap = new Map<number, number>();
  let nextRow = 1;
  for (let r = 1; r <= maxRow; r++) {
    if (occupiedRows.has(r)) { rowMap.set(r, nextRow); nextRow++; }
  }
  for (const p of result) {
    const newRow = rowMap.get(p.row);
    if (newRow !== undefined) p.row = newRow;
  }
  return result;
}
