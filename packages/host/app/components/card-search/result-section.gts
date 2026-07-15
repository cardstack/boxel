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
  removeCardJsonExtension,
  type NewCardArgs,
} from '@cardstack/host/utils/card-search/types';

import { SECTION_SHOW_MORE_INCREMENT } from './constants';
import ResultTile from './result-tile';
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
      `result-section: rendering with placeholder realm name for ${realmUrl} — realm.info() returned "${UNKNOWN_REALM_NAME}" because fetchInfo has not resolved yet. If a test failed selecting on data-test-realm here, this is the race.`,
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
    // When true, the tiles render the Adorn visual treatment (teal hover
    // type-label tab + selection chip) rather than the plain grey
    // hover/selection visuals.
    adorn?: boolean;
    // The outline class yielded by the enclosing <AdornContext>, threaded
    // down to each tile.
    adornStrokeClass?: string;
    // The pre-wired label positioner yielded by the enclosing <AdornContext>,
    // threaded down to each tile.
    adornPositionLabel?: ModifierLike<{
      Element: HTMLElement;
      Args: { Positional: [cardEl: HTMLElement | undefined] };
    }>;
    // Opt-in visual variant. 'mini' forces single-strip rows, suppresses the
    // per-section "show only" toggle, and un-hides the recents count.
    variant?: 'default' | 'mini';
  };
  Blocks: {};
}

// One section of the search-results pane — a realm group, the URL-paste row, or
// the recents row. Lays its rows out into a grid of `ResultTile`s; each tile
// renders through the entry rendering surface (an entry's
// `entry.component`, or a live `CardDef` for the URL paste / live-recents
// fallback).
export default class ResultSection extends Component<Signature> {
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

  get isMini(): boolean {
    return this.args.variant === 'mini';
  }

  // Recents rows go through FittedCardContainer, which writes an inline
  // `width: <single-strip width>px` unless @fullWidthItem is set. The mini
  // variant wants every row to fill the chooser's narrow envelope, same
  // as strip-view does in the full search sheet.
  get useFullWidthItem(): boolean {
    return this.viewClass === 'strip-view' || this.isMini;
  }

