// KanbanDragManager — Drag interaction for Kanban boards.
// Uses insertion model: cards insert BETWEEN other cards.

import { tracked } from '@glimmer/tracking';
import {
  type KanbanPlacement,
  type InsertionPoint,
  findInsertionFromPointer,
  resolveInsertion,
} from './engine.ts';

// ── Constants ────────────────────────────────────────────────────────── //
const DRAG_THRESHOLD_PX = 4;
const HOLD_DELAY_MS = 180;

// ── Types ────────────────────────────────────────────────────────────── //

export type KanbanInteractionMode = 'idle' | 'pending' | 'drag';

export interface KanbanDragManagerOptions {
  placements: () => KanbanPlacement[];
  columnCount: () => number;
  containerElement: () => HTMLElement | null;
  onChange: (placements: KanbanPlacement[]) => void;
  onSelect?: (index: number | null) => void;
  onOpen?: (index: number) => void;
}

// ── KanbanDragManager ────────────────────────────────────────────────── //

export class KanbanDragManager {
  // ── Dependencies ───────────────────────────────────────────────────
  private placementsFn: () => KanbanPlacement[];
  private columnCountFn: () => number;
  private containerFn: () => HTMLElement | null;
  private onChangeFn: (placements: KanbanPlacement[]) => void;
  private onSelectFn: ((index: number | null) => void) | undefined;
  private onOpenFn: ((index: number) => void) | undefined;

  // ── Tracked State ──────────────────────────────────────────────────
  @tracked selectedIndex: number | null = null;
  @tracked interactionMode: KanbanInteractionMode = 'idle';
  @tracked activeDragIndex: number | null = null;
  @tracked pointerClientX = 0;
  @tracked pointerClientY = 0;
  @tracked dragGhostWidth = 0;
  @tracked dragGhostHeight = 0;
  @tracked dragOffsetX = 0;
  @tracked dragOffsetY = 0;
  @tracked insertion: InsertionPoint | null = null;
  @tracked isSettling = false;
  @tracked settleX = 0;
  @tracked settleY = 0;
  @tracked settleWidth = 0;
  @tracked settleHeight = 0;

  // ── Non-tracked ────────────────────────────────────────────────────
  private activePointerId: number | null = null;
  private startClientX = 0;
  private startClientY = 0;
  private dragIndex: number | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotPlacements: KanbanPlacement[] | null = null;

  // ── Public container ref ───────────────────────────────────────────
  containerRef: HTMLElement | null = null;

  constructor(opts: KanbanDragManagerOptions) {
    this.placementsFn = opts.placements;
    this.columnCountFn = opts.columnCount;
    this.containerFn = () => this.containerRef ?? opts.containerElement();
    this.onChangeFn = opts.onChange;
    this.onSelectFn = opts.onSelect;
    this.onOpenFn = opts.onOpen;
  }

  registerContainer = (el: HTMLElement): void => {
    this.containerRef = el;
  };

  // ── Pointer Handlers ───────────────────────────────────────────────

  onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.interactionMode !== 'idle') return;

    const container = this.containerFn();
    if (!container) return;

    const targetEl = e.target as HTMLElement;
    const cardEl = targetEl?.closest?.(
      '[data-card-index]',
    ) as HTMLElement | null;
    if (!cardEl) {
      this.selectedIndex = null;
      this.onSelectFn?.(null);
      return;
    }

    const hitIndex = parseInt(cardEl.getAttribute('data-card-index')!, 10);
    this.activePointerId = e.pointerId;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.dragIndex = hitIndex;
    this.selectedIndex = hitIndex;
    this.onSelectFn?.(hitIndex);
    this.interactionMode = 'pending';

    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';

    this.holdTimer = setTimeout(() => {
      if (this.interactionMode === 'pending') {
        this.activateDrag(container);
      }
    }, HOLD_DELAY_MS);

    container.setPointerCapture(e.pointerId);
  };

  onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId || this.interactionMode === 'idle')
      return;

    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;

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
    if (!container || this.dragIndex === null) return;

    const placements = this.placementsFn();
    const point = findInsertionFromPointer(
      e.clientX,
      e.clientY,
      container,
      placements,
      this.dragIndex,
      this.columnCountFn(),
    );
    this.insertion = point;
  };

  onPointerUp = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) return;

    const container = this.containerFn();
    if (container) container.releasePointerCapture(e.pointerId);

    if (this.interactionMode === 'pending') {
      if (this.holdTimer) {
        clearTimeout(this.holdTimer);
        this.holdTimer = null;
      }
      const tappedIndex = this.dragIndex;
      this.interactionMode = 'idle';
      this.activePointerId = null;
      this.dragIndex = null;
      this.snapshotPlacements = null;
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
      if (tappedIndex !== null) this.onOpenFn?.(tappedIndex);
      return;
    }

    if (this.interactionMode !== 'drag' || this.dragIndex === null) {
      this.resetSession();
      return;
    }

    if (container && this.insertion) {
      this.measureSettlePosition(container);
    }

    this.isSettling = true;

    const pendingInsertion = this.insertion;
    const pendingDragIndex = this.dragIndex;

    setTimeout(() => {
      if (pendingInsertion && pendingDragIndex !== null) {
        const placements = this.placementsFn();
        const newPlacements = resolveInsertion(
          pendingDragIndex,
          pendingInsertion,
          placements,
        );
        this.onChangeFn(newPlacements);
      }

      requestAnimationFrame(() => {
        this.resetSession();
      });
    }, 200);
  };

  // ── Keyboard ───────────────────────────────────────────────────────

  onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (e.key === 'Escape') {
      if (this.interactionMode !== 'idle') {
        e.preventDefault();
        this.cancelDrag();
      } else {
        this.selectedIndex = null;
        this.onSelectFn?.(null);
      }
    }
  };

  // ── Actions ────────────────────────────────────────────────────────

  select = (index: number | null): void => {
    this.selectedIndex = index;
    this.onSelectFn?.(index);
  };

  // ── Private ────────────────────────────────────────────────────────

  private activateDrag(container: HTMLElement): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.interactionMode = 'drag';
    this.activeDragIndex = this.dragIndex;
    this.snapshotPlacements = this.placementsFn().map((p) => ({ ...p }));

    const cardEl = container.querySelector(
      `[data-card-index="${this.dragIndex}"]`,
    ) as HTMLElement | null;
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      this.dragGhostWidth = rect.width;
      this.dragGhostHeight = rect.height;
      this.dragOffsetX = this.pointerClientX - rect.left;
      this.dragOffsetY = this.pointerClientY - rect.top;
    }
  }

  private measureSettlePosition(container: HTMLElement): void {
    if (!this.insertion) return;
    const { column, position } = this.insertion;
    const placements = this.placementsFn();
    const colCards = placements
      .filter((p) => p.column === column && p.index !== this.dragIndex)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const colEl = container.querySelector(
      `[data-kanban-column="${column}"]`,
    ) as HTMLElement | null;
    if (!colEl) return;

    const bodyEl = colEl.querySelector('.col-body') as HTMLElement | null;
    if (!bodyEl) return;

    if (colCards.length === 0) {
      const bodyRect = bodyEl.getBoundingClientRect();
      this.settleX = bodyRect.left + 4;
      this.settleY = bodyRect.top + 8;
      this.settleWidth = bodyRect.width - 8;
      this.settleHeight = this.dragGhostHeight;
      return;
    }

    const insertIdx = Math.min(position - 1, colCards.length);

    if (insertIdx >= colCards.length) {
      const lastCardEl = container.querySelector(
        `[data-card-index="${colCards[colCards.length - 1]?.index}"]`,
      ) as HTMLElement | null;
      if (lastCardEl) {
        const rect = lastCardEl.getBoundingClientRect();
        const cs = getComputedStyle(lastCardEl);
        const matrix = new DOMMatrix(cs.transform);
        this.settleX = rect.left - matrix.m41;
        this.settleY = rect.bottom - matrix.m42 + 6;
        this.settleWidth = rect.width;
        this.settleHeight = this.dragGhostHeight;
      }
    } else {
      const beforeCardEl = container.querySelector(
        `[data-card-index="${colCards[insertIdx]?.index}"]`,
      ) as HTMLElement | null;
      if (beforeCardEl) {
        const rect = beforeCardEl.getBoundingClientRect();
        const cs = getComputedStyle(beforeCardEl);
        const matrix = new DOMMatrix(cs.transform);
        this.settleX = rect.left - matrix.m41;
        this.settleY = rect.top - matrix.m42;
        this.settleWidth = rect.width;
        this.settleHeight = this.dragGhostHeight;
      }
    }
  }

  private cancelDrag(): void {
    if (this.snapshotPlacements) {
      this.onChangeFn(this.snapshotPlacements);
    }
    const container = this.containerFn();
    if (container && this.activePointerId !== null) {
      try {
        container.releasePointerCapture(this.activePointerId);
      } catch (_) {
        /* ok */
      }
    }
    this.resetSession();
  }

  private resetSession(): void {
    this.activePointerId = null;
    this.activeDragIndex = null;
    this.insertion = null;
    this.isSettling = false;
    this.settleX = 0;
    this.settleY = 0;
    this.settleWidth = 0;
    this.settleHeight = 0;
    this.dragGhostWidth = 0;
    this.dragGhostHeight = 0;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.dragIndex = null;
    this.snapshotPlacements = null;
    this.interactionMode = 'idle';
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
  }
}
