// Pretui — Board usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  autoPlaceKanban,
  cardsInColumn,
} from '@cardstack/boxel-ui/components';
import { FreestyleUsage } from './freestyle-usage';
import { Board } from './board';
import type { KanbanColumnConfig, KanbanPlacement } from '@cardstack/boxel-ui/components';
import type { FittedFormatId } from '@cardstack/boxel-ui/helpers';

// ── Board ← kanban/usage.gts ─────────────────────────────────────────────
// Ported knobs: cardSize (upstream's three-size view selector becomes a
// select), hideEmpty, columns/placements object rows, and all five
// callbacks live (onChange/onSelect/onOpen/onAddCard/onToggleCollapsed).
// Dropped: the KanbanColumnConfigSidebar half of the upstream page (a
// separate boxel-ui component, not part of the Board wrap) and the
// boxel-kanban-* cssVars rows (channel pinned to Pretui tokens by the
// wrapper). Column colors are instance data, not component CSS.
interface BoardCard {
  kind: string;
  title: string;
}

const BOARD_COLUMNS: KanbanColumnConfig[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    color: '#656a73',
    wipLimit: 0,
    collapsed: false,
    sortOrder: 1,
  },
  {
    key: 'in-progress',
    label: 'In Progress',
    color: '#b8860b',
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
    color: '#2e7d5b',
    wipLimit: null,
    collapsed: false,
    sortOrder: 4,
  },
];

const BOARD_CARDS: BoardCard[] = [
  { title: 'Audit drag states', kind: 'Chore' },
  { title: 'Polish column header', kind: 'Design' },
  { title: 'Document insertion flow', kind: 'Docs' },
  { title: 'Ship empty states', kind: 'Feature' },
  { title: 'Review keyboard handling', kind: 'QA' },
  { title: 'Publish examples', kind: 'Docs' },
];

const BOARD_CARD_SIZES = ['double-strip', 'regular-tile', 'compact-card'];

class BoardUsage extends Component {
  cardSizeOptions = BOARD_CARD_SIZES;
  @tracked columns: KanbanColumnConfig[] = [...BOARD_COLUMNS];
  @tracked cards: BoardCard[] = [...BOARD_CARDS];
  @tracked placements: KanbanPlacement[] = autoPlaceKanban(
    BOARD_CARDS.length,
    BOARD_COLUMNS,
  );
  @tracked cardSize = 'regular-tile';
  @tracked hideEmpty = false;
  @tracked selectedIndex: number | null = null;
  @tracked openedIndex: number | null = null;

