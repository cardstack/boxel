import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import DropTargetModifier from 'ember-draggable-modifiers/modifiers/drop-target';
import SortableItemModifier from 'ember-draggable-modifiers/modifiers/sortable-item';
import {
  insertAfter,
  insertBefore,
  removeItem,
} from 'ember-draggable-modifiers/utils/array';

import { and, eq } from '../../helpers/truth-helpers.ts';

export type DndItem = Record<string, any>;

export interface DndKanbanBoardArgs<DndColumn> {
  columns: DndColumn[];
  displayCard?: (card: DndItem) => boolean;
  isLoading?: boolean;
  onMove?: (
    draggedCard: DndItem,
    targetCard: DndItem,
    sourceColumn: DndColumn,
    targetColumn: DndColumn,
  ) => void;
}

export class DndColumn {
  @tracked cards: DndItem[];
  title: string;

  constructor(title: string, cards: DndItem[] = []) {
    this.title = title;
    this.cards = cards;
  }
}

export interface DndKanbanBoardSignature<DndColumn> {
  Args: DndKanbanBoardArgs<DndColumn>;
  Blocks: {
    card: [card?: DndItem, column?: DndColumn];
    // We yield the card and column back to the consumer so they can decide how to render it or use additional information
    // This rendering by the block will typically occur at the card of the kanaban
    // but with more sophistication you can use it somewhere else
    header: [column?: DndColumn];
  };
}

export default class DndKanbanBoard extends Component<
  DndKanbanBoardSignature<DndColumn>
> {
  @tracked draggedCard: DndItem | null = null;

  @action moveCard({
    source: {
      data: { item: draggedItem, parent: draggedItemParent },
    },
    target: {
      data: { item: dropTarget, parent: dropTargetParent },
      edge,
    },
  }: any) {
    draggedItemParent.cards = removeItem(draggedItemParent.cards, draggedItem);

    if (dropTarget !== undefined) {
      if (edge === 'top') {
        dropTargetParent.cards = insertBefore(
          dropTargetParent.cards,
          dropTarget,
          draggedItem,
        );
      } else if (edge === 'bottom') {
        dropTargetParent.cards = insertAfter(
          dropTargetParent.cards,
          dropTarget,
          draggedItem,
        );
      } else {
        throw new Error('Invalid edge');
      }
    } else {
      if (dropTargetParent !== undefined) {
        // If the drop target is undefined, but the dropTargetParent is defined,  we are dropping the card into last index of the drop target of the column
        dropTargetParent.cards = [...dropTargetParent.cards, draggedItem];
      }
    }

    if (this.args.onMove) {
      this.args.onMove(
        draggedItem,
        dropTarget,
        draggedItemParent,
        dropTargetParent,
      );
    }
  }

  @action
  onDragStart(card: DndItem) {
    this.draggedCard = card;
  }

  @action
  onDragEnd() {
    this.draggedCard = null;
  }

  @action
  displayCard(card: DndItem): boolean {
    if (this.args.displayCard) {
      return this.args.displayCard(card);
    }
    return true;
  }

  <template>
    <div class='draggable-container' {{on 'dragend' this.onDragEnd}}>
      {{#each @columns as |column|}}
        <div
          class='column'
          {{DropTargetModifier
            group='cards'
            data=(hash parent=column)
            onDrop=this.moveCard
          }}
        >
          {{#if (has-block 'header')}}
            <div class='column-header'>
              {{yield column to='header'}}
            </div>
          {{/if}}

          <div class='column-drop-zone'>
            {{#each column.cards as |card|}}
              {{#if (this.displayCard card)}}
                <div
                  class='draggable-card {{if @isLoading "is-loading"}}'
                  {{SortableItemModifier
                    group='cards'
                    data=(hash item=card parent=column)
                    onDrop=this.moveCard
                    isOnTargetClass='is-on-target'
                    onDragStart=(fn this.onDragStart card)
                  }}
                >
                  {{#if (and @isLoading (eq card this.draggedCard))}}
                    <div class='overlay'></div>
                    {{yield card column to='card'}}
                    <LoadingIndicator
                      width='18'
                      height='18'
                      @color='var(--boxel-light)'
                      class='loader'
                    />
                  {{else}}
                    {{yield card column to='card'}}
                  {{/if}}
                </div>
              {{/if}}
            {{/each}}
          </div>
        </div>
      {{/each}}
    </div>

    <style scoped>
      .draggable-container {
        --draggable-overlay-z-index: 5;
        display: flex;
        overflow-x: auto;
        flex-grow: 1;
        gap: var(--dnd-container-gap, var(--boxel-sp));
        transition: transform 0.5s ease;
        height: 100%;
      }
      .draggable-card {
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-light);
        transition:
          all 0.3s ease,
          filter 0.3s ease;
        cursor: grab;
      }
      .draggable-card :where(.boundaries) {
        box-shadow: none;
      }
      .draggable-card.is-loading {
        position: relative;
      }
      .draggable-card.is-loading > .overlay {
        position: absolute;
        top: 0%;
        left: 0%;
        width: 100%;
        height: 100%;
        background-color: rgb(38 38 38 / 50%);
        z-index: var(--draggable-overlay-z-index);
        border-radius: var(--boxel-border-radius);
      }
      .draggable-card.is-loading > .loader {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: calc(var(--draggable-overlay-z-index) + 1);
      }
      .draggable-card.is-on-target {
        transform: scale(0.95);
        filter: brightness(0.7);
      }
      .draggable-card-empty {
        filter: brightness(0.7);
        border: 1px dashed var(--boxel-300);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .column {
        display: flex;
        flex-direction: column;
        flex: 0 0 var(--boxel-xs-container);
        height: 100%;
        border-radius: var(--dnd-column-border-radius, 14px);
        overflow: hidden;
        background-color: var(--dnd-drop-zone-bg, var(--boxel-200));
      }
      .column-header {
        position: sticky;
        z-index: calc(var(--draggable-overlay-z-index) +2);
        top: 0;
        background-color: var(--dnd-header-bg, transparent);
        font-weight: 600;
        padding: var(--boxel-sp-sm) var(--boxel-sp) var(--boxel-sp-xxs)
          var(--boxel-sp);
      }
      .column-drop-zone {
        position: relative;
        padding: var(--boxel-sp-xs);
        display: grid;
        align-content: flex-start;
        gap: var(--boxel-sp-xs);
        height: 100%;
        overflow-y: auto;
      }
      .column-drop-zone:has(.draggable-card.is-dragging)
        .draggable-card:not(.is-dragging) {
        filter: brightness(0.7);
      }
    </style>
  </template>
}
