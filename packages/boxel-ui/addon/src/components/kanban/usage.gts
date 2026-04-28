import { fn, get } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type FittedFormatId, fittedFormatById } from '../../helpers.ts';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as RowsIcon,
} from '../../icons.gts';
import CardContainer from '../card-container/index.gts';
import Switch from '../switch/index.gts';
import type { ViewItem } from '../view-selector/index.gts';
import ViewSelector from '../view-selector/index.gts';
import { KanbanColumnHeader } from './column-header.gts';
import { KanbanDragManager } from './drag.gts';
import {
  type KanbanColumnConfig,
  autoPlaceKanban,
  cardsInColumn,
} from './engine.ts';
import { KanbanPlane } from './plane.gts';

interface DemoCard {
  kind: string;
  title: string;
}

const INITIAL_COLUMNS: KanbanColumnConfig[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    color: '#64748b',
    wipLimit: null,
    collapsed: false,
    sortOrder: 1,
  },
  {
    key: 'in-progress',
    label: 'In Progress',
    color: '#d97706',
    wipLimit: 2,
    collapsed: false,
    sortOrder: 2,
  },
  {
    key: 'review',
    label: 'Review',
    color: '#0f766e',
    wipLimit: 1,
    collapsed: false,
    sortOrder: 3,
  },
  {
    key: 'done',
    label: 'Done',
    color: '#15803d',
    wipLimit: null,
    collapsed: false,
    sortOrder: 4,
  },
];

const INITIAL_CARDS: DemoCard[] = [
  { title: 'Audit drag states', kind: 'Chore' },
  { title: 'Polish column header', kind: 'Design' },
  { title: 'Document insertion flow', kind: 'Docs' },
  { title: 'Ship empty states', kind: 'Feature' },
  { title: 'Review keyboard handling', kind: 'QA' },
  { title: 'Publish examples', kind: 'Docs' },
];

const KANBAN_CARD_SIZE_OPTIONS: FittedFormatId[] = [
  'double-strip',
  'regular-tile',
  'compact-card',
];

const KANBAN_VIEW_OPTIONS: ViewItem[] = [
  { id: 'tile', icon: GridIcon },
  { id: 'strip', icon: RowsIcon },
  { id: 'card', icon: CardIcon },
];

const KANBAN_VIEW_TO_SIZE: Record<string, FittedFormatId> = {
  card: 'compact-card',
  strip: 'double-strip',
  tile: 'regular-tile',
};

export default class KanbanUsage extends Component {
  fittedFormats = KANBAN_CARD_SIZE_OPTIONS;
  sizeViewOptions = KANBAN_VIEW_OPTIONS;
  @tracked columns = INITIAL_COLUMNS;
  @tracked cards = INITIAL_CARDS;
  @tracked placements = autoPlaceKanban(INITIAL_CARDS.length, 4);
  @tracked hideEmpty = false;
  @tracked selectedIndex: number | null = null;
  @tracked openedIndex: number | null = null;
  @tracked cardSizeView = 'grid';
  @tracked cardSize: FittedFormatId = 'regular-tile';

  manager = new KanbanDragManager({
    placements: () => this.placements,
    columnCount: () => this.columns.length,
    containerElement: () => null,
    onChange: (placements) => {
      this.placements = placements;
    },
    onSelect: (index) => {
      this.selectedIndex = index;
    },
    onOpen: (index) => {
      this.openedIndex = index;
    },
  });

  get selectedCard(): DemoCard | null {
    if (this.selectedIndex === null) {
      return null;
    }
    return this.cards[this.selectedIndex] ?? null;
  }

  get openedCard(): DemoCard | null {
    if (this.openedIndex === null) {
      return null;
    }
    return this.cards[this.openedIndex] ?? null;
  }

  get secondColumn(): KanbanColumnConfig {
    return this.columns[1] ?? this.columns[0]!;
  }

  formatTitle(size: FittedFormatId) {
    return fittedFormatById.get(size)?.title ?? size;
  }

  @action updateCardSizeView(view: string): void {
    this.cardSizeView = view;
    this.cardSize = KANBAN_VIEW_TO_SIZE[view] ?? 'regular-tile';
  }

  @action toggleHideEmpty(): void {
    this.hideEmpty = !this.hideEmpty;
  }

  @action addCard(columnKey: string | null): void {
    let nextIndex = this.cards.length;
    let columnIndex = this.columns.findIndex(
      (column) => column.key === columnKey,
    );
    let resolvedColumnIndex = columnIndex === -1 ? 0 : columnIndex;
    let existingCards = cardsInColumn(resolvedColumnIndex, this.placements);
    let nextOrder =
      (existingCards[existingCards.length - 1]?.sortOrder ?? 0) + 1;

    this.cards = [
      ...this.cards,
      {
        title: `New card ${nextIndex + 1}`,
        kind: 'Draft',
      },
    ];
    this.placements = [
      ...this.placements,
      {
        index: nextIndex,
        column: resolvedColumnIndex,
        sortOrder: nextOrder,
      },
    ];
  }

