// Pretui — CardPills: the cards a call found or touched, as pills or a grid, that open, select and fold.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { VisuallyHidden } from './visually-hidden';

export interface CardPillItem {
  /** stable: the card's id. Default: its title */
  id?: string;
  /** the card's title */
  title: string;
  /** its type, as the card shows it: 'Runner', 'Race' */
  kind?: string;
  /** a thumbnail; without one the pill shows the title's initial */
  image?: string;
  /** a quieter line, for the grid: '4 runs this month' */
  sub?: string;
}

export interface CardPillsSignature {
  Args: {
    cards: CardPillItem[];
    /** 'pills' (default): a wrap of pills, for a search row's result.
     * 'grid': small tiles, for members and other sets worth seeing */
    layout?: 'pills' | 'grid';
    /** how many show before "Show all N". Default: all */
    limit?: number;
    /** the reader opened a card; the caller opens it where they work */
    onOpen?: (card: CardPillItem) => void;
    /** the card open on the stack, by id: its pill stays highlighted, and
     * pressing it again (or Escape) closes it */
    open?: string;
    onClose?: (card: CardPillItem) => void;
    /** pick cards instead of opening them: a press toggles a check, and a
     * bar offers what to do with the picked ones */
    selectable?: boolean;
    /** the picked cards, by id; controlled */
    selected?: string[];
    onSelectionChange?: (ids: string[]) => void;
    /** the bar's verb for the picked cards: 'Attach', 'Message'. With
     * `@onUseSelection` */
    useLabel?: string;
    onUseSelection?: (cards: CardPillItem[]) => void;
    /** the list's accessible name. Default 'Cards' */
    label?: string;
    /** hovering or focusing a pill peeks at its card: a hover card with
     * the `<:peek>` block (the host's fitted card), Open on stack and Show
     * here. `@onPeek` lets the host start loading it */
    peek?: boolean;
    onPeek?: (card: CardPillItem) => void;
    /** the card shown in place, by id: the `<:expanded>` block renders it
     * under the set, embedded, with Hide */
    expanded?: string;
    onExpand?: (card: CardPillItem) => void;
    onCollapse?: (card: CardPillItem) => void;
  };
  Blocks: {
    /** a card's fitted view, inside the peek */
    peek: [card: CardPillItem];
    /** a card's embedded view, in place under the set */
    expanded: [card: CardPillItem];
  };
  Element: HTMLDivElement;
}

/**
 * What a `cards.search`, `cards.get` or `entries.search` returned, as the
 * cards themselves. The whole interaction is here:
 *
 * - **Open.** A press opens the card where the reader works; that pill
 *   stays highlighted as open, and a second press (or Escape) closes it.
 * - **Pick.** With `@selectable` a press toggles a check instead, and a
 *   bar says "3 picked · Attach · Clear"; Escape clears.
 * - **Move.** Arrow keys move between cards (one tab stop for the set),
 *   Home and End jump to the ends.
 * - **Fold.** Past `@limit`, "Show all N"; once open, "Show fewer".
 */
export class CardPills extends Component<CardPillsSignature> {
  @tracked showAll = false;
  @tracked private innerSelected: string[] = [];
  @tracked private focusIndex = 0;
  /** the pill being peeked at */
  @tracked private peekId: string | undefined;
  private list: HTMLElement | undefined;

  get layout() {
    return this.args.layout ?? 'pills';
  }
  get folds(): boolean {
    let { limit, cards } = this.args;
    return limit !== undefined && cards.length > limit;
  }
  get shown(): CardPillItem[] {
    let { cards, limit } = this.args;
    return this.showAll || limit === undefined ? cards : cards.slice(0, limit);
  }
  get hidden(): number {
    return this.args.cards.length - this.shown.length;
  }
  get selectedIds(): string[] {
    return this.args.selected ?? this.innerSelected;
  }
  get pickedCards(): CardPillItem[] {
    let ids = new Set(this.selectedIds);
    return this.args.cards.filter((c) => ids.has(this.idOf(c)));
  }
  get pickedLabel(): string {
    return `${this.selectedIds.length} picked`;
  }
  get hasPicks(): boolean {
    return this.selectedIds.length > 0;
  }

