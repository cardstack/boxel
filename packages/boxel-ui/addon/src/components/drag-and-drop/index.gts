import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { and, eq } from '../../helpers/truth-helpers.ts';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

export type DndItem = Record<string, any>;

export interface DndKanbanBoardArgs<DndColumn> {
  columns: DndColumn[];
  isDisabled?: boolean;
  isLoading?: boolean;
  onMove?: (card: DndItem, column: DndColumn) => void;
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
  @tracked areModifiersLoaded = false;
  @tracked DndDraggableItemModifier: any = null;
  @tracked DndDropTargetModifier: any = null;
  @tracked DndSortableItemModifier: any = null;
  @tracked insertAfter: any;
  @tracked insertAt: any;
  @tracked insertBefore: any;
  @tracked removeItem: any;
  @tracked draggedCard: DndItem | null = null;

  constructor(owner: unknown, args: DndKanbanBoardArgs<DndColumn>) {
    super(owner, args);

    if (!isFastBoot) {
      this.loadModifiers();
    }
  }

  // Have to use dynamic imports because the modifiers are not compatible in FastBoot
  // .ie a static import will break the indexing build
  // See: https://github.com/alvarocastro/ember-draggable-modifiers/issues/1 and https://github.com/cardstack/boxel/pull/1683#discussion_r1803979937
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

  @action moveCard({
    source: {
      data: { item: draggedItem, parent: draggedItemParent },
    },
    target: {
      data: { item: dropTarget, parent: dropTargetParent },
      edge,
    },
  }: any) {
    if (dropTargetParent.cards.length === 0) {
      draggedItemParent.cards = this.removeItem(
        draggedItemParent.cards,
        draggedItem,
      );
      dropTargetParent.cards = this.insertAt(
        dropTargetParent.cards,
        0,
        draggedItem,
      );
    } else {
      if (dropTarget !== undefined) {
        draggedItemParent.cards = this.removeItem(
          draggedItemParent.cards,
          draggedItem,
        );
        if (edge === 'top') {
          dropTargetParent.cards = this.insertBefore(
            dropTargetParent.cards,
            dropTarget,
            draggedItem,
          );
        } else if (edge === 'bottom') {
          dropTargetParent.cards = this.insertAfter(
            dropTargetParent.cards,
            dropTarget,
            draggedItem,
          );
        } else {
          throw new Error('Invalid edge');
        }
      }
    }
    if (this.args.onMove) {
      this.args.onMove(draggedItem, dropTargetParent);
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

  <template>
    {{#if this.areModifiersLoaded}}
      <div class='draggable-container' {{on 'dragend' this.onDragEnd}}>
        {{#each @columns as |column|}}
          <div
            class='column'
            {{this.DndDropTargetModifier
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
                {{#if @isDisabled}}
                  <div class='draggable-card is-disabled'>
                    <div class='overlay'></div>
                    {{yield card column to='card'}}
                  </div>
                {{else}}
                  <div
                    class='draggable-card {{if @isLoading "is-loading"}}'
                    {{this.DndSortableItemModifier
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
    {{/if}}

    <style scoped>
      .draggable-container {
        display: flex;
        overflow-x: auto;
        flex-grow: 1;
        transition: transform 0.5s ease;
        height: 100vh;
      }
      .draggable-card {
        border: 2px solid var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-light);
        transition:
          all 0.3s ease,
          filter 0.3s ease;
        cursor: grab;
      }
      .draggable-card.is-dragging {
        border: 2px solid var(--boxel-highlight);
        border-radius: var(--boxel-border-radius);
        filter: brightness(0.7);
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
        z-index: 1;
      }
      .draggable-card.is-loading > .loader {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2;
      }
      .draggable-card.is-disabled {
        position: relative;
      }
      .draggable-card.is-disabled > .overlay {
        position: absolute;
        top: 0%;
        left: 0%;
        width: 100%;
        height: 100%;
        background-color: rgb(38 38 38 / 5%);
        z-index: 1;
        filter: grayscale(100%);
        cursor: not-allowed;
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
      }
      .column-drop-zone {
        position: relative;
        padding: var(--boxel-sp);
        display: grid;
        align-content: flex-start;
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
    </style>
  </template>
}
