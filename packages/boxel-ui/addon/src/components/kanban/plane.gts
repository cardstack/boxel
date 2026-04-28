// KanbanPlane — Vertical columns with insertion-based drag.

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type { SafeString } from '@ember/template';
import { cn, eq, sanitizeHtmlSafe } from '@cardstack/boxel-ui/helpers';
import type { KanbanDragManager } from './drag.gts';
import {
  type KanbanPlacement,
  type KanbanColumnConfig,
  cardsInColumn,
  columnCount as colCount,
} from './engine.ts';
import { CaptureElement, BindPointerDown } from './modifiers.gts';
import { KanbanColumnHeader } from './column-header.gts';
import { KanbanCard } from './card.gts';
import { KanbanGhost } from './ghost.gts';

export class KanbanPlane extends Component<{
  Args: {
    columns: KanbanColumnConfig[];
    placements: KanbanPlacement[];
    manager: KanbanDragManager;
    interactive: boolean;
    hideEmpty?: boolean;
    onAddCard?: (columnKey: string | null) => void;
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

  captureRef = (el: HTMLElement): void => {
    this.containerElement = el;
    this.manager.registerContainer(el);
  };

  // ── Helpers ────────────────────────────────────────────────────────

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
    return this.manager.interactionMode === 'drag';
  }
  get showGhost(): boolean {
    return this.manager.activeDragIndex !== null;
  }
  get isSettling(): boolean {
    return this.manager.isSettling;
  }

  isSource = (p: KanbanPlacement): boolean =>
    p.index === this.manager.activeDragIndex;

  isTargetColumn = (colIndex: number): boolean => {
    const ins = this.manager.insertion;
    return ins !== null && ins.column === colIndex && this.isDragging;
  };

  shouldShiftDown = (p: KanbanPlacement): boolean => {
    const ins = this.manager.insertion;
    if (!ins || !this.isDragging || p.column !== ins.column) return false;
    if (p.index === this.manager.activeDragIndex) return false;
    return p.sortOrder >= ins.position;
  };

  cardShiftStyle = (p: KanbanPlacement): SafeString => {
    if (this.shouldShiftDown(p)) {
      const gap = (this.manager.dragGhostHeight || 170) + 8;
      return sanitizeHtmlSafe(`transform: translateY(${gap}px)`);
    }
    return sanitizeHtmlSafe('');
  };

  showInsertionBox = (colIndex: number): boolean => {
    return (
      this.manager.insertion !== null &&
      this.manager.insertion.column === colIndex &&
      this.isDragging
    );
  };

