import {
  contains,
  field,
  Component,
  CardDef,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import {
  SearchCardsResult,
  SearchCardsByTypeAndTitleInput,
} from 'https://cardstack.com/base/commands/search-card-result';
import { SearchCardsByTypeAndTitleCommand } from '@cardstack/boxel-host/commands/search-cards';

export class SimpleSearchCard extends CardDef {
  static displayName = 'Simple Search';
  @field titleSearch = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    searchResource = commandData<
      typeof SearchCardsByTypeAndTitleInput,
      typeof SearchCardsResult
    >(this, SearchCardsByTypeAndTitleCommand, () => {
      return {
        cardTitle: this.args.model.titleSearch,
      };
    });

    get searchResults() {
      const resource = this.searchResource;
      if (resource?.isSuccess && resource.value?.cardIds) {
        return resource.value.cardIds;
      }
      return [];
    }

    get isLoading() {
      return this.searchResource.isLoading;
    }

    get isError() {
      return !!this.searchResource.error;
    }

    get isSuccess() {
      return this.searchResource.isSuccess;
    }

    <template>
      <div class='simple-search-card'>
        <h2>Simple Search</h2>

        <div class='input'>
          <@fields.titleSearch @format='edit' />
        </div>

        <div class='execution-state'>
          <h3>Execution State</h3>
          <div class='state-indicators'>
            <span class='state-item {{if this.isLoading "active"}}'>isLoading:
              {{this.isLoading}}</span>
            <span class='state-item {{if this.isError "active"}}'>isError:
              {{this.isError}}</span>
            <span class='state-item {{if this.isSuccess "active"}}'>isSuccess:
              {{this.isSuccess}}</span>
          </div>
        </div>

        <div class='results-section'>
          <h3>Results</h3>
          {{#if this.searchResults.length}}
            <p>Found {{this.searchResults.length}} results:</p>
            <ul>
              {{#each this.searchResults as |cardId|}}
                <li>{{cardId}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p>No results found</p>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .simple-search-card {
          padding: var(--boxel-sp-lg);
        }
        .input label {
          display: block;
          margin-bottom: var(--boxel-sp);
        }
        .execution-state {
          margin: var(--boxel-sp-lg) 0;
          padding: var(--boxel-sp);
          border: 1px solid var(--boxel-300);
          border-radius: var(--boxel-border-radius);
        }
        .state-indicators {
          display: flex;
          gap: var(--boxel-sp);
        }
        .state-item {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-xs);
          background: var(--boxel-100);
          font-family: monospace;
          font-size: var(--boxel-font-xs);
        }
        .state-item.active {
          background: var(--boxel-highlight);
          font-weight: bold;
        }
        .results-section {
          margin: var(--boxel-sp-lg) 0;
          padding: var(--boxel-sp);
          border: 1px solid var(--boxel-300);
          border-radius: var(--boxel-border-radius);
        }
        .results-section ul {
          list-style: none;
          padding: 0;
        }
        .results-section li {
          padding: var(--boxel-sp-xs);
          background: var(--boxel-100);
          margin-bottom: var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
}
