import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import HistoryIcon from '@cardstack/boxel-icons/history';

import { Button } from '@cardstack/boxel-ui/components';

import { SECTION_SHOW_MORE_INCREMENT } from './constants';
import { SearchResult } from './results-section';
import SearchSheetSectionHeader from './section-header';

import type {
  RealmSection,
  RecentsSection,
  SearchSheetSection,
  UrlSection,
} from './search-sheet-content';

interface Signature {
  Element: HTMLElement;
  Args: {
    section: SearchSheetSection;
    viewOption: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
    isFocused: boolean;
    isCollapsed: boolean;
    onFocusSection: (sectionId: string | null) => void;
    getDisplayedCount?: (sectionId: string, totalCount: number) => number;
    onShowMore?: (sectionId: string, totalCount: number) => void;
  };
  Blocks: {};
}

export default class SearchResultSection extends Component<Signature> {
  recentsIcon = HistoryIcon;

  get realmSection(): RealmSection | null {
    return this.args.section.type === 'realm' ? this.args.section : null;
  }

  get urlSection(): UrlSection | null {
    return this.args.section.type === 'url' ? this.args.section : null;
  }

  get recentsSection(): RecentsSection | null {
    return this.args.section.type === 'recents' ? this.args.section : null;
  }

  @action
  handleShowOnlyChange(checked: boolean) {
    const sid = this.args.section.sid;
    if (sid) {
      this.args.onFocusSection?.(checked ? sid : null);
    }
  }

  @action
  handleShowMore(totalCount: number) {
    const sid = this.args.section.sid;
    const onShowMore = this.args.onShowMore;
    if (sid && onShowMore) {
      onShowMore(sid, totalCount);
    }
  }

  get displayedRealmCards() {
    const section = this.realmSection;
    if (!section) return [];
    const sid = this.args.section.sid;
    const getDisplayedCount = this.args.getDisplayedCount;
    if (!sid || !getDisplayedCount) return section.cards;
    const limit = getDisplayedCount(sid, section.totalCount);
    return section.cards.slice(0, limit);
  }

  get displayedRecentsCards() {
    const section = this.recentsSection;
    if (!section) return [];
    const sid = this.args.section.sid;
    const getDisplayedCount = this.args.getDisplayedCount;
    if (!sid || !getDisplayedCount) return section.cards;
    const limit = getDisplayedCount(sid, section.totalCount);
    return section.cards.slice(0, limit);
  }

  get hasMoreCards() {
    const section = this.args.section;
    const sid = this.args.section.sid;
    const getDisplayedCount = this.args.getDisplayedCount;
    if (!sid || !getDisplayedCount) return false;
    if (section.type === 'url') return false;
    const total = section.totalCount;
    const displayed = getDisplayedCount(sid, total);
    return displayed < total;
  }

  get remainingCount() {
    const section = this.args.section;
    const sid = this.args.section.sid;
    const getDisplayedCount = this.args.getDisplayedCount;
    if (!sid || !getDisplayedCount) return 0;
    if (section.type === 'url') return 0;
    const total = section.totalCount;
    const displayed = getDisplayedCount(sid, total);
    return total - displayed;
  }

  get nextShowMoreCount() {
    return Math.min(SECTION_SHOW_MORE_INCREMENT, this.remainingCount);
  }

  get viewClass() {
    if (this.args.isCompact) {
      return 'compact-view';
    } else if (this.args.viewOption === 'grid') {
      return 'grid-view';
    } else if (this.args.viewOption === 'strip') {
      return 'strip-view';
    }
    return '';
  }

  get displayShowMore() {
    return this.hasMoreCards && !this.args.isCompact;
  }

