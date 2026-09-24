import { eq } from '@cardstack/boxel-ui/helpers';
import { IconSearchThick } from '@cardstack/boxel-ui/icons';
import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from '../card-api';
import BooleanField from '../boolean';
import CodeRefField from '../code-ref';
import NumberField from '../number';
import { QueryField } from './search-card-result';
import { EntryResultRow, SearchResultList } from './search-result-list';

export class SearchEntriesInput extends CardDef {
  static displayName = 'Search Entries';
  static icon = IconSearchThick;
  @field query = contains(QueryField);
  // Realm URLs to search; empty means every realm the user can read.
  @field realms = containsMany(StringField);
  // 'cards' | 'files' | 'all'; the tool validates and defaults to 'all'.
  @field scope = contains(StringField);
  // Maximum rows returned; the tool defaults to 5 and clamps to 10.
  @field limit = contains(NumberField);
}

export class SearchEntrySummaryField extends FieldDef {
  static displayName = 'Search Entry Summary';
  // The entry's URL — a card id or a file URL.
  @field url = contains(StringField);
  // 'card' | 'file', from the entry's item resource type.
  @field kind = contains(StringField);
  // Populated for Spec rows.
  @field ref = contains(CodeRefField);
  @field specType = contains(StringField);
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  // The file name — the display handle for file rows, which carry no
  // cardTitle.
  @field name = contains(StringField);
  // Present only when the search sorted by full-text relevance.
  @field matchRelevance = contains(NumberField);
  // Full, untruncated readMe when the row carries one (e.g. a Spec).
  @field readMe = contains(StringField);
}

export class SearchEntriesResult extends CardDef {
  static displayName = 'Search Entries Result';
  static icon = IconSearchThick;
  @field results = containsMany(SearchEntrySummaryField);
  // Total matches across the searched realms; `results` is one page of them.
  @field total = contains(NumberField);
  // True when a searched realm failed to answer: `results`/`total` then cover
  // only the realms that responded.
  @field incomplete = contains(BooleanField);
  @field cardDescription = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-search-entries-result>
        <SearchResultList @items={{@model.results}} as |visibleResults|>
          <p class='result-count' data-test-search-entries-count>
            {{@model.results.length}}
            of
            {{@model.total}}
            results{{if @model.incomplete ' (incomplete: a realm failed)' ''}}
          </p>
          <ol class='result-list' data-test-result-list>
            {{#each visibleResults key='url' as |result|}}
              <EntryResultRow
                @url={{result.url}}
                @kind={{result.kind}}
                @format='atom'
                @context={{@context}}
                @matchRelevance={{result.matchRelevance}}
                @fallbackLabel={{if
                  result.cardTitle
                  result.cardTitle
                  result.name
                }}
              />
            {{/each}}
            {{#if (eq @model.results.length 0)}}
              <li class='empty' data-test-search-entries-empty>No entries were
                found.</li>
            {{/if}}
          </ol>
        </SearchResultList>
      </div>
      <style scoped>
        .result-count {
          margin: 0 0 var(--boxel-sp-xs);
          font-weight: 500;
          color: var(--boxel-450);
        }
        .result-list {
          list-style-type: none;
          margin: 0;
          padding: 0;
        }
        .empty {
          font-weight: 500;
        }
      </style>
    </template>
  };
}