  idOf = (card: CardPillItem) => card.id ?? card.title;
  initial = (card: CardPillItem) => card.title.trim()[0] ?? '?';
  isOpen = (card: CardPillItem) =>
    !this.args.selectable && this.args.open === this.idOf(card);
  isPicked = (card: CardPillItem) => this.selectedIds.includes(this.idOf(card));
  pressedOf = (card: CardPillItem) =>
    this.args.selectable
      ? this.isPicked(card)
        ? 'true'
        : 'false'
      : this.isOpen(card)
        ? 'true'
        : 'false';
  tabIndexOf = (index: number) => (index === this.focusIndex ? '0' : '-1');
  stateOf = (card: CardPillItem) =>
    this.isPicked(card) ? 'picked' : this.isOpen(card) ? 'open' : undefined;

  private setSelected(ids: string[]) {
    this.innerSelected = ids;
    this.args.onSelectionChange?.(ids);
  }

  press = (card: CardPillItem, index: number) => {
    this.focusIndex = index;
    if (this.args.selectable) {
      let id = this.idOf(card);
      let ids = this.selectedIds;
      this.setSelected(
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
      return;
    }
    if (this.isOpen(card)) {
      this.args.onClose?.(card);
    } else {
      this.args.onOpen?.(card);
    }
  };
  isPeeking = (card: CardPillItem) =>
    this.args.peek === true && this.peekId === this.idOf(card);
  peekIdOf = (card: CardPillItem) =>
    `${this.idOf(card)}-peek`.replace(/\s+/g, '-');
  startPeek = (card: CardPillItem) => {
    if (!this.args.peek || this.peekId === this.idOf(card)) {
      return;
    }
    this.peekId = this.idOf(card);
    this.args.onPeek?.(card);
  };
  endPeek = (card: CardPillItem, event?: Event) => {
    let to = (event as FocusEvent | PointerEvent | undefined)?.relatedTarget as
      | Node
      | null
      | undefined;
    let li = (event?.currentTarget as HTMLElement | undefined) ?? undefined;
    if (to && li?.contains(to)) {
      return; // moving into the peek keeps it
    }
    if (this.peekId === this.idOf(card)) {
      this.peekId = undefined;
    }
  };
  openFromPeek = (card: CardPillItem) => {
    this.peekId = undefined;
    this.args.onOpen?.(card);
  };
  expandFromPeek = (card: CardPillItem) => {
    this.peekId = undefined;
    this.args.onExpand?.(card);
  };
  get expandedCard(): CardPillItem | undefined {
    return this.args.expanded
      ? this.args.cards.find((c) => this.idOf(c) === this.args.expanded)
      : undefined;
  }
  collapse_ = () => {
    let card = this.expandedCard;
    if (card) {
      this.args.onCollapse?.(card);
    }
  };
  clear = () => this.setSelected([]);
  use = () => this.args.onUseSelection?.(this.pickedCards);
  expand = () => (this.showAll = true);
  collapse = () => {
    this.showAll = false;
    this.focusIndex = Math.min(this.focusIndex, (this.args.limit ?? 1) - 1);
  };
  /** one button folds and unfolds, so focus stays on it when its words
   * change */
  toggleAll = () => (this.showAll ? this.collapse() : this.expand());

  private focusAt(index: number) {
    let n = this.shown.length;
    if (!n) {
      return;
    }
    this.focusIndex = Math.min(Math.max(index, 0), n - 1);
    let buttons =
      this.list?.querySelectorAll<HTMLButtonElement>('[data-card-pill]');
    buttons?.[this.focusIndex]?.focus();
  }
  /** the grid's columns, for Up and Down */
  private columns(): number {
    let buttons = [
      ...(this.list?.querySelectorAll<HTMLElement>('[data-card-pill]') ?? []),
    ];
    if (buttons.length < 2) {
      return 1;
    }
    let top = buttons[0]!.getBoundingClientRect().top;
    let perRow = buttons.findIndex(
      (b) => b.getBoundingClientRect().top > top + 1,
    );
    return perRow > 0 ? perRow : buttons.length;
  }
  keydown = (e: Event) => {
    let event = e as KeyboardEvent;
    let i = this.focusIndex;
    let cols = this.layout === 'grid' ? this.columns() : 1;
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowRight':
        next = i + 1;
        break;
      case 'ArrowLeft':
        next = i - 1;
        break;
      case 'ArrowDown':
        next = i + cols;
        break;
      case 'ArrowUp':
        next = i - cols;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.shown.length - 1;
        break;
      case 'Escape': {
        // an Escape the set uses stops here, so a host's document-level
        // Escape does not also close what holds it
        if (this.peekId) {
          event.preventDefault();
          event.stopPropagation();
          this.peekId = undefined;
          return;
        }
        if (this.args.selectable && this.hasPicks) {
          event.preventDefault();
          event.stopPropagation();
          this.clear();
        } else {
          let open = this.args.cards.find((c) => this.isOpen(c));
          if (open) {
            event.preventDefault();
            event.stopPropagation();
            this.args.onClose?.(open);
          }
        }
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    this.focusAt(next);
  };
  setupList = modifier((element: HTMLElement) => {
    this.list = element;
    return () => (this.list = undefined);
  });

  <template>
    <div
      class='pretui-cardpills'
      data-layout={{this.layout}}
      data-selectable={{if @selectable 'true'}}
      data-test-pretui-card-pills
      ...attributes
    >
      {{! the arrow keys move a roving focus through the set, handled on
          the list that holds it }}
      {{! template-lint-disable no-invalid-interactive }}
      <ul
        class='pretui-cardpills-list'
        aria-label={{if @label @label 'Cards'}}
        {{this.setupList}}
        {{on 'keydown' this.keydown}}
      >
        {{#each this.shown as |card index|}}
          {{! the item holds the pill and its peek, so moving the pointer or
              focus from one to the other keeps the peek open }}
          {{! template-lint-disable no-invalid-interactive no-positive-tabindex }}
          <li
            class='pretui-cardpill-item'
            {{on 'pointerenter' (fn this.startPeek card)}}
            {{on 'pointerleave' (fn this.endPeek card)}}
            {{on 'focusin' (fn this.startPeek card)}}
            {{on 'focusout' (fn this.endPeek card)}}
          >
            <button
              type='button'
              class='pretui-cardpill'
              title={{if card.kind card.kind}}
              {{! a roving tabindex: 0 for the set's one stop, -1 for the rest }}
              tabindex={{this.tabIndexOf index}}
              aria-pressed={{this.pressedOf card}}
              aria-describedby={{if (this.isPeeking card) (this.peekIdOf card)}}
              data-card-pill
              data-state={{this.stateOf card}}
              {{on 'click' (fn this.press card index)}}
              data-test-pretui-card-pill={{card.title}}
            >
              <span class='pretui-cardpill-mark' aria-hidden='true'>{{#if
                  (this.isPicked card)
                }}<StateGlyph @glyph='done' @size={{10}} />{{else if
                  card.image
                }}<img
                    class='pretui-cardpill-image'
                    src={{card.image}}
                    alt=''
                    data-test-pretui-card-pill-image
                  />{{else}}{{this.initial card}}{{/if}}</span>
              <span class='pretui-cardpill-text'>
                <span class='pretui-cardpill-title'>{{card.title}}</span>
                {{#if card.sub}}<span
                    class='pretui-cardpill-sub'
                  >{{card.sub}}</span>{{/if}}
              </span>
              {{#if (this.isOpen card)}}<span
                  class='pretui-cardpill-open'
                  data-test-pretui-card-pill-open
                >open</span>{{/if}}
            </button>
            {{#if (this.isPeeking card)}}
              <div
                class='pretui-cardpill-peek'
                id={{this.peekIdOf card}}
                role='group'
                aria-label={{card.title}}
                data-test-pretui-card-pill-peek={{card.title}}
              >
                <div class='pretui-cardpill-peek-card'>{{yield
                    card
                    to='peek'
                  }}</div>
                <div class='pretui-cardpill-peek-actions'>
                  {{#if @onOpen}}<button
                      type='button'
                      class='pretui-cardpills-act'
                      data-test-pretui-card-pill-peek-open
                      {{on 'click' (fn this.openFromPeek card)}}
                    >Open on stack</button>{{/if}}
                  {{#if @onExpand}}<button
                      type='button'
                      class='pretui-cardpills-act'
                      data-test-pretui-card-pill-peek-expand
                      {{on 'click' (fn this.expandFromPeek card)}}
                    >Show here</button>{{/if}}
                </div>
              </div>
            {{/if}}
          </li>
        {{/each}}
      </ul>
      {{#if this.folds}}
        <button
          type='button'
          class='pretui-cardpills-all'
          aria-expanded={{if this.showAll 'true' 'false'}}
          {{on 'click' this.toggleAll}}
          data-test-pretui-card-pills-all
        >{{#if this.showAll}}Show fewer{{else}}Show all
            {{@cards.length}}{{/if}}</button>
      {{/if}}
      {{#if this.expandedCard}}
        <div
          class='pretui-cardpills-expanded'
          data-test-pretui-card-pills-expanded={{this.expandedCard.title}}
        >
          <div class='pretui-cardpills-expanded-head'>
            <span>{{this.expandedCard.title}}</span>
            <button
              type='button'
              class='pretui-cardpills-act'
              {{on 'click' this.collapse_}}
              data-test-pretui-card-pills-collapse
            >Hide</button>
          </div>
          {{yield this.expandedCard to='expanded'}}
        </div>
      {{/if}}
      {{#if (if @selectable this.hasPicks)}}
        <div class='pretui-cardpills-bar' data-test-pretui-card-pills-bar>
          <span class='pretui-cardpills-count'>{{this.pickedLabel}}</span>
          {{#if @onUseSelection}}
            <button
              type='button'
              class='pretui-cardpills-act'
              data-kind='primary'
              {{on 'click' this.use}}
              data-test-pretui-card-pills-use
            >{{if @useLabel @useLabel 'Attach'}}</button>
          {{/if}}
          <button
            type='button'
            class='pretui-cardpills-act'
            {{on 'click' this.clear}}
            data-test-pretui-card-pills-clear
          >Clear</button>
        </div>
      {{/if}}
      {{! the count is announced from a region that is always there, apart
          from the bar's buttons, so a change says the count and nothing else }}
      <VisuallyHidden
        role='status'
        aria-atomic='true'
        data-test-pretui-card-pills-status
      >{{if (if @selectable this.hasPicks) this.pickedLabel}}</VisuallyHidden>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-cardpills {
          /* the peek's distance from its pill, which the bridge over it
             must span */
          --_cardpills-peek-gap: var(--boxel-sp-2xs);
          display: grid;
          gap: var(--boxel-sp-xs);
          justify-items: start;
        }
        .pretui-cardpills-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-cardpills[data-layout='grid'] {
          justify-items: stretch;
        }
        .pretui-cardpills[data-layout='grid'] .pretui-cardpills-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
          gap: var(--boxel-sp-xs);
        }
        /* a pill: an outlined token on the inset, the card's mark and its
           title in ink-1. It is 1.5rem tall, the least a pointer target
           takes */
        .pretui-cardpill {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          max-width: 100%;
          height: 1.5rem;
          padding: 0 var(--boxel-sp-2xs) 0 var(--boxel-sp-5xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--inset);
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          /* knobs: a settled ToolRow sets both so its pills recede with it */
          font-weight: var(--pretui-cardpill-weight, 600);
          color: var(--pretui-cardpill-ink, var(--foreground));
          vertical-align: middle;
          cursor: pointer;
          transition:
            background-color 120ms ease-out,
            box-shadow 120ms ease-out;
        }
        .pretui-cardpill:hover {
          background-color: var(--hover);
          box-shadow: inset 0 0 0 1px var(--border-strong);
        }
        .pretui-cardpill:active {
          transform: translateY(0.5px);
        }
        .pretui-cardpill:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* open on the stack: the outline and the "open" word take the live
           state, never the fill */
        .pretui-cardpill[data-state='open'] {
          box-shadow: inset 0 0 0 1px var(--primary-ink);
        }
        /* picked: done is ink with a check, the outline in ink-1 */
        .pretui-cardpill[data-state='picked'] {
          box-shadow: inset 0 0 0 1px var(--foreground);
        }
        .pretui-cardpill[data-state='picked'] .pretui-cardpill-mark {
          background-color: var(--foreground);
          color: var(--background);
        }
        .pretui-cardpill-mark {
          flex: none;
          display: grid;
          place-items: center;
          width: 0.875rem;
          height: 0.875rem;
          overflow: hidden;
          border-radius: 50%;
          background-color: var(--card);
          font-size: var(--boxel-caption-font-size);
          line-height: 1;
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .pretui-cardpill-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pretui-cardpill-text {
          display: grid;
          min-width: 0;
          text-align: start;
        }
        .pretui-cardpill-title,
        .pretui-cardpill-sub {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-cardpill-sub {
          display: none;
        }
        .pretui-cardpill-open {
          margin-inline-start: var(--boxel-sp-6xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--primary-ink);
        }
        /* the grid: a tile per card, the mark larger, the type under it */
        .pretui-cardpills[data-layout='grid'] .pretui-cardpill {
          width: 100%;
          height: auto;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs) var(--boxel-sp-2xs)
            var(--boxel-sp-2xs);
          border-radius: var(--boxel-border-radius-sm);
        }
        .pretui-cardpills[data-layout='grid'] .pretui-cardpill-mark {
          width: 1.625rem;
          height: 1.625rem;
        }
        .pretui-cardpills[data-layout='grid'] .pretui-cardpill-sub {
          display: block;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .pretui-cardpills[data-layout='grid'] .pretui-cardpill-open {
          position: absolute;
          inset-block-start: var(--boxel-sp-4xs);
          inset-inline-end: var(--boxel-sp-2xs);
        }
        .pretui-cardpills-all {
          min-height: 1.5rem;
          padding: 0 var(--boxel-sp-4xs);
          border: 0;
          border-radius: var(--boxel-border-radius-xs);
          background-color: transparent;
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-cardpills-all:hover {
          color: var(--foreground);
        }
        .pretui-cardpills-all:focus-visible,
        .pretui-cardpills-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* the peek: a hover card under the pill with the fitted card. It
           fades in after a beat (a CSS delay, no clock), so a pointer
           passing over pills does not flash them */
        .pretui-cardpill-item {
          position: relative;
        }
        .pretui-cardpill-peek {
          position: absolute;
          inset-block-start: calc(100% + var(--_cardpills-peek-gap));
          inset-inline-start: 0;
          z-index: var(--pretui-z-popover, 30);
          display: grid;
          gap: var(--boxel-sp-xs);
          width: 15rem;
          padding: var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-lg);
          background-color: var(--popover);
          color: var(--popover-foreground);
          box-shadow:
            0 0 0 1px var(--border),
            var(--shadow-md);
          animation: pretui-peek-in 160ms ease-out 280ms both;
        }
        /* a bridge over the gap, so moving from the pill into the peek
           never leaves the item */
        .pretui-cardpill-peek::before {
          content: '';
          position: absolute;
          inset-inline: 0;
          inset-block-start: calc(-1 * var(--_cardpills-peek-gap));
          height: var(--_cardpills-peek-gap);
        }
        @keyframes pretui-peek-in {
          from {
            opacity: 0;
            transform: translateY(-0.125rem);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        .pretui-cardpill-peek-card {
          display: grid;
          min-height: 4rem;
          overflow: hidden;
          border-radius: var(--boxel-border-radius-sm);
        }
        .pretui-cardpill-peek-actions {
          display: flex;
          gap: var(--boxel-sp-4xs);
          justify-content: flex-end;
        }
        /* the card shown in place, embedded, under the set */
        .pretui-cardpills-expanded {
          display: grid;
          gap: var(--boxel-sp-xs);
          justify-self: stretch;
        }
        .pretui-cardpills-expanded-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          color: var(--foreground);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-cardpill-peek {
            animation: none;
          }
        }
        /* what to do with the picked cards, under the set */
        .pretui-cardpills-bar {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          justify-self: stretch;
          padding: var(--boxel-sp-6xs) var(--boxel-sp-6xs) var(--boxel-sp-6xs)
            var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--inset);
          color: var(--foreground);
          box-shadow: inset 0 0 0 1px var(--border);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-cardpills-count {
          margin-inline-end: auto;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .pretui-cardpills-act {
          height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          font-weight: 600;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        /* the bar's verb is the moment's one action */
        .pretui-cardpills-act[data-kind='primary'] {
          background-color: var(--primary);
          color: var(--primary-foreground);
        }
        .pretui-cardpills-act:not([data-kind='primary']):hover {
          color: var(--foreground);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-cardpill {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
