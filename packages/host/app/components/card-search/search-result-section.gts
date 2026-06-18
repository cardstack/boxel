import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import HistoryIcon from '@cardstack/boxel-icons/history';
import { modifier } from 'ember-modifier';
import pluralize from 'pluralize';

import { Button, GridContainer } from '@cardstack/boxel-ui/components';
import { cn, eq, type FittedFormatId } from '@cardstack/boxel-ui/helpers';

import type { CodeRef } from '@cardstack/runtime-common';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type RealmService from '@cardstack/host/services/realm';
import { UNKNOWN_REALM_NAME } from '@cardstack/host/services/realm';

import type {
  RealmSection,
  RecentsSection,
  SearchSheetSection,
  UrlSection,
} from '@cardstack/host/utils/card-search/sections';

import {
  removeFileExtension,
  type NewCardArgs,
} from '@cardstack/host/utils/card-search/types';

import { SECTION_SHOW_MORE_INCREMENT } from './constants';
import ItemButton from './item-button';
import SearchSheetSectionHeader from './section-header';

import type { ModifierLike } from '@glint/template';

// Tracks which realm URLs we've already warned about to keep the diagnostic
// to one-per-realm-per-test-run. Only populated under `isTesting()` (the
// warning is silenced in production), so growth is bounded by realms
// touched within a single test run / page session — typically a handful.
const placeholderWarnedFor = new Set<string>();

// did-insert / did-update modifier that emits a one-shot console.warn per
// realm URL when the section renders with the placeholder realm name.
// The warning lands in the browser log captured by Ember Exam, so a
// future recurrence of the realm-info race shows up in CI logs even
// without a DOM dump. Kept off the render path (no side effects in
// getters) and gated to test runs (no production logging or set growth).
const warnPlaceholderModifier = modifier(
  (
    _element: Element,
    [realmUrl, isPlaceholder]: [string | undefined, boolean],
  ) => {
    if (!isTesting()) return;
    if (!isPlaceholder || !realmUrl) return;
    if (placeholderWarnedFor.has(realmUrl)) return;
    placeholderWarnedFor.add(realmUrl);
    console.warn(
      `search-result-section: rendering with placeholder realm name for ${realmUrl} — realm.info() returned "${UNKNOWN_REALM_NAME}" because fetchInfo has not resolved yet. If a test failed selecting on data-test-realm here, this is the race.`,
    );
  },
);

