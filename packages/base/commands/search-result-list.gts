import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconMinusCircle, IconPlus } from '@cardstack/boxel-ui/icons';
import type { BaseDef } from '../card-api';
import type { CardContext, Format } from '../card-api';

// A card or field renders through the component its own class exposes. The
// search result lists render both live cards and hydrated files this way — a
// `FileDef` is a `BaseDef`, so its format shell resolves the same as a card's.
export function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

interface SearchResultListSignature<T> {
  Args: {
    // The full row set. The shell shows the first `paginateSize` and reveals the
    // rest behind a toggle. Accepts undefined (an unset containsMany field) and
    // treats it as empty.
    items: T[] | undefined;
    paginateSize?: number;
  };
  Blocks: {
    default: [visibleItems: T[]];
  };
  Element: HTMLDivElement;
}

// The container chrome and "Show N more results" paginator shared by the search
// tool-result cards. It owns only pagination and layout; the consumer yields the
// list body for the visible slice.
export class SearchResultList<T> extends GlimmerComponent<
  SearchResultListSignature<T>
> {
  @tracked private showAll = false;

  private get paginateSize() {
    return this.args.paginateSize ?? 5;
  }

  private get items(): T[] {
    return this.args.items ?? [];
  }

  private get total() {
    return this.items.length;
  }

  private get visibleItems(): T[] {
    return this.showAll ? this.items : this.items.slice(0, this.paginateSize);
  }

  private get hasMore() {
    return this.total > this.paginateSize;
  }

  private get leftover() {
    return this.total - this.paginateSize;
  }

  private get toggleText() {
    if (this.showAll) {
      return 'See Less';
    }
    return `Show ${this.leftover} more ${
      this.leftover === 1 ? 'result' : 'results'
    }`;
  }

  @action private toggle() {
    this.showAll = !this.showAll;
  }

  <template>
    <div class='tool-call-result' ...attributes>
      {{yield this.visibleItems}}
      <div class='footer'>
        {{#if this.hasMore}}
          <Button
            @size='small'
            class='toggle-show'
            {{on 'click' this.toggle}}
            data-test-toggle-show-button
          >
            {{#if this.showAll}}
              <IconMinusCircle width='11px' height='11px' role='presentation' />
            {{else}}
              <IconPlus width='11px' height='11px' role='presentation' />
            {{/if}}

            {{this.toggleText}}
          </Button>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .tool-call-result {
        color: var(--boxel-dark);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        --left-padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        font-weight: 600;
        padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-xxs);
      }
      .footer {
        color: var(--boxel-header-text-color);
        text-overflow: ellipsis;
      }
      .toggle-show {
        --icon-color: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
        --boxel-button-min-height: 1.875rem;
        --boxel-button-padding: 0px;
        --boxel-button-font: var(--boxel-font-xs);
        --icon-stroke-width: 2.5;
        font-weight: 600;
        color: var(--boxel-highlight);
        display: flex;
        justify-content: flex-start;
        gap: var(--boxel-sp-xxxs);
        border: none;
      }
      .toggle-show:focus:not(:disabled) {
        outline-offset: 2px;
      }
    </style>
  </template>
}

interface CardListSignature {
  cardIds: string[];
  format: Format;
  context?: CardContext;
}

// A batched list of live cards, hydrated by id through the store's card
// collection. Used by the card-instance result card, whose rows are all cards.
export class CardList extends GlimmerComponent<CardListSignature> {
  <template>
    <ol class='result-list {{@format}}' data-test-result-list>
      {{#each this.cardList.cards as |card|}}
        <li
          class='result-list-item {{@format}}'
          data-test-result-card={{card.id}}
          {{@context.cardComponentModifier
            card=card
            format='data'
            fieldType=undefined
            fieldName=undefined
          }}
        >
          {{#let (getComponent card) as |Component|}}
            <Component
              @format={{@format}}
              @displayContainer={{eq @format 'fitted'}}
            />
          {{/let}}
        </li>
      {{/each}}
      {{#each this.cardList.cardErrors as |error|}}
        <li class='result-list-item' data-test-card-error={{error.id}}>
          Error: cannot render card
          {{error.id}}:
          {{error.message}}
        </li>
      {{/each}}
      {{#if this.hasNoResults}}
        No cards were found.
      {{/if}}
    </ol>
    <style scoped>
      .result-list {
        margin: 0;
        padding-left: var(--boxel-sp);
      }
      .result-list-item {
        margin-bottom: var(--boxel-sp-xxs);
      }
      .result-list.embedded,
      .result-list.fitted {
        --grid-card-width: 10.25rem; /* 164px */
        --grid-card-height: 14rem; /* 224px */
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: max-content;
        gap: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }
      .result-list-item.embedded,
      .result-list-item.fitted {
        margin-bottom: 0;
        width: var(--grid-card-width);
        height: var(--grid-card-height);
      }
      .result-list-item :deep(.field-component-card.fitted-format) {
        height: 100%;
      }
    </style>
  </template>

  @tracked cardList = this.args.context?.getCardCollection(
    this,
    () => this.args.cardIds,
  );

  get hasNoResults() {
    return (
      !this.cardList ||
      (this.cardList.cards.length === 0 &&
        this.cardList.cardErrors.length === 0)
    );
  }
}

interface EntryResultRowSignature {
  Args: {
    // A card id or a file URL — the entry's `url`.
    url: string | undefined;
    // 'card' | 'file', selecting the store read type.
    kind: string | undefined;
    format: Format;
    context?: CardContext;
    // Full-text match relevance, shown as a chip when present.
    matchRelevance?: number | undefined;
    // Title/name to show before hydration completes or when it fails.
    fallbackLabel?: string | undefined;
  };
  Element: HTMLLIElement;
}

// One search-entry row, hydrated on its own from its URL. A file row reads
// through the store's `file-meta` type (the same path interact submode uses for
// file stack items); a card row reads the default `card` type. Rendering both
// this way keeps the two entry kinds in one relevance-ordered list, which a
// batched card collection could not do (it reads a single type and can't
// preserve interleaved order).
export class EntryResultRow extends GlimmerComponent<EntryResultRowSignature> {
  // `kind` and `context` are captured once here while the `url` thunk stays
  // reactive. That is sound because consumers key rows by url and a url's kind
  // never changes; a row reused across a kind flip would read the wrong store
  // type.
  private cardResource = this.args.context?.getCard(this, () => this.args.url, {
    type: this.args.kind === 'file' ? 'file-meta' : 'card',
  });

  private get instance(): BaseDef | undefined {
    return this.cardResource?.card;
  }

  private get error() {
    return this.cardResource?.cardError;
  }

  private get relevanceLabel(): string | undefined {
    let relevance = this.args.matchRelevance;
    if (relevance == null || !Number.isFinite(relevance)) {
      return undefined;
    }
    return relevance.toFixed(2);
  }

  <template>
    <li
      class='result-entry {{@format}}'
      data-test-result-entry={{@url}}
      ...attributes
    >
      <span class='entry-content'>
        {{#if this.instance}}
          {{#let (getComponent this.instance) as |Component|}}
            <Component
              @format={{@format}}
              @displayContainer={{eq @format 'fitted'}}
            />
          {{/let}}
        {{else if this.error}}
          <span class='entry-error' data-test-entry-error={{@url}}>
            Error: cannot render
            {{if @fallbackLabel @fallbackLabel @url}}
          </span>
        {{else if @fallbackLabel}}
          <span class='entry-fallback'>{{@fallbackLabel}}</span>
        {{/if}}
      </span>
      {{#if this.relevanceLabel}}
        <span
          class='relevance-chip'
          title='Full-text match relevance'
          data-test-entry-relevance={{@url}}
        >{{this.relevanceLabel}}</span>
      {{/if}}
    </li>
    <style scoped>
      .result-entry {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xxs);
      }
      .entry-content {
        min-width: 0;
      }
      .entry-error,
      .entry-fallback {
        font-weight: 500;
      }
      .relevance-chip {
        flex-shrink: 0;
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius-sm);
        padding: 0 var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}
