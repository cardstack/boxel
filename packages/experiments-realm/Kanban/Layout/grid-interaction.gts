// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ GridManager — Pointer/keyboard interaction handler for Layout grids.
// Full UX: wells reveal on hold, ghost spawns immediately, live prospective
// swap via CSS transforms (no model mutation until release), escape cancels.

import { tracked } from '@glimmer/tracking'; // ²
import {
  type GridCell,
  type GridPlacement,
  type GridConfig,
  type SpanEdge,
  type DisplacementPlan,
  cellFromPointer,
  placementAtCell,
  resolveDisplacement,
  applyPlan,
  fixOverlaps,
  resolveSpanResize,
  removePlacement,
} from './grid-engine'; // ³

// ── Constants ────────────────────────────────────────────────────────── // ⁴
const SWAP_DEBOUNCE_MS = 80;
const SPAN_HANDLE_ZONE_PX = 10;
const DRAG_THRESHOLD_PX = 4;   // ⁴ᵃ movement to start drag
const HOLD_DELAY_MS = 180;     // ⁴ᵇ hold duration to start drag

// ── Types ────────────────────────────────────────────────────────────── // ⁵

export type InteractionMode = 'idle' | 'pending' | 'drag' | 'span'; // ⁶

export interface ProspectiveSwap { // ⁶ᵃ
  sourceIndex: number;  // the card being dragged
  targetIndex: number;  // the card it would swap with
}

export interface GridManagerOptions { // ⁷
  config: () => GridConfig;
  placements: () => GridPlacement[];
  containerElement: () => HTMLElement | null;
  onChange: (placements: GridPlacement[]) => void;
  onSelect?: (index: number | null) => void;
}

// ── GridManager ──────────────────────────────────────────────────────── // ⁸

export class GridManager { // ⁹

  // ── Injected dependencies ──────────────────────────────────────────
  private configFn: () => GridConfig; // ¹⁰
  private placementsFn: () => GridPlacement[];
  private containerFn: () => HTMLElement | null;
  private onChangeFn: (placements: GridPlacement[]) => void;
  private onSelectFn: ((index: number | null) => void) | undefined;

  // ── Tracked state (drives template reactivity) ─────────────────────
  @tracked selectedIndex: number | null = null; // ¹¹
  @tracked interactionMode: InteractionMode = 'idle';
  @tracked wellsRevealed = false; // ¹¹ᵃ cards shrink to show slots
  @tracked activeDragIndex: number | null = null; // ¹¹ᵇ which card is being dragged
  @tracked pointerClientX = 0; // ¹¹ᶜ ghost position
  @tracked pointerClientY = 0;
  @tracked prospectiveSwap: ProspectiveSwap | null = null; // ¹¹ᵈ live swap preview (visual only)
  @tracked currentPlan: DisplacementPlan | null = null; // ¹¹ᵉ current best plan from engine
  @tracked dropTarget: GridCell | null = null; // ¹¹ᶠ current cell under pointer
  @tracked liveSpanPreview: { index: number; colSpan: number; rowSpan: number } | null = null; // ¹¹ᵍᵃ snapped span
  @tracked resizeWidth = 0;   // ¹¹ᵍᵇ live pixel width during resize
  @tracked resizeHeight = 0;  // ¹¹ᵍᶜ live pixel height during resize
  @tracked isResizing = false; // ¹¹ᵍᵈ true during span resize
  @tracked resizeOriginShift = 0; // ¹¹ᵍᵉ pixel shift for top/left resize (negative = grow up/left)
  @tracked dropSpan: { colSpan: number; rowSpan: number } | null = null;
  @tracked dragGhostWidth = 0; // ¹¹ᵍ source cell dimensions for full-size ghost
  @tracked dragGhostHeight = 0;
  @tracked dragOffsetX = 0; // ¹¹ʰ pointer offset within the card
  @tracked dragOffsetY = 0;
  @tracked isSettling = false; // ¹¹ⁱ ghost animating into target well
  @tracked settleX = 0; // ¹¹ʲ target well screen position
  @tracked settleY = 0;
  @tracked settleWidth = 0;
  @tracked settleHeight = 0;