  get viewClass() {
    if (this.args.isCompact || this.isMini) {
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

  showSelectedCheckmark = (cardUrl: string): boolean => {
    return this.isMini && this.isCardSelected(cardUrl);
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
        search-result-block--mini=this.isMini
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
          @showOnlyLabel={{unless this.isMini this.realmSection.realmInfo.name}}
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
            <ResultTile
              @newCard={{this.newCardArgs this.realmSection.realmUrl}}
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
              <ResultTile
                @entry={{card}}
                @isSelected={{this.isCardSelected card.id}}
                @showSelectedCheckmark={{this.showSelectedCheckmark card.id}}
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
            {{pluralize 'result' this.nextShowMoreCount}}
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
          <ResultTile
            @card={{this.urlSection.card}}
            @isSelected={{this.isCardSelected this.urlSection.card.id}}
            @multiSelect={{@multiSelect}}
            @showSelectedCheckmark={{this.isMini}}
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
          {{#if this.isMini}}
            <SearchSheetSectionHeader
              @icon={{this.recentsIcon}}
              @title='Recents'
              @totalCount={{this.recentsSection.totalCount}}
            />
          {{else}}
            <SearchSheetSectionHeader
              @icon={{this.recentsIcon}}
              @title='Recents'
              @hideCount={{true}}
              @showOnlyLabel='Recents'
              @showOnlyChecked={{@isFocused}}
              @onShowOnlyChange={{this.handleShowOnlyChange}}
            />
          {{/if}}
        {{/unless}}

        {{#if (eq this.recentsSection.kind 'prerendered')}}
          <GridContainer
            class='cards {{this.viewClass}}'
            @items={{this.displayedPrerenderedRecents}}
            @viewFormat={{this.viewFormat}}
            @size={{this.cardSize}}
            @fullWidthItem={{this.useFullWidthItem}}
            as |card GridItem|
          >
            <GridItem class={{if @isCompact 'recent-card-item--compact'}}>
              <:default>
                <ResultTile
                  @entry={{card}}
                  @isSelected={{this.isCardSelected card.id}}
                  @multiSelect={{@multiSelect}}
                  @showSelectedCheckmark={{this.isMini}}
                  @onSelect={{@handleSelect}}
                  @onSubmit={{@onSubmit}}
                  @adorn={{@adorn}}
                  @adornStrokeClass={{@adornStrokeClass}}
                  @adornPositionLabel={{@adornPositionLabel}}
                  data-test-recent-card-result={{removeCardJsonExtension
                    card.id
                  }}
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
            @fullWidthItem={{this.useFullWidthItem}}
            as |card GridItem|
          >
            <GridItem class={{if @isCompact 'recent-card-item--compact'}}>
              <:default>
                <ResultTile
                  @card={{card}}
                  @isSelected={{this.isCardSelected card.id}}
                  @multiSelect={{@multiSelect}}
                  @showSelectedCheckmark={{this.isMini}}
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
            more
            {{pluralize 'result' this.nextShowMoreCount}}
            ({{this.remainingCount}}
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
      .search-result-block--mini .show-more {
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        font-weight: 600;
      }
      .search-result-block--mini {
        margin-bottom: var(--boxel-sp);
      }
      /* The recents/realm "in {realm}" caption is rendered as a GridItem
         :after — hide it in the mini variant so each row collapses to icon
         + name only. The Spec card type also renders a `spec-tag-pill`
         badge inside its prerendered body; suppress it for the same
         single-line reason. */
      .search-result-block--mini .realm-name,
      .search-result-block--mini :deep(.spec-tag-pill) {
        display: none;
      }
      /* `.compact-view` was authored for the horizontal quick-menu strip
         (row of cards scrolling sideways). The mini chooser wants the
         opposite — a vertical list of single-line rows, one per card. */
      .search-result-block--mini .compact-view {
        flex-flow: column nowrap;
        gap: 0;
      }
      /* The realm/recents section header is bottom-margined for the full
         search-sheet layout; in mini it sits right above the rows, so
         tighten the gap. */
      .search-result-block--mini :deep(.search-sheet-section-header) {
        margin-bottom: var(--boxel-sp-xxs);
        padding-block: var(--boxel-sp-xs);
      }
      /* Rows in the mini variant are bare — no border or hover shadow.
         Selection is signaled by a teal fill + a black checkmark on the
         right, matching the design. */
      .search-result-block--mini :deep(.item-button) {
        border: none;
        background-color: transparent;
        border-radius: var(--boxel-border-radius);
      }
      .search-result-block--mini :deep(.item-button:hover) {
        box-shadow: none;
        background-color: var(--boxel-200);
      }
      .search-result-block--mini :deep(.item-button.selected),
      .search-result-block--mini :deep(.item-button.selected:hover) {
        background-color: var(--boxel-highlight);
        box-shadow: none;
        border: none;
        --background: transparent;
        --card: transparent;
      }
      /* The Button's own scoped CSS sets `background-color` via the
         `--boxel-button-color` variable; override that var here too so
         the teal fill wins regardless of which selector lands first. */
      .search-result-block--mini :deep(.item-button.selected) {
        --boxel-button-color: var(--boxel-highlight);
      }
      /* The fitted-format card template (and the prerendered HTML for
         each card type) renders with its own opaque background — that
         covers the Button's teal so only the strip of padding around
         the card would show through. Force every descendant of a
         selected row to transparent so the teal reads end-to-end.
         SVG fills (e.g. the CheckMark icon) aren't `background-color`,
         so the icon glyph stays visible. */
      .search-result-block--mini :deep(.item-button.selected *) {
        background-color: transparent;
        background-image: none;
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
