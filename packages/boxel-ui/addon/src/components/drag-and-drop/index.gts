import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

//Dnd Kanban Board
export interface ColumnHeaderArgs {
  title?: string;
}

export interface DndKanbanBoardArgs<Column> {
  columnHeader?: ComponentLike<ColumnHeaderArgs>;
  columns: Column[];
}

export interface DndKanbanBoardSignature<Column> {
  Args: DndKanbanBoardArgs<Column>;
  Blocks: {
    default: [card: Card, column: Column];
  };
}

export class Card {
  [key: string]: any;

  constructor(...args: any[]) {
    if (args.length === 1 && typeof args[0] === 'object') {
      Object.assign(this, args[0]);
    }
  }
}

export class Column {
  @tracked title: string;
  @tracked cards: Card[];

  constructor(title: string, cards: Card[] = []) {
    this.title = title;
    this.cards = cards;
  }
}

export default class DndKanbanBoard extends Component<
  DndKanbanBoardSignature<Column>
> {
  @tracked areModifiersLoaded = false;
  @tracked DndDraggableItemModifier: any = null;
  @tracked DndDropTargetModifier: any = null;
  @tracked DndSortableItemModifier: any = null;
  @tracked insertAfter: any;
  @tracked insertAt: any;
  @tracked insertBefore: any;
  @tracked removeItem: any;
  @tracked columns: Column[] = this.args.columns;
  @tracked hoveredColumnIndex: number | null = null;

  constructor(owner: unknown, args: DndKanbanBoardArgs<Column>) {
    super(owner, args);

    if (!isFastBoot) {
      this.loadModifiers();
    }
  }

  async loadModifiers() {
    // @ts-expect-error Dynamic imports are only supported when the '--module' flag is set to 'es2020', 'es2022', 'esnext', 'commonjs', 'amd', 'system', 'umd', 'node16', or 'nodenext'
    const DndDraggableItemModifier = await import(
      'ember-draggable-modifiers/modifiers/draggable-item'
    );

    // @ts-expect-error Dynamic imports are only supported when the '--module' flag is set to 'es2020', 'es2022', 'esnext', 'commonjs', 'amd', 'system', 'umd', 'node16', or 'nodenext'
    const DndDropTargetModifier = await import(
      'ember-draggable-modifiers/modifiers/drop-target'
    );

    // @ts-expect-error Dynamic imports are only supported when the '--module' flag is set to 'es2020', 'es2022', 'esnext', 'commonjs', 'amd', 'system', 'umd', 'node16', or 'nodenext'
    const DndSortableItemModifier = await import(
      'ember-draggable-modifiers/modifiers/sortable-item'
    );
    // @ts-expect-error Dynamic imports are only supported when the '--module' flag is set to 'es2020', 'es2022', 'esnext', 'commonjs', 'amd', 'system', 'umd', 'node16', or 'nodenext'
    const arrayUtils = await import('ember-draggable-modifiers/utils/array');

    this.DndDraggableItemModifier = DndDraggableItemModifier.default;
    this.DndDropTargetModifier = DndDropTargetModifier.default;
    this.DndSortableItemModifier = DndSortableItemModifier.default;
    this.insertAfter = arrayUtils.insertAfter;
    this.insertAt = arrayUtils.insertAt;
    this.insertBefore = arrayUtils.insertBefore;
    this.removeItem = arrayUtils.removeItem;

    this.areModifiersLoaded = true;
  }

  get isDropZoneTargeted() {
    return (columnIndex: number) => this.hoveredColumnIndex === columnIndex;
  }

  @action onColumnDragEnter(columnIndex: number) {
    this.hoveredColumnIndex = columnIndex;
  }

  @action onColumnDragLeave() {
    this.hoveredColumnIndex = null;
  }

  @action clearHoveredState() {
    this.hoveredColumnIndex = null;
  }

  @action moveColumn({
    source: { data: draggedItem },
    target: { data: dropTarget, edge },
  }: any) {
    this.columns = this.removeItem(this.columns, draggedItem);

    if (edge === 'left') {
      this.columns = this.insertBefore(this.columns, dropTarget, draggedItem);
    } else {
      this.columns = this.insertAfter(this.columns, dropTarget, draggedItem);
    }
  }

  @action moveCard({
    source: {
      data: { item: draggedItem, parent: draggedItemParent },
    },
    target: {
      data: { item: dropTarget, parent: dropTargetParent },
      edge,
    },
  }: any) {
    draggedItemParent.cards = this.removeItem(
      draggedItemParent.cards,
      draggedItem,
    );

    if (!dropTarget) {
      dropTargetParent.cards = this.insertAt(
        dropTargetParent.cards,
        0,
        draggedItem,
      );
    } else if (edge === 'top') {
      dropTargetParent.cards = this.insertBefore(
        dropTargetParent.cards,
        dropTarget,
        draggedItem,
      );
    } else {
      dropTargetParent.cards = this.insertAfter(
        dropTargetParent.cards,
        dropTarget,
        draggedItem,
      );
    }

    this.clearHoveredState();
  }

  <template>
    {{#if this.areModifiersLoaded}}
      <div class='draggable-container' {{on 'dragend' this.clearHoveredState}}>
        {{#each this.columns as |column columnIndex|}}
          <div
            class='column'
            {{this.DndDropTargetModifier
              group='cards'
              data=(hash parent=column)
              onDrop=this.moveCard
              onDragEnter=(fn this.onColumnDragEnter columnIndex)
              onDragLeave=this.onColumnDragLeave
            }}
          >
            <div class='column-header'>
              {{#if @columnHeader}}
                <@columnHeader @title={{column.title}} />
              {{else}}
                {{column.title}}
              {{/if}}
            </div>

            <div
              class='column-drop-zone
                {{if (this.isDropZoneTargeted columnIndex) "is-hovered"}}'
            >
              {{#if (this.isDropZoneTargeted columnIndex)}}
                <div class='column-drop-zone-overlay'>
                  Board ordered by Priority
                </div>
              {{/if}}

              {{#each column.cards as |card|}}
                <div
                  class='draggable-card'
                  {{this.DndSortableItemModifier
                    group='cards'
                    data=(hash item=card parent=column)
                    onDrop=this.moveCard
                    isOnTargetClass='is-on-target'
                  }}
                >
                  {{yield card column}}
                </div>
              {{/each}}
            </div>
          </div>
        {{/each}}
      </div>
    {{else}}
      <div class='draggable-container' {{on 'dragend' this.clearHoveredState}}>
        {{#each this.columns as |column|}}
          <div class='column'>
            <div class='column-header'>
              {{#if @columnHeader}}
                <@columnHeader @title={{column.title}} />
              {{else}}
                {{column.title}}
              {{/if}}
            </div>

            <div class='column-drop-zone'>
              {{#each column.cards as |card|}}
                <div class='draggable-card'>
                  {{yield card column}}
                </div>
              {{/each}}
            </div>
          </div>
        {{/each}}
      </div>
    {{/if}}

    <style scoped>
      .draggable-container {
        display: flex;
        overflow-x: auto;
        flex-grow: 1;
        padding: var(--boxel-sp);
        transition: transform 0.5s ease;
        height: 100vh;
      }
      .draggable-card {
        padding: var(--boxel-sp);
        border: 2px solid var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-light);
        height: auto;
        overflow: hidden;
        transition:
          all 0.3s ease,
          filter 0.3s ease;
      }
      .draggable-card.is-dragging {
        border: 2px solid var(--boxel-highlight);
        border-radius: var(--boxel-border-radius);
        filter: brightness(0.7);
      }
      .draggable-card.is-on-target {
        transform: scale(0.95);
        filter: brightness(0.7);
      }
      .draggable-card-empty {
        filter: brightness(0.7);
        border: 1px dashed var(--boxel-200);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .column {
        display: flex;
        flex-direction: column;
        flex: 0 0 var(--boxel-xs-container);
        border-right: var(--boxel-border);
        height: 100%;
        transition: background-color 0.3s ease;
      }
      .column-header {
        position: sticky;
        top: 0;
        background-color: var(--dnd-kanban-header-bg, var(--boxel-100));
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        font: var(--boxel-font-sm);
      }
      .column-drop-zone {
        position: relative;
        padding: var(--boxel-sp);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        height: 100%;
        background-color: var(--dnd-kanban-drop-zone-bg, var(--boxel-600));
        z-index: 0;
        overflow-y: auto;
      }
      .column-drop-zone:has(.draggable-card.is-dragging)
        .draggable-card:not(.is-dragging) {
        filter: brightness(0.7);
      }
      .column-drop-zone.is-hovered {
        filter: brightness(0.7);
      }
      .column-drop-zone-overlay {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        z-index: 1;
        background-color: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px);
        background-blend-mode: darken;
        display: flex;
        justify-content: center;
        align-items: center;
        color: var(--boxel-200);
        width: 100%;
        height: 100%;
      }
      .column-data {
        flex-grow: 1;
        overflow-y: auto;
      }
    </style>
  </template>
}