interface Signature {
  Element: HTMLElement;
  Args: {
    section: SearchSheetSection;
    viewOption?: string;
    isCompact?: boolean;
    handleSelect: (selection: string | NewCardArgs) => void;
    isFocused?: boolean;
    isCollapsed?: boolean;
    onFocusSection?: (sectionId: string | null) => void;
    getDisplayedCount?: (sectionId: string, totalCount: number) => number;
    onShowMore?: (sectionId: string, totalCount: number) => void;
    selectedCards?: (string | NewCardArgs)[];
    multiSelect?: boolean;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onSubmit?: (selection: string | NewCardArgs) => void;
    // When true, ItemButton renders the Adorn visual treatment (teal hover
    // type-label tab + teal selection chip) rather than the legacy grey
    // hover/selection visuals.
    adorn?: boolean;
    // The outline class yielded by the enclosing <AdornContext>,
    // threaded down to each ItemButton.
    adornStrokeClass?: string;
    // The pre-wired label positioner yielded by the enclosing
    // <AdornContext>, threaded down to each ItemButton.
    adornPositionLabel?: ModifierLike<{
      Element: HTMLElement;
      Args: { Positional: [cardEl: HTMLElement | undefined] };
    }>;
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

  // Stable identifier for the realm section regardless of whether
  // `realm.info()` has resolved the user-visible name yet. When
  // `data-test-realm` (the name) is still showing the placeholder
  // ("Unknown Workspace"), this attribute pins the section to a known
  // URL so failures are diagnosable and tests can wait reliably.
  get sectionRealmUrl(): string | undefined {
    if (this.realmSection) {
      return this.realmSection.realmUrl;
    }
    if (this.urlSection) {
      return this.urlSection.realmUrl;
    }
    return undefined;
  }

  // True when the section header is showing the placeholder name returned
  // by `RealmService#info()` before its fetchInfo resolves. Surfaced as a
  // data-test attribute and consumed by `warnPlaceholderModifier`, so
  // future CI failures involving `[data-test-realm="<Name>"]` selectors
  // are immediately diagnosable (the browser log will show which realm
  // URL raced its info fetch).
  get sectionRealmInfoIsPlaceholder(): boolean {
    return this.sectionRealmName === UNKNOWN_REALM_NAME;
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
    if (this.args.isCompact) {
      // do not limit the cards in the quick menu and keep last-updated sort order
      return section.cards;
    }
    const sid = this.args.section.sid;
    const getDisplayedCount = this.args.getDisplayedCount;
    if (!sid || !getDisplayedCount) return section.cards;
    const limit = getDisplayedCount(sid, section.totalCount);
    return section.cards.slice(0, limit);
  }

  get displayedPrerenderedRecents() {
    const section = this.recentsSection;
    if (!section || section.kind !== 'prerendered') return [];
    return this.displayedRecentsCards as typeof section.cards;
  }

  get displayedLiveRecents() {
    const section = this.recentsSection;
    if (!section || section.kind !== 'live') return [];
    return this.displayedRecentsCards as typeof section.cards;
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

  get viewFormat() {
    return this.viewClass === 'grid-view' ? 'grid' : 'list';
  }

  get displayShowMore() {
    return this.hasMoreCards && !this.args.isCompact;
  }

  showCreateForRealm = (realmUrl: string): boolean => {
    return !!this.args.offerToCreate && this.realm.canWrite(realmUrl);
  };

  isCardSelected = (cardUrl: string): boolean => {
    const selected = this.args.selectedCards;
    if (!selected) return false;
    const normalized = cardUrl.replace(/\.json$/, '');
    return selected.some(
      (s) => typeof s === 'string' && s.replace(/\.json$/, '') === normalized,
    );
  };

  get isCreateNewSelected(): boolean {
    const selected = this.args.selectedCards;
    if (!this.realmSection || !selected) {
      return false;
    }
    return selected.some(
      (s) =>
        typeof s !== 'string' && s.realmURL === this.realmSection!.realmUrl,
    );
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

  private get cardSize(): FittedFormatId {
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
      class={{cn
        'search-result-block'
        search-result-block--collapsed=@isCollapsed
      }}
      data-test-realm={{this.sectionRealmName}}
      data-test-realm-url={{this.sectionRealmUrl}}
      data-test-realm-info-placeholder={{if
        this.sectionRealmInfoIsPlaceholder
        'true'
      }}
      {{warnPlaceholderModifier
        this.sectionRealmUrl
        this.sectionRealmInfoIsPlaceholder
      }}
      ...attributes
    >
      {{#if this.realmSection}}
        <SearchSheetSectionHeader
          @realmInfo={{this.realmSection.realmInfo}}
          @title={{this.realmSection.realmInfo.name}}
          @totalCount={{this.realmSection.totalCount}}
          @showOnlyLabel={{this.realmSection.realmInfo.name}}
          @showOnlyChecked={{@isFocused}}
          @onShowOnlyChange={{this.handleShowOnlyChange}}
        />
        <GridContainer
          class='cards {{this.viewClass}}'
          @viewFormat={{this.viewFormat}}
          @size={{this.cardSize}}
          data-test-search-cards-result
        >
          {{#if (this.showCreateForRealm this.realmSection.realmUrl)}}
            <ItemButton
              @item={{this.newCardArgs this.realmSection.realmUrl}}
              @isSelected={{this.isCreateNewSelected}}
              @multiSelect={{@multiSelect}}
              @onSelect={{@handleSelect}}
              @onSubmit={{@onSubmit}}
              @adorn={{@adorn}}
              @adornStrokeClass={{@adornStrokeClass}}
              @adornPositionLabel={{@adornPositionLabel}}
            />
          {{/if}}
          {{#each this.displayedRealmCards as |card i|}}
            {{#unless card.isError}}
              <ItemButton
                @item={{card.component}}
                @itemId={{card.id}}
                @isSelected={{this.isCardSelected card.id}}
                @multiSelect={{@multiSelect}}
                @onSelect={{@handleSelect}}
                @onSubmit={{@onSubmit}}
                @adorn={{@adorn}}
                @adornStrokeClass={{@adornStrokeClass}}
                @adornPositionLabel={{@adornPositionLabel}}
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
        <SearchSheetSectionHeader
          @realmInfo={{this.urlSection.realmInfo}}
          @title={{this.urlSection.realmInfo.name}}
          @totalCount={{1}}
        />
        <GridContainer
          class='cards {{this.viewClass}}'
          @viewFormat={{this.viewFormat}}
          @size={{this.cardSize}}
        >
          <ItemButton
            @item={{this.urlSection.card}}
            @itemId={{this.urlSection.card.id}}
            @isSelected={{this.isCardSelected this.urlSection.card.id}}
            @multiSelect={{@multiSelect}}
            @onSelect={{@handleSelect}}
            @onSubmit={{@onSubmit}}
            @adorn={{@adorn}}
            @adornStrokeClass={{@adornStrokeClass}}
            @adornPositionLabel={{@adornPositionLabel}}
            data-test-search-sheet-search-result='0'
          />
        </GridContainer>
      {{else if this.recentsSection}}
        {{#unless @isCompact}}
          <SearchSheetSectionHeader
            @icon={{this.recentsIcon}}
            @title='Recents'
            @hideCount={{true}}
            @showOnlyLabel='Recents'
            @showOnlyChecked={{@isFocused}}
            @onShowOnlyChange={{this.handleShowOnlyChange}}
          />
        {{/unless}}

        {{#if (eq this.recentsSection.kind 'prerendered')}}
          <GridContainer
            class='cards {{this.viewClass}}'
            @items={{this.displayedPrerenderedRecents}}
            @viewFormat={{this.viewFormat}}
            @size={{this.cardSize}}
            @fullWidthItem={{eq this.viewClass 'strip-view'}}
            as |card GridItem|
          >
            <GridItem class={{if @isCompact 'recent-card-item--compact'}}>
              <:default>
                <ItemButton
                  @item={{card.component}}
                  @itemId={{card.id}}
                  @isSelected={{this.isCardSelected card.id}}
                  @multiSelect={{@multiSelect}}
                  @onSelect={{@handleSelect}}
                  @onSubmit={{@onSubmit}}
                  @adorn={{@adorn}}
                  @adornStrokeClass={{@adornStrokeClass}}
                  @adornPositionLabel={{@adornPositionLabel}}
                  data-test-recent-card-result={{removeFileExtension card.id}}
                />
              </:default>
              <:after>
                {{#let (this.realm.info card.realmUrl) as |realmInfo|}}
                  <div
                    class={{cn
                      'realm-name'
                      realm-name--compact=@isCompact
                      boxel-ellipsize=@isCompact
                    }}
                    data-test-realm-name
                  >
                    in
                    {{realmInfo.name}}
                  </div>
                {{/let}}
              </:after>
            </GridItem>
          </GridContainer>
        {{else}}
          <GridContainer
            class='cards {{this.viewClass}}'
            @items={{this.displayedLiveRecents}}
            @viewFormat={{this.viewFormat}}
            @size={{this.cardSize}}
            @fullWidthItem={{eq this.viewClass 'strip-view'}}
            as |card GridItem|
          >
            <GridItem class={{if @isCompact 'recent-card-item--compact'}}>
              <:default>
                <ItemButton
                  @item={{card}}
                  @itemId={{card.id}}
                  @isSelected={{this.isCardSelected card.id}}
                  @multiSelect={{@multiSelect}}
                  @onSelect={{@handleSelect}}
                  @onSubmit={{@onSubmit}}
                  @adorn={{@adorn}}
                  @adornStrokeClass={{@adornStrokeClass}}
                  @adornPositionLabel={{@adornPositionLabel}}
                  data-test-recent-card-result={{card.id}}
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
                        realm-name--compact=@isCompact
                        boxel-ellipsize=@isCompact
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
        {{/if}}

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
      .search-result-block--collapsed {
        opacity: 0.6;
      }
      .search-result-block--collapsed :deep(.search-sheet-section-header) {
        margin-bottom: 0;
        padding-bottom: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-400);
      }
      .search-result-block--collapsed .cards,
      .search-result-block--collapsed .show-more {
        display: none;
      }
      .grid-view :deep(.create-new-button) {
        flex-direction: column;
        justify-content: center;
      }
      .show-more {
        margin-top: var(--boxel-sp);
        width: fit-content;
      }
      .realm-name {
        padding-top: var(--boxel-sp-4xs);
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      .compact-view {
        display: flex;
        flex-flow: row nowrap;
        gap: var(--boxel-sp-xs);
      }
      .recent-card-item--compact {
        display: flex;
        flex-direction: column;
        align-items: self-end;
      }
      .realm-name--compact {
        max-width: 15rem;
      }
    </style>
  </template>
}
