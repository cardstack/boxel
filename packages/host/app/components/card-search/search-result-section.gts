import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import HistoryIcon from '@cardstack/boxel-icons/history';
import pluralize from 'pluralize';

import { Button, GridContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { CodeRef } from '@cardstack/runtime-common';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type RealmService from '@cardstack/host/services/realm';

import { SECTION_SHOW_MORE_INCREMENT } from './constants';
import ItemButton from './item-button';
import SearchSheetSectionHeader from './section-header';

import type {
  RealmSection,
  RecentsSection,
  SearchSheetSection,
  UrlSection,
} from './search-content';
import type { NewCardArgs } from './utils';

interface Signature {
  Element: HTMLElement;
  Args: {
    section: SearchSheetSection;
    viewOption: string;
    isCompact: boolean;
    handleSelect: (selection: string | NewCardArgs) => void;
    isFocused: boolean;
    isCollapsed: boolean;
    onFocusSection: (sectionId: string | null) => void;
    getDisplayedCount?: (sectionId: string, totalCount: number) => number;
    onShowMore?: (sectionId: string, totalCount: number) => void;
    selectedCard?: string | NewCardArgs;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onSubmit?: (selection: string | NewCardArgs) => void;
  };
  Blocks: {};
}

export default class SearchResultSection extends Component<Signature> {
  @service declare realm: RealmService;

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

  get sectionRealmName(): string | undefined {
    if (this.realmSection) {
      return this.realmSection.realmInfo.name;
    }
    if (this.urlSection) {
      return this.urlSection.realmInfo.name;
    }
    return undefined;
  }

  get recentsTitle(): string {
    const count = this.recentsSection?.totalCount ?? 0;
    return pluralize('Recent', count);
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
    } else if (
      this.args.viewOption === 'grid' &&
      (this.displayedRealmCards.length > 0 ||
        this.displayedRecentsCards.length > 0 ||
        this.urlSection)
    ) {
      return 'grid-view';
    } else {
      return 'strip-view';
    }
  }

  get displayShowMore() {
    return this.hasMoreCards && !this.args.isCompact;
  }

  showCreateForRealm = (realmUrl: string): boolean => {
    return !!this.args.offerToCreate && this.realm.canWrite(realmUrl);
  };

  get selectedCardId(): string | undefined {
    const selected = this.args.selectedCard;
    return typeof selected === 'string' ? selected : undefined;
  }

  get isCreateNewSelected(): boolean {
    const selected = this.args.selectedCard;
    if (!this.realmSection || !selected || typeof selected === 'string') {
      return false;
    }
    return selected.realmURL === this.realmSection.realmUrl;
  }

  newCardArgs = (realmUrl: string): NewCardArgs => {
    if (!this.args.offerToCreate) {
      throw new Error(
        'cannot create newCardArgs without offerToCreate argument',
      );
    }
    const { ref, relativeTo } = this.args.offerToCreate;
    return {
      ref,
      relativeTo: relativeTo ? relativeTo.href : undefined,
      realmURL: realmUrl,
    };
  };

  private get cardSize() {
    if (this.viewClass === 'compact-view') {
      return 'single-strip';
    } else if (this.viewClass === 'strip-view') {
      return 'double-wide-strip';
    } else {
      return 'cardsgrid-tile';
    }
  }

  <template>
    <div
      class='search-result-block {{if @isCollapsed "collapsed"}}'
      data-test-realm={{this.sectionRealmName}}
      ...attributes
    >
      {{#if this.realmSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @realmInfo={{this.realmSection.realmInfo}}
            @title={{this.realmSection.realmInfo.name}}
            @totalCount={{this.realmSection.totalCount}}
            @showOnlyLabel={{this.realmSection.realmInfo.name}}
            @showOnlyChecked={{@isFocused}}
            @onShowOnlyChange={{this.handleShowOnlyChange}}
          />
        {{/unless}}
        <GridContainer
          class='cards {{this.viewClass}}'
          @viewFormat={{if (eq this.viewClass 'grid-view') 'grid' 'list'}}
          @size={{this.cardSize}}
          data-test-search-cards-result
        >
          {{#if (this.showCreateForRealm this.realmSection.realmUrl)}}
            <ItemButton
              @item={{this.newCardArgs this.realmSection.realmUrl}}
              @isSelected={{this.isCreateNewSelected}}
              @isCompact={{@isCompact}}
              @onSelect={{@handleSelect}}
              @onSubmit={{@onSubmit}}
            />
          {{/if}}
          {{#each this.displayedRealmCards as |card i|}}
            {{#unless card.isError}}
              <ItemButton
                @item={{card.component}}
                @itemId={{card.url}}
                @isSelected={{eq this.selectedCardId card.url}}
                @isCompact={{@isCompact}}
                @displayRealmName={{@isCompact}}
                @onSelect={{@handleSelect}}
                @onSubmit={{@onSubmit}}
                data-test-search-sheet-search-result={{i}}
              />
            {{/unless}}
          {{/each}}
        </GridContainer>
        {{#if this.displayShowMore}}
          <Button
            class='show-more'
            @kind='secondary-light'
            @size='small'
            {{on 'click' (fn this.handleShowMore this.realmSection.totalCount)}}
            data-test-search-sheet-show-more
            data-test-show-more-cards
          >
            Show
            {{this.nextShowMoreCount}}
            more
            {{pluralize 'card' this.nextShowMoreCount}}
            ({{this.remainingCount}}
            not shown)
          </Button>
        {{/if}}
      {{else if this.urlSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @realmInfo={{this.urlSection.realmInfo}}
            @title={{this.urlSection.realmInfo.name}}
            @totalCount={{1}}
          />
        {{/unless}}
        <GridContainer
          class='cards {{this.viewClass}}'
          @viewFormat={{if (eq this.viewClass 'grid-view') 'grid' 'list'}}
          @size={{this.cardSize}}
        >
          <ItemButton
            @item={{this.urlSection.card}}
            @itemId={{this.urlSection.card.id}}
            @isSelected={{eq this.selectedCardId this.urlSection.card.id}}
            @isCompact={{@isCompact}}
            @displayRealmName={{@isCompact}}
            @onSelect={{@handleSelect}}
            @onSubmit={{@onSubmit}}
            data-test-search-sheet-search-result='0'
          />
        </GridContainer>
      {{else if this.recentsSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @icon={{this.recentsIcon}}
            @title={{this.recentsTitle}}
            @totalCount={{this.recentsSection.totalCount}}
            @showOnlyLabel={{this.recentsTitle}}
            @showOnlyChecked={{@isFocused}}
            @onShowOnlyChange={{this.handleShowOnlyChange}}
          />
        {{/unless}}

        <GridContainer
          class='cards {{this.viewClass}}'
          @items={{this.displayedRecentsCards}}
          @viewFormat={{if (eq this.viewClass 'grid-view') 'grid' 'list'}}
          @size={{this.cardSize}}
          @fullWidthItem={{eq this.viewClass 'strip-view'}}
          as |card GridItem i|
        >
          <GridItem class={{if @isCompact 'item-button-container'}}>
            <:default>
              <ItemButton
                @item={{card}}
                @itemId={{card.id}}
                @isSelected={{eq this.selectedCardId card.id}}
                @isCompact={{@isCompact}}
                @displayRealmName={{true}}
                @onSelect={{@handleSelect}}
                @onSubmit={{@onSubmit}}
                data-test-search-result-index={{i}}
              />
            </:default>
            <:after>
              {{#if card}}
                {{#let
                  (this.realm.info (urlForRealmLookup card))
                  as |realmInfo|
                }}
                  <div
                    class={{cn
                      'realm-name'
                      boxel-ellipsize=@isCompact
                      realm-name--compact=@isCompact
                    }}
                    data-test-realm-name
                  >
                    in
                    {{realmInfo.name}}
                  </div>
                {{/let}}
              {{/if}}
            </:after>
          </GridItem>
        </GridContainer>

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
            data-test-show-more-cards
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
      .compact-view {
        display: flex;
        flex-flow: row nowrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0;
      }
      .grid-view :deep(.create-new-button) {
        flex-direction: column;
        justify-content: center;
      }
      .show-more {
        margin-top: var(--boxel-sp);
        width: fit-content;
      }
      .item-button-container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
      }
      .realm-name {
        padding-top: var(--boxel-sp-4xs);
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      .realm-name--compact {
        max-width: 15rem;
      }
    </style>
  </template>
}