  <template>
    <FreestyleUsage @name='Kanban Plane'>
      <:description>
        <p>
          <code>KanbanPlane</code>
          renders configurable columns, selectable cards, insertion-based drag
          and drop, and an optional add-card affordance in each lane.
        </p>
        <p>
          Pass a
          <code>KanbanDragManager</code>
          to coordinate pointer interactions and render your own card and ghost
          content through yielded blocks.
        </p>
      </:description>
      <:example>
        <div class='kanban-usage'>
          <div class='kanban-usage-toolbar'>
            <label class='kanban-toggle'>
              <Switch
                @label='Hide empty columns'
                @isEnabled={{this.hideEmpty}}
                @onChange={{this.toggleHideEmpty}}
              />
              <span class='kanban-toggle-label'>Hide empty columns</span>
            </label>
            <ViewSelector
              class='kanban-size-picker'
              @items={{this.sizeViewOptions}}
              @selectedId={{this.cardSizeView}}
              @onChange={{this.updateCardSizeView}}
            />
            {{#if this.selectedCard}}
              <span class='kanban-meta'>
                Selected:
                {{this.selectedCard.title}}
              </span>
            {{/if}}
            {{#if this.openedCard}}
              <span class='kanban-meta'>
                Opened:
                {{this.openedCard.title}}
              </span>
            {{/if}}
          </div>

          <div class='kanban-plane-demo'>
            <KanbanPlane
              @columns={{this.columns}}
              @placements={{this.placements}}
              @manager={{this.manager}}
              @interactive={{true}}
              @cardSize={{this.cardSize}}
              @hideEmpty={{this.hideEmpty}}
              @onAddCard={{this.addCard}}
            >
              <:card as |placement|>
                {{#let (get this.cards placement.index) as |card|}}
                  <CardContainer class='demo-card'>
                    <div class='demo-card-kind'>{{card.kind}}</div>
                    <div class='demo-card-title'>{{card.title}}</div>
                  </CardContainer>
                {{/let}}
              </:card>
              <:ghost as |dragIndex|>
                {{#let (get this.cards dragIndex) as |card|}}
                  <CardContainer class='demo-card demo-card--ghost'>
                    <div class='demo-card-kind'>{{card.kind}}</div>
                    <div class='demo-card-title'>{{card.title}}</div>
                  </CardContainer>
                {{/let}}
              </:ghost>
            </KanbanPlane>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='columns'
          @description='Column definitions including key, label, color, WIP limit, collapse state, and sort order.'
          @required={{true}}
          @items={{this.columns}}
        />
        <Args.Array
          @name='placements'
          @description='Card placement records that map each card index to a column and sort order.'
          @required={{true}}
          @items={{this.placements}}
        />
        <Args.Object
          @name='manager'
          @description='A KanbanDragManager instance that owns drag, selection, and open behavior.'
          @required={{true}}
        />
        <Args.Bool
          @name='interactive'
          @description='Enables interactive keyboard and pointer behavior for drag and selection.'
          @value={{true}}
          @defaultValue={{true}}
        />
        <Args.String
          @name='cardSize'
          @description='Fitted card size id used for the card wrapper and for column sizing within the kanban plane.'
          @options={{this.fittedFormats}}
          @value={{this.cardSize}}
          @onInput={{fn (mut this.cardSize)}}
          @defaultValue='regular-tile'
        />
        <Args.Bool
          @name='hideEmpty'
          @description='When true, collapsed columns and empty visible columns are omitted from the plane.'
          @value={{this.hideEmpty}}
          @onInput={{fn (mut this.hideEmpty)}}
        />
        <Args.Action
          @name='onAddCard'
          @description='Optional callback invoked with the target column key when the add-card affordance is used.'
        />
        <Args.Yield
          @name='placement'
          @description='Yielded to the card block so callers can render card content for a specific placement.'
        />
        <Args.Yield
          @name='dragIndex'
          @description='Yielded to the ghost block so callers can render drag preview content for the active card index.'
        />
      </:api>
    </FreestyleUsage>

    <FreestyleUsage @name='Kanban Column Header'>
      <:description>
        Use
        <code>KanbanColumnHeader</code>
        when you need the standalone lane header outside the full plane, for
        previews or custom layouts.
      </:description>
      <:example>
        <div class='header-demo'>
          <KanbanColumnHeader
            @column={{this.secondColumn}}
            @cardCount={{3}}
            @isOverWip={{true}}
            @isTarget={{false}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='column'
          @description='Single KanbanColumnConfig object used to render label, color, and WIP information.'
          @required={{true}}
        />
        <Args.Number
          @name='cardCount'
          @description='Number of cards currently shown in the lane.'
          @required={{true}}
          @value={{3}}
        />
        <Args.Bool
          @name='isOverWip'
          @description='Highlights the WIP badge when the current count exceeds the configured limit.'
          @value={{true}}
        />
        <Args.Bool
          @name='isTarget'
          @description='Applies target styling while a drag insertion is hovering over the lane.'
          @value={{false}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .kanban-usage {
        display: grid;
        gap: var(--boxel-sp);
      }
      .kanban-usage-toolbar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .kanban-size-picker {
        display: inline-flex;
        --boxel-view-option-group-column-gap: var(--boxel-sp-xs);
      }
      .kanban-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .kanban-toggle-label {
        font-size: 0.8125rem;
        color: var(--foreground, var(--boxel-dark));
      }
      .kanban-meta {
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .kanban-plane-demo {
        height: 34rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 0.75rem;
        overflow: hidden;
        background: linear-gradient(
          180deg,
          var(--boxel-050, #f8fafc),
          var(--boxel-100, #f1f5f9)
        );
      }
      .demo-card {
        display: grid;
        align-content: start;
        gap: 0.375rem;
        height: 100%;
        padding: 0.875rem;
        box-sizing: border-box;
      }
      .demo-card-kind {
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .demo-card-title {
        font-size: 0.875rem;
        font-weight: 600;
        line-height: 1.4;
        color: var(--foreground, var(--boxel-dark));
      }
      .demo-card--ghost {
        background: color-mix(
          in oklch,
          var(--boxel-light, white) 92%,
          var(--boxel-dark, black)
        );
      }
      .header-demo {
        width: 18rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 0.75rem;
        background: var(--sidebar, var(--boxel-100));
      }
    </style>
  </template>
}
