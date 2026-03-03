import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { debounce } from 'lodash';

import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { type Query } from '@cardstack/runtime-common';

import { BoxelInput, ViewSelector } from '@cardstack/boxel-ui/components';
import { type ViewItem } from '@cardstack/boxel-ui/components';
import CardList from 'https://cardstack.com/base/components/card-list';
import BotIcon from '@cardstack/boxel-icons/bot';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';

type ViewOption = 'strip' | 'grid';

const SUBMISSION_VIEW_OPTIONS: ViewItem[] = [
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

class Isolated extends Component<typeof SubmissionCardPortal> {
  @tracked searchText: string = '';
  @tracked selectedView: string = 'grid';

  private debouncedSetSearch = debounce((value: string) => {
    this.searchText = value;
  }, 300);

  @action
  onSearchInput(value: string) {
    this.debouncedSetSearch(value);
  }

  @action
  setView(id: ViewOption) {
    this.selectedView = id;
  }

  get realmHrefs(): string[] {
    const url = this.args.model[realmURL];
    return url ? [url.href] : [];
  }

  get query(): Query {
    const baseFilter = {
      type: {
        module: new URL('./submission-card', import.meta.url).href,
        name: 'SubmissionCard',
      },
    };

    if (!this.searchText) {
      return { filter: baseFilter };
    }

    return {
      filter: {
        every: [
          baseFilter,
          {
            any: [{ contains: { cardTitle: this.searchText } }],
          },
        ],
      },
    };
  }

  <template>
    <div class='submission-portal'>
      <header class='portal-header'>
        <h1 class='portal-title'>{{@model.title}}</h1>
        <div class='portal-controls'>
          <BoxelInput
            class='search-input'
            @type='search'
            @value={{this.searchText}}
            @onInput={{this.onSearchInput}}
            placeholder='Search by card title...'
          />
          <ViewSelector
            class='portal-view-selector'
            @selectedId={{this.selectedView}}
            @onChange={{this.setView}}
            @items={{SUBMISSION_VIEW_OPTIONS}}
          />
        </div>
      </header>

      <div class='portal-content'>
        <CardList
          @query={{this.query}}
          @realms={{this.realmHrefs}}
          @format='fitted'
          @viewOption={{this.selectedView}}
          @context={{@context}}
        />
      </div>
    </div>

    <style scoped>
      .submission-portal {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--boxel-light);
      }

      .portal-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        background: var(--boxel-200);
        border-bottom: 1px solid var(--boxel-200);
      }

      .portal-title {
        margin: 0;
        font: 700 var(--boxel-font-xl);
        color: var(--boxel-dark);
      }

      .portal-controls {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }

      .search-input {
        flex: 1;
      }

      .portal-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--boxel-sp);
      }

      .portal-view-selector {
        margin-left: auto;
        flex-shrink: 0;
        --boxel-view-option-group-column-gap: var(--boxel-sp-2xs);
      }

      /* Each list item must be a sized container so fitted template
         container queries (@container fitted-card) resolve correctly */
      .portal-content :deep(.grid-view) {
        --item-width: 300px;
        --item-height: 380px;
      }

      .portal-content :deep(.strip-view) {
        --item-height: 120px;
        grid-template-columns: 1fr;
      }
    </style>
  </template>
}

export class SubmissionCardPortal extends CardDef {
  static displayName = 'Submission Card Portal';
  static prefersWideFormat = true;
  static headerColor = '#e5f0ff';
  static icon = BotIcon;
  static isolated = Isolated;

  @field title = contains(StringField);
  @field description = contains(StringField);
}
