import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconSearchThick } from '@cardstack/boxel-ui/icons';
import { type Query, primitive } from '@cardstack/runtime-common';
import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  FieldDef,
  linksToMany,
} from '../card-api';
import CodeRefField from '../code-ref';
import { CardList, SearchResultList } from './search-result-list';

// `JsonField` lives in its own module so non-command code can reuse it.
// Re-exported here so it is importable from this module too.
export { JsonField } from '../json-field';

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

class SearchCardsResultEmbeddedView extends Component<
  typeof SearchCardsResult
> {
  get cardIds() {
    return this.args.model.cardIds ?? [];
  }

  <template>
    <SearchResultList @items={{this.cardIds}} as |visibleCardIds|>
      <CardList
        @cardIds={{visibleCardIds}}
        @format='atom'
        @context={{@context}}
      />
    </SearchResultList>
  </template>
}

class SearchCardsResultIsolatedView extends Component<
  typeof SearchCardsResult
> {
  get cardIds() {
    return this.args.model.cardIds ?? [];
  }

  get numberOfCards() {
    return this.cardIds.length;
  }

  <template>
    <section class='tool-call-result' data-test-tool-result-isolated>
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
            @cardIds={{this.cardIds}}
            @format='fitted'
            @context={{@context}}
          />
        </FieldContainer>
      </div>
    </section>
    <style scoped>
      .tool-call-result {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
      }
      .tool-call-result > * + * {
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
