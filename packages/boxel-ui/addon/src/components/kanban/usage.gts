import { fn, get } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type FittedFormatId, cn, fittedFormatById } from '../../helpers.ts';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as RowsIcon,
} from '../../icons.gts';
import CardContainer from '../card-container/index.gts';
import Switch from '../switch/index.gts';
import type { ViewItem } from '../view-selector/index.gts';
import ViewSelector from '../view-selector/index.gts';
import { KanbanColumnConfigSidebar } from './column-config-sidebar.gts';
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
  @tracked columns: KanbanColumnConfig[] = [...INITIAL_COLUMNS];
  @tracked cards = INITIAL_CARDS;
  @tracked placements = autoPlaceKanban(INITIAL_CARDS.length, INITIAL_COLUMNS);
  @tracked selectedIndex: number | null = null;
  @tracked openedIndex: number | null = null;
  @tracked cardSizeView = 'tile';
  @tracked cardSize: FittedFormatId = 'regular-tile';
  @tracked showSidebar = true;

  @action handlePlacementsChange(placements: KanbanPlacement[]): void {
    this.placements = placements;
    if (this.hideEmpty) {
      this.columns = this.columns.map((col) =>
        cardsInColumn(col.key, placements).length === 0
          ? { ...col, collapsed: true }
          : col,
      );
    }
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

  formatTitle(size: FittedFormatId) {
    return fittedFormatById.get(size)?.title ?? size;
  }

  @action updateCardSizeView(view: string): void {
    this.cardSizeView = view;
    this.cardSize = KANBAN_VIEW_TO_SIZE[view] ?? 'regular-tile';
  }

  @action toggleHideEmpty(): void {
    let next = !this.hideEmpty;
    this.hideEmpty = next;
    this.columns = this.columns.map((col) =>
      cardsInColumn(col.key, this.placements).length === 0
        ? { ...col, collapsed: next }
        : col,
    );
  }

  @action toggleCollapsed(col: KanbanColumnConfig | null): void {
    if (!col) return;
    this.columns = this.columns.map((c) =>
      c.key === col.key ? { ...c, collapsed: !c.collapsed } : c,
    );
  }

  @action onLabelChange(col: KanbanColumnConfig | null, val: string): void {
    if (!col) return;
    this.columns = this.columns.map((c) =>
      c.key === col.key ? { ...c, label: val } : c,
    );
  }

  @action onColorChange(col: KanbanColumnConfig | null, val: string): void {
    if (!col) return;
    this.columns = this.columns.map((c) =>
      c.key === col.key ? { ...c, color: val } : c,
    );
  }

  @action onWipLimitChange(col: KanbanColumnConfig | null, val: string): void {
    if (!col) return;
    let raw = parseInt(val, 10);
    let wipLimit = isNaN(raw) || raw < 0 ? 0 : raw;
    this.columns = this.columns.map((c) =>
      c.key === col.key ? { ...c, wipLimit } : c,
    );
  }

  @action onReorder(newColumns: KanbanColumnConfig[]): void {
    this.columns = newColumns;
  }

  @action toggleSidebar(): void {
    this.showSidebar = !this.showSidebar;
  }

  @action addCard(columnKey: string | null): void {
    let nextIndex = this.cards.length;
    let column = this.columns.find(
      (c: KanbanColumnConfig) => c.key === columnKey,
    );
    let resolvedColumnKey = column?.key ?? this.columns[0]?.key;
    if (!resolvedColumnKey) {
      console.error(`Kanban column for key '${columnKey}' could not be found.`);
      return;
    }
    let existingCards = cardsInColumn(resolvedColumnKey, this.placements);
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
        columnId: resolvedColumnKey,
        sortOrder: nextOrder,
      },
    ];
  }

  @tracked hideEmpty = false;

  get columnCardCounts(): Record<string, number> {
    let counts: Record<string, number> = {};
    for (let col of this.columns) {
      counts[col.key] = cardsInColumn(col.key, this.placements).length;
    }
    return counts;
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
          It owns its drag manager internally while yielding card and ghost
          blocks so callers can customize rendering without taking over the
          interaction layer.
        </p>
        <p>
          Columns can be collapsed via the hide button in their header.
          Collapsed columns are collected into a
          <strong>Hidden Columns</strong>
          tray on the right side of the board. Clicking a row in the tray
          restores that column. To hide empty columns, set
          <code>collapsed: true</code>
          on those columns — the example toolbar demonstrates this pattern.
        </p>
      </:description>
      <:example>
        <div class='kanban-usage'>
          <div class='kanban-usage-toolbar'>
            <ViewSelector
              class='kanban-size-picker'
              @items={{this.sizeViewOptions}}
              @selectedId={{this.cardSizeView}}
              @onChange={{this.updateCardSizeView}}
            />
            <label class='kanban-toggle'>
              <span class='kanban-toggle-label'>Show sidebar</span>
              <Switch
                @label='Toggle column config sidebar'
                @isEnabled={{this.showSidebar}}
                @onChange={{this.toggleSidebar}}
              />
            </label>
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
              class='demo-plane'
              @boardLabel='Kanban plane demo'
              @columns={{this.columns}}
              @placements={{this.placements}}
              @onChange={{this.handlePlacementsChange}}
              @onSelect={{this.handleSelect}}
              @onOpen={{this.handleOpen}}
              @cardSize={{this.cardSize}}
              @onAddCard={{this.addCard}}
              @onToggleCollapsed={{this.toggleCollapsed}}
              @hideEmpty={{this.hideEmpty}}
            >
              <:card as |placement|>
                {{#let (get this.cards placement.index) as |card|}}
                  <CardContainer class='demo-card'>
                    <div class='demo-card-kind'>{{card.kind}}</div>
                    <h3>{{card.title}}</h3>
                  </CardContainer>
                {{/let}}
              </:card>
              <:ghost as |dragIndex|>
                {{#let (get this.cards dragIndex) as |card|}}
                  <CardContainer class='demo-card demo-card--ghost'>
                    <div class='demo-card-kind'>{{card.kind}}</div>
                    <h3>{{card.title}}</h3>
                  </CardContainer>
                {{/let}}
              </:ghost>
            </KanbanPlane>
            <div class={{cn 'demo-sidebar-wrap' is-open=this.showSidebar}}>
              <KanbanColumnConfigSidebar
                @columns={{this.columns}}
                @cardCounts={{this.columnCardCounts}}
                @hideEmpty={{this.hideEmpty}}
                @onClose={{this.toggleSidebar}}
                @onHideEmptyChange={{this.toggleHideEmpty}}
                @onToggleCollapsed={{this.toggleCollapsed}}
                @onLabelChange={{this.onLabelChange}}
                @onColorChange={{this.onColorChange}}
                @onWipLimitChange={{this.onWipLimitChange}}
                @onReorder={{this.onReorder}}
              />
            </div>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @description='Column definitions including key, label, color, WIP limit, and collapse state.'
          @required={{true}}
          @value={{this.columns}}
        />
        <Args.Object
          @name='placements'
          @description='Card placement records that map each card index to a column and sort order.'
          @required={{true}}
          @value={{this.placements}}
        />
        <Args.String
          @name='cardSize'
          @description='Fitted card size id used for the card wrapper and for column sizing within the kanban plane.'
          @options={{this.fittedFormats}}
          @value={{this.cardSize}}
          @onInput={{fn (mut this.cardSize)}}
          @defaultValue='regular-tile'
        />
        <Args.Action
          @name='onChange'
          @description='Invoked with updated placements when the internally owned drag manager commits a move.'
        />
        <Args.Bool
          @name='hideEmpty'
          @description='When true, empty columns are moved to the Hidden Columns tray on the right alongside any explicitly collapsed columns.'
          @value={{this.hideEmpty}}
          @onInput={{fn (mut this.hideEmpty)}}
        />
        <Args.Action
          @name='onToggleCollapsed'
          @description='Invoked with the KanbanColumnConfig object when a column is collapsed via its header button or restored from the Hidden Columns tray. The caller is responsible for toggling the collapsed state on that column.'
        />
        <Args.Action
          @name='onOpen'
          @description='Invoked with a card index when the internally owned drag manager treats a pointer interaction as open.'
        />
        <Args.Action
          @name='onSelect'
          @description='Invoked with the selected card index, or null when selection clears, for the internally owned drag manager.'
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

    <FreestyleUsage @name='Kanban Column Config Sidebar'>
      <:description>
        <p>
          <code>KanbanColumnConfigSidebar</code>
          renders a panel where users can rename columns, change their color,
          set a WIP limit (max cards), reorder them with up/down controls, and
          toggle individual column visibility.
        </p>
        <p>
          All changes flow back to the caller via action callbacks — the
          component never mutates its arguments. Reordering builds a new sorted
          array and delivers it via
          <code>@onReorder</code>; label, color, WIP limit, and visibility
          changes are delivered via their respective callbacks with the target
          column and new value.
        </p>
      </:description>
      <:example>
        <KanbanColumnConfigSidebar
          @columns={{this.columns}}
          @cardCounts={{this.columnCardCounts}}
          @hideEmpty={{this.hideEmpty}}
          @onClose={{this.toggleSidebar}}
          @onHideEmptyChange={{this.toggleHideEmpty}}
          @onToggleCollapsed={{this.toggleCollapsed}}
          @onLabelChange={{this.onLabelChange}}
          @onColorChange={{this.onColorChange}}
          @onWipLimitChange={{this.onWipLimitChange}}
          @onReorder={{this.onReorder}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @description='Array of KanbanColumnConfig objects to display and edit.'
          @required={{true}}
          @value={{this.columns}}
        />
        <Args.Bool
          @name='hideEmpty'
          @description='When true, the Hide empty columns switch is toggled on.'
          @value={{this.hideEmpty}}
          @onInput={{fn (mut this.hideEmpty)}}
        />
        <Args.Action
          @name='onHideEmptyChange'
          @description='Invoked when the Hide empty columns switch is toggled. If omitted the switch is hidden.'
        />
        <Args.Action
          @name='onClose'
          @description='Optional callback invoked when the close button is clicked. If omitted the close button is hidden.'
        />
        <Args.Action
          @name='onToggleCollapsed'
          @description='Optional callback invoked with the column when its visibility toggle is clicked.'
        />
        <Args.Action
          @name='onLabelChange'
          @description='Optional callback invoked with the column and new label string when the label input changes.'
        />
        <Args.Action
          @name='onColorChange'
          @description='Optional callback invoked with the column and new color hex string when the color picker changes.'
        />
        <Args.Action
          @name='onWipLimitChange'
          @description='Optional callback invoked with the column and new value string when the WIP limit input changes.'
        />
        <Args.Action
          @name='onReorder'
          @description='Optional callback invoked with the full reordered KanbanColumnConfig[] after a column is moved up or down. The caller is responsible for applying the new order to its own state.'
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
        display: flex;
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
      .demo-plane {
        flex: 1;
        min-width: 0;
      }
      .demo-sidebar-wrap {
        flex-shrink: 0;
        width: 0;
        overflow: hidden;
        transition: width var(--boxel-transition);
      }
      .demo-sidebar-wrap.is-open {
        width: 19rem;
      }
    </style>
  </template>
}