  insertionBoxStyle = (colIndex: number): SafeString => {
    if (!this.showInsertionBox(colIndex) || !this.containerElement)
      return sanitizeHtmlSafe('display: none');
    const ins = this.manager.insertion!;
    const ghostH = this.manager.dragGhostHeight || 170;
    const colCards = this.columnCards(colIndex).filter(
      (p) => p.index !== this.manager.activeDragIndex,
    );

    if (colCards.length === 0)
      return sanitizeHtmlSafe(`top: 0; height: ${ghostH}px`);

    const insertIdx = Math.min(ins.position - 1, colCards.length);

    if (insertIdx >= colCards.length) {
      const lastEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[colCards.length - 1]?.index}"]`,
      ) as HTMLElement | null;
      if (lastEl) {
        const rect = lastEl.getBoundingClientRect();
        const parentRect = lastEl.parentElement!.getBoundingClientRect();
        const cs = getComputedStyle(lastEl);
        const matrix = new DOMMatrix(cs.transform);
        return sanitizeHtmlSafe(
          `top: ${rect.bottom - matrix.m42 - parentRect.top + 6}px; height: ${ghostH}px`,
        );
      }
    } else {
      const beforeEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[insertIdx]?.index}"]`,
      ) as HTMLElement | null;
      if (beforeEl) {
        const rect = beforeEl.getBoundingClientRect();
        const parentRect = beforeEl.parentElement!.getBoundingClientRect();
        const cs = getComputedStyle(beforeEl);
        const matrix = new DOMMatrix(cs.transform);
        return sanitizeHtmlSafe(
          `top: ${rect.top - matrix.m42 - parentRect.top - 3}px; height: ${ghostH}px`,
        );
      }
    }
    return sanitizeHtmlSafe(`top: 0; height: ${ghostH}px`);
  };

  get ghostStyle(): SafeString {
    const m = this.manager;
    if (m.isSettling) {
      return sanitizeHtmlSafe(
        `left: ${m.settleX}px; top: ${m.settleY}px; width: ${m.settleWidth}px; height: ${m.settleHeight}px`,
      );
    }
    return sanitizeHtmlSafe(
      `left: ${m.pointerClientX - m.dragOffsetX}px; top: ${m.pointerClientY - m.dragOffsetY}px; width: ${m.dragGhostWidth}px; height: ${m.dragGhostHeight}px`,
    );
  }

  get ghostIndex(): number {
    return this.manager.activeDragIndex ?? -1;
  }

  // ── Template ───────────────────────────────────────────────────────

  <template>
    <div
      class='board {{if this.isDragging "is-dragging"}}'
      {{CaptureElement this.captureRef}}
      {{BindPointerDown this.manager.onPointerDown}}
      {{on 'pointermove' this.manager.onPointerMove}}
      {{on 'pointerup' this.manager.onPointerUp}}
      {{on 'keydown' this.manager.onKeyDown}}
      tabindex='0'
    >
      {{#each this.columns as |column colIdx|}}
        {{#if (this.isColumnVisible column colIdx)}}
          <div
            class={{cn
              'column'
              is-target=(this.isTargetColumn colIdx)
              is-over-wip=(this.isOverWip column colIdx)
            }}
            data-kanban-column={{colIdx}}
          >
            <KanbanColumnHeader
              @column={{column}}
              @cardCount={{this.columnCardCount colIdx}}
              @isOverWip={{this.isOverWip column colIdx}}
              @isTarget={{this.isTargetColumn colIdx}}
              @onAddCard={{if @onAddCard (fn @onAddCard column.key)}}
            />

            <div class='col-body'>
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
                  @shiftStyle={{this.cardShiftStyle placement}}
                  @isDragging={{this.isDragging}}
                >
                  {{yield placement to='card'}}
                </KanbanCard>
              {{/each}}

              {{#unless (this.columnCardCount colIdx)}}
                <div class='empty-col'>No cards</div>
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
      /* ── Board ──────────────────────────────────────────────────── */
      .board {
        display: flex;
        gap: 8px;
        height: 100%;
        padding: 12px;
        overflow-x: auto;
        outline: none;
      }
      .board:focus-visible {
        box-shadow: inset 0 0 0 2px var(--ring, var(--boxel-highlight));
      }
      .board.is-dragging {
        user-select: none;
        -webkit-user-select: none;
        cursor: grabbing;
      }

      /* ── Column ─────────────────────────────────────────────────── */
      .column {
        display: flex;
        flex-direction: column;
        flex: 0 0 300px;
        min-width: 260px;
        height: 100%;
        border-radius: 8px;
        background: var(--sidebar, var(--boxel-100));
        color: var(--sidebar-foreground, var(--boxel-700));
      }
      .column.is-over-wip {
        color: var(--destructive, var(--boxel-red));
        background: color-mix(in oklch, currentColor 12%, transparent);
      }

      /* ── Column Body ────────────────────────────────────────────── */
      .col-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 8px 8px;
        position: relative;
      }

      /* ── Insertion Box ──────────────────────────────────────────── */
      .insertion-box {
        position: absolute;
        left: 8px;
        right: 8px;
        border-radius: 0.5rem;
        background: color-mix(
          in oklch,
          var(--accent, var(--boxel-dark-green)) 8%,
          transparent
        );
        border: 2px dashed
          color-mix(
            in oklch,
            var(--accent, var(--boxel-dark-green)) 35%,
            transparent
          );
        z-index: 0;
        pointer-events: none;
        transition: top 120ms ease-out;
      }

      /* ── Empty Column ───────────────────────────────────────────── */
      .empty-col {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 13px;
        font-style: italic;
      }
    </style>
  </template>
}
