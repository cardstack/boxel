// KanbanPlane — Vertical columns with insertion-based drag.
// Visual design inspired by Linear/sprint-planner: fixed-height cards,
// clean columns, status-colored headers, professional kanban feel.

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { htmlSafe, type SafeString } from '@ember/template';
import { ContextButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import Modifier from 'ember-modifier';
import { KanbanDragManager } from './kanban-drag';
import {
  type KanbanPlacement,
  cardsInColumn,
  columnCount as colCount,
} from './kanban-engine';
import { KanbanColumnField } from './kanban-column';

class CaptureElement extends Modifier<{
  Element: HTMLElement;
  Args: {
    Positional: [(el: HTMLElement) => void];
  };
}> {
  modify(el: HTMLElement, [callback]: [(el: HTMLElement) => void]) {
    callback(el);
  }
}

class BindPointerDown extends Modifier<{
  Element: HTMLElement;
  Args: {
    Positional: [(event: PointerEvent) => void];
  };
}> {
  #element: HTMLElement | null = null;
  #handler: ((event: PointerEvent) => void) | null = null;

  modify(el: HTMLElement, [handler]: [(event: PointerEvent) => void]) {
    if (this.#element && this.#handler) {
      this.#element.removeEventListener('pointerdown', this.#handler);
    }
    el.addEventListener('pointerdown', handler);
    this.#element = el;
    this.#handler = handler;
  }

  willRemove() {
    if (this.#element && this.#handler) {
      this.#element.removeEventListener('pointerdown', this.#handler);
    }
  }
}

export class KanbanPlane extends Component<{
  Args: {
    columns: KanbanColumnField[];
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

  get columns(): KanbanColumnField[] {
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

  isColumnVisible = (column: KanbanColumnField, colIndex: number): boolean => {
    if (column.collapsed) {
      return false;
    }
    if (!this.args.hideEmpty) {
      return true;
    }
    return this.columnCardCount(colIndex) > 0;
  };

  isOverWip = (column: KanbanColumnField, colIndex: number): boolean => {
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
    // ¹²
    const ins = this.manager.insertion;
    if (!ins || !this.isDragging || p.column !== ins.column) return false;
    if (p.index === this.manager.activeDragIndex) return false;
    return p.sortOrder >= ins.position;
  };

  cardShiftStyle = (p: KanbanPlacement): SafeString => {
    if (this.shouldShiftDown(p)) {
      const gap = (this.manager.dragGhostHeight || 170) + 8;
      return htmlSafe(`transform: translateY(${gap}px)`);
    }
    return htmlSafe('');
  };

  showInsertionBox = (colIndex: number): boolean => {
    return (
      this.manager.insertion !== null &&
      this.manager.insertion.column === colIndex &&
      this.isDragging
    );
  };

  insertionBoxStyle = (colIndex: number): SafeString => {
    // ¹³
    if (!this.showInsertionBox(colIndex) || !this.containerElement)
      return htmlSafe('display: none');
    const ins = this.manager.insertion!;
    const ghostH = this.manager.dragGhostHeight || 170;
    const colCards = this.columnCards(colIndex).filter(
      (p) => p.index !== this.manager.activeDragIndex,
    );

    if (colCards.length === 0) return htmlSafe(`top: 0; height: ${ghostH}px`);

    const insertIdx = Math.min(ins.position - 1, colCards.length);

    if (insertIdx >= colCards.length) {
      const lastEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[colCards.length - 1].index}"]`,
      ) as HTMLElement | null;
      if (lastEl) {
        const rect = lastEl.getBoundingClientRect();
        const parentRect = lastEl.parentElement!.getBoundingClientRect();
        const cs = getComputedStyle(lastEl);
        const matrix = new DOMMatrix(cs.transform);
        return htmlSafe(
          `top: ${rect.bottom - matrix.m42 - parentRect.top + 6}px; height: ${ghostH}px`,
        );
      }
    } else {
      const beforeEl = this.containerElement.querySelector(
        `[data-card-index="${colCards[insertIdx].index}"]`,
      ) as HTMLElement | null;
      if (beforeEl) {
        const rect = beforeEl.getBoundingClientRect();
        const parentRect = beforeEl.parentElement!.getBoundingClientRect();
        const cs = getComputedStyle(beforeEl);
        const matrix = new DOMMatrix(cs.transform);
        return htmlSafe(
          `top: ${rect.top - matrix.m42 - parentRect.top - 3}px; height: ${ghostH}px`,
        );
      }
    }
    return htmlSafe(`top: 0; height: ${ghostH}px`);
  };

  columnDotStyle = (column: KanbanColumnField): SafeString =>
    htmlSafe(`background: ${column.color ?? '#94a3b8'}`);

  get ghostStyle(): SafeString {
    const m = this.manager;
    if (m.isSettling) {
      return htmlSafe(
        `left: ${m.settleX}px; top: ${m.settleY}px; width: ${m.settleWidth}px; height: ${m.settleHeight}px`,
      );
    }
    return htmlSafe(
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
            class='column
              {{if (this.isTargetColumn colIdx) "is-target"}}
              {{if (this.isOverWip column colIdx) "is-over-wip"}}'
            data-kanban-column={{colIdx}}
          >
            <div class='col-header'>
              <div class='col-header-left'>
                <span
                  class='col-dot'
                  style={{this.columnDotStyle column}}
                ></span>
                <span class='col-name'>{{if
                    column.label
                    column.label
                    'Untitled'
                  }}</span>
                <span class='col-count'>{{this.columnCardCount colIdx}}</span>
              </div>
              <div class='col-header-right'>
                {{#if column.wipLimit}}
                  <span
                    class='col-wip {{if (this.isOverWip column colIdx) "over"}}'
                  >
                    max
                    {{column.wipLimit}}
                  </span>
                {{/if}}
                {{#if @onAddCard}}
                  <ContextButton
                    class='col-add-btn'
                    @label={{if
                      column.label
                      (concat 'Add card to ' column.label)
                      'Add card to column'
                    }}
                    @icon='add'
                    @variant='ghost'
                    {{on 'click' (fn @onAddCard column.key)}}
                  />
                {{/if}}
              </div>
            </div>

            <div class='col-body'>
              {{#if (this.showInsertionBox colIdx)}}
                <div
                  class='insertion-box'
                  style={{this.insertionBoxStyle colIdx}}
                ></div>
              {{/if}}

              {{#each (this.columnCards colIdx) as |placement|}}
                <div
                  class='card
                    {{if
                      (eq placement.index this.manager.selectedIndex)
                      "selected"
                    }}
                    {{if (this.isSource placement) "dragging"}}'
                  style={{this.cardShiftStyle placement}}
                  data-card-index={{placement.index}}
                >
                  {{yield placement to='card'}}
                </div>
              {{/each}}

              {{#unless (this.columnCardCount colIdx)}}
                {{#unless this.isDragging}}
                  <div class='empty-col'>No cards</div>
                {{/unless}}
              {{/unless}}
            </div>
          </div>
        {{/if}}
      {{/each}}
    </div>

    {{#if this.showGhost}}
      <div
        class='ghost {{if this.isSettling "settling"}}'
        style={{this.ghostStyle}}
      >
        {{yield this.ghostIndex to='ghost'}}
      </div>
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
        box-shadow: inset 0 0 0 2px var(--ring, #3b82f6);
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
        background: #f4f5f7;
      }
      .column.is-over-wip {
        background: #fef3c7;
      }

      /* ── Column Header ──────────────────────────────────────────── */
      .col-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px 8px;
        flex-shrink: 0;
      }
      .col-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .col-dot {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .col-name {
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: -0.01em;
      }
      .col-count {
        font-size: 12px;
        font-weight: 500;
        color: #94a3b8;
      }
      .col-header-right {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .col-wip {
        font-size: 10px;
        color: #94a3b8;
        font-family: var(--font-mono, monospace);
      }
      .col-wip.over {
        color: #d97706;
        font-weight: 600;
      }
      .col-add-btn {
        color: #94a3b8;
        opacity: 0.6;
      }
      .col-add-btn:hover {
        opacity: 1;
        color: #1e293b;
      }

      /* Target column during drag */
      .column.is-target .col-header {
        background: rgba(16, 185, 129, 0.06);
        border-radius: 8px 8px 0 0;
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

      /* ── Card ───────────────────────────────────────────────────── */
      .card {
        flex-shrink: 0;
        height: 170px;
        border-radius: 8px;
        overflow: hidden;
        background: #fff;
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 0 0 1px rgba(0, 0, 0, 0.04);
        cursor: grab;
        transition: box-shadow 120ms ease-out;
      }
      /* Only animate shift transforms during active drag */
      .board.is-dragging .card {
        transition:
          transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
          box-shadow 120ms ease-out;
      }
      .card:hover {
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.08),
          0 0 0 1px rgba(0, 0, 0, 0.06);
      }
      .card.selected {
        box-shadow:
          0 0 0 2px var(--primary, #3b82f6),
          0 1px 2px rgba(0, 0, 0, 0.06);
      }
      .card.dragging {
        opacity: 0;
        height: 0;
        min-height: 0;
        overflow: hidden;
        margin: -3px 0;
      }

      /* ── Insertion Box ──────────────────────────────────────────── */
      .insertion-box {
        position: absolute;
        left: 8px;
        right: 8px;
        border-radius: 8px;
        background: rgba(16, 185, 129, 0.06);
        border: 2px dashed rgba(16, 185, 129, 0.35);
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
        color: #cbd5e1;
        font-size: 13px;
        font-style: italic;
      }

      /* ── Ghost ──────────────────────────────────────────────────── */
      .ghost {
        position: fixed;
        z-index: 999;
        pointer-events: none;
        border-radius: 8px;
        overflow: hidden;
        background: #fff;
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.28),
          0 8px 20px rgba(0, 0, 0, 0.12),
          0 2px 6px rgba(0, 0, 0, 0.06);
        opacity: 0.97;
        transform: rotate(-2.5deg) scale(1.03);
      }
      .ghost.settling {
        transition:
          left 180ms cubic-bezier(0.4, 0, 0.2, 1),
          top 180ms cubic-bezier(0.4, 0, 0.2, 1),
          width 180ms cubic-bezier(0.4, 0, 0.2, 1),
          height 180ms cubic-bezier(0.4, 0, 0.2, 1),
          transform 180ms ease-out,
          box-shadow 180ms ease-out;
        transform: rotate(0deg) scale(1);
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 0 0 1px rgba(0, 0, 0, 0.04);
      }
    </style>
  </template>
}
