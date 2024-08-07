import { fn } from '@ember/helper';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { eq, gt, or } from '@cardstack/boxel-ui/helpers';

import { catalogEntryRef } from '@cardstack/runtime-common';

import PrerenderedCardSearch from '../prerendered-card-search';

import ResultsSection from './results-section';

import { getCodeRefFromSearchKey } from './utils';

import type CardService from '../../services/card-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    searchKey: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
  };
  Blocks: {};
}

export default class CardQueryResults extends Component<Signature> {
  @service declare cardService: CardService;

  get realms() {
    return this.cardService.realmURLs;
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
                    type: catalogEntryRef,
                  },
                }),
          },
          ...(searchTerm
            ? [
                {
                  contains: {
                    title: searchTerm,
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
    <PrerenderedCardSearch
      @query={{this.query}}
      @format='embedded'
      @realms={{this.realms}}
    >
      <:loading>
        <ResultsSection
          @label={{concat 'Searching for “' @searchKey '”'}}
          @isCompact={{@isCompact}}
        />
      </:loading>
      <:response as |response|>
        {{#if (or (gt response.count 0) this.isSearchKeyNotEmpty)}}
          <ResultsSection
            @label={{concat
              response.count
              ' Result'
              (if (eq response.count 1) '' 's')
              ' for “'
              @searchKey
              '”'
            }}
            @isCompact={{@isCompact}}
            as |SearchResult|
          >
            <response.Results as |PrerenderedCard cardId i|>
              <SearchResult
                @component={{PrerenderedCard}}
                @cardId={{cardId}}
                @isCompact={{@isCompact}}
                {{on 'click' (fn @handleCardSelect cardId)}}
                data-test-search-sheet-search-result={{i}}
              />
            </response.Results>
          </ResultsSection>
        {{/if}}
      </:response>
    </PrerenderedCardSearch>
  </template>
}
