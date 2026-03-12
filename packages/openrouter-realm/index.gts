import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  Component,
  field,
  contains,
  getCardMeta,
  realmInfo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';
import { type Query } from '@cardstack/runtime-common';

import CardList from 'https://cardstack.com/base/components/card-list';

class Isolated extends Component<typeof OpenRouterIndex> {
  @tracked filterText = '';

  get realmHref(): string {
    return this.args.model[realmURL]?.href ?? '';
  }

  get modelRef() {
    return {
      module: `${this.realmHref}openrouter-model`,
      name: 'OpenRouterModel',
    };
  }

  get query(): Query {
    let typeFilter = { type: this.modelRef };
    let trimmed = this.filterText.trim();
    let filter = trimmed
      ? {
          every: [
            typeFilter,
            {
              any: [
                { contains: { name: trimmed }, on: this.modelRef },
                { contains: { modelId: trimmed }, on: this.modelRef },
              ],
            },
          ],
        }
      : typeFilter;
    return {
      filter,
      sort: [
        {
          by: 'cardTitle',
          on: this.modelRef,
          direction: 'asc' as const,
        },
      ],
    };
  }

  @action onFilterInput(event: Event) {
    this.filterText = (event.target as HTMLInputElement).value;
  }

  get realms(): string[] {
    return this.realmHref ? [this.realmHref] : [];
  }

  <template>
    <div class='openrouter-index'>
      <header class='header'>
        <div class='header-text'>
          <h1 class='title'>{{if
              @model.cardTitle
              @model.cardTitle
              'OpenRouter Models'
            }}</h1>
          <p class='subtitle'>
            {{#if @model.lastSyncedAt}}
              Last synced at
              <@fields.lastSyncedAt />
            {{else}}
              Auto-synced OpenRouter model definitions
            {{/if}}
          </p>
        </div>
      </header>

      <div class='filter-bar'>
        <input
          class='filter-input'
          type='text'
          placeholder='Filter by name or model ID...'
          value={{this.filterText}}
          {{on 'input' this.onFilterInput}}
        />
      </div>

      <CardList
        class='model-list'
        style='--item-height: 4.375rem;'
        @context={{@context}}
        @query={{this.query}}
        @realms={{this.realms}}
        @format='fitted'
        @viewOption='strip'
        @isLive={{true}}
      />
    </div>

    <style scoped>
      .openrouter-index {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
        background-color: var(--boxel-light);
        font-family: var(--boxel-font-family);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-200);
      }
      .header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .title {
        margin: 0;
        font-size: var(--boxel-heading-font-size);
        font-weight: 600;
        line-height: var(--boxel-heading-line-height);
      }
      .subtitle {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
      }
      .filter-bar {
        padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-200);
      }
      .filter-input {
        width: 100%;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size-sm);
        font-family: var(--boxel-font-family);
        outline: none;
      }
      .filter-input:focus {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .model-list {
        --boxel-card-list-gap: var(--boxel-sp-xxxs);
        flex: 1;
        overflow-y: auto;
        padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
    </style>
  </template>
}

export class OpenRouterIndex extends CardDef {
  static displayName = 'OpenRouter Models';
  static isolated = Isolated;
  static prefersWideFormat = false;

  @field lastSyncedAt = contains(DateTimeField, {
    computeVia: function (this: OpenRouterIndex) {
      let lastModified = getCardMeta(this, 'lastModified');
      return lastModified ? new Date(lastModified * 1000) : undefined;
    },
  });

  @field realmName = contains(StringField, {
    computeVia: function (this: OpenRouterIndex) {
      return this[realmInfo]?.name;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: OpenRouterIndex) {
      return this.realmName ?? 'OpenRouter Models';
    },
  });
}
