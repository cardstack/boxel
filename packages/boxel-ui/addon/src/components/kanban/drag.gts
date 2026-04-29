// KanbanDragManager — Drag interaction for Kanban boards.
// Uses insertion model: cards insert BETWEEN other cards.

import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';

import {
  type InsertionPoint,
  type KanbanPlacement,
  cardsInColumn,
  findInsertionFromPointer,
  resolveInsertion,
} from './engine.ts';

// ── Constants ────────────────────────────────────────────────────────── //
const DRAG_THRESHOLD_PX = 4;

function placementsEqual(a: KanbanPlacement[], b: KanbanPlacement[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bMap = new Map(b.map((p) => [p.index, p]));
  return a.every((p) => {
    const q = bMap.get(p.index);
    return (
      q !== undefined && p.column === q.column && p.sortOrder === q.sortOrder
    );
  });
}
const HOLD_DELAY_MS = 180;

// ── Types ────────────────────────────────────────────────────────────── //

type BodyStyle = CSSStyleDeclaration & { webkitUserSelect: string };

export type KanbanInteractionMode = 'idle' | 'pending' | 'drag' | 'kb-drag';

export interface KanbanDragManagerArgs {
  columnCount: number;
  isColumnVisible: (column: number) => boolean;
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

  // ── Non-tracked ────────────────────────────────────────────────────
  private activePointerId: number | null = null;
  private startClientX = 0;
  private startClientY = 0;
  private dragIndex: number | null = null;
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
  private snapshotPlacements: KanbanPlacement[] | null = null;
  private suppressLostPointerCapture = false;

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

    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;

    if (this.interactionMode === 'pending') {
      const dx = e.clientX - this.startClientX;
      const dy = e.clientY - this.startClientY;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
        const container = this.containerRef;
        if (container) {
          this.activateDrag(container);
          this.insertion = findInsertionFromPointer(
            e.clientX,
            e.clientY,
            container,
            this.args.placements,
            this.dragIndex!,
            this.args.columnCount,
          );
        }
      }
      return;
    }

    const container = this.containerRef;
    if (!container || this.dragIndex === null) {
      return;
    }

    const placements = this.args.placements;
    const point = findInsertionFromPointer(
      e.clientX,
      e.clientY,
      container,
      placements,
      this.dragIndex,
      this.args.columnCount,
    );
    this.insertion = point;
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

    const pendingInsertion = this.insertion;
    const pendingDragIndex = this.dragIndex;

    // No-op drop: card released at its original position — skip settle entirely.
    if (pendingInsertion !== null && pendingDragIndex !== null) {
      const placements = this.args.placements;
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

    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (pendingInsertion && pendingDragIndex !== null) {
        const placements = this.args.placements;
        const newPlacements = resolveInsertion(
          pendingDragIndex,
          pendingInsertion,
          placements,
        );
        this.args.onChange(newPlacements);
        this.announcement = 'Card moved.';
      } else {
        this.announcement = 'Movement cancelled.';
      }

      this.resetSession();
    }, 200);
  };

  // ── Keyboard ───────────────────────────────────────────────────────

  onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;

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

  private activateDrag(container: HTMLElement): void {
    this.holdTask.cancelAll();
    this.interactionMode = 'drag';
    this.activeDragIndex = this.dragIndex;
    this.snapshotPlacements = this.args.placements.map((p) => ({ ...p }));

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
    if (!this.insertion) {
      return;
    }
    const { column, position } = this.insertion;
    const placements = this.args.placements;
    const colCards = placements
      .filter((p) => p.column === column && p.index !== this.dragIndex)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const colEl = container.querySelector(
      `[data-kanban-column="${column}"]`,
    ) as HTMLElement | null;
    if (!colEl) {
      return;
    }

    const bodyEl = colEl.querySelector('.col-body') as HTMLElement | null;
    if (!bodyEl) {
      return;
    }

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

  private startKeyboardDrag(index: number): void {
    const placements = this.args.placements;
    const placement = placements.find((p) => p.index === index);
    if (!placement) {
      return;
    }

    const colCards = cardsInColumn(placement.column, placements).filter(
      (p) => p.index !== index,
    );
    const slot = colCards.filter(
      (c) => c.sortOrder < placement.sortOrder,
    ).length;

    this.interactionMode = 'kb-drag';
    this.activeDragIndex = index;
    this.kbGrabIndex = index;
    this.selectedIndex = index;
    this.snapshotPlacements = placements.map((p) => ({ ...p }));
    this.insertion = this.slotToInsertion(placement.column, slot, colCards);
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
    const { column } = this.insertion;
    const totalColumns = this.args.columnCount;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      let newColumn = column + delta;
      while (
        newColumn >= 0 &&
        newColumn < totalColumns &&
        !this.isColumnVisible(newColumn)
      ) {
        newColumn += delta;
      }
      if (newColumn < 0 || newColumn >= totalColumns || newColumn === column) {
        return;
      }
      const currentColCards = cardsInColumn(column, placements).filter(
        (p) => p.index !== this.activeDragIndex,
      );
      const currentSlot = this.insertionToSlot(this.insertion, currentColCards);
      const newColCards = cardsInColumn(newColumn, placements).filter(
        (p) => p.index !== this.activeDragIndex,
      );
      const newSlot = Math.min(currentSlot, newColCards.length);
      this.insertion = this.slotToInsertion(newColumn, newSlot, newColCards);
      this.announcement = `Column ${newColumn + 1}. Position ${newSlot + 1} of ${newColCards.length + 1}.`;
      return;
    }

    const colCards = cardsInColumn(column, placements).filter(
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
    this.insertion = this.slotToInsertion(column, newSlot, colCards);
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
      this.isColumnVisible(p.column),
    );
    if (visiblePlacements.length === 0) {
      return;
    }

    const currentIndex = this.selectedIndex;
    const current =
      currentIndex !== null
        ? visiblePlacements.find((p) => p.index === currentIndex)
        : null;

    const colCards = (col: number) =>
      visiblePlacements
        .filter((p) => p.column === col)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    let targetCard: KanbanPlacement | undefined;

    if (!current) {
      targetCard = visiblePlacements
        .slice()
        .sort((a, b) => a.column - b.column || a.sortOrder - b.sortOrder)[0];
    } else if (direction === 'up') {
      const cards = colCards(current.column);
      const idx = cards.findIndex((p) => p.index === current.index);
      targetCard = cards[idx - 1];
    } else if (direction === 'down') {
      const cards = colCards(current.column);
      const idx = cards.findIndex((p) => p.index === current.index);
      targetCard = cards[idx + 1];
    } else {
      const delta = direction === 'left' ? -1 : 1;
      const totalCols = this.args.columnCount;
      let col = current.column + delta;
      while (col >= 0 && col < totalCols) {
        if (!this.isColumnVisible(col)) {
          col += delta;
          continue;
        }
        const cards = colCards(col);
        if (cards.length > 0) {
          targetCard = cards[Math.min(current.sortOrder - 1, cards.length - 1)];
          break;
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
    column: number,
    slot: number,
    colCards: KanbanPlacement[],
  ): InsertionPoint {
    if (slot >= colCards.length) {
      return {
        column,
        insertBeforeIndex: -1,
        position: (colCards[colCards.length - 1]?.sortOrder ?? 0) + 1,
      };
    }
    const beforeCard = colCards[slot]!;
    return {
      column,
      insertBeforeIndex: beforeCard.index,
      position: beforeCard.sortOrder,
    };
  }

  private isColumnVisible(column: number): boolean {
    return this.args.isColumnVisible(column);
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
      this.suppressLostPointerCapture = false;
    }
  }

  private resetSession(): void {
    this.suppressLostPointerCapture = false;
    this.activePointerId = null;
    this.activeDragIndex = null;
    this.kbGrabIndex = null;
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
    this.holdTask.cancelAll();
    this.focusCardTask.cancelAll();
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    document.body.style.userSelect = '';
    (document.body.style as BodyStyle).webkitUserSelect = '';
  }
}
