// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ GridPlane — CSS Grid viewport. Single grid with well+card per cell.
// Wells are static backgrounds. Cards float on top with swap transforms.
// Ghost is a full-size card popped out of its well.

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking'; // ³
import { on } from '@ember/modifier'; // ⁴
import { eq } from '@cardstack/boxel-ui/helpers'; // ⁵
import { fn } from '@ember/helper'; // ⁶
import Modifier from 'ember-modifier'; // ⁷
import { GridManager, type ProspectiveSwap } from './grid-interaction'; // ⁸
import {
  type GridPlacement,
  type GridConfig,
  effectiveRows,
} from './grid-engine'; // ⁹

// ── CaptureElement modifier ──────────────────────────────────────────── // ¹⁰
class CaptureElement extends Modifier {
  modify(el: HTMLElement, [callback]: [(el: HTMLElement) => void]) {
    callback(el);
  }
}

// ── GridPlane Component ──────────────────────────────────────────────── // ¹¹

export class GridPlane extends Component<{
  Args: {
    config: GridConfig;
    placements: GridPlacement[];
    manager: GridManager;
    showGridLines: boolean;
    interactive: boolean;
  };
  Blocks: {
    cell: [GridPlacement];
    empty: [];
    ghost: [number];
  };
}> {
  @tracked containerElement: HTMLElement | null = null; // ¹²

  captureRef = (el: HTMLElement): void => {
    this.containerElement = el;
    this.args.manager.registerContainer(el);
  };

  // ── Grid Style ─────────────────────────────────────────────────────

  get gridStyle(): string {
    // ¹³
    const c = this.args.config;
    const cols = c.columns || 4;
    const gap = c.gap ?? 16;
    const pad = c.padding ?? 24;
    return [
      `grid-template-columns: repeat(${cols}, 1fr)`,
      `grid-auto-rows: ${c.rowHeight || 'minmax(200px, 1fr)'}`,
      `gap: ${gap}px`,
      `padding: ${pad}px`,
    ].join('; ');
  }

  // ── Cell Styles ────────────────────────────────────────────────────

  cellStyle = (placement: GridPlacement): string => {
    // ¹⁴
    let col = placement.col || 1;
    let row = placement.row || 1;
    let colSpan = placement.colSpan || 1;
    let rowSpan = placement.rowSpan || 1;

    // Only apply preview span during SETTLE (not active drag)
    // During active drag, the card-float uses pixel width/height (absolute positioned)
    // and the grid cell stays at original span to prevent layout reflow fighting
    const m = this.args.manager;
    if (
      m.isSettling &&
      m.isResizing &&
      m.liveSpanPreview?.index === placement.index
    ) {
      if (m.liveSpanPreview.colSpan > colSpan && m.spanEdge === 'left') {
        col = Math.max(1, col - (m.liveSpanPreview.colSpan - colSpan));
      }
      if (m.liveSpanPreview.rowSpan > rowSpan && m.spanEdge === 'top') {
        row = Math.max(1, row - (m.liveSpanPreview.rowSpan - rowSpan));
      }
      colSpan = m.liveSpanPreview.colSpan;
      rowSpan = m.liveSpanPreview.rowSpan;
    }

    return `grid-column: ${col} / span ${colSpan}; grid-row: ${row} / span ${rowSpan}`;
  };

  /** Pixel resize style for card-float. Position handled by CSS. */ // ¹⁴ᵃ
  resizeStyle = (placement: GridPlacement): string => {
    const m = this.args.manager;
    if (!m.isResizing || m.liveSpanPreview?.index !== placement.index)
      return '';

    if (m.isSettling) {
      return `width: ${m.settleWidth}px; height: ${m.settleHeight}px`;
    }

    // Both dimensions always set for stable rendering
    const parts: string[] = [];
    if (m.resizeWidth > 0) parts.push(`width: ${m.resizeWidth}px`);
    if (m.resizeHeight > 0) parts.push(`height: ${m.resizeHeight}px`);
    // For top/left resize, shift the card-float origin
    if (m.resizeOriginShift !== 0) {
      const edge =
        m.liveSpanPreview?.colSpan !== (placement.colSpan || 1)
          ? 'left'
          : 'top';
      if (edge === 'left') {
        parts.push(`left: ${m.resizeOriginShift}px`);
      } else {
        parts.push(`top: ${m.resizeOriginShift}px`);
      }
    }
    return parts.join('; ');
  };

  isResizingCard = (placement: GridPlacement): boolean => {
    return (
      this.args.manager.isResizing &&
      this.args.manager.liveSpanPreview?.index === placement.index
    );
  };

  isSettlingResize = (placement: GridPlacement): boolean => {
    return this.isResizingCard(placement) && this.args.manager.isSettling;
  };

  /** Which resize handles to show based on position and available space. */ // ¹⁴ᵇ
  // All four handles always visible on selected card
  showHandleRight = (): boolean => true;
  showHandleLeft = (): boolean => true;
  showHandleBottom = (): boolean => true;
  showHandleTop = (): boolean => true;

  /** Swap transform applied to .card-float only (not the well).
   *  Measures actual DOM positions instead of calculating from grid geometry. */ // ¹⁵
  cardTransformStyle = (placement: GridPlacement): string => {
    const swap = this.args.manager.prospectiveSwap;
    if (!swap || !this.containerElement) return '';

    let otherIndex: number | null = null;
    if (placement.index === swap.sourceIndex) {
      otherIndex = swap.targetIndex;
    } else if (placement.index === swap.targetIndex) {
      otherIndex = swap.sourceIndex;
    } else {
      return '';
    }

    // Measure both cells from the DOM
    const thisEl = this.containerElement.querySelector(
      `[data-cell-index="${placement.index}"]`,
    ) as HTMLElement | null;
    const otherEl = this.containerElement.querySelector(
      `[data-cell-index="${otherIndex}"]`,
    ) as HTMLElement | null;

    if (!thisEl || !otherEl) return '';

    const thisRect = thisEl.getBoundingClientRect();
    const otherRect = otherEl.getBoundingClientRect();

    // Delta from this cell's position to the other cell's position
    const dx = otherRect.left - thisRect.left;
    const dy = otherRect.top - thisRect.top;

    return `transform: translate(${dx}px, ${dy}px)`;
  };

  // ── All grid cells for empty wells ─────────────────────────────────

  get allCells(): Array<{ col: number; row: number; key: string }> {
    // ¹⁶
    const config = this.args.config;
    const cols = config.columns || 4;
    let rows = effectiveRows(this.args.placements, config);
    // Add one blank row at the bottom when wells are visible for drop targets
    if (this.wellsRevealed) rows += 1;
    const cells: Array<{ col: number; row: number; key: string }> = [];
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        cells.push({ col: c, row: r, key: `${c}-${r}` });
      }
    }
    return cells;
  }

  /** Which cells should show as empty wells?
   *  During resize, the resizing card's cells become individual wells (snap points). */ // ¹⁶ᵃ
  get emptyCells(): Array<{ col: number; row: number; key: string }> {
    const m = this.args.manager;
    const resizingIndex = m.isResizing ? (m.liveSpanPreview?.index ?? -1) : -1;

    const occupied = new Set<string>();
    for (const p of this.args.placements) {
      // Skip the resizing card — its cells become individual wells
      if (p.index === resizingIndex) continue;
      for (let r = p.row; r < p.row + (p.rowSpan || 1); r++) {
        for (let c = p.col; c < p.col + (p.colSpan || 1); c++) {
          occupied.add(`${c}-${r}`);
        }
      }
    }
    return this.allCells.filter((cell) => !occupied.has(cell.key));
  }

  emptyCellStyle = (cell: { col: number; row: number }): string => {
    return `grid-column: ${cell.col}; grid-row: ${cell.row}`;
  };

  // ── State Getters ──────────────────────────────────────────────────

  get isDragging(): boolean {
    // ¹⁷
    const mode = this.args.manager.interactionMode;
    return mode === 'drag' || mode === 'span';
  }

  get hasCards(): boolean {
    return this.args.placements.length > 0;
  }

  get wellsRevealed(): boolean {
    return this.args.manager.wellsRevealed;
  }

  get showDragGhost(): boolean {
    return this.args.manager.activeDragIndex !== null;
  }

  get isSettling(): boolean {
    return this.args.manager.isSettling;
  }

  get dragGhostStyle(): string {
    // ¹⁸
    const m = this.args.manager;
    if (m.isSettling) {
      return `left: ${m.settleX}px; top: ${m.settleY}px; width: ${m.settleWidth}px; height: ${m.settleHeight}px`;
    }
    const x = m.pointerClientX - m.dragOffsetX;
    const y = m.pointerClientY - m.dragOffsetY;
    return `left: ${x}px; top: ${y}px; width: ${m.dragGhostWidth}px; height: ${m.dragGhostHeight}px`;
  }

  get dragGhostIndex(): number {
    return this.args.manager.activeDragIndex ?? -1;
  }

  isSource = (placement: GridPlacement): boolean => {
    return placement.index === this.args.manager.activeDragIndex;
  };

  /** Which well is the drop target? */ // ¹⁹
  get targetWellKey(): string {
    const m = this.args.manager;
    if (m.interactionMode !== 'drag') return '';
    if (m.prospectiveSwap) {
      const tgt = this.args.placements.find(
        (p) => p.index === m.prospectiveSwap!.targetIndex,
      );
      if (tgt) return `${tgt.col}-${tgt.row}`;
    }
    if (m.dropTarget) {
      return `${m.dropTarget.col}-${m.dropTarget.row}`;
    }
    return '';
  }

  isTargetWell = (cell: { col: number; row: number; key: string }): boolean => {
    return cell.key === this.targetWellKey;
  };

  /** Is this occupied cell the drop target? */ // ¹⁹ᵃ
  isDropTargetPlacement = (placement: GridPlacement): boolean => {
    return `${placement.col}-${placement.row}` === this.targetWellKey;
  };

  // ── Template ───────────────────────────────────────────────────────

  <template>
    {{! ²⁰ GridPlane template }}
    <div
      class='layout-grid
        {{if this.isDragging "is-dragging"}}
        {{if this.wellsRevealed "wells-revealed"}}'
      style={{this.gridStyle}}
      {{CaptureElement this.captureRef}}
      {{on 'pointerdown' this.args.manager.onPointerDown}}
      {{on 'pointermove' this.args.manager.onPointerMove}}
      {{on 'pointerup' this.args.manager.onPointerUp}}
      {{on 'keydown' this.args.manager.onKeyDown}}
      tabindex='0'
    >
      {{#if this.hasCards}}
        {{! ²¹ Occupied cells: well (static) + card (can transform) }}
        {{#each this.args.placements as |placement|}}
          <div
            class='grid-cell
              {{if
                (eq placement.index this.args.manager.selectedIndex)
                "is-selected"
              }}
              {{if (this.isSource placement) "is-drag-source"}}
              {{if (this.isDropTargetPlacement placement) "is-drop-target"}}'
            style={{this.cellStyle placement}}
            data-cell-index={{placement.index}}
            data-well-key='{{placement.col}}-{{placement.row}}'
          >
            {{! Well: static background, never transforms }}
            <div class='cell-well'></div>

            {{! Card: floats on top, gets swap transforms + pixel resize }}
            <div
              class='card-float
                {{if (this.isResizingCard placement) "is-resizing"}}
                {{if (this.isSettlingResize placement) "is-settling"}}'
              style='{{this.cardTransformStyle placement}} {{this.resizeStyle
                placement
              }}'
            >
              {{yield placement to='cell'}}
            </div>

            {{! Span resize handles — all four sides }}
            {{#if (eq placement.index this.args.manager.selectedIndex)}}
              <div class='span-handle span-handle-right'></div>
              <div class='span-handle span-handle-left'></div>
              <div class='span-handle span-handle-bottom'></div>
              <div class='span-handle span-handle-top'></div>
            {{/if}}
          </div>
        {{/each}}

        {{! ²² Empty cells: well only (for drop targets) }}
        {{#each this.emptyCells as |cell|}}
          <div
            class='grid-cell is-empty-cell
              {{if (this.isTargetWell cell) "is-drop-target"}}'
            style={{this.emptyCellStyle cell}}
            data-well-key={{cell.key}}
          >
            <div class='cell-well'></div>
          </div>
        {{/each}}
      {{else}}
        <div class='empty-state'>
          {{yield to='empty'}}
        </div>
      {{/if}}
    </div>

    {{! ²³ Drag ghost }}
    {{#if this.showDragGhost}}
      <div
        class='drag-ghost {{if this.isSettling "is-settling"}}'
        style={{this.dragGhostStyle}}
      >
        {{yield this.dragGhostIndex to='ghost'}}
      </div>
    {{/if}}

    <style scoped>
      {{! ²⁴ Styles }}/* ── Grid ───────────────────────────────────────────────────── */
            .layout-grid {
              display: grid;
              height: 100%;
              overflow-y: auto;
              position: relative;
              outline: none;
              border-radius: var(--boxel-border-radius, 8px);
              background: transparent;
              transition: background 200ms ease-out;
            }

            .layout-grid:focus-visible {
              box-shadow: 0 0 0 2px var(--ring, #3b82f6);
            }

            .layout-grid.is-dragging {
              user-select: none;
              -webkit-user-select: none;
              cursor: grabbing;
            }

            .layout-grid.wells-revealed {
              background-color: rgba(0, 0, 0, 0.04);
            }

            /* ── Grid Cell — contains well + card stacked ───────────────── */
            .grid-cell {
              position: relative;
              display: grid; /* stack well and card */
              align-items: stretch;
              justify-items: stretch;
              border-radius: var(--boxel-border-radius-sm, 8px);
              cursor: grab;
            }

            .grid-cell:hover { z-index: 1; }
            .grid-cell.is-selected { z-index: 2; }
            .grid-cell.is-empty-cell { cursor: default; pointer-events: none; }

            /* ── Well — static background, perfectly aligned ────────────── */
            .cell-well {
              grid-area: 1 / 1; /* stack in same cell */
              align-self: stretch;
              justify-self: stretch;
              border-radius: 10px;
              background: transparent;
              transition:
                background 180ms ease-out,
                box-shadow 180ms ease-out;
            }

            .layout-grid.wells-revealed .cell-well {
              background: rgba(0, 0, 0, 0.06);
              box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
            }

            /* Drop target well — green highlight (occupied or empty) */
            .layout-grid.wells-revealed .grid-cell.is-drop-target .cell-well {
              background: rgba(16, 185, 129, 0.12);
              box-shadow:
                inset 0 1px 3px rgba(0, 0, 0, 0.08),
                0 0 0 2px rgba(16, 185, 129, 0.6);
            }

            /* Also highlight the occupied cell's well when it's a drop target */
            .layout-grid.wells-revealed .grid-cell.is-selected .cell-well {
              box-shadow:
                inset 0 1px 3px rgba(0, 0, 0, 0.08),
                0 0 0 2px var(--primary, #3b82f6);
            }

            /* ── Card Float — sits on top of well, can transform ────────── */
            .card-float {
              grid-area: 1 / 1; /* stack on top of well */
              z-index: 1;
              /* Center within cell — inset shrinks evenly from all sides */
              align-self: center;
              justify-self: center;
              width: 100%;
              height: 100%;
              border-radius: var(--boxel-border-radius-sm, 8px);
              overflow: hidden;
              transition:
                width 180ms ease-out,
                height 180ms ease-out,
                border-radius 180ms ease-out;
            }

            /* During drag: card insets to reveal well behind it */
            .layout-grid.wells-revealed .card-float {
              width: calc(100% - 12px);
              height: calc(100% - 12px);
              border-radius: 6px;
              pointer-events: none;
            }

            /* During resize: card fills the well fully (no inset needed) */
            .layout-grid.wells-revealed .card-float.is-resizing {
              width: auto;
              height: auto;
            }

            /* Source card: invisible (popped out as ghost) */
            .grid-cell.is-drag-source .card-float {
              opacity: 0;
            }

            /* Grid cell containing resizing card — float above everything */
            .grid-cell:has(.card-float.is-resizing) {
              z-index: 10;
            }

            /* Card being resized — absolute so it doesn't stretch the well */
            .card-float.is-resizing {
              position: absolute;
              top: 0;
              left: 0;
              z-index: 5;
              overflow: hidden;
              transition: none;
              box-shadow:
                0 8px 24px rgba(0, 0, 0, 0.14),
                0 0 0 2px var(--primary, #3b82f6);
            }

            /* Settling from resize — smooth snap to well */
            .card-float.is-resizing.is-settling {
              transition:
                width 180ms cubic-bezier(0.4, 0, 0.2, 1),
                height 180ms cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 180ms ease-out;
              box-shadow:
                0 1px 3px rgba(0, 0, 0, 0.06),
                0 0 0 1px rgba(0, 0, 0, 0.04);
            }

            /* Selection ring on card (not well) */
            .grid-cell.is-selected .card-float {
              box-shadow: 0 0 0 2px var(--primary, #3b82f6);
            }

            /* ── Empty wells: invisible at rest, appear during drag ─────── */
            .is-empty-cell .cell-well {
              opacity: 0;
              transition: opacity 180ms ease-out;
            }

            .layout-grid.wells-revealed .is-empty-cell .cell-well {
              opacity: 1;
            }

            /* ── Drag Ghost ─────────────────────────────────────────────── */
            .drag-ghost {
              position: fixed;
              z-index: 9;
              pointer-events: none;
              border-radius: var(--boxel-border-radius-sm, 8px);
              overflow: hidden;
              background: var(--card, #fff);
              box-shadow:
                0 12px 40px rgba(0, 0, 0, 0.25),
                0 4px 12px rgba(0, 0, 0, 0.12);
              opacity: 0.95;
              transform: scale(1.02);
              transform-origin: center center;
            }

            .drag-ghost.is-settling {
              transition:
                left 200ms cubic-bezier(0.4, 0, 0.2, 1),
                top 200ms cubic-bezier(0.4, 0, 0.2, 1),
                width 200ms cubic-bezier(0.4, 0, 0.2, 1),
                height 200ms cubic-bezier(0.4, 0, 0.2, 1),
                transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 200ms ease-out;
              transform: scale(1);
              box-shadow:
                0 2px 6px rgba(0, 0, 0, 0.10),
                0 1px 2px rgba(0, 0, 0, 0.05);
            }

            /* ── Span Resize Handles ────────────────────────────────────── */
            /* Visual: small dot centered on edge. Hit target: generous transparent zone. */
            .span-handle {
              position: absolute;
              z-index: 4;
              opacity: 0;
              transition: opacity 150ms ease;
            }

            .span-handle::after {
              content: '';
              position: absolute;
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--primary, #3b82f6);
              box-shadow: 0 0 0 2px #fff;
              transition: transform 100ms ease;
            }

            .grid-cell.is-selected:hover .span-handle,
            .grid-cell.is-selected:focus-within .span-handle {
              opacity: 1;
            }

            .span-handle:hover::after {
              transform: scale(1.4);
            }

            .layout-grid.wells-revealed .span-handle { opacity: 0 !important; }

            .span-handle-right {
              right: -10px; top: 0; width: 20px; height: 100%;
              cursor: ew-resize;
            }
            .span-handle-right::after { top: 50%; left: 50%; margin: -3px 0 0 -3px; }

            .span-handle-left {
              left: -10px; top: 0; width: 20px; height: 100%;
              cursor: ew-resize;
            }
            .span-handle-left::after { top: 50%; left: 50%; margin: -3px 0 0 -3px; }

            .span-handle-bottom {
              bottom: -10px; left: 0; height: 20px; width: 100%;
              cursor: ns-resize;
            }
            .span-handle-bottom::after { top: 50%; left: 50%; margin: -3px 0 0 -3px; }

            .span-handle-top {
              top: -10px; left: 0; height: 20px; width: 100%;
              cursor: ns-resize;
            }
            .span-handle-top::after { top: 50%; left: 50%; margin: -3px 0 0 -3px; }

            /* ── Empty State ────────────────────────────────────────────── */
            .empty-state {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: var(--boxel-sp-xs, 8px);
              padding: var(--boxel-sp-xl, 32px);
              color: var(--muted-foreground, #94a3b8);
              text-align: center;
              font-size: var(--boxel-font-size-sm, 0.875rem);
              border: 2px dashed var(--border, #e2e8f0);
              border-radius: var(--boxel-border-radius, 8px);
              grid-column: 1 / -1;
            }
    </style>
  </template>
}
