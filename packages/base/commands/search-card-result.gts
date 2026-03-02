import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  IconMinusCircle,
  IconPlus,
  IconSearchThick,
} from '@cardstack/boxel-ui/icons';
import { type Query, primitive } from '@cardstack/runtime-common';
import {
  BaseDef,
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  type CardContext,
  type Format,
  FieldDef,
  linksToMany,
} from '../card-api';
import CodeRefField from '../code-ref';

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

interface CardListSignature {
  cardIds: string[];
  format: Format;
  context?: CardContext;
}

export class JsonField extends FieldDef {
  static [primitive]: Record<string, any>;
}

export class QueryField extends FieldDef {
  static [primitive]: Query;
}

export class SearchCardsByQueryInput extends CardDef {
  static displayName = 'Search Cards';
  static icon = IconSearchThick;
  @field query = contains(QueryField);
}

export class SearchCardsByTypeAndTitleInput extends CardDef {
  static displayName = 'Search Cards';
  static icon = IconSearchThick;
  @field cardTitle = contains(StringField);
  @field type = contains(CodeRefField);
  @field cardType = contains(StringField);
}

class CardList extends GlimmerComponent<CardListSignature> {
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

class SearchCardsResultEmbeddedView extends Component<
  typeof SearchCardsResult
> {
  @tracked showAllResults = false;

  get cardIdsToDisplay() {
    if (!this.args.model.cardIds?.length) {
      return [];
    }
    if (this.showAllResults) {
      return this.args.model.cardIds;
    }
    return this.args.model.cardIds?.slice(0, this.paginateSize);
  }

  get numberOfCards() {
    if (!this.args.model.cardIds) {
      return 0;
    }
    return this.args.model.cardIds?.length;
  }

  get leftoverCardsToShow() {
    return this.numberOfCards - this.paginateSize;
  }

  get numberOfCardsGreaterThanPaginateSize() {
    return this.numberOfCards > this.paginateSize;
  }

  get paginateSize() {
    return 5;
  }

  get toggleShowText() {
    return !this.showAllResults
      ? `Show ${this.leftoverCardsToShow} more results`
      : 'See Less';
  }

  @action toggleShow() {
    this.showAllResults = !this.showAllResults;
  }

  <template>
    <div class='command-result'>
      <CardList
        @cardIds={{this.cardIdsToDisplay}}
        @format='atom'
        @context={{@context}}
      />
      <div class='footer'>
        {{#if this.numberOfCardsGreaterThanPaginateSize}}
          <Button
            @size='small'
            class='toggle-show'
            {{on 'click' this.toggleShow}}
            data-test-toggle-show-button
          >
            {{#if this.showAllResults}}
              <IconMinusCircle width='11px' height='11px' role='presentation' />
            {{else}}
              <IconPlus width='11px' height='11px' role='presentation' />
            {{/if}}

            {{this.toggleShowText}}
          </Button>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .command-result {
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
      .result-list {
        padding-left: var(--boxel-sp);
        margin-block-end: 0;
      }
      .result-list li {
        margin-bottom: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

class SearchCardsResultIsolatedView extends SearchCardsResultEmbeddedView {
  <template>
    <section class='command-result' data-test-command-result-isolated>
      <header>
        <h3>Search Results</h3>
        <p class='result-count'>
          {{this.numberOfCards}}
          {{if (eq this.numberOfCards 1) 'Result' 'Results'}}
        </p>
      </header>
      <div class='fields'>
        <FieldContainer @label='Description'>
          {{@model.cardDescription}}
        </FieldContainer>
        <FieldContainer @label='Results' class='results'>
          <CardList
            @cardIds={{this.cardIdsToDisplay}}
            @format='fitted'
            @context={{@context}}
          />
        </FieldContainer>
      </div>
    </section>
    <style scoped>
      .command-result {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
      }
      .command-result > * + * {
        margin-top: var(--boxel-sp-lg);
      }
      h3 {
        margin: 0;
        font: 600 var(--boxel-font-lg);
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
      }
      .result-count {
        margin: 0;
        font-weight: 500;
        color: var(--boxel-450);
      }
      .fields > * + * {
        margin-top: var(--boxel-sp-xxs);
      }
      .results {
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>

  @tracked showAllResults = true;
}

export class SearchCardSummaryField extends FieldDef {
  @field id = contains(StringField); //since it is field, it doesn't conflict with id
  @field cardTitle = contains(StringField);
}

export class SearchCardsResult extends CardDef {
  static displayName = 'Search Results';
  static icon = IconSearchThick;
  @field cardIds = containsMany(StringField);
  @field instances = linksToMany(CardDef);
  @field summaries = containsMany(SearchCardSummaryField);
  static embedded = SearchCardsResultEmbeddedView;
  static isolated = SearchCardsResultIsolatedView;
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SearchCardsResult) {
      return 'Search Results';
    },
  });
  @field cardDescription = contains(StringField);
}
