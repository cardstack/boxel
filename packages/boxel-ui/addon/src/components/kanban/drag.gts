// KanbanDragManager — Drag interaction for Kanban boards.
// Uses insertion model: cards insert BETWEEN other cards.

import { type Timer, cancel, scheduleOnce } from '@ember/runloop';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';

import {
  type DragRect,
  type InsertionPoint,
  type KanbanPlacement,
  cardsInColumn,
  findInsertionFromDragRect,
  findInsertionFromPointer,
  KanbanColumnConfig,
  resolveInsertion,
} from './engine.ts';

// ── Constants ────────────────────────────────────────────────────────── //
const DRAG_THRESHOLD_PX = 4;
const SETTLE_DURATION_MS = 200;

function placementsEqual(a: KanbanPlacement[], b: KanbanPlacement[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bMap = new Map(b.map((p) => [p.index, p]));
  return a.every((p) => {
    const q = bMap.get(p.index);
    return (
      q !== undefined &&
      p.columnId === q.columnId &&
      p.sortOrder === q.sortOrder
    );
  });
}
const HOLD_DELAY_MS = 180;

// ── Types ────────────────────────────────────────────────────────────── //

type BodyStyle = CSSStyleDeclaration & { webkitUserSelect: string };

export type KanbanInteractionMode = 'idle' | 'pending' | 'drag' | 'kb-drag';

export interface KanbanDragManagerArgs {
  columnCount: number;
  columns: KanbanColumnConfig[] | [];
  isColumnVisible: (columnId: string) => boolean;
  onChange: (placements: KanbanPlacement[]) => void;
  onOpen?: (index: number) => void;
  onSelect?: (index: number | null) => void;
  placements: KanbanPlacement[];
}

// ── KanbanDragManager ────────────────────────────────────────────────── //

export class KanbanDragManager {
  private args: KanbanDragManagerArgs;

  // ── Tracked State ──────────────────────────────────────────────────
  @tracked selectedIndex: number | null = null;
  @tracked interactionMode: KanbanInteractionMode = 'idle';
  @tracked activeDragIndex: number | null = null;
  // Deferred by one render frame so the source card's collapse animation begins
  // after the ghost has materialised, rather than in the same paint.
  @tracked collapseIndex: number | null = null;
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
  @tracked kbGrabIndex: number | null = null;
  @tracked insertionBoxOffset: { height: number; yOffset: number } | null =
    null;

  // ── Non-tracked ────────────────────────────────────────────────────
  private activePointerId: number | null = null;
  private startClientX = 0;
  private startClientY = 0;
  private dragIndex: number | null = null;
  // Long-press on touch can promote a pending interaction into a drag.
  private holdTask = restartableTask(async (container: HTMLElement) => {
    await timeout(HOLD_DELAY_MS);
    if (this.interactionMode === 'pending') {
      this.activateDrag(container);
    }
  });
  private focusCardTask = restartableTask(async (index: number) => {
    await timeout(0);
    this.focusCard(index);
  });
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private rafTimer: Timer | null = null;
  private snapshotPlacements: KanbanPlacement[] | null = null;
  private suppressLostPointerCapture = false;
  private activeCardHeight = 0;

  // ── Public container ref ───────────────────────────────────────────
  containerRef: HTMLElement | null = null;

  constructor(args: KanbanDragManagerArgs) {
    this.args = args;
  }

  destroy(): void {
    this.holdTask.cancelAll();
    this.focusCardTask.cancelAll();
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (this.rafTimer !== null) {
      cancel(this.rafTimer);
      this.rafTimer = null;
    }
    document.body.style.userSelect = '';
    (document.body.style as BodyStyle).webkitUserSelect = '';
  }

  get isDragging(): boolean {
    return this.interactionMode === 'drag';
  }

  get isActivelyMoving(): boolean {
    return (
      this.interactionMode === 'drag' || this.interactionMode === 'kb-drag'
    );
  }

  registerContainer = (el: HTMLElement): void => {
    this.containerRef = el;
  };

  private getDragRect(clientX: number, clientY: number): DragRect | null {
    if (this.dragGhostWidth <= 0 || this.dragGhostHeight <= 0) {
      return null;
    }

    const left = clientX - this.dragOffsetX;
    const top = clientY - this.dragOffsetY;
    return {
      left,
      top,
      right: left + this.dragGhostWidth,
      bottom: top + this.dragGhostHeight,
    };
  }

  private getCurrentInsertion(
    clientX: number,
    clientY: number,
    container: HTMLElement,
    dragIndex: number,
  ): InsertionPoint | null {
    const dragRect = this.getDragRect(clientX, clientY);
    if (!dragRect) {
      return null;
    }

    const centerY = (dragRect.top + dragRect.bottom) / 2;
    // Prefer pointer-based hit testing while the pointer is over a column.
    // When it leaves the board horizontally, fall back to the dragged card's
    // rect so we can preserve a sensible "last visible" target.
    if (this.getColumnAtClientX(clientX, container) !== null) {
      return findInsertionFromPointer(
        clientX,
        centerY,
        container,
        this.args.placements,
        dragIndex,
      );
    }

    return findInsertionFromDragRect(
      dragRect,
      container,
      this.args.placements,
      dragIndex,
    );
  }

  private getColumnAtClientX(
    clientX: number,
    container: HTMLElement,
  ): number | null {
    const columnEls = container.querySelectorAll('[data-kanban-column]');

    for (let i = 0; i < columnEls.length; i++) {
      const el = columnEls[i] as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return parseInt(el.getAttribute('data-kanban-column')!, 10);
      }
    }

    return null;
  }

  // ── Pointer Handlers ───────────────────────────────────────────────

  onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.interactionMode !== 'idle') {
      return;
    }

    const container = this.containerRef;
    if (!container) {
      return;
    }

    const targetEl = e.target as HTMLElement;
    const cardEl = targetEl?.closest?.(
      '[data-card-index]',
    ) as HTMLElement | null;
    if (!cardEl) {
      this.selectedIndex = null;
      this.args.onSelect?.(null);
      return;
    }

    const hitIndex = parseInt(cardEl.getAttribute('data-card-index')!, 10);
    // Pointer interactions start in "pending" so a quick click can still open
    // the card, while a move past the threshold or a hold becomes a drag.
    this.suppressLostPointerCapture = false;
    this.activePointerId = e.pointerId;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;
    this.dragIndex = hitIndex;
    this.selectedIndex = hitIndex;
    this.args.onSelect?.(hitIndex);
    this.interactionMode = 'pending';

    document.body.style.userSelect = 'none';
    (document.body.style as BodyStyle).webkitUserSelect = 'none';

    void this.holdTask.perform(container);

    container.setPointerCapture(e.pointerId);
  };

  onPointerCancel = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) {
      return;
    }
    this.abortPointerInteraction();
  };

  onLostPointerCapture = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) {
      return;
    }
    if (this.suppressLostPointerCapture) {
      return;
    }
    this.abortPointerInteraction();
  };

  onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    if (
      e.pointerId !== this.activePointerId ||
      this.interactionMode === 'idle'
    ) {
      return;
    }

    // Update coordinates immediately so the ghost tracks the pointer every frame.
    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;

    if (this.interactionMode === 'pending') {
      const dx = e.clientX - this.startClientX;
      const dy = e.clientY - this.startClientY;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
        const container = this.containerRef;
        if (container) {
          this.activateDrag(container);
          this.insertion = this.getCurrentInsertion(
            e.clientX,
            e.clientY,
            container,
            this.dragIndex!,
          );
          scheduleOnce('afterRender', this, this.updateInsertionBox);
        }
      }
      return;
    }

    // Throttle the expensive querySelectorAll / getBoundingClientRect work to
    // one Ember queue flush. pointerClientX/Y above are already updated.
    if (this.rafTimer !== null) {
      return;
    }
    this.rafTimer = scheduleOnce('afterRender', this, this.processMoveFrame);
  };

  onPointerUp = (event: Event): void => {
    const e = event as PointerEvent;
    if (e.pointerId !== this.activePointerId) {
      return;
    }

    const container = this.containerRef;
    if (container) {
      this.releasePointerCapture(container, e.pointerId);
    }

    if (this.interactionMode === 'pending') {
      this.holdTask.cancelAll();
      const tappedIndex = this.dragIndex;
      this.interactionMode = 'idle';
      this.activePointerId = null;
      this.dragIndex = null;
      this.snapshotPlacements = null;
      document.body.style.userSelect = '';
      (document.body.style as BodyStyle).webkitUserSelect = '';
      if (tappedIndex !== null) {
        this.args.onOpen?.(tappedIndex);
      }
      return;
    }

    if (this.interactionMode !== 'drag' || this.dragIndex === null) {
      this.resetSession();
      return;
    }

    // Recompute once on drop so the final insertion reflects the latest
    // pointer position even if a throttled move frame has not run yet.
    const pendingInsertion = this.insertion;
    const pendingDragIndex = this.dragIndex;
    let finalInsertion = pendingInsertion;

    if (container && pendingDragIndex !== null) {
      const finalClientX = Number.isFinite(e.clientX)
        ? e.clientX
        : this.pointerClientX;
      const finalClientY = Number.isFinite(e.clientY)
        ? e.clientY
        : this.pointerClientY;
      const currentInsertion = this.getCurrentInsertion(
        finalClientX,
        finalClientY,
        container,
        pendingDragIndex,
      );
      finalInsertion = currentInsertion ?? pendingInsertion;
      this.insertion = finalInsertion;
    }

    // Snapshot placements at drop time so the settle timer's resolveInsertion
    // call is unaffected by any parent update that arrives during the 200 ms
    // settle window (e.g. a live-sync push).
    const placementsAtDrop = this.args.placements;

    // No-op drop: card released at its original position — skip settle entirely.
    if (finalInsertion !== null && pendingDragIndex !== null) {
      const next = resolveInsertion(
        pendingDragIndex,
        finalInsertion,
        placementsAtDrop,
      );
      if (placementsEqual(placementsAtDrop, next)) {
        this.resetSession();
        return;
      }
    }

    if (container && finalInsertion) {
      this.measureSettlePosition(container);
    }

    this.isSettling = true;

    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (finalInsertion && pendingDragIndex !== null) {
        const newPlacements = resolveInsertion(
          pendingDragIndex,
          finalInsertion,
          placementsAtDrop,
        );
        this.args.onChange(newPlacements);
        this.announcement = 'Card moved.';
      } else {
        this.announcement = 'Movement cancelled.';
      }

      this.resetSession();
    }, SETTLE_DURATION_MS);
  };

  // ── Keyboard ───────────────────────────────────────────────────────

  onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;

    if (e.key === 'Tab' && this.interactionMode === 'kb-drag') {
      e.preventDefault();
      this.cancelKeyboardDrag();
      return;
    }

    if (e.key === 'Escape') {
      if (this.interactionMode === 'kb-drag') {
        e.preventDefault();
        this.cancelKeyboardDrag();
      } else if (this.interactionMode !== 'idle') {
        e.preventDefault();
        this.cancelDrag();
      } else {
        this.selectedIndex = null;
        this.args.onSelect?.(null);
      }
      return;
    }

    if (this.interactionMode === 'kb-drag') {
      this.handleKeyboardMove(e);
      return;
    }

    if (this.interactionMode === 'idle') {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this.navigateFocus('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.navigateFocus('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.navigateFocus('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.navigateFocus('right');
          break;
        case ' ':
        case 'Enter': {
          const cardEl = (e.target as HTMLElement)?.closest?.(
            '[data-card-index]',
          ) as HTMLElement | null;
          if (cardEl) {
            e.preventDefault();
            const index = parseInt(cardEl.getAttribute('data-card-index')!, 10);
            this.startKeyboardDrag(index);
          }
          break;
        }
      }
    }
  };

  // ── Actions ────────────────────────────────────────────────────────

  select = (index: number | null): void => {
    this.selectedIndex = index;
    this.args.onSelect?.(index);
  };

  // ── Private ────────────────────────────────────────────────────────

  private applyCollapse = (): void => {
    this.collapseIndex = this.dragIndex;
  };

  private activateDrag(container: HTMLElement): void {
    this.holdTask.cancelAll();
    this.interactionMode = 'drag';
    this.activeDragIndex = this.dragIndex;
    // Snapshot the pre-drag placements so cancellation can restore them.
    this.snapshotPlacements = this.args.placements.map((p) => ({ ...p }));
    // Defer the collapse so it starts after the ghost has painted.
    scheduleOnce('afterRender', this, this.applyCollapse);

    const rect = this.measureActiveCardRect(container, this.dragIndex);
    if (rect) {
      this.dragGhostWidth = rect.width;
      this.dragGhostHeight = rect.height;
      this.activeCardHeight = rect.height;
      this.dragOffsetX = this.pointerClientX - rect.left;
      this.dragOffsetY = this.pointerClientY - rect.top;
    }
  }

  private updateInsertionBox(): void {
    const container = this.containerRef;
    const ins = this.insertion;
    if (!container || !ins) {
      this.insertionBoxOffset = null;
      return;
    }

    const { columnId, position } = ins;
    const colCards = this.args.placements
      .filter(
        (p) => p.columnId === columnId && p.index !== this.activeDragIndex,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const colEl = container.querySelector(
      `[data-kanban-column="${columnId}"]`,
    ) as HTMLElement | null;
    const bodyEl = colEl?.querySelector(
      '[data-kanban-col-body]',
    ) as HTMLElement | null;
    if (!bodyEl) {
      this.insertionBoxOffset = null;
      return;
    }

    const height = this.getInsertionBoxHeight(container);

    if (colCards.length === 0) {
      this.insertionBoxOffset = { yOffset: 0, height };
      return;
    }

    // The insertion indicator is positioned in the board's untransformed flow,
    // so remove any card transform offsets before measuring the gap.
    const bodyRect = bodyEl.getBoundingClientRect();
    const scrollTop = bodyEl.scrollTop;
    const gap = parseFloat(getComputedStyle(bodyEl).gap) || 0;
    // Find the first card whose sortOrder is >= the insertion position. Using
    // sortOrder comparison instead of (position - 1) as an array index avoids
    // an off-by-one when the source card is excluded from colCards (the gap in
    // sortOrder values would push the index one past the intended slot).
    const rawIdx = colCards.findIndex((c) => c.sortOrder >= position);
    const insertIdx = rawIdx === -1 ? colCards.length : rawIdx;

    if (insertIdx >= colCards.length) {
      const lastEl = container.querySelector(
        `[data-card-index="${colCards[colCards.length - 1]?.index}"]`,
      ) as HTMLElement | null;
      if (lastEl) {
        const rect = lastEl.getBoundingClientRect();
        const matrix = new DOMMatrix(getComputedStyle(lastEl).transform);
        this.insertionBoxOffset = {
          yOffset: rect.bottom - matrix.m42 - bodyRect.top + gap + scrollTop,
          height,
        };
      } else {
        this.insertionBoxOffset = null;
      }
    } else {
      const beforeEl = container.querySelector(
        `[data-card-index="${colCards[insertIdx]?.index}"]`,
      ) as HTMLElement | null;
      if (beforeEl) {
        const rect = beforeEl.getBoundingClientRect();
        const matrix = new DOMMatrix(getComputedStyle(beforeEl).transform);
        this.insertionBoxOffset = {
          yOffset: rect.top - matrix.m42 - bodyRect.top + scrollTop,
          height,
        };
      } else {
        this.insertionBoxOffset = null;
      }
    }
  }

  private measureSettlePosition(container: HTMLElement): void {
    if (!this.insertion) {
      return;
    }
    // The settle animation moves the ghost to the exact slot it will resolve
    // into before onChange updates the parent-owned placements.
    const { columnId, position } = this.insertion;
    const placements = this.args.placements;
    const colCards = placements
      .filter((p) => p.columnId === columnId && p.index !== this.dragIndex)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const colEl = container.querySelector(
      `[data-kanban-column="${columnId}"]`,
    ) as HTMLElement | null;
    if (!colEl) {
      return;
    }

    const bodyEl = colEl.querySelector(
      '[data-kanban-col-body]',
    ) as HTMLElement | null;
    if (!bodyEl) {
      return;
    }

    const bodyCs = getComputedStyle(bodyEl);
    const bodyPadTop = parseFloat(bodyCs.paddingTop);
    const bodyPadLeft = parseFloat(bodyCs.paddingLeft);
    const bodyPadRight = parseFloat(bodyCs.paddingRight);
    const gap = parseFloat(bodyCs.gap) || 0;

    if (colCards.length === 0) {
      const bodyRect = bodyEl.getBoundingClientRect();
      this.settleX = bodyRect.left + bodyPadLeft;
      this.settleY = bodyRect.top + bodyPadTop;
      this.settleWidth = bodyRect.width - bodyPadLeft - bodyPadRight;
      this.settleHeight = this.dragGhostHeight;
      return;
    }

    const rawIdx = colCards.findIndex((c) => c.sortOrder >= position);
    const insertIdx = rawIdx === -1 ? colCards.length : rawIdx;

    if (insertIdx >= colCards.length) {
      const lastCardEl = container.querySelector(
        `[data-card-index="${colCards[colCards.length - 1]?.index}"]`,
      ) as HTMLElement | null;
      if (lastCardEl) {
        const rect = lastCardEl.getBoundingClientRect();
        const cs = getComputedStyle(lastCardEl);
        const matrix = new DOMMatrix(cs.transform);
        this.settleX = rect.left - matrix.m41;
        this.settleY = rect.bottom - matrix.m42 + gap;
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

  private startKeyboardDrag(index: number): void {
    const placements = this.args.placements;
    const placement = placements.find((p) => p.index === index);
    if (!placement) {
      return;
    }

    const colCards = cardsInColumn(placement.columnId, placements).filter(
      (p) => p.index !== index,
    );
    const slot = colCards.filter(
      (c) => c.sortOrder < placement.sortOrder,
    ).length;

    // Keyboard dragging reuses the same insertion model as pointer dragging,
    // but advances it in discrete slots instead of by pointer geometry.
    this.interactionMode = 'kb-drag';
    this.activeDragIndex = index;
    this.collapseIndex = index;
    this.kbGrabIndex = index;
    this.selectedIndex = index;
    this.snapshotPlacements = placements.map((p) => ({ ...p }));
    const rect = this.measureActiveCardRect(this.containerRef, index);
    if (rect && rect.height > 0) {
      this.dragGhostHeight = rect.height;
      this.activeCardHeight = rect.height;
    }
    this.insertion = this.slotToInsertion(placement.columnId, slot, colCards);
    this.updateInsertionBox();
    this.args.onSelect?.(index);
    this.announcement =
      'Grabbed. Use arrow keys to move, Space or Enter to drop, Escape to cancel.';
  }

  private handleKeyboardMove(e: KeyboardEvent): void {
    const movingKeys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      ' ',
      'Enter',
    ];
    if (!movingKeys.includes(e.key)) {
      return;
    }
    e.preventDefault();

    if (e.key === ' ' || e.key === 'Enter') {
      this.commitKeyboardDrag();
      return;
    }

    if (!this.insertion) {
      return;
    }
    const placements = this.args.placements;
    const { columnId } = this.insertion;
    const columns = this.args.columns ?? [];
    const columnIdx = columns.findIndex((c) => c.key === columnId);
    const totalColumns = columns.length;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      let newIdx = columnIdx + delta;
      while (newIdx >= 0 && newIdx < totalColumns) {
        if (this.isColumnVisible(columns[newIdx]!.key)) {
          break;
        }
        newIdx += delta;
      }
      if (newIdx < 0 || newIdx >= totalColumns || newIdx === columnIdx) {
        return;
      }
      const newColumnId = columns[newIdx]!.key;
      const currentColCards = cardsInColumn(columnId, placements).filter(
        (p) => p.index !== this.activeDragIndex,
      );
      const currentSlot = this.insertionToSlot(this.insertion, currentColCards);
      const newColCards = cardsInColumn(newColumnId, placements).filter(
        (p) => p.index !== this.activeDragIndex,
      );
      const newSlot = Math.min(currentSlot, newColCards.length);
      this.insertion = this.slotToInsertion(newColumnId, newSlot, newColCards);
      this.updateInsertionBox();
      this.announcement = `Column ${newIdx + 1}. Position ${newSlot + 1} of ${newColCards.length + 1}.`;
      return;
    }

    const colCards = cardsInColumn(columnId, placements).filter(
      (p) => p.index !== this.activeDragIndex,
    );
    const currentSlot = this.insertionToSlot(this.insertion, colCards);
    const newSlot =
      e.key === 'ArrowUp'
        ? Math.max(0, currentSlot - 1)
        : Math.min(colCards.length, currentSlot + 1);
    if (newSlot === currentSlot) {
      return;
    }
    this.insertion = this.slotToInsertion(columnId, newSlot, colCards);
    this.updateInsertionBox();
    this.announcement = `Position ${newSlot + 1} of ${colCards.length + 1}.`;
  }

  private commitKeyboardDrag(): void {
    const pendingInsertion = this.insertion;
    const pendingIndex = this.kbGrabIndex;
    if (pendingInsertion !== null && pendingIndex !== null) {
      const placements = this.args.placements;
      const next = resolveInsertion(pendingIndex, pendingInsertion, placements);
      if (!placementsEqual(placements, next)) {
        this.args.onChange(next);
        this.announcement = 'Card dropped.';
      } else {
        this.announcement = 'Card returned to original position.';
      }
    }
    const focusTarget = pendingIndex;
    this.resetSession();
    if (focusTarget !== null) {
      void this.focusCardTask.perform(focusTarget);
    }
  }

  private cancelKeyboardDrag(): void {
    const focusTarget = this.kbGrabIndex;
    this.announcement = 'Movement cancelled.';
    if (this.snapshotPlacements) {
      this.args.onChange(this.snapshotPlacements);
    }
    this.resetSession();
    if (focusTarget !== null) {
      void this.focusCardTask.perform(focusTarget);
    }
  }

  private navigateFocus(direction: 'up' | 'down' | 'left' | 'right'): void {
    const placements = this.args.placements;
    const visiblePlacements = placements.filter((p) =>
      this.isColumnVisible(p.columnId),
    );
    if (visiblePlacements.length === 0) {
      return;
    }

    const currentIndex = this.selectedIndex;
    const current =
      currentIndex !== null
        ? visiblePlacements.find((p) => p.index === currentIndex)
        : null;

    const colCards = (colId: string) =>
      visiblePlacements
        .filter((p) => p.columnId === colId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    let targetCard: KanbanPlacement | undefined;

    if (!current) {
      targetCard = visiblePlacements
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    } else if (direction === 'up') {
      const cards = colCards(current.columnId);
      const idx = cards.findIndex((p) => p.index === current.index);
      targetCard = cards[idx - 1];
    } else if (direction === 'down') {
      const cards = colCards(current.columnId);
      const idx = cards.findIndex((p) => p.index === current.index);
      targetCard = cards[idx + 1];
    } else {
      const delta = direction === 'left' ? -1 : 1;
      const columns = this.args.columns ?? [];
      const totalCols = columns.length;
      const currentRowIndex = colCards(current.columnId).findIndex(
        (p) => p.index === current.index,
      );
      const currentColIdx = columns.findIndex(
        (c) => c.key === current.columnId,
      );
      let col = currentColIdx + delta;
      while (col >= 0 && col < totalCols) {
        const colKey = columns[col]!.key;
        if (this.isColumnVisible(colKey)) {
          const cards = colCards(colKey);
          if (cards.length > 0) {
            targetCard = cards[Math.min(currentRowIndex, cards.length - 1)];
            break;
          }
        }
        col += delta;
      }
    }

    if (!targetCard) {
      return;
    }
    this.selectedIndex = targetCard.index;
    this.args.onSelect?.(targetCard.index);
    void this.focusCardTask.perform(targetCard.index);
  }

  private focusCard(index: number): void {
    const el = this.containerRef?.querySelector(
      `[data-card-index="${index}"]`,
    ) as HTMLElement | null;
    el?.focus();
  }

  private insertionToSlot(
    insertion: InsertionPoint,
    colCards: KanbanPlacement[],
  ): number {
    if (insertion.insertBeforeIndex === -1) {
      return colCards.length;
    }
    const idx = colCards.findIndex(
      (c) => c.index === insertion.insertBeforeIndex,
    );
    return idx === -1 ? colCards.length : idx;
  }

  private slotToInsertion(
    columnId: string,
    slot: number,
    colCards: KanbanPlacement[],
  ): InsertionPoint {
    if (slot >= colCards.length) {
      return {
        columnId,
        insertBeforeIndex: -1,
        position: (colCards[colCards.length - 1]?.sortOrder ?? 0) + 1,
      };
    }
    const beforeCard = colCards[slot]!;
    return {
      columnId,
      insertBeforeIndex: beforeCard.index,
      position: beforeCard.sortOrder,
    };
  }

  private processMoveFrame(): void {
    this.rafTimer = null;
    if (this.interactionMode !== 'drag' || this.dragIndex === null) {
      return;
    }
    // Pointer coordinates update on every event, but DOM measurement is batched
    // here to avoid repeating layout work for each pointermove.
    const container = this.containerRef;
    if (!container) {
      return;
    }
    this.insertion = this.getCurrentInsertion(
      this.pointerClientX,
      this.pointerClientY,
      container,
      this.dragIndex,
    );
    this.updateInsertionBox();
  }

  private isColumnVisible(columnId: string): boolean {
    return this.args.isColumnVisible(columnId);
  }

  private cancelDrag(): void {
    this.announcement = 'Movement cancelled.';
    if (this.snapshotPlacements) {
      this.args.onChange(this.snapshotPlacements);
    }
    this.abortPointerInteraction();
  }

  private abortPointerInteraction(): void {
    const container = this.containerRef;
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
      // Capture was already lost; lostpointercapture has already fired or will
      // not fire again, so the suppress flag should stay true to avoid a
      // double-abort if it fires late.
    }
  }

  private measureActiveCardRect(
    container: HTMLElement | null,
    index: number | null,
  ): DOMRect | null {
    if (!container || index === null) {
      return null;
    }
    const cardEl = container.querySelector(
      `[data-card-index="${index}"]`,
    ) as HTMLElement | null;
    return cardEl?.getBoundingClientRect() ?? null;
  }

  private getInsertionBoxHeight(container: HTMLElement): number {
    if (this.dragGhostHeight > 0) {
      return this.dragGhostHeight;
    }
    if (this.activeCardHeight > 0) {
      return this.activeCardHeight;
    }
    if (this.insertionBoxOffset && this.insertionBoxOffset.height > 0) {
      this.activeCardHeight = this.insertionBoxOffset.height;
      return this.insertionBoxOffset.height;
    }

    const rect = this.measureActiveCardRect(container, this.activeDragIndex);
    if (rect && rect.height > 0) {
      this.activeCardHeight = rect.height;
      return rect.height;
    }

    return 40;
  }

  private resetSession(): void {
    // Clear every transient drag artifact so the next interaction starts from
    // a fully neutral state, regardless of how this one ended.
    this.suppressLostPointerCapture = false;
    this.activePointerId = null;
    this.activeDragIndex = null;
    this.collapseIndex = null;
    this.kbGrabIndex = null;
    this.insertion = null;
    this.insertionBoxOffset = null;
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
    this.activeCardHeight = 0;
    this.snapshotPlacements = null;
    this.interactionMode = 'idle';
    this.holdTask.cancelAll();
    this.focusCardTask.cancelAll();
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (this.rafTimer !== null) {
      cancel(this.rafTimer);
      this.rafTimer = null;
    }
    document.body.style.userSelect = '';
    (document.body.style as BodyStyle).webkitUserSelect = '';
  }
}
