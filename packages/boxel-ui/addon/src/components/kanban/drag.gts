// KanbanDragManager — Drag interaction for Kanban boards.
// Uses insertion model: cards insert BETWEEN other cards.

import { scheduleOnce } from '@ember/runloop';
import { tracked } from '@glimmer/tracking';

import {
  type InsertionPoint,
  type KanbanPlacement,
  findInsertionFromPointer,
  resolveInsertion,
} from './engine.ts';

// ── Constants ────────────────────────────────────────────────────────── //
const DRAG_THRESHOLD_PX = 4;

function placementsEqual(a: KanbanPlacement[], b: KanbanPlacement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i]!;
    return (
      p.index === q.index &&
      p.column === q.column &&
      p.sortOrder === q.sortOrder
    );
  });
}
const HOLD_DELAY_MS = 180;

// ── Types ────────────────────────────────────────────────────────────── //

type BodyStyle = CSSStyleDeclaration & { webkitUserSelect: string };

export type KanbanInteractionMode = 'idle' | 'pending' | 'drag';

export interface KanbanDragManagerOptions {
  columnCount: () => number;
  containerElement: () => HTMLElement | null;
  onChange: (placements: KanbanPlacement[]) => void;
  onOpen?: (index: number) => void;
  onSelect?: (index: number | null) => void;
  placements: () => KanbanPlacement[];
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
  @tracked announcement = '';

  // ── Non-tracked ────────────────────────────────────────────────────
  private activePointerId: number | null = null;
  private startClientX = 0;
  private startClientY = 0;
  private dragIndex: number | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotPlacements: KanbanPlacement[] | null = null;
  private suppressLostPointerCapture = false;

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
    this.suppressLostPointerCapture = false;
    this.activePointerId = e.pointerId;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;
    this.dragIndex = hitIndex;
    this.selectedIndex = hitIndex;
    this.onSelectFn?.(hitIndex);
    this.interactionMode = 'pending';

    document.body.style.userSelect = 'none';
    (document.body.style as BodyStyle).webkitUserSelect = 'none';

    this.holdTimer = setTimeout(() => {
      if (this.interactionMode === 'pending') {
        this.activateDrag(container);
      }
    }, HOLD_DELAY_MS);

    container.setPointerCapture(e.pointerId);
  };

  onPointerCancel = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) return;
    this.abortPointerInteraction();
  };

  onLostPointerCapture = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) return;
    if (this.suppressLostPointerCapture) {
      return;
    }
    this.abortPointerInteraction();
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
    if (container) this.releasePointerCapture(container, e.pointerId);

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
      (document.body.style as BodyStyle).webkitUserSelect = '';
      if (tappedIndex !== null) this.onOpenFn?.(tappedIndex);
      return;
    }

    if (this.interactionMode !== 'drag' || this.dragIndex === null) {
      this.resetSession();
      return;
    }

    const pendingInsertion = this.insertion;
    const pendingDragIndex = this.dragIndex;

    // No-op drop: card released at its original position — skip settle entirely.
    if (pendingInsertion !== null && pendingDragIndex !== null) {
      const placements = this.placementsFn();
      const next = resolveInsertion(
        pendingDragIndex,
        pendingInsertion,
        placements,
      );
      if (placementsEqual(placements, next)) {
        this.resetSession();
        return;
      }
    }

    if (container && pendingInsertion) {
      this.measureSettlePosition(container);
    }

    this.isSettling = true;

    setTimeout(() => {
      if (pendingInsertion && pendingDragIndex !== null) {
        const placements = this.placementsFn();
        const newPlacements = resolveInsertion(
          pendingDragIndex,
          pendingInsertion,
          placements,
        );
        this.onChangeFn(newPlacements);
        this.announcement = 'Card moved.';
      } else {
        this.announcement = 'Movement cancelled.';
      }

      scheduleOnce('afterRender', this, this.resetSession);
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

  destroy(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    document.body.style.userSelect = '';
    (document.body.style as BodyStyle).webkitUserSelect = '';
  }

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
    this.announcement = 'Movement cancelled.';
    if (this.snapshotPlacements) {
      this.onChangeFn(this.snapshotPlacements);
    }
    this.abortPointerInteraction();
  }

  private abortPointerInteraction(): void {
    const container = this.containerFn();
    if (container && this.activePointerId !== null) {
      this.releasePointerCapture(container, this.activePointerId);
    }
    this.resetSession();
  }

  private releasePointerCapture(
    container: HTMLElement,
    pointerId: number,
  ): void {
    this.suppressLostPointerCapture = true;
    try {
      container.releasePointerCapture(pointerId);
    } catch (_) {
      this.suppressLostPointerCapture = false;
    }
  }

  private resetSession(): void {
    this.suppressLostPointerCapture = false;
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
    (document.body.style as BodyStyle).webkitUserSelect = '';
  }
}