  setCardSize = (v: string) => (this.cardSize = v);
  get cardSizeVal() {
    return this.cardSize as FittedFormatId;
  }
  setHideEmpty = (v: boolean) => {
    this.hideEmpty = v;
    this.columns = this.columns.map((col) =>
      cardsInColumn(col.key, this.placements).length === 0
        ? { ...col, collapsed: v }
        : col,
    );
  };
  handleChange = (placements: KanbanPlacement[]) => {
    this.placements = placements;
    if (this.hideEmpty) {
      this.columns = this.columns.map((col) =>
        cardsInColumn(col.key, placements).length === 0
          ? { ...col, collapsed: true }
          : col,
      );
    }
  };
  handleSelect = (index: number | null) => (this.selectedIndex = index);
  handleOpen = (index: number) => (this.openedIndex = index);
  toggleCollapsed = (col: KanbanColumnConfig | null) => {
    if (!col) {
      return;
    }
    this.columns = this.columns.map((c) =>
      c.key === col.key ? { ...c, collapsed: !c.collapsed } : c,
    );
  };
  addCard = (columnKey: string | null) => {
    let column = this.columns.find((c) => c.key === columnKey);
    let resolvedKey = column?.key ?? this.columns[0]?.key;
    if (!resolvedKey) {
      return;
    }
    let nextIndex = this.cards.length;
    let existing = cardsInColumn(resolvedKey, this.placements);
    let nextOrder = (existing[existing.length - 1]?.sortOrder ?? 0) + 1;
    this.cards = [
      ...this.cards,
      { title: `New card ${nextIndex + 1}`, kind: 'Draft' },
    ];
    this.placements = [
      ...this.placements,
      { index: nextIndex, columnId: resolvedKey, sortOrder: nextOrder },
    ];
  };
  cardAt = (index: number): BoardCard => {
    return this.cards[index] ?? { title: '', kind: '' };
  };
  get selectedCard(): BoardCard | null {
    return this.selectedIndex === null
      ? null
      : (this.cards[this.selectedIndex] ?? null);
  }
  get openedCard(): BoardCard | null {
    return this.openedIndex === null
      ? null
      : (this.cards[this.openedIndex] ?? null);
  }
  get usage() {
    let bits = [
      '@columns={{this.columns}}',
      '@placements={{this.placements}}',
      '@onChange={{this.handleChange}}',
    ];
    if (this.cardSize !== 'regular-tile')
      bits.push(`@cardSize='${this.cardSize}'`);
    if (this.hideEmpty) bits.push('@hideEmpty={{true}}');
    return `<Board ${bits.join(' ')}>\n  <:card as |placement|>…</:card>\n  <:ghost as |dragIndex|>…</:ghost>\n</Board>`;
  }
  <template>
    <FreestyleUsage
      @name='Board'
      @description="Column workflow over a record set — drag cards between configurable lanes. Wraps boxel-ui's KanbanPlane, the newer pure-fn placement engine: columns and card placements are plain data, the consumer renders cards through blocks and owns all state, and every interaction (move, select, open, add, collapse) arrives as a callback. Collapsed columns gather in a hidden-columns tray."
      @source={{this.usage}}
    >
      <:example>
        <div class='board-host'>
          {{#if this.selectedCard}}
            <p class='board-meta'>Selected: {{this.selectedCard.title}}</p>
          {{/if}}
          {{#if this.openedCard}}
            <p class='board-meta'>Opened: {{this.openedCard.title}}</p>
          {{/if}}
          <div class='board-frame'>
            <Board
              @boardLabel='Pretui board demo'
              @columns={{this.columns}}
              @placements={{this.placements}}
              @cardSize={{this.cardSizeVal}}
              @hideEmpty={{this.hideEmpty}}
              @onChange={{this.handleChange}}
              @onSelect={{this.handleSelect}}
              @onOpen={{this.handleOpen}}
              @onAddCard={{this.addCard}}
              @onToggleCollapsed={{this.toggleCollapsed}}
            >
              <:card as |placement|>
                {{#let (this.cardAt placement.index) as |card|}}
                  <div class='board-card'>
                    <span class='board-card-kind'>{{card.kind}}</span>
                    <h4 class='board-card-title'>{{card.title}}</h4>
                  </div>
                {{/let}}
              </:card>
              <:ghost as |dragIndex|>
                {{#let (this.cardAt dragIndex) as |card|}}
                  <div class='board-card'>
                    <span class='board-card-kind'>{{card.kind}}</span>
                    <h4 class='board-card-title'>{{card.title}}</h4>
                  </div>
                {{/let}}
              </:ghost>
            </Board>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @required={{true}}
          @value={{this.columns}}
          @description='KanbanColumnConfig[] — key, label, color, wipLimit, collapsed, sortOrder per lane.'
        />
        <Args.Object
          @name='placements'
          @required={{true}}
          @value={{this.placements}}
          @description='KanbanPlacement[] — maps each card index to a columnId and sortOrder. Pure data; autoPlaceKanban seeds an initial spread.'
        />
        <Args.String
          @name='cardSize'
          @defaultValue='regular-tile'
          @value={{this.cardSize}}
          @options={{this.cardSizeOptions}}
          @description='Fitted format id for card and column sizing within the plane.'
          @onInput={{this.setCardSize}}
        />
        <Args.Bool
          @name='hideEmpty'
          @defaultValue={{false}}
          @value={{this.hideEmpty}}
          @description='Moves empty columns into the hidden-columns tray alongside explicitly collapsed ones (demo also collapses them on change).'
          @onInput={{this.setHideEmpty}}
        />
        <Args.String
          @name='boardLabel'
          @description='Accessible label for the board region.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Receives the updated KanbanPlacement[] when the drag manager commits a move.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Receives the selected card index, or null when selection clears.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onOpen'
          @description='Receives a card index when a pointer interaction reads as open.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onAddCard'
          @description='Receives the target column key when a lane add-card affordance is used.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onToggleCollapsed'
          @description='Receives the KanbanColumnConfig when a column is collapsed or restored — the caller flips the collapsed flag.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='card'
          @description='Renders one card for a KanbanPlacement — look the record up by placement.index.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='ghost'
          @description='Renders the drag preview for the active card index.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .board-host {
        display: grid;
        gap: var(--space-3, 8px);
      }
      .board-meta {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .board-frame {
        height: 420px;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
        background: var(--background);
      }
      .board-card {
        height: 100%;
        display: grid;
        align-content: start;
        gap: 2px;
        padding: var(--space-4, 11px);
        overflow: hidden;
      }
      .board-card-kind {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .board-card-title {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--card-foreground);
      }
    </style>
  </template>
}

export const DEMOS_BOARD: Record<string, unknown> = {
  Board: BoardUsage,
};
