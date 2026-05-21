// KanbanPlaneInner — Vertical columns with insertion-based drag.
import Eye from '@cardstack/boxel-icons/eye';
import {
  cn,
  cssVar,
  eq,
  fittedFormatById,
  sanitizeHtmlSafe,
} from '@cardstack/boxel-ui/helpers';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

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

const KANBAN_COLUMN_HORIZONTAL_PADDING_PX = 16;
const KANBAN_INSERTION_GAP_PX = 8;

export class KanbanPlaneInner extends Component<{
  Args: {
    boardLabel?: string;
    cardSize?: FittedFormatId;
    columns: KanbanColumnConfig[];
    hideEmpty?: boolean;
    manager: KanbanDragManager;
    onAddCard?: (columnKey: string | null) => void;
    onToggleCollapsed?: (column: KanbanColumnConfig) => void;
    placements: KanbanPlacement[];
  };
  Blocks: {
    card: [KanbanPlacement];
    ghost: [number];
  };
  Element: HTMLElement;
}> {
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
    let width = this.cardFormat.width + KANBAN_COLUMN_HORIZONTAL_PADDING_PX;
    return sanitizeHtmlSafe(`flex-basis: ${width}px; min-width: ${width}px;`);
  }

  captureRef = (el: HTMLElement): void => {
    this.manager.registerContainer(el);
  };

  columnCards = (colId: string): KanbanPlacement[] =>
    cardsInColumn(colId, this.args.placements);
  columnCardCount = (colId: string): number =>
    colCount(colId, this.args.placements);

  isOverWip = (column: KanbanColumnConfig): boolean => {
    const limit = column.wipLimit ?? 0;
    return limit > 0 && this.columnCardCount(column.key) > limit;
  };

  get isDragging(): boolean {
    // Pointer-only drag state. Use this for the drag ghost and pointer-specific
    // styling that should not appear during keyboard drag.
    return this.manager.isDragging;
  }
  get isActivelyMoving(): boolean {
    // Any active repositioning state, whether driven by pointer drag or
    // keyboard drag. Use this for shared insertion/target UI.
    return this.manager.isActivelyMoving;
  }
  get showGhost(): boolean {
    return this.manager.activeDragIndex !== null && this.manager.isDragging;
  }
  get isSettling(): boolean {
    return this.manager.isSettling;
  }

  isSource = (p: KanbanPlacement): boolean =>
    p.index === this.manager.collapseIndex;

  isTargetColumn = (colId: string): boolean => {
    const ins = this.manager.insertion;
    return ins !== null && ins.columnId === colId && this.isActivelyMoving;
  };

  shouldShiftDown = (p: KanbanPlacement): boolean => {
    const ins = this.manager.insertion;
    if (!ins || !this.isActivelyMoving || p.columnId !== ins.columnId)
      return false;
    if (p.index === this.manager.activeDragIndex) return false;
    return p.sortOrder >= ins.position;
  };

  cardShiftStyle = (p: KanbanPlacement): SafeString => {
    if (this.shouldShiftDown(p)) {
      const shift =
        (this.manager.dragGhostHeight || this.cardFormat.height) +
        KANBAN_INSERTION_GAP_PX;
      return sanitizeHtmlSafe(`transform: translateY(${shift}px)`);
    }
    return sanitizeHtmlSafe('');
  };

  showInsertionBox = (colId: string): boolean => {
    return (
      this.manager.insertion !== null &&
      this.manager.insertion.columnId === colId &&
      this.isActivelyMoving
    );
  };

  insertionBoxStyle = (colId: string): SafeString => {
    if (!this.showInsertionBox(colId)) return sanitizeHtmlSafe('display: none');
    const off = this.manager.insertionBoxOffset;
    if (!off) return sanitizeHtmlSafe('display: none');
    const height = off.height > 0 ? off.height : this.cardFormat.height;
    return sanitizeHtmlSafe(
      `transform: translateY(${off.yOffset}px); height: ${height}px`,
    );
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
    for (const col of this.columns) {
      const cards = this.columnCards(col.key);
      if (cards.length > 0) return cards[0]!.index;
    }
    return null;
  }

  get hiddenColumns(): Array<{
    cardCount: number;
    config: KanbanColumnConfig;
  }> {
    return this.columns
      .filter((config) => config.collapsed)
      .map((config) => ({
        config,
        cardCount: this.columnCardCount(config.key),
      }));
  }

  restoreColumn = (hc: KanbanColumnConfig): void => {
    this.args.onToggleCollapsed?.(hc);
  };

  <template>
    <div
      class={{cn 'board' is-dragging=this.isDragging}}
      role={{if @boardLabel 'region'}}
      aria-label={{@boardLabel}}
      data-test-kanban-board
      {{CaptureElement this.captureRef}}
      {{BindPointerDown this.manager.onPointerDown}}
      {{on 'pointermove' this.manager.onPointerMove}}
      {{on 'pointerup' this.manager.onPointerUp}}
      {{on 'pointercancel' this.manager.onPointerCancel}}
      {{on 'lostpointercapture' this.manager.onLostPointerCapture}}
      {{on 'keydown' this.manager.onKeyDown}}
      tabindex='0'
      ...attributes
    >
      <div
        class='boxel-sr-only'
        role='status'
        aria-live='polite'
        aria-atomic='true'
      >{{this.manager.announcement}}</div>

      {{#each this.columns as |column i|}}
        {{#unless column.collapsed}}
          <div
            class={{cn
              'column'
              is-target=(this.isTargetColumn column.key)
              is-over-wip=(this.isOverWip column)
            }}
            role='group'
            aria-label={{if column.label column.label 'Untitled'}}
            style={{this.columnStyle}}
            data-kanban-column={{column.key}}
            data-kanban-column-index='{{i}}'
            data-test-column-is-over-wip={{this.isOverWip column}}
          >
            <KanbanColumnHeader
              @column={{column}}
              @cardCount={{this.columnCardCount column.key}}
              @isOverWip={{this.isOverWip column}}
              @isTarget={{this.isTargetColumn column.key}}
              @onAddCard={{if @onAddCard (fn @onAddCard column.key)}}
              @onCollapse={{if
                @onToggleCollapsed
                (fn @onToggleCollapsed column)
              }}
            />

            <div class='col-body' role='list' data-kanban-col-body>
              {{#if (this.showInsertionBox column.key)}}
                <div
                  class='insertion-box'
                  style={{this.insertionBoxStyle column.key}}
                ></div>
              {{/if}}

              {{#each (this.columnCards column.key) as |placement|}}
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

              {{#unless (this.columnCardCount column.key)}}
                <div
                  class='empty-col'
                  aria-hidden='true'
                  data-test-empty-column={{column.key}}
                >No cards</div>
              {{/unless}}
            </div>
          </div>
        {{/unless}}
      {{/each}}

      {{#if this.hiddenColumns.length}}
        <div
          class='hidden-columns-tray'
          style={{this.columnStyle}}
          data-test-hidden-columns
        >
          <div class='hidden-tray-header'>
            <span class='hidden-tray-title'>Hidden</span>
            <span
              class='hidden-tray-count'
              data-test-hidden-column-count
            >{{this.hiddenColumns.length}}</span>
          </div>
          <div class='hidden-tray-body'>
            {{#each this.hiddenColumns as |hc i|}}
              <button
                class='hidden-col-row'
                type='button'
                aria-label={{if
                  hc.config.label
                  (concat 'Show ' hc.config.label)
                  'Show column'
                }}
                {{on 'click' (fn this.restoreColumn hc.config)}}
                data-test-hidden-column-row={{i}}
              >
                <span
                  class='hidden-col-dot'
                  style={{cssVar col-dot-bg=hc.config.color}}
                ></span>
                <span class='hidden-col-label'>{{if
                    hc.config.label
                    hc.config.label
                    'Untitled'
                  }}</span>
                <span class='hidden-col-count'>{{hc.cardCount}}</span>
                <Eye class='hidden-col-restore-icon' />
              </button>
            {{/each}}
          </div>
        </div>
      {{/if}}
    </div>

    {{#if this.showGhost}}
      <KanbanGhost @style={{this.ghostStyle}} @isSettling={{this.isSettling}}>
        {{yield this.ghostIndex to='ghost'}}
      </KanbanGhost>
    {{/if}}

    <style scoped>
      .board {
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
        gap: var(--_kanban-col-gap);
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
        color: var(--_kanban-primary-fg);
        z-index: 0;
        pointer-events: none;
        transition: transform 240ms cubic-bezier(0.4, 0, 0.2, 1);
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

      .hidden-columns-tray {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-radius: var(--_kanban-radius);
        background: var(--_kanban-col-bg);
        color: var(--_kanban-col-fg);
        flex-shrink: 0;
      }

      .hidden-tray-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 0.875rem 0.5rem;
        flex-shrink: 0;
      }

      .hidden-tray-title {
        font-size: 0.8125rem;
        font-weight: 600;
        opacity: var(--_kanban-muted-opacity);
      }

      .hidden-tray-count {
        font-size: 0.75rem;
        font-weight: 500;
        padding: 0.0625rem 0.375rem;
        border-radius: 999px;
        background: color-mix(in oklch, var(--_kanban-col-fg) 10%, transparent);
        opacity: var(--_kanban-muted-opacity);
      }

      .hidden-tray-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem 0.5rem;
      }

      .hidden-col-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        border-radius: var(--_kanban-radius);
        border: none;
        background: color-mix(in oklch, var(--_kanban-col-fg) 5%, transparent);
        color: var(--_kanban-col-fg);
        font-size: 0.8125rem;
        cursor: pointer;
        text-align: left;
        transition: background 120ms ease;
      }

      .hidden-col-row:hover {
        background: color-mix(in oklch, var(--_kanban-col-fg) 10%, transparent);
      }

      .hidden-col-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--col-dot-bg, var(--_kanban-muted-fg));
      }

      .hidden-col-label {
        flex: 1;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .hidden-col-count {
        font-size: 0.75rem;
        font-weight: 500;
        opacity: var(--_kanban-muted-opacity);
        flex-shrink: 0;
      }

      .hidden-col-restore-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 120ms ease;
        color: var(--_kanban-muted-fg);
      }

      .hidden-col-row:hover .hidden-col-restore-icon {
        opacity: 1;
      }
    </style>
  </template>
}
