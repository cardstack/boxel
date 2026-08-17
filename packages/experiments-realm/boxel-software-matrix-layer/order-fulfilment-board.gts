import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { get } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import {
  KanbanPlane,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

// Order Fulfilment Board (OB) — a lifecycle board over any set of cards.
//
// It knows nothing about orders. The consumer supplies the columns, a function
// that says which column a card belongs in, and a function that performs the
// move. That is deliberate and it is the whole reason this is a block: a board
// that hardcoded `card.status` against a fulfilment enum could never be the
// second consumer's board.
//
// Drag mechanics, insertion points and column chrome come from boxel-ui's
// KanbanPlane. This block is the bridge between a list of cards and that
// plane's placement model, plus the two things the plane leaves open: what a
// column means, and what happens when something lands in one.

export type BoardColumn = {
  key: string;
  label: string;
  /** Consumed diluted only — never used as a text colour. */
  hue?: string;
  wipLimit?: number | null;
};

interface Signature<T> {
  Args: {
    cards: T[];
    columns: BoardColumn[];
    /** Which column does this card belong in? Returns a column key. */
    columnKeyFor: (card: T) => string | undefined;
    /** Perform the move. Returning a rejected promise leaves the card put. */
    onMove?: (card: T, columnKey: string) => Promise<unknown> | unknown;
    onOpen?: (card: T) => void;
    /** A fitted size id — the plane sizes the fitted container itself. */
    cardSize?: 'double-strip' | 'regular-tile' | 'compact-card';
    boardLabel?: string;
    hideEmpty?: boolean;
    emptyMessage?: string;
  };
  Blocks: {
    card: [T, number];
  };
  Element: HTMLElement;
}

export class OrderFulfilmentBoard<T> extends GlimmerComponent<Signature<T>> {
  // Placements are held locally so a drag lands immediately and the write
  // happens behind it. Without this the card snaps back to its old column for
  // as long as the save takes, which reads as a failed drag.
  @tracked private localPlacements: KanbanPlacement[] | undefined = undefined;
  @tracked private moving = false;

  get columnConfigs(): KanbanColumnConfig[] {
    return (this.args.columns ?? []).map((c, i) => ({
      key: c.key,
      label: c.label,
      color: c.hue ?? null,
      wipLimit: c.wipLimit ?? null,
      collapsed: false,
      sortOrder: i + 1,
    }));
  }

  get derivedPlacements(): KanbanPlacement[] {
    let byColumn = new Map<string, number>();
    let placements: KanbanPlacement[] = [];
    let fallback = this.args.columns?.[0]?.key;

    (this.args.cards ?? []).forEach((card, index) => {
      if (!card) {
        return;
      }
      let key = this.args.columnKeyFor(card) ?? fallback;
      if (!key) {
        return;
      }
      // A card whose state is not one of the board's columns is not drawn.
      // Silently dropping it into column one would misreport the pipeline.
      if (!this.args.columns.some((c) => c.key === key)) {
        return;
      }
      let next = (byColumn.get(key) ?? 0) + 1;
      byColumn.set(key, next);
      placements.push({ columnId: key, index, sortOrder: next });
    });

    return placements;
  }

  get placements(): KanbanPlacement[] {
    return this.localPlacements ?? this.derivedPlacements;
  }

  get isEmpty() {
    return this.placements.length === 0;
  }

  get counts(): Record<string, number> {
    let counts: Record<string, number> = {};
    for (let p of this.placements) {
      counts[p.columnId] = (counts[p.columnId] ?? 0) + 1;
    }
    return counts;
  }

  @action
  async handleChange(next: KanbanPlacement[]) {
    let before = new Map(this.placements.map((p) => [p.index, p.columnId]));
    this.localPlacements = next;

    let moved = next.filter((p) => before.get(p.index) !== p.columnId);
    if (!moved.length || !this.args.onMove) {
      return;
    }

    this.moving = true;
    try {
      for (let placement of moved) {
        let card = this.args.cards?.[placement.index];
        if (card) {
          await this.args.onMove(card, placement.columnId);
        }
      }
    } catch (e) {
      // The write failed, so the optimistic placement is a lie. Dropping the
      // local copy re-derives from the cards, which snaps the card back to
      // where it actually is.
      console.error('Board move failed; reverting', e);
      this.localPlacements = undefined;
    } finally {
      this.moving = false;
    }
  }

  @action
  handleOpen(index: number) {
    let card = this.args.cards?.[index];
    if (card && this.args.onOpen) {
      this.args.onOpen(card);
    }
  }

  <template>
    <div class='ofb {{if this.moving "ofb-busy"}}' ...attributes>
      {{#if this.isEmpty}}
        <p class='empty'>{{if
            @emptyMessage
            @emptyMessage
            'Nothing on the board. Cards appear here as soon as they exist.'
          }}</p>
      {{else}}
        <KanbanPlane
          class='ofb-plane'
          @boardLabel={{if @boardLabel @boardLabel 'Fulfilment board'}}
          @columns={{this.columnConfigs}}
          @placements={{this.placements}}
          @onChange={{this.handleChange}}
          @onOpen={{this.handleOpen}}
          @cardSize={{if @cardSize @cardSize 'regular-tile'}}
          @hideEmpty={{@hideEmpty}}
        >
          <:card as |placement|>
            {{#let (get @cards placement.index) as |card|}}
              {{#if card}}
                {{yield card placement.index to='card'}}
              {{/if}}
            {{/let}}
          </:card>
          <:ghost as |dragIndex|>
            {{#let (get @cards dragIndex) as |card|}}
              {{#if card}}
                {{yield card dragIndex to='card'}}
              {{/if}}
            {{/let}}
          </:ghost>
        </KanbanPlane>
      {{/if}}
    </div>

    <style scoped>
      .ofb {
        /* Adapter block: the plane's published knobs are handed the semantic
           set once, rather than fought for on specificity. */
        --board-bg: color-mix(in oklch, var(--foreground) 2%, transparent);
        --board-fg: var(--foreground);
        --board-card-bg: var(--card);
        --board-card-fg: var(--card-foreground);
        --board-border: var(--border);

        --boxel-kanban-bg: var(--board-bg);
        --boxel-kanban-card-bg: var(--board-card-bg);
        --boxel-kanban-card-fg: var(--board-card-fg);
        --boxel-kanban-border: var(--board-border);

        min-height: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .ofb-plane {
        flex: 1;
        min-height: 0;
      }
      /* A move in flight dims the board rather than blocking it: the drag has
         already landed visually, and this only says the write is still going. */
      .ofb-busy .ofb-plane {
        opacity: 0.75;
      }
      .empty {
        margin: 0;
        padding: var(--boxel-sp-lg);
        text-align: center;
        font-size: 0.9rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
    </style>
  </template>
}

export default OrderFulfilmentBoard;