  <template>
    <div
      class='search-result-block {{if @isCollapsed "collapsed"}}'
      ...attributes
    >
      {{#if this.realmSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @iconURL={{this.realmSection.realmInfo.iconURL}}
            @title={{this.realmSection.realmInfo.name}}
            @totalCount={{this.realmSection.totalCount}}
            @showOnlyLabel={{this.realmSection.realmInfo.name}}
            @showOnlyChecked={{@isFocused}}
            @onShowOnlyChange={{this.handleShowOnlyChange}}
          />
        {{/unless}}
        <div class='cards {{this.viewClass}}' data-test-search-cards-result>
          {{#each this.displayedRealmCards as |card i|}}
            {{#unless card.isError}}
              <div class='search-sheet-result__card-item'>
                <SearchResult
                  @component={{card.component}}
                  @cardId={{card.url}}
                  @isCompact={{@isCompact}}
                  @displayRealmName={{@isCompact}}
                  {{on 'click' (fn @handleCardSelect card.url)}}
                  data-test-search-sheet-search-result={{i}}
                />
              </div>
            {{/unless}}
          {{/each}}
        </div>
        {{#if this.displayShowMore}}
          <Button
            class='show-more'
            @kind='secondary-light'
            @size='small'
            {{on 'click' (fn this.handleShowMore this.realmSection.totalCount)}}
            data-test-search-sheet-show-more
          >
            Show
            {{this.nextShowMoreCount}}
            more cards ({{this.remainingCount}}
            not shown)
          </Button>
        {{/if}}
      {{else if this.urlSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @iconURL={{this.urlSection.realmInfo.iconURL}}
            @title={{this.urlSection.realmInfo.name}}
            @totalCount={{1}}
          />
        {{/unless}}
        <div class='cards {{this.viewClass}}'>
          <div class='search-sheet-result__card-item'>
            <SearchResult
              @card={{this.urlSection.card}}
              @cardId={{this.urlSection.card.id}}
              @isCompact={{@isCompact}}
              @displayRealmName={{@isCompact}}
              {{on 'click' (fn @handleCardSelect this.urlSection.card.id)}}
              data-test-search-sheet-search-result='0'
            />
          </div>
        </div>
      {{else if this.recentsSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @icon={{this.recentsIcon}}
            @title='Recents'
            @totalCount={{this.recentsSection.totalCount}}
            @showOnlyLabel='Recents'
            @showOnlyChecked={{@isFocused}}
            @onShowOnlyChange={{this.handleShowOnlyChange}}
          />
        {{/unless}}
        <div class='cards {{this.viewClass}}'>
          {{#each this.displayedRecentsCards as |card i|}}
            {{#if card}}
              <div class='search-sheet-result__card-item'>
                <SearchResult
                  @card={{card}}
                  @cardId={{card.id}}
                  @isCompact={{@isCompact}}
                  {{on 'click' (fn @handleCardSelect card.id)}}
                  @displayRealmName={{true}}
                  data-test-search-result-index={{i}}
                />
              </div>
            {{/if}}
          {{/each}}
        </div>
        {{#if this.displayShowMore}}
          <Button
            class='show-more'
            @kind='secondary-light'
            @size='small'
            {{on
              'click'
              (fn this.handleShowMore this.recentsSection.totalCount)
            }}
            data-test-search-sheet-show-more
          >
            Show
            {{this.nextShowMoreCount}}
            more cards ({{this.remainingCount}}
            not shown)
          </Button>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .search-result-block {
        display: flex;
        flex-direction: column;
        margin-bottom: var(--boxel-sp-lg);
      }
      .search-result-block.collapsed {
        opacity: 0.6;
      }
      .search-result-block.collapsed :deep(.search-sheet-section-header) {
        margin-bottom: 0;
        padding-bottom: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-400);
      }
      .search-result-block.collapsed .cards,
      .search-result-block.collapsed .show-more {
        display: none;
      }
      .cards {
        --gap: var(--boxel-sp);
        gap: var(--gap);
      }
      .cards.compact-view {
        --item-width: 250px;
        --item-height: 40px;
        display: flex;
        flex-wrap: nowrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0;
      }
      .cards.grid-view {
        --item-width: 186.2px;
        --item-height: 244px;
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--item-width));
        align-content: start;
      }
      .cards.strip-view {
        --item-height: 65px;
        --item-width: 100%;
        display: grid;
        grid-template-columns: 1fr;
        align-content: start;
      }
      .cards.grid-view .search-sheet-result__card-item,
      .cards.strip-view .search-sheet-result__card-item {
        width: 100%;
      }
      .show-more {
        margin-top: var(--boxel-sp);
        width: fit-content;
      }
    </style>
  </template>
}
