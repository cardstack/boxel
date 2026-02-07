import { fn } from '@ember/helper';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { eq, gt, or } from '@cardstack/boxel-ui/helpers';

import { specRef } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import PrerenderedCardSearch from '../prerendered-card-search';

import ResultsSection from './results-section';

import { getCodeRefFromSearchKey } from './utils';

interface Signature {
  Element: HTMLElement;
  Args: {
    searchKey: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
    realms?: string[];
  };
  Blocks: {};
}

export default class CardQueryResults extends Component<Signature> {
  @service declare realmServer: RealmServerService;

  get realms() {
    return this.args.realms ?? this.realmServer.availableRealmURLs;
  }

  /** Serialized for data-test-search-realms (testing realm filter) */
  get realmsForTest(): string {
    return this.realms.join(',');
  }

  get query() {
    let { searchKey } = this.args;
    let type = getCodeRefFromSearchKey(searchKey);
    let searchTerm = !type ? searchKey : undefined;
    return {
      filter: {
        every: [
          {
            ...(type
              ? { type }
              : {
                  not: {
                    type: specRef,
                  },
                }),
          },
          ...(searchTerm
            ? [
                {
                  contains: {
                    cardTitle: searchTerm,
                  },
                },
              ]
            : []),
        ],
      },
    };
  }

  private get isSearchKeyNotEmpty() {
    return !!this.args.searchKey && this.args.searchKey !== '';
  }

  <template>
    <div data-test-search-realms={{this.realmsForTest}}>
      <PrerenderedCardSearch
        @query={{this.query}}
        @format='fitted'
        @realms={{this.realms}}
      >
        <:loading>
          <ResultsSection
            @label={{concat 'Searching for “' @searchKey '”'}}
            @isCompact={{@isCompact}}
          />
        </:loading>
        <:response as |cards|>
          {{#if (or (gt cards.length 0) this.isSearchKeyNotEmpty)}}
            <ResultsSection
              @label={{concat
                cards.length
                ' Result'
                (if (eq cards.length 1) '' 's')
                ' for “'
                @searchKey
                '”'
              }}
              @isCompact={{@isCompact}}
              as |SearchResult|
            >
              {{#each cards as |card i|}}
                {{#unless card.isError}}
                  <SearchResult
                    @component={{card.component}}
                    @cardId={{card.url}}
                    @isCompact={{@isCompact}}
                    {{on 'click' (fn @handleCardSelect card.url)}}
                    data-test-search-sheet-search-result={{i}}
                  />
                {{/unless}}
              {{/each}}
            </ResultsSection>
          {{/if}}
        </:response>
      </PrerenderedCardSearch>
    </div>
  </template>
}
