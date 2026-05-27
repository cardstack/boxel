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
import {
  type KanbanColumnConfig,
  type KanbanPlacement,
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
    wipLimit: 0,
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
  @tracked cardSizeView = 'tile';
  @tracked cardSize: FittedFormatId = 'regular-tile';

  @action handlePlacementsChange(placements: KanbanPlacement[]): void {
    this.placements = placements;
  }

  @action handleSelect(index: number | null): void {
    this.selectedIndex = index;
  }

  @action handleOpen(index: number): void {
    this.openedIndex = index;
  }

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

  @action handleToggleCollapsed(
    columnKey: string | null,
    collapsed: boolean,
  ): void {
    this.columns = this.columns.map((col) =>
      col.key === columnKey ? { ...col, collapsed } : col,
    );
  }

  @action handleShowEmptyColumns(): void {
    this.hideEmpty = false;
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
    <FreestyleUsage @name="Kanban Plane">
      <:description>
        <p>
          <code>KanbanPlane</code>
          renders configurable columns, selectable cards, insertion-based drag
          and drop, and an optional add-card affordance in each lane.
        </p>
        <p>
          It owns its drag manager internally while yielding card and ghost
          blocks so callers can customize rendering without taking over the
          interaction layer.
        </p>
        <p>
          Columns can be collapsed via the hide button in their header. Hidden
          columns (collapsed or empty when
          <code>hideEmpty</code>
          is on) are collected into a
          <strong>Hidden Columns</strong>
          tray on the right side of the board. Clicking a row in the tray
          restores that column.
        </p>
      </:description>
      <:example>
        <div class="kanban-usage">
          <div class="kanban-usage-toolbar">
            <label class="kanban-toggle">
              <span class="kanban-toggle-label">Hide empty columns</span>
              <Switch
                @label="Hide empty columns"
                @isEnabled={{this.hideEmpty}}
                @onChange={{this.toggleHideEmpty}}
              />
            </label>
            <ViewSelector
              class="kanban-size-picker"
              @items={{this.sizeViewOptions}}
              @selectedId={{this.cardSizeView}}
              @onChange={{this.updateCardSizeView}}
            />
            {{#if this.selectedCard}}
              <span class="kanban-meta">
                Selected:
                {{this.selectedCard.title}}
              </span>
            {{/if}}
            {{#if this.openedCard}}
              <span class="kanban-meta">
                Opened:
                {{this.openedCard.title}}
              </span>
            {{/if}}
          </div>

          <div class="kanban-plane-demo">
            <KanbanPlane
              @columns={{this.columns}}
              @placements={{this.placements}}
              @onChange={{this.handlePlacementsChange}}
              @onSelect={{this.handleSelect}}
              @onOpen={{this.handleOpen}}
              @cardSize={{this.cardSize}}
              @hideEmpty={{this.hideEmpty}}
              @onAddCard={{this.addCard}}
              @onToggleCollapsed={{this.handleToggleCollapsed}}
              @onShowEmptyColumns={{this.handleShowEmptyColumns}}
            >
              <:card as |placement|>
                {{#let (get this.cards placement.index) as |card|}}
                  <CardContainer class="demo-card">
                    <div class="demo-card-kind">{{card.kind}}</div>
                    <h3>{{card.title}}</h3>
                  </CardContainer>
                {{/let}}
              </:card>
              <:ghost as |dragIndex|>
                {{#let (get this.cards dragIndex) as |card|}}
                  <CardContainer class="demo-card demo-card--ghost">
                    <div class="demo-card-kind">{{card.kind}}</div>
                    <h3>{{card.title}}</h3>
                  </CardContainer>
                {{/let}}
              </:ghost>
            </KanbanPlane>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name="columns"
          @description="Column definitions including key, label, color, WIP limit, collapse state, and sort order."
          @required={{true}}
          @value={{this.columns}}
        />
        <Args.Object
          @name="placements"
          @description="Card placement records that map each card index to a column and sort order."
          @required={{true}}
          @value={{this.placements}}
        />
        <Args.String
          @name="cardSize"
          @description="Fitted card size id used for the card wrapper and for column sizing within the kanban plane."
          @options={{this.fittedFormats}}
          @value={{this.cardSize}}
          @onInput={{fn (mut this.cardSize)}}
          @defaultValue="regular-tile"
        />
        <Args.Bool
          @name="hideEmpty"
          @description="When true, empty columns are moved to the Hidden Columns tray on the right alongside any explicitly collapsed columns."
          @value={{this.hideEmpty}}
          @onInput={{fn (mut this.hideEmpty)}}
        />
        <Args.Action
          @name="onChange"
          @description="Invoked with updated placements when the internally owned drag manager commits a move."
        />
        <Args.Action
          @name="onToggleCollapsed"
          @description="Invoked with the column key when a column is collapsed via its header button or restored from the Hidden Columns tray."
        />
        <Args.Action
          @name="onShowEmptyColumns"
          @description="Invoked when the user clicks restore on an empty column in the Hidden Columns tray. Should disable the hideEmpty flag so the column becomes visible again."
        />
        <Args.Action
          @name="onOpen"
          @description="Invoked with a card index when the internally owned drag manager treats a pointer interaction as open."
        />
        <Args.Action
          @name="onSelect"
          @description="Invoked with the selected card index, or null when selection clears, for the internally owned drag manager."
        />
        <Args.Action
          @name="onAddCard"
          @description="Optional callback invoked with the target column key when the add-card affordance is used."
        />
        <Args.Yield
          @name="placement"
          @description="Yielded to the card block so callers can render card content for a specific placement."
        />
        <Args.Yield
          @name="dragIndex"
          @description="Yielded to the ghost block so callers can render drag preview content for the active card index."
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
        margin-left: 1rem;
        display: inline-flex;
        --boxel-view-option-group-column-gap: var(--boxel-sp-xs);
      }
      .kanban-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .kanban-toggle-label {
        font-weight: 500;
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
          var(--boxel-50, #f8fafc),
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
    </style>
  </template>
}
