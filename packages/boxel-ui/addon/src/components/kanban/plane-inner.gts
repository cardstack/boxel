// KanbanPlaneInner — Vertical columns with insertion-based drag.
import {
  cn,
  eq,
  fittedFormatById,
  sanitizeHtmlSafe,
} from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { FittedFormatId } from '../../helpers.ts';
import { KanbanCard } from './card.gts';
import { KanbanColumnHeader } from './column-header.gts';
import type { KanbanDragManager } from './drag.gts';
import {
  type KanbanColumnConfig,
  type KanbanPlacement,
  cardsInColumn,
  columnCount as colCount,
} from './engine.ts';
import { KanbanGhost } from './ghost.gts';
import { BindPointerDown, CaptureElement } from './modifiers.gts';

export class KanbanPlaneInner extends Component<{
  Args: {
    boardLabel?: string;
    cardSize?: FittedFormatId;
    columns: KanbanColumnConfig[];
    hideEmpty?: boolean;
    manager: KanbanDragManager;
    onAddCard?: (columnKey: string | null) => void;
    placements: KanbanPlacement[];
  };
  Blocks: {
    card: [KanbanPlacement];
    ghost: [number];
  };
}> {
  @tracked containerElement: HTMLElement | null = null;
  get manager(): KanbanDragManager {
    return this.args.manager;
  }

  get columns(): KanbanColumnConfig[] {
    return this.args.columns;
  }

  get cardSize(): FittedFormatId {
    return this.args.cardSize ?? 'regular-tile';
  }

  get cardFormat() {
    return (
      fittedFormatById.get(this.cardSize) ??
      fittedFormatById.get('regular-tile')!
    );
  }

  get columnStyle(): SafeString {
    let width = this.cardFormat.width + 16;
    return sanitizeHtmlSafe(`flex-basis: ${width}px; min-width: ${width}px;`);
  }

  captureRef = (el: HTMLElement): void => {
    this.containerElement = el;
    this.manager.registerContainer(el);
  };

  columnCards = (colIndex: number): KanbanPlacement[] =>
    cardsInColumn(colIndex, this.args.placements);
  columnCardCount = (colIndex: number): number =>
    colCount(colIndex, this.args.placements);

  isColumnVisible = (column: KanbanColumnConfig, colIndex: number): boolean => {
    if (column.collapsed) {
      return false;
    }
    if (!this.args.hideEmpty) {
      return true;
    }
    return this.columnCardCount(colIndex) > 0;
  };

  isOverWip = (column: KanbanColumnConfig, colIndex: number): boolean => {
    const limit = column.wipLimit ?? 0;
    return limit > 0 && this.columnCardCount(colIndex) > limit;
  };

  get isDragging(): boolean {
    return this.manager.isDragging;
  }
  get isActivelyMoving(): boolean {
    return this.manager.isActivelyMoving;
  }
  get showGhost(): boolean {
    return this.manager.activeDragIndex !== null && this.manager.isDragging;
  }
  get isSettling(): boolean {
    return this.manager.isSettling;
  }

  isSource = (p: KanbanPlacement): boolean =>
    p.index === this.manager.activeDragIndex;

  isTargetColumn = (colIndex: number): boolean => {
    const ins = this.manager.insertion;
    return ins !== null && ins.column === colIndex && this.isActivelyMoving;
  };

  shouldShiftDown = (p: KanbanPlacement): boolean => {
    const ins = this.manager.insertion;
    if (!ins || !this.isActivelyMoving || p.column !== ins.column) return false;
    if (p.index === this.manager.activeDragIndex) return false;
    return p.sortOrder >= ins.position;
  };

  cardShiftStyle = (p: KanbanPlacement): SafeString => {
    if (this.shouldShiftDown(p)) {
      const gap = (this.manager.dragGhostHeight || this.cardFormat.height) + 8;
      return sanitizeHtmlSafe(`transform: translateY(${gap}px)`);
    }
    return sanitizeHtmlSafe('');
  };

  showInsertionBox = (colIndex: number): boolean => {
    return (
      this.manager.insertion !== null &&
      this.manager.insertion.column === colIndex &&
      this.isActivelyMoving
    );
  };

  insertionBoxStyle = (colIndex: number): SafeString => {
    if (!this.showInsertionBox(colIndex) || !this.containerElement)
      return sanitizeHtmlSafe('display: none');
    const ins = this.manager.insertion!;
    const ghostH = this.manager.dragGhostHeight || this.cardFormat.height;
    const colCards = this.columnCards(colIndex).filter(
      (p) => p.index !== this.manager.activeDragIndex,
    );

    if (colCards.length === 0) return sanitizeHtmlSafe(`height: ${ghostH}px`);

    const insertIdx = Math.min(ins.position - 1, colCards.length);

    if (insertIdx >= colCards.length) {
      const lastEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[colCards.length - 1]?.index}"]`,
      ) as HTMLElement | null;
      if (lastEl?.parentElement) {
        const rect = lastEl.getBoundingClientRect();
        const parentRect = lastEl.parentElement.getBoundingClientRect();
        const cs = getComputedStyle(lastEl);
        const matrix = new DOMMatrix(cs.transform);
        const offset = rect.bottom - matrix.m42 - parentRect.top + 6;
        return sanitizeHtmlSafe(
          `transform: translateY(${offset}px); height: ${ghostH}px`,
        );
      }
    } else {
      const beforeEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[insertIdx]?.index}"]`,
      ) as HTMLElement | null;
      if (beforeEl?.parentElement) {
        const rect = beforeEl.getBoundingClientRect();
        const parentRect = beforeEl.parentElement.getBoundingClientRect();
        const cs = getComputedStyle(beforeEl);
        const matrix = new DOMMatrix(cs.transform);
        const offset = rect.top - matrix.m42 - parentRect.top - 3;
        return sanitizeHtmlSafe(
          `transform: translateY(${offset}px); height: ${ghostH}px`,
        );
      }
    }
    return sanitizeHtmlSafe(`height: ${ghostH}px`);
  };

  get ghostStyle(): SafeString {
    const m = this.manager;
    if (m.isSettling) {
      return sanitizeHtmlSafe(
        `translate: ${m.settleX}px ${m.settleY}px; width: ${m.settleWidth}px; height: ${m.settleHeight}px`,
      );
    }
    return sanitizeHtmlSafe(
      `translate: ${m.pointerClientX - m.dragOffsetX}px ${m.pointerClientY - m.dragOffsetY}px; width: ${m.dragGhostWidth}px; height: ${m.dragGhostHeight}px`,
    );
  }

  get ghostIndex(): number {
    return this.manager.activeDragIndex ?? -1;
  }

  get roverIndex(): number | null {
    const sel = this.manager.selectedIndex;
    if (sel !== null) return sel;
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const cards = this.columnCards(colIdx);
      if (cards.length > 0) return cards[0]!.index;
    }
    return null;
  }

  <template>
    <div
      class={{cn 'board' is-dragging=this.isDragging}}
      role='region'
      aria-label={{if @boardLabel @boardLabel 'Kanban board'}}
      {{CaptureElement this.captureRef}}
      {{BindPointerDown this.manager.onPointerDown}}
      {{on 'pointermove' this.manager.onPointerMove}}
      {{on 'pointerup' this.manager.onPointerUp}}
      {{on 'pointercancel' this.manager.onPointerCancel}}
      {{on 'lostpointercapture' this.manager.onLostPointerCapture}}
      {{on 'keydown' this.manager.onKeyDown}}
      tabindex='0'
    >
      <div
        class='boxel-sr-only'
        role='status'
        aria-live='polite'
        aria-atomic='true'
      >{{this.manager.announcement}}</div>

      {{#each this.columns as |column colIdx|}}
        {{#if (this.isColumnVisible column colIdx)}}
          <div
            class={{cn
              'column'
              is-target=(this.isTargetColumn colIdx)
              is-over-wip=(this.isOverWip column colIdx)
            }}
            role='group'
            aria-label={{if column.label column.label 'Untitled'}}
            style={{this.columnStyle}}
            data-kanban-column={{colIdx}}
          >
            <KanbanColumnHeader
              @column={{column}}
              @cardCount={{this.columnCardCount colIdx}}
              @isOverWip={{this.isOverWip column colIdx}}
              @isTarget={{this.isTargetColumn colIdx}}
              @onAddCard={{if @onAddCard (fn @onAddCard column.key)}}
            />

            <div class='col-body' role='list' data-kanban-col-body>
              {{#if (this.showInsertionBox colIdx)}}
                <div
                  class='insertion-box'
                  style={{this.insertionBoxStyle colIdx}}
                ></div>
              {{/if}}

              {{#each (this.columnCards colIdx) as |placement|}}
                <KanbanCard
                  @placement={{placement}}
                  @isSelected={{eq placement.index this.manager.selectedIndex}}
                  @isSource={{this.isSource placement}}
                  @isRover={{eq placement.index this.roverIndex}}
                  @size={{this.cardSize}}
                  @shiftStyle={{this.cardShiftStyle placement}}
                  @isDragging={{this.isDragging}}
                >
                  {{yield placement to='card'}}
                </KanbanCard>
              {{/each}}

              {{#unless (this.columnCardCount colIdx)}}
                <div class='empty-col' aria-hidden='true'>No cards</div>
              {{/unless}}
            </div>
          </div>
        {{/if}}
      {{/each}}
    </div>

    {{#if this.showGhost}}
      <KanbanGhost @style={{this.ghostStyle}} @isSettling={{this.isSettling}}>
        {{yield this.ghostIndex to='ghost'}}
      </KanbanGhost>
    {{/if}}

    <style scoped>
      .board {
        --_kanban-bg: var(
          --boxel-kanban-bg,
          var(--background, var(--boxel-100))
        );
        --_kanban-fg: var(
          --boxel-kanban-fg,
          var(--foreground, var(--boxel-700))
        );
        --_kanban-card-bg: var(
          --boxel-kanban-card-bg,
          var(--card, var(--boxel-light))
        );
        --_kanban-card-fg: var(
          --boxel-kanban-card-fg,
          var(--card-foreground, var(--boxel-dark))
        );
        --_kanban-col-bg: var(
          --boxel-kanban-col-bg,
          var(--sidebar, var(--boxel-200))
        );
        --_kanban-col-fg: var(
          --boxel-kanban-col-fg,
          var(--sidebar-foreground, var(--boxel-dark))
        );
        --_kanban-ring: var(
          --boxel-kanban-ring,
          var(--ring, var(--boxel-highlight))
        );
        --_kanban-destructive: var(
          --boxel-kanban-destructive,
          var(--destructive, var(--boxel-danger))
        );
        --_kanban-destructive-fg: var(
          --boxel-kanban-destructive-fg,
          var(--destructive-foreground, var(--boxel-light-100))
        );
        --_kanban-primary: var(
          --boxel-kanban-primary,
          var(--primary, var(--boxel-highlight))
        );
        --_kanban-primary-fg: var(
          --boxel-kanban-primary-fg,
          var(--primary-foreground, var(--boxel-dark))
        );
        --_kanban-radius: var(
          --boxel-kanban-radius,
          var(--radius, var(--boxel-border-radius-sm))
        );
        --_kanban-muted-opacity: var(--boxel-kanban-muted-opacity, 0.7);

        display: flex;
        gap: 0.5rem;
        height: 100%;
        padding: 0.75rem;
        overflow-x: auto;
        outline: none;
        background-color: var(--_kanban-bg);
        color: var(--_kanban-fg);
      }
      .board:focus-visible {
        box-shadow: inset 0 0 0 2px var(--_kanban-ring);
      }
      .board.is-dragging {
        user-select: none;
        -webkit-user-select: none;
        cursor: grabbing;
      }

      .column {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-radius: var(--_kanban-radius);
        background: var(--_kanban-col-bg);
        color: var(--_kanban-col-fg);
      }
      .column.is-over-wip {
        background: color-mix(
          in oklch,
          var(--_kanban-destructive) 12%,
          var(--_kanban-bg)
        );
      }

      .col-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.25rem 0.5rem 0.5rem;
        position: relative;
      }

      .insertion-box {
        position: absolute;
        top: 0;
        left: 0.5rem;
        right: 0.5rem;
        border-radius: var(--_kanban-radius);
        background: color-mix(
          in oklch,
          var(--_kanban-primary) 8%,
          var(--_kanban-bg)
        );
        border: 2px dashed var(--_kanban-primary);
        color: var(--_kanban-primary-foreground);
        z-index: 0;
        pointer-events: none;
        transition: transform 120ms ease-out;
      }

      .empty-col {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        font-size: 0.8125rem;
        font-style: italic;
        opacity: var(--_kanban-muted-opacity);
      }
    </style>
  </template>
}