  // ── Non-tracked session state ──────────────────────────────────────
  private activePointerId: number | null = null; // ¹²
  private startClientX = 0;
  private startClientY = 0;
  private dragIndex: number | null = null;
  spanEdge: SpanEdge | null = null; // public for GridPlane to check during settle
  private swapDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoveredCellKey = ''; // ¹²ᵃ debounce tracking
  private snapshotPlacements: GridPlacement[] | null = null; // ¹²ᵇ for cancel
  private holdTimer: ReturnType<typeof setTimeout> | null = null; // ¹²ᵈ hold-to-drag timer
  private savedScrollTop = 0; // ¹²ᵐ scroll position before drag/resize
  resizeStartW = 0;     // ¹²ᵉ initial card width (public for GridPlane)
  resizeStartH = 0;     // ¹²ᶠ initial card height
  private resizeCellW = 0;      // ¹²ᵍ single grid cell width
  private resizeCellH = 0;      // ¹²ʰ single grid cell height
  private resizeGap = 0;        // ¹²ⁱ grid gap
  private resizeMaxSpanX = 1;   // ¹²ʲ max colSpan from current position
  private resizeRafId: number | null = null; // ¹²ᵏ RAF for smooth tracking
  private resizePendingX = 0;   // ¹²ˡ pending pointer position
  private resizePendingY = 0;

  // ── Public container ref (set by GridPlane via modifier) ─────────
  containerRef: HTMLElement | null = null; // ¹²ᶜ

  constructor(opts: GridManagerOptions) { // ¹³
    this.configFn = opts.config;
    this.placementsFn = opts.placements;
    this.containerFn = () => this.containerRef ?? opts.containerElement();
    this.onChangeFn = opts.onChange;
    this.onSelectFn = opts.onSelect;
  }

  registerContainer = (el: HTMLElement): void => { // ¹³ᵃ
    this.containerRef = el;
  };

  // ── Public: Pointer Handlers ───────────────────────────────────────

  onPointerDown = (e: PointerEvent): void => { // ¹⁴
    if (e.button !== 0) return;
    if (this.interactionMode !== 'idle') return;

    const container = this.containerFn();
    if (!container) return;
    const config = this.configFn();
    const placements = this.placementsFn();

    // Walk up from event target to find which grid-cell was clicked
    const targetEl = e.target as HTMLElement;
    const cellEl = targetEl?.closest?.('[data-cell-index]') as HTMLElement | null;
    if (!cellEl) {
      this.selectedIndex = null;
      this.onSelectFn?.(null);
      return;
    }
    const hitIndex = parseInt(cellEl.getAttribute('data-cell-index')!, 10);
    const hit = placements.find(p => p.index === hitIndex);

    if (!hit) {
      this.selectedIndex = null;
      this.onSelectFn?.(null);
      return;
    }

    const rect = container.getBoundingClientRect();
    const spanEdge = this.detectSpanEdge(e, hit, rect, config);

    this.activePointerId = e.pointerId;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.dragIndex = hit.index;
    this.spanEdge = spanEdge;
    this.selectedIndex = hit.index;
    this.onSelectFn?.(hit.index);

    // Disable text selection for entire drag session
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';

    if (!spanEdge) {
      // ¹⁴ᵃ Pending: wait for hold or movement before showing wells/ghost
      this.interactionMode = 'pending';
      this.pointerClientX = e.clientX;
      this.pointerClientY = e.clientY;
      this.snapshotPlacements = placements.map(p => ({ ...p }));

      // Hold timer: activate drag after delay even without movement
      this.holdTimer = setTimeout(() => {
        if (this.interactionMode === 'pending') {
          this.activateDrag(container);
        }
      }, HOLD_DELAY_MS);
    } else {
      // Span resize: capture grid geometry once, then track pixels smoothly
      this.savedScrollTop = container.scrollTop; // preserve scroll position
      this.interactionMode = 'span';
      this.isResizing = true;
      this.wellsRevealed = true;
      const cellEl = container.querySelector(`[data-cell-index="${hit.index}"]`) as HTMLElement | null;
      if (cellEl) {
        const cr = cellEl.getBoundingClientRect();
        const curSpanX = hit.colSpan || 1;
        const curSpanY = hit.rowSpan || 1;
        this.resizeStartW = cr.width;
        this.resizeStartH = cr.height;
        this.resizeGap = config.gap ?? 16;
        this.resizeCellW = (cr.width - this.resizeGap * (curSpanX - 1)) / curSpanX;
        this.resizeCellH = (cr.height - this.resizeGap * (curSpanY - 1)) / curSpanY;
        this.resizeMaxSpanX = config.columns - (hit.col || 1) + 1;
        // Set both dimensions initially for stable first frame
        this.resizeWidth = cr.width;
        this.resizeHeight = cr.height;
      }
    }

    container.setPointerCapture(e.pointerId);
  };

  onPointerMove = (e: PointerEvent): void => { // ¹⁵
    if (e.pointerId !== this.activePointerId) return;
    if (this.interactionMode === 'idle') return;

    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;

    // ¹⁵ᵃ Pending → drag on movement threshold
    if (this.interactionMode === 'pending') {
      const dx = e.clientX - this.startClientX;
      const dy = e.clientY - this.startClientY;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
        const container = this.containerFn();
        if (container) this.activateDrag(container);
      }
      return;
    }

    const container = this.containerFn();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const config = this.configFn();
    const placements = this.placementsFn();

    if (this.interactionMode === 'drag' && this.dragIndex !== null) {
      // Find which well the ghost's CENTER is over via DOM hit test
      const ghostLeft = e.clientX - this.dragOffsetX;
      const ghostTop = e.clientY - this.dragOffsetY;
      const probeX = ghostLeft + this.dragGhostWidth / 2;
      const probeY = ghostTop + this.dragGhostHeight / 2;
      const els = document.elementsFromPoint(probeX, probeY);
      let cell: GridCell | null = null;
      for (const el of els) {
        const wellKey = (el as HTMLElement).getAttribute?.('data-well-key');
        if (wellKey) {
          const [c, r] = wellKey.split('-').map(Number);
          cell = { col: c, row: r };
          break;
        }
        const cellIdx = (el as HTMLElement).getAttribute?.('data-cell-index');
        if (cellIdx !== null && cellIdx !== undefined) {
          const p = placements.find(pl => pl.index === parseInt(cellIdx, 10));
          if (p) { cell = { col: p.col, row: p.row }; break; }
        }
      }
      if (!cell) {
        // Fallback to math-based calculation
        cell = cellFromPointer(ghostLeft, ghostTop, rect, config, container.scrollTop, container.scrollLeft);
      }
      const cellKey = `${cell.col},${cell.row}`;
      this.dropTarget = cell;
      const dragPlacement = placements.find(p => p.index === this.dragIndex);
      this.dropSpan = dragPlacement
        ? { colSpan: dragPlacement.colSpan, rowSpan: dragPlacement.rowSpan }
        : null;

      // ¹⁵ᵇ Run displacement engine (debounced) when cell changes
      if (cellKey !== this.lastHoveredCellKey) {
        this.lastHoveredCellKey = cellKey;
        if (this.swapDebounceTimer) clearTimeout(this.swapDebounceTimer);
        this.swapDebounceTimer = setTimeout(() => {
          this.computeDisplacement(cell, placements, config);
        }, SWAP_DEBOUNCE_MS);
      }
    } else if (this.interactionMode === 'span' && this.dragIndex !== null && this.spanEdge) {
      // ¹⁵ᵈ Smooth pixel resize via RAF — no heavy computation per move
      this.resizePendingX = e.clientX;
      this.resizePendingY = e.clientY;
      if (!this.resizeRafId) {
        this.resizeRafId = requestAnimationFrame(() => {
          this.resizeRafId = null;
          this.updateResizePixels();
        });
      }
    }
  };

  onPointerUp = (e: PointerEvent): void => { // ¹⁶
    if (e.pointerId !== this.activePointerId) return;

    const container = this.containerFn();
    if (container) container.releasePointerCapture(e.pointerId);

    if (this.interactionMode === 'span' && this.dragIndex !== null && this.spanEdge && this.liveSpanPreview) {
      // Span resize: settle the resized card into its target well, then commit

      // Measure the target well span for the resized axis only
      if (container) {
        const placement = this.placementsFn().find(p => p.index === this.dragIndex);
        if (placement) {
          // For left/top resize, the start position shifts
          let startCol = placement.col;
          let startRow = placement.row;
          if (this.liveSpanPreview.colSpan > placement.colSpan && (this.spanEdge === 'left')) {
            startCol = Math.max(1, startCol - (this.liveSpanPreview.colSpan - placement.colSpan));
          }
          if (this.liveSpanPreview.rowSpan > placement.rowSpan && (this.spanEdge === 'top')) {
            startRow = Math.max(1, startRow - (this.liveSpanPreview.rowSpan - placement.rowSpan));
          }
          const endCol = startCol + this.liveSpanPreview.colSpan - 1;
          const endRow = startRow + this.liveSpanPreview.rowSpan - 1;

          const startWell = container.querySelector(`[data-well-key="${startCol}-${startRow}"]`) as HTMLElement | null;
          const endWell = container.querySelector(`[data-well-key="${endCol}-${endRow}"]`) as HTMLElement | null;

          if (startWell) {
            const sr = startWell.getBoundingClientRect();
            const er = endWell ? endWell.getBoundingClientRect() : sr;

            this.settleX = sr.left;
            this.settleY = sr.top;
            // Only change the resized dimension, keep the other at start size
            if (this.spanEdge === 'right' || this.spanEdge === 'left') {
              this.settleWidth = er.right - sr.left;
              this.settleHeight = this.resizeStartH;
            } else {
              this.settleWidth = this.resizeStartW;
              this.settleHeight = er.bottom - sr.top;
            }
          }
        }
      }

      this.isSettling = true;

      const pendingPreview = this.liveSpanPreview;
      const pendingDragIndex = this.dragIndex;

      setTimeout(() => {
        // Commit the span change + fix overlaps
        const config = this.configFn();
        const placements = this.placementsFn();
        const result = placements.map(p => {
          if (p.index === pendingDragIndex) {
            const updated = { ...p, colSpan: pendingPreview.colSpan, rowSpan: pendingPreview.rowSpan };
            // For left/top resize, adjust the start position
            if (pendingPreview.colSpan > p.colSpan) {
              updated.col = Math.max(1, p.col - (pendingPreview.colSpan - p.colSpan));
            }
            if (pendingPreview.rowSpan > p.rowSpan) {
              updated.row = Math.max(1, p.row - (pendingPreview.rowSpan - p.rowSpan));
            }
            return updated;
          }
          return { ...p };
        });
        const fixed = fixOverlaps(result, config);
        this.onChangeFn(fixed);

        requestAnimationFrame(() => {
          this.resetSession();
        });
      }, 200); // match settle animation
      return;
    }

    if (this.interactionMode === 'pending') {
      // Tap: just select, no drag happened. Clean up without wells.
      if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
      this.interactionMode = 'idle';
      this.activePointerId = null;
      this.dragIndex = null;
      this.spanEdge = null;
      this.snapshotPlacements = null;
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
      return;
    }

    if (this.interactionMode !== 'drag' || this.dragIndex === null) {
      this.resetSession();
      return;
    }

    // ¹⁶ᵃ Find the target well by measuring the actual DOM element
    const targetCell = this.dropTarget;
    if (!targetCell && !this.prospectiveSwap) {
      this.resetSession();
      return;
    }

    if (container) {
      // Which cell index are we landing on?
      let targetIndex: number | null = null;
      if (this.prospectiveSwap) {
        targetIndex = this.prospectiveSwap.targetIndex;
      }

      // Compute settle rect from the plan's destination for the drag card.
      // Uses well elements (which never transform) for exact measurement.
      const plan = this.currentPlan;
      const dragMove = plan?.moves.find(m => m.index === this.dragIndex);
      const placements = this.placementsFn();

      let targetCol = dragMove?.col ?? targetCell?.col ?? 1;
      let targetRow = dragMove?.row ?? targetCell?.row ?? 1;
      let destColSpan = dragMove?.colSpan ?? 1;
      let destRowSpan = dragMove?.rowSpan ?? 1;

      // If no plan, try swap target's position
      if (!dragMove && targetIndex !== null) {
        const tgt = placements.find(p => p.index === targetIndex);
        if (tgt) { targetCol = tgt.col; targetRow = tgt.row; destColSpan = tgt.colSpan; destRowSpan = tgt.rowSpan; }
      }

      // Measure the destination well(s) and inset by 6px on each side
      // to match the card's inset position (100% - 12px = 6px per side)
      const INSET = 6;
      const wellKey = `${targetCol}-${targetRow}`;
      const wellEl = container.querySelector(`[data-well-key="${wellKey}"]`) as HTMLElement | null;
      if (wellEl) {
        const r = wellEl.getBoundingClientRect();
        let fullW = r.width;
        let fullH = r.height;

        if (destColSpan > 1 || destRowSpan > 1) {
          const endCol = targetCol + destColSpan - 1;
          const endRow = targetRow + destRowSpan - 1;
          const endWellKey = `${endCol}-${endRow}`;
          const endWellEl = container.querySelector(`[data-well-key="${endWellKey}"]`) as HTMLElement | null;
          if (endWellEl) {
            const r2 = endWellEl.getBoundingClientRect();
            fullW = r2.right - r.left;
            fullH = r2.bottom - r.top;
          }
        }

        // Ghost settles to the inset card position within the well
        this.settleX = r.left + INSET;
        this.settleY = r.top + INSET;
        this.settleWidth = fullW - INSET * 2;
        this.settleHeight = fullH - INSET * 2;
      }
    }

    // ¹⁶ᵇ Start settle animation — ghost flies to target well
    this.isSettling = true;

    // Capture the current plan
    const plan = this.currentPlan;

    // ¹⁶ᶜ After settle animation: apply plan underneath ghost, then remove
    setTimeout(() => {
      this.prospectiveSwap = null;

      // Apply displacement plan, then fix any remaining overlaps
      if (plan && plan.moves.length > 0) {
        const placements = this.placementsFn();
        const afterPlan = applyPlan(plan, placements);
        const config = this.configFn();
        const fixed = fixOverlaps(afterPlan, config);
        this.onChangeFn(fixed);
      }

      // Wait one frame for Glimmer to render, then remove ghost
      requestAnimationFrame(() => {
        this.resetSession();
      });
    }, 220); // match CSS transition duration
  };

  // ── Public: Keyboard Handler ───────────────────────────────────────

  onKeyDown = (e: KeyboardEvent): void => { // ¹⁷
    const config = this.configFn();
    const placements = this.placementsFn();

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.navigateSelection(e.key, config, placements);
        break;

      case 'Delete':
      case 'Backspace':
        if (this.selectedIndex !== null) {
          e.preventDefault();
          const newPlacements = removePlacement(this.selectedIndex, placements);
          this.selectedIndex = null;
          this.onSelectFn?.(null);
          this.onChangeFn(newPlacements);
        }
        break;

      case 'Escape':
        if (this.interactionMode !== 'idle') {
          e.preventDefault();
          this.cancelDrag(); // ¹⁷ᵃ revert to snapshot
        } else {
          this.selectedIndex = null;
          this.onSelectFn?.(null);
        }
        break;

      case 'Tab':
        e.preventDefault();
        this.cycleSelection(e.shiftKey ? -1 : 1, placements);
        break;
    }
  };

  // ── Public: Actions ────────────────────────────────────────────────

  select = (index: number | null): void => { // ¹⁸
    this.selectedIndex = index;
    this.onSelectFn?.(index);
  };

  remove = (index: number): void => { // ¹⁹
    const placements = this.placementsFn();
    const newPlacements = removePlacement(index, placements);
    if (this.selectedIndex === index) {
      this.selectedIndex = null;
      this.onSelectFn?.(null);
    }
    this.onChangeFn(newPlacements);
  };

  /** Transition from pending to active drag: show wells + ghost. */ // ¹⁹ᵃ
  private activateDrag(container: HTMLElement): void {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    this.savedScrollTop = container.scrollTop; // preserve scroll position
    this.interactionMode = 'drag';
    this.wellsRevealed = true;
    this.activeDragIndex = this.dragIndex;

    // Capture source cell dimensions for full-size ghost
    const cellEl = container.querySelector(`[data-cell-index="${this.dragIndex}"]`) as HTMLElement | null;
    if (cellEl) {
      const cellRect = cellEl.getBoundingClientRect();
      this.dragGhostWidth = cellRect.width;
      this.dragGhostHeight = cellRect.height;
      this.dragOffsetX = this.pointerClientX - cellRect.left;
      this.dragOffsetY = this.pointerClientY - cellRect.top;
    }
  }

  /** Smooth pixel resize with magnetic grid snap. Called via RAF. */ // ¹⁹ᵃ
  private updateResizePixels(): void {
    const dx = this.resizePendingX - this.startClientX;
    const dy = this.resizePendingY - this.startClientY;
    const SNAP = 24;
    const cw = this.resizeCellW;
    const ch = this.resizeCellH;
    const gap = this.resizeGap;
    let spanChanged = false;

    const placements = this.placementsFn();
    const placement = placements.find(p => p.index === this.dragIndex);
    const curColSpan = placement?.colSpan ?? 1;
    const curRowSpan = placement?.rowSpan ?? 1;

    // Helper: find nearest snap edge
    const snapToNearest = (raw: number, cellSize: number, gapSize: number, maxSpan: number): number => {
      let bestEdge = raw;
      let bestDist = Infinity;
      for (let s = 1; s <= maxSpan; s++) {
        const edge = cellSize * s + gapSize * (s - 1);
        const dist = Math.abs(raw - edge);
        if (dist < SNAP && dist < bestDist) {
          bestDist = dist;
          bestEdge = edge;
        }
      }
      return bestEdge;
    };

    if (this.spanEdge === 'right' && cw > 0) {
      const raw = Math.max(cw, this.resizeStartW + dx);
      const w = snapToNearest(raw, cw, gap, this.resizeMaxSpanX);
      this.resizeWidth = w;
      const snappedSpan = Math.max(1, Math.min(Math.round((w + gap) / (cw + gap)), this.resizeMaxSpanX));
      if (!this.liveSpanPreview || this.liveSpanPreview.colSpan !== snappedSpan) {
        this.liveSpanPreview = { index: this.dragIndex!, colSpan: snappedSpan, rowSpan: curRowSpan };
        spanChanged = true;
      }
    } else if (this.spanEdge === 'left' && cw > 0) {
      const maxGrow = (placement?.col ?? 1) - 1;
      const maxSpan = curColSpan + maxGrow;
      const raw = Math.max(cw, this.resizeStartW - dx);
      const w = snapToNearest(raw, cw, gap, maxSpan);
      this.resizeWidth = w;
      this.resizeOriginShift = -(w - this.resizeStartW);
      const snappedSpan = Math.max(1, Math.min(Math.round((w + gap) / (cw + gap)), maxSpan));
      if (!this.liveSpanPreview || this.liveSpanPreview.colSpan !== snappedSpan) {
        this.liveSpanPreview = { index: this.dragIndex!, colSpan: snappedSpan, rowSpan: curRowSpan };
        spanChanged = true;
      }
    } else if (this.spanEdge === 'bottom' && ch > 0) {
      const raw = Math.max(ch, this.resizeStartH + dy);
      const h = snapToNearest(raw, ch, gap, 6);
      this.resizeHeight = h;
      const snappedSpan = Math.max(1, Math.round((h + gap) / (ch + gap)));
      if (!this.liveSpanPreview || this.liveSpanPreview.rowSpan !== snappedSpan) {
        this.liveSpanPreview = { index: this.dragIndex!, colSpan: curColSpan, rowSpan: snappedSpan };
        spanChanged = true;
      }
    } else if (this.spanEdge === 'top' && ch > 0) {
      const maxGrow = (placement?.row ?? 1) - 1;
      const maxSpan = curRowSpan + maxGrow;
      const raw = Math.max(ch, this.resizeStartH - dy);
      const h = snapToNearest(raw, ch, gap, maxSpan);
      this.resizeHeight = h;
      this.resizeOriginShift = -(h - this.resizeStartH);
      const snappedSpan = Math.max(1, Math.min(Math.round((h + gap) / (ch + gap)), maxSpan));
      if (!this.liveSpanPreview || this.liveSpanPreview.rowSpan !== snappedSpan) {
        this.liveSpanPreview = { index: this.dragIndex!, colSpan: curColSpan, rowSpan: snappedSpan };
        spanChanged = true;
      }
    }

    // When snapped span changes, run displacement to push overlapping cards
    if (spanChanged && this.dragIndex !== null && this.liveSpanPreview) {
      const currentPlacements = this.placementsFn();
      const config = this.configFn();
      const tempPlacements = currentPlacements.map(p => {
        if (p.index === this.dragIndex) {
          return { ...p, colSpan: this.liveSpanPreview!.colSpan, rowSpan: this.liveSpanPreview!.rowSpan };
        }
        return { ...p };
      });
      const fixed = fixOverlaps(tempPlacements, config);
      // Only commit if something actually moved (not just the resized card)
      const othersChanged = fixed.some((f, i) => {
        const orig = currentPlacements[i];
        return orig && f.index !== this.dragIndex && (f.col !== orig.col || f.row !== orig.row);
      });
      if (othersChanged) {
        this.onChangeFn(fixed);
      }
    }
  }

  // ── Displacement Engine Integration ─────────────────────────────────

  /** Run the displacement engine and set prospective swap for visual preview. */ // ²⁰
  private computeDisplacement(cell: GridCell, placements: GridPlacement[], config: GridConfig): void {
    if (this.dragIndex === null) return;

    const plan = resolveDisplacement(this.dragIndex, cell, placements, config);
    this.currentPlan = plan;

    if (plan.type === 'noop' || plan.moves.length === 0) {
      this.prospectiveSwap = null;
      return;
    }

    // Find the swap pair for visual preview (drag card + first displaced card)
    const dragMove = plan.moves.find(m => m.index === this.dragIndex);
    const otherMove = plan.moves.find(m => m.index !== this.dragIndex);

    if (dragMove && otherMove) {
      this.prospectiveSwap = {
        sourceIndex: this.dragIndex,
        targetIndex: otherMove.index,
      };
    } else {
      this.prospectiveSwap = null;
    }
  }

  /** Cancel drag: revert to snapshot, clear all state. */ // ²²
  private cancelDrag(): void {
    if (this.snapshotPlacements) {
      this.onChangeFn(this.snapshotPlacements);
    }
    // Release pointer if held
    const container = this.containerFn();
    if (container && this.activePointerId !== null) {
      try { container.releasePointerCapture(this.activePointerId); } catch (_) { /* ok */ }
    }
    this.resetSession();
  }

  private resetSession(): void { // ²³
    // Restore scroll position before clearing state
    const container = this.containerFn();
    if (container && this.savedScrollTop > 0) {
      requestAnimationFrame(() => { container.scrollTop = this.savedScrollTop; });
    }
    this.activePointerId = null;
    this.activeDragIndex = null;
    this.wellsRevealed = false;
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    this.prospectiveSwap = null;
    this.currentPlan = null;
    this.liveSpanPreview = null;
    this.isResizing = false;
    this.resizeWidth = 0;
    this.resizeHeight = 0;
    this.resizeStartW = 0;
    this.resizeStartH = 0;
    this.resizeOriginShift = 0;
    this.resizeCellW = 0;
    this.resizeCellH = 0;
    this.resizeGap = 0;
    this.resizeMaxSpanX = 1;
    if (this.resizeRafId) { cancelAnimationFrame(this.resizeRafId); this.resizeRafId = null; }
    this.dragGhostWidth = 0;
    this.dragGhostHeight = 0;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.isSettling = false;
    this.settleX = 0;
    this.settleY = 0;
    this.settleWidth = 0;
    this.settleHeight = 0;
    // Re-enable text selection
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
    this.dropTarget = null;
    this.dropSpan = null;
    this.dragIndex = null;
    this.spanEdge = null;
    this.snapshotPlacements = null;
    this.lastHoveredCellKey = '';
    this.interactionMode = 'idle';
    if (this.swapDebounceTimer) {
      clearTimeout(this.swapDebounceTimer);
      this.swapDebounceTimer = null;
    }
  }

  // ── Private Helpers ────────────────────────────────────────────────

  /** Check if a cell is truly empty (no placement covers it). */ // ²⁴
  private isCellEmpty(cell: GridCell, placements: GridPlacement[]): boolean {
    return !placementAtCell(cell.col, cell.row, placements);
  }

  private detectSpanEdge( // ²⁵
    e: PointerEvent,
    placement: GridPlacement,
    containerRect: DOMRect,
    config: GridConfig,
  ): SpanEdge | null {
    const ZONE = 14; // generous hit zone matching CSS handle width
    const container = this.containerFn();
    if (!container) return null;
    const cellEl = container.querySelector(`[data-cell-index="${placement.index}"]`) as HTMLElement | null;
    if (!cellEl) return null;

    const r = cellEl.getBoundingClientRect();

    // All four edges — clamping handled in resize logic
    if (Math.abs(e.clientX - r.right) < ZONE) return 'right';
    if (Math.abs(e.clientX - r.left) < ZONE) return 'left';
    if (Math.abs(e.clientY - r.bottom) < ZONE) return 'bottom';
    if (Math.abs(e.clientY - r.top) < ZONE) return 'top';
    return null;
  }

  private navigateSelection( // ²⁶
    key: string,
    config: GridConfig,
    placements: GridPlacement[],
  ): void {
    if (placements.length === 0) return;

    if (this.selectedIndex === null) {
      const first = placements.reduce((a, b) =>
        a.row < b.row || (a.row === b.row && a.col < b.col) ? a : b
      );
      this.selectedIndex = first.index;
      this.onSelectFn?.(first.index);
      return;
    }

    const current = placements.find(p => p.index === this.selectedIndex);
    if (!current) return;

    let targetCol = current.col;
    let targetRow = current.row;

    switch (key) {
      case 'ArrowLeft': targetCol = Math.max(1, current.col - 1); break;
      case 'ArrowRight': targetCol = Math.min(config.columns, current.col + 1); break;
      case 'ArrowUp': targetRow = Math.max(1, current.row - 1); break;
      case 'ArrowDown': targetRow = current.row + 1; break;
    }

    const target = placementAtCell(targetCol, targetRow, placements);
    if (target && target.index !== this.selectedIndex) {
      this.selectedIndex = target.index;
      this.onSelectFn?.(target.index);
    }
  }

  private cycleSelection(direction: 1 | -1, placements: GridPlacement[]): void { // ²⁷
    if (placements.length === 0) return;

    const sorted = [...placements].sort((a, b) =>
      a.row !== b.row ? a.row - b.row : a.col - b.col
    );

    if (this.selectedIndex === null) {
      const target = direction === 1 ? sorted[0] : sorted[sorted.length - 1];
      this.selectedIndex = target.index;
      this.onSelectFn?.(target.index);
      return;
    }

    const currentIdx = sorted.findIndex(p => p.index === this.selectedIndex);
    const nextIdx = (currentIdx + direction + sorted.length) % sorted.length;
    this.selectedIndex = sorted[nextIdx].index;
    this.onSelectFn?.(sorted[nextIdx].index);
  }
}
