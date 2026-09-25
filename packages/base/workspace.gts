import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { htmlSafe, type SafeString } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { TrackedArray, TrackedObject, TrackedSet } from 'tracked-built-ins';

import {
  BoxelInput,
  Button,
  FilterList,
  IconButton,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { and, bool, cn, eq } from '@cardstack/boxel-ui/helpers';
import BooleanField from './boolean';
// host-mode mutation: publish and unpublish are registered host tools
// (tools/index.ts shims them onto the loader's virtual network, so these
// specifiers resolve for card code in operator mode and under prerender)
import GetPublishedRealmsTool from '@cardstack/boxel-host/tools/get-published-realms';
import PublishRealmTool from '@cardstack/boxel-host/tools/publish-realm';
import UnpublishRealmTool from '@cardstack/boxel-host/tools/unpublish-realm';
import {
  GetPublishedRealmsInput,
  PublishRealmInput,
  UnpublishRealmInput,
  type PublishedRealmInfo,
  type PublishTargetResult,
} from './command';

import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import Captions from '@cardstack/boxel-icons/captions';
import FileIcon from '@cardstack/boxel-icons/file';
import HouseIcon from '@cardstack/boxel-icons/house';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import ActivityIcon from '@cardstack/boxel-icons/activity';
import DoorOpenIcon from '@cardstack/boxel-icons/door-open';
import SearchIcon from '@cardstack/boxel-icons/search';
import XIcon from '@cardstack/boxel-icons/x';
import PlusIcon from '@cardstack/boxel-icons/plus';
import PanelLeftCloseIcon from '@cardstack/boxel-icons/panel-left-close';
import PanelLeftOpenIcon from '@cardstack/boxel-icons/panel-left-open';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';

import type { CardErrorJSONAPI } from '@cardstack/runtime-common';
import {
  chooseCard,
  codeRef,
  specRef,
  baseCardRef,
  baseFileRef,
  baseRealmRRI,
  executableExtensions,
  inferContentType,
  isCardInstance,
  isFileDefInstance,
  excludeCardInstanceFileRows,
  SupportedMimeType,
  subscribeToRealm,
  codeRefFromInternalKey,
  type Query,
  type Filter,
  type CodeRef,
} from '@cardstack/runtime-common';

import CardsGridLayout, {
  VIEW_OPTIONS,
  SORT_OPTIONS,
  type FilterOption,
  type ViewOption,
  type SortOption,
} from './components/cards-grid-layout';

import {
  contains,
  field,
  getCardMeta,
  linksTo,
  linksToMany,
  Component,
  CardDef,
  realmInfo,
  realmURL,
  StringField,
  type BaseDef,
  type BoxComponent,
  type FileDef,
} from './card-api';
import { MarkdownDef } from './markdown-file-def'; // realm README
// Content-only markdown renderer: the README's prose with no file shell chrome
// (no file bar, metadata, or fixed-height scroll box). The card owns the frame.
// Imported from its own module rather than the `file-formats/index` barrel,
// which would also pull the audio renderer and the metadata field shapes into
// this card's graph for nothing.
import { MarkdownPreview } from './file-formats/markdown-preview';
import type { RealmEventContent } from './matrix-event';
import type { Spec } from './spec';
import { now as clockNow, nowDate } from './helpers/clock';

// This file is always loaded through the Boxel loader, which supplies
// `import.meta`. When type-checking, tsc sees the file as CommonJS output and
// rejects the meta-property, so suppress it — the same pattern used elsewhere
// in packages/base.
// @ts-ignore
const here: string = (import.meta as any).url;

// Below this width the Library pane starts with its filter rail closed.
const LIBRARY_NARROW_WIDTH_REM = 40;

function remToPx(rem: number): number {
  let rootSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return rem * (Number.isFinite(rootSize) ? rootSize : 16);
}

const [, StripView, GridView] = VIEW_OPTIONS;

type Segment = 'home' | 'library' | 'activity';

// The frame's three sections, in tab order.
const SEGMENTS: { id: Segment; label: string; icon: typeof HouseIcon }[] = [
  { id: 'home', label: 'Home', icon: HouseIcon },
  { id: 'library', label: 'Library', icon: LayoutGridIcon },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
];

// A rail row is a stock FilterOption plus the count shown right-aligned in
// the sidebar; library-group counts are computed live via `countFor`.
type RailOption = Omit<FilterOption, 'icon'> & {
  count?: number;
  icon?: string | typeof SearchIcon;
};

// Job cards carry setup progress (ProcessCard contract fields).
type JobCard = CardDef & {
  listingName?: string;
  progressDone?: number;
  progressTotal?: number;
  stage?: string; // the current step, echoed on the Home setup bar
  startedAt?: string; // for the honest ETA on Home
  setupSurvey?: CardDef; // the separate, optional themed survey card
};

// A projected ETA further out than this many minutes reads as noise rather
// than signal, so it is suppressed.
const ETA_IMPLAUSIBLE_MINUTES = 30;

// honest ETA (same rules as the job card): linear from arrival rate, only
// once 3 pieces are in, suppressed when implausible (see the threshold above).
// The subset of a job card the ETA reads. A full `JobCard` satisfies it.
export interface EtaJob {
  progressDone?: number;
  progressTotal?: number;
  startedAt?: string | Date;
}

export function etaMinutes(
  job: EtaJob,
  now: number = clockNow(),
): number | undefined {
  let done = job.progressDone ?? 0;
  let total = job.progressTotal ?? 0;
  let started = job.startedAt ? new Date(job.startedAt).getTime() : undefined;
  if (done < 3 || total <= done || !started) {
    return undefined;
  }
  let elapsed = now - started;
  if (elapsed <= 0) {
    return undefined;
  }
  let mins = Math.round(((elapsed / done) * (total - done)) / 60000);
  return mins > ETA_IMPLAUSIBLE_MINUTES ? undefined : mins;
}

// The verbs the Activity feed labels an event with. A card save is classified
// as Created/Updated by timing; a RemixCard instance is a first-class Remixed
// event regardless of when it was written.
export type ActivityVerb = 'Created' | 'Updated' | 'Remixed';

// A card modified within this window of its creation reads as "Created" in
// the Activity feed rather than "Updated".
const CREATED_WINDOW_MS = 120000;

// Setup progress is announced on crossing a multiple of this, rather than on
// every change, so a long-running job reports in a few times instead of
// continuously.
const PROGRESS_ANNOUNCE_STEP = 25;

// Rounds a live percentage down to the last announced milestone. The status
// region's text is derived from this, so it only changes when a milestone is
// crossed — that is what keeps a job whose meter advances every few seconds from
// interrupting a screen reader every few seconds.
export function progressMilestone(pct: number): number {
  return (
    Math.floor(Math.max(0, pct) / PROGRESS_ANNOUNCE_STEP) *
    PROGRESS_ANNOUNCE_STEP
  );
}

// The text the search status region announces once a search has settled.
// `shown` is what the dropdown lists (capped), `total` the full hit count.
// A settled zero is a real "no matches"; the caller is responsible for only
// reaching here on settle, never for the empty debounce or dismissal windows.
export function describeSearchResults(shown: number, total: number): string {
  if (!shown) {
    return 'No matching cards';
  }
  if (total > shown) {
    return `Showing ${shown} of ${total} results`;
  }
  return shown === 1 ? '1 result' : `${shown} results`;
}

export function classifyActivityVerb(
  modMs: number | undefined,
  createdMs: number | undefined,
): 'Created' | 'Updated' {
  return modMs !== undefined &&
    createdMs !== undefined &&
    Math.abs(modMs - createdMs) < CREATED_WINDOW_MS
    ? 'Created'
    : 'Updated';
}

// RemixCard's displayName. The feed recognizes a remix structurally (by
// displayName, like SYSTEM_TYPE_NAMES) so this module keeps compiling without a
// static RemixCard import — matching how loadJobs references it via codeRef.
const REMIX_TYPE_NAME = 'Remix';
// The subset of RemixCard the feed reads: the source it was cloned from.
type RemixCardLike = CardDef & { remixedFrom?: CardDef };

// The Activity feed verb for a card. A RemixCard instance is the record of a
// clone, so it is a first-class "Remixed" event regardless of write timing;
// every other card is Created/Updated by how close its save is to its creation.
export function activityVerbFor(
  displayName: string | undefined,
  modMs: number | undefined,
  createdMs: number | undefined,
): ActivityVerb {
  return displayName === REMIX_TYPE_NAME
    ? 'Remixed'
    : classifyActivityVerb(modMs, createdMs);
}

// How the Frame typeahead's hotkey is spelled on the platform the user is
// actually on. `setupSearchHotkey` binds `metaKey || ctrlKey`, so both spellings
// work everywhere and this is purely about naming the one they'd reach for.
// Matches on `Mac`, as codemirror-editor.gts's own mod-key label does.
export function searchHotkeyLabel(platform: string): string {
  return /Mac/i.test(platform) ? '⌘K' : 'Ctrl+K';
}

// Resolved once, against whichever browser evaluates this module. In the app
// that is the user's own, which is the case this is for. A prerender pass
// resolves it against the prerender browser instead, so generated HTML carries
// that machine's spelling until the app renders the card live.
const SEARCH_HOTKEY_LABEL = searchHotkeyLabel(
  typeof navigator === 'undefined' ? '' : navigator.platform,
);

type RealmConfigCard = CardDef & { iconURL?: string }; // RealmConfig shape

// Home modules in the administrator's order; unknown tokens dropped,
// missing tokens appended so a stale CSV can never lose a section.
const HOME_MODULES = ['pinned', 'about', 'browse'];

function homeModulesOf(model: Partial<Workspace>): string[] {
  let configured = (model.moduleOrder ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => HOME_MODULES.includes(s));
  for (let k of HOME_MODULES) {
    if (!configured.includes(k)) {
      configured.push(k);
    }
  }
  return configured;
}

interface PublishedSite {
  url: string;
  host: string;
  when?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// One row of the hosting list. `at` is an epoch-ms timestamp in whichever form
// its source hands over — a number from meta.realmInfo, a string from the
// get-published-realms tool — and is absent for a destination the server has
// no publish timestamp for, which must read as "no date" rather than 1970.
function publishedSite(url: string, at: unknown): PublishedSite {
  let ms = at == null || at === '' ? NaN : Number(at);
  return {
    url,
    host: hostOf(url),
    when: Number.isFinite(ms) ? relativeTime(ms) : undefined,
  };
}

// published sites, read synchronously off meta.realmInfo (source-realm
// shape: lastPublishedAt is a map of publishedRealmURL → epoch-ms string)
function publishedSitesOf(model: Partial<Workspace>): PublishedSite[] {
  let info = model[realmInfo];
  let published = info?.lastPublishedAt;
  if (!published || typeof published !== 'object') {
    return [];
  }
  return Object.entries(published).map(([url, at]) => publishedSite(url, at));
}

// Types that are machinery rather than content — the Home inventory folds
// them behind one "System (n)" link. The Library rail still lists them all.
const SYSTEM_TYPE_NAMES = new Set([
  'Theme',
  'Realm Config',
  REMIX_TYPE_NAME,
  'Spec',
  'Skill',
  'Process',
  'Onboarding Survey',
  'Setup Survey',
]);

// The Workspace index card and the legacy Cards Grid index card are
// self-referential: every Library / search / feed / pin query hides them so a
// workspace never lists itself. Kept in one place — hiding a third
// self-referential type means editing only this list, not each query site.
const SELF_REFERENTIAL_CARD_TYPES = ['Cards Grid', 'Workspace'];
function excludeSelfReferentialCards(on?: CodeRef): Filter[] {
  return SELF_REFERENTIAL_CARD_TYPES.map((_cardType) =>
    on ? { not: { on, eq: { _cardType } } } : { not: { eq: { _cardType } } },
  );
}

// Source modules (.gts, .ts, …) index as `file` rows just like uploaded
// assets, but the Activity feed is a content stream — cards and uploaded
// files, not code edits. The exclusion must live in the query rather than the
// render loop: the server-side row budget is shared across both kinds, so a
// realm under active code editing would otherwise fill the window with module
// saves and evict every card. Deriving the content types from
// `executableExtensions` through the same `inferContentType` the file indexer
// stamps rows with keeps the filter and the index in lockstep. The negation is
// qualified with `on: baseFileRef` so it wraps a type gate card rows fail — a
// bare negated match on a key card rows lack is SQL NULL, which would drop
// them all.
function excludeExecutableFiles(): Filter {
  return {
    not: {
      on: baseFileRef,
      any: executableExtensions.map((extension) => ({
        eq: { contentType: inferContentType(`module${extension}`) },
      })),
    },
  };
}

// Debounce window for the post-index refresh. Active editing (e.g. an AI setup
// flow writing many cards) emits a burst of index events; coalescing them into
// one refresh avoids firing the panel searches several times per keystroke.
const INDEX_REFRESH_DEBOUNCE_MS = 200;

// Layout / bound tuning. These are internal tuning knobs rather than per-realm
// settings, so they live as module constants — the one operator-facing lever,
// tile density, is the `pinnedSize` edit-format setting that selects between
// the two door heights below.

// Activity feed: both the server query and the reveal-on-scroll pager are
// bounded to this many of the most recently modified cards.
const ACTIVITY_FEED_CAP = 100;
// The feed reveals this many rows at a time as the sentinel scrolls into view.
const FEED_REVEAL_CHUNK = 20;

// Generic upper bound for realm-local search / chooser result pages. Callers
// that need fewer rows may request a smaller page.
const SEARCH_PAGE_SIZE = 100;

// The header's ⌘K search lists this many hits inline; the rest live behind the
// "See all" row in Library.
const SEARCH_RESULTS_CAP = 8;

// Pinned-card tile heights (px) for the two densities `pinnedSize` selects.
const DOOR_TILE_HEIGHT_PX = 300;
const DOOR_TILE_HEIGHT_COMPACT_PX = 220;

// Base machinery the `_types` rail never lists: these are not realm content.
const TYPE_RAIL_EXCLUDED_IDS = [
  `${baseRealmRRI}card-api/CardDef`,
  `${baseRealmRRI}cards-grid/CardsGrid`,
  `${baseRealmRRI}card-api/FieldDef`,
  `${baseRealmRRI}card-api/FileDef`,
];

function toMs(value: unknown): number | undefined {
  let ms =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : undefined;
  if (ms === undefined || Number.isNaN(ms)) {
    return undefined;
  }
  // epoch seconds
  return ms < 1e12 ? ms * 1000 : ms;
}

function dayLabelFor(ms: number): string {
  let now = nowDate();
  let startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (ms >= startOfToday) {
    return 'Today';
  }
  if (ms >= startOfToday - 86400000) {
    return 'Yesterday';
  }
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function relativeTime(value: unknown): string | undefined {
  let ms = toMs(value);
  if (ms === undefined) {
    return undefined;
  }
  let diff = Math.max(0, clockNow() - ms);
  let minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  let hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

// One Browse pill: a card type or file kind with its instance count, opening
// the Library filtered to it.
class TypeChip extends GlimmerComponent<{
  Args: { option: RailOption; count: number; onSelect: () => void };
}> {
  private get iconHtml(): SafeString | undefined {
    return typeof this.args.option.icon === 'string'
      ? htmlSafe(this.args.option.icon)
      : undefined;
  }

  <template>
    <Button
      @kind='default'
      @size='extra-small'
      @pill={{true}}
      class='type-chip'
      {{on 'click' @onSelect}}
      data-test-type-chip={{@option.id}}
    >
      {{#if this.iconHtml}}
        <span class='type-chip-icon'>{{this.iconHtml}}</span>
      {{/if}}
      <span class='type-chip-label'>{{@option.displayName}}</span>
      <span class='type-chip-count' data-test-type-chip-count>{{@count}}</span>
    </Button>
    <style scoped>
      .type-chip {
        --boxel-button-default-border: var(
          --grid-chip-border,
          color-mix(in oklch, var(--border) 50%, transparent)
        );
        --boxel-button-default-background: var(--card);
        --boxel-button-default-foreground: var(--card-foreground);
        gap: var(--boxel-sp-2xs);
        max-width: 100%;
      }
      .type-chip-label {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .type-chip:hover {
        border-color: var(--border-strong);
        box-shadow: var(--shadow-sm);
      }
      .type-chip-icon {
        display: grid;
        place-items: center;
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      .type-chip-icon :deep(svg) {
        width: 0.875rem;
        height: 0.875rem;
        display: block;
      }
      .type-chip-count {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

class Isolated extends Component<typeof Workspace> {
  <template>
    <section
      class='card-grid'
      data-test-workspace-index
      {{this.setupRealmSubscription this.primaryRealm}}
    >
      {{! Setup progress runs on its own — jobs start, advance and finish with no
        interaction to hang an announcement off. Lives at the root, outside every
        segment: the Activity tab's dot is always on screen while the dock that
        details it is only rendered on that one tab, and a live region has to be
        in the DOM before its text changes to be announced at all. }}
      <span
        class='boxel-sr-only'
        role='status'
        data-test-progress-announcement
      >{{this.progressAnnouncement}}</span>
      <header class='frame'>
        <div class='frame-lead'>
          <nav class='tabs' aria-label='Sections'>
            {{#each SEGMENTS as |tab|}}
              {{#let (eq this.segment tab.id) as |isActive|}}
                <Button
                  @kind={{if isActive 'default' 'muted'}}
                  @size='extra-small'
                  @rectangular={{true}}
                  class={{cn 'nav-tab' nav-tab--active=isActive}}
                  aria-current={{if isActive 'true'}}
                  {{on 'click' (this.setSegment tab.id)}}
                  data-test-workspace-tab={{tab.id}}
                ><tab.icon
                    width='14'
                    height='14'
                    class='tab-icon'
                    aria-hidden='true'
                  />
                  {{tab.label}}
                  {{#if
                    (and (eq tab.id 'activity') (bool this.runningJobs.length))
                  }}
                    <span class='attention-dot' aria-hidden='true' />
                    <span class='boxel-sr-only'>({{this.runningJobs.length}}
                      in progress)</span>
                  {{/if}}</Button>
              {{/let}}
            {{/each}}
          </nav>
          {{#if @model.signage}}
            {{! workspace signage; the purpose annotation shows on hover or focus
            and is read after the badge text }}
            {{#if @model.purpose}}
              <Tooltip @placement='bottom'>
                <:trigger>
                  <span class='signage kicker' tabindex='0'>
                    {{@model.signage}}<span class='boxel-sr-only'>:
                      {{@model.purpose}}</span></span>
                </:trigger>
                <:content>{{@model.purpose}}</:content>
              </Tooltip>
            {{else}}
              <span class='signage kicker'>{{@model.signage}}</span>
            {{/if}}
          {{/if}}
        </div>
        <div class='frame-actions' data-test-frame-actions>
          <div
            class='search-box'
            role='search'
            aria-label='Search this space'
            {{this.setupSearchHotkey}}
            {{on 'focusout' this.onSearchFocusOut}}
          >
            <SearchIcon
              width='13'
              height='13'
              class='search-icon'
              aria-hidden='true'
            />
            <BoxelInput
              @value={{this.searchTerm}}
              @onInput={{this.onSearchInput}}
              @onFocus={{this.onSearchFocus}}
              @placeholder='Search'
              class='search-input'
              aria-label='Search this space'
              aria-keyshortcuts='Meta+K Control+K'
              {{on 'keydown' this.onSearchKeydown}}
              data-test-workspace-search
            />
            {{! the visible hint is decorative — aria-keyshortcuts above carries
              the same thing to assistive tech, in both spellings }}
            <span
              class='search-kbd kicker'
              aria-hidden='true'
              data-test-search-hotkey
            >{{SEARCH_HOTKEY_LABEL}}</span>
            {{! Results appear and refresh without any focus change, so nothing
              would reach a screen reader on its own. Announced as a count
              rather than a list of titles: the search reruns on each keystroke,
              and reading matches back would talk over the user's typing. }}
            <span
              class='boxel-sr-only'
              role='status'
              data-test-search-announcement
            >{{this.searchAnnouncement}}</span>
            {{! Results are click-only, so this is not a combobox: an
              `aria-controls`/`aria-expanded` textbox would name a role AT does
              not honour on an <input> and dangle when the list is empty. The
              status region above carries the count instead. }}
            {{#if this.searchResults.length}}
              <div class='search-results'>
                <ul class='search-result-list'>
                  {{#each this.searchResults as |result|}}
                    <li>
                      <Button
                        @kind='text-only'
                        @size='auto'
                        class='search-result'
                        {{on 'click' (this.openResult result)}}
                        {{on 'keydown' this.onSearchKeydown}}
                        data-test-search-result={{result.id}}
                      >
                        <span
                          class='search-result-title'
                        >{{result.title}}</span>
                        <span
                          class='search-result-type kicker'
                        >{{result.type}}</span>
                      </Button>
                    </li>
                  {{/each}}
                </ul>
                <Button
                  @kind='text-only'
                  @size='auto'
                  class='search-see-all'
                  {{on 'click' this.seeAllResults}}
                  {{on 'keydown' this.onSearchKeydown}}
                  data-test-search-see-all
                >
                  See all
                  {{this.searchTotal}}
                  results
                  <span class='search-scope-note kicker'>Cards only</span>
                </Button>
              </div>
            {{/if}}
          </div>
        </div>
      </header>

      {{#if (eq this.segment 'home')}}
        <div class='stage scroll-container'>
          {{! greeting removed: Home opens with work, not a
            restatement of what the page already shows }}
          {{#if @model.cardInfo.summary}}
            {{! workspace description, set in Settings }}
            <p class='space-desc'>{{@model.cardInfo.summary}}</p>
          {{/if}}
          {{#each this.runningJobs as |job|}}
            {{! HB frame: a compact strip, not a takeover — ring icon,
              two lines, gradient meter, green Activity link, and the
              survey teaser attached below }}
            <div class='setup-strip'>
              <Button
                @kind='text-only'
                @size='auto'
                class='setup-bar'
                {{on 'click' (this.setSegment 'activity')}}
              >
                {{! ring and meter both restate the percentage this button
                  already spells out in `.setup-pct`, so they are decoration }}
                <span
                  class='setup-ring'
                  style={{this.ringStyle job}}
                  aria-hidden='true'
                >
                  <span class='setup-ring-hole' /></span>
                <span class='setup-lines'>
                  <span class='setup-name'>Setting up
                    <strong>{{this.jobName job}}</strong></span>
                  <span class='setup-data data'>{{this.jobCount job}}{{#if
                      (this.jobEta job)
                    }}
                      ·
                      {{this.jobEta job}}{{/if}}</span>
                </span>
                <span class='setup-track' aria-hidden='true'><span
                    class='setup-fill'
                    style={{this.jobFillStyle job}}
                  /></span>
                <span class='setup-pct data'>{{this.jobPct job}}%</span>
                <span class='setup-action'>View in Activity
                  <span aria-hidden='true'>›</span></span>
              </Button>
              {{#if (this.surveyRemaining job)}}
                <Button
                  @kind='text-only'
                  @size='auto'
                  class='setup-tease'
                  {{on 'click' (this.openCard job.card.setupSurvey)}}
                >
                  <span class='setup-tease-mark' aria-hidden='true'>✦</span>
                  Want it to arrive already yours?
                  <span class='setup-tease-link'>Answer
                    {{this.surveyRemaining job}}
                    quick questions
                    <span aria-hidden='true'>›</span></span>
                </Button>
              {{/if}}
            </div>
          {{/each}}

          {{! Home modules render in the configured order (Settings →
            Modules); each block is unchanged, only sequenced }}
          {{#each this.homeModules as |mod|}}
            {{#if (eq mod 'pinned')}}
              {{#if @model.entryPoints.length}}
                <section class='zone'>
                  <div class='section-head'>
                    <h2 class='section-title'>Pinned</h2>
                    <p class='section-hint'>Cards you pinned for quick access.</p>
                  </div>
                  <div class='doors' style={{this.doorsStyle}}>
                    {{#each @fields.entryPoints as |Door index|}}
                      <article class='door'>
                        <div class='door-kicker'>
                          <span class='door-kind kicker'>{{this.doorKind
                              index
                            }}</span>
                          {{#if @canEdit}}
                            <IconButton
                              @icon={{XIcon}}
                              @variant='text-only'
                              @size='extra-small'
                              @width='12'
                              @height='12'
                              class='door-unpin'
                              aria-label='Unpin'
                              title='Unpin'
                              {{on 'click' (this.unpinDoor index)}}
                            />
                          {{/if}}
                        </div>
                        <div class='door-face'>
                          <Door
                            @format='fitted'
                            @displayContainer={{false}}
                            class='door-card'
                          />
                          <Button
                            @kind='text-only'
                            @size='auto'
                            class='tile-open'
                            aria-label='Open {{this.doorTitle index}}'
                            {{on 'click' (this.openDoor index)}}
                          />
                          {{! Match Library fitted tiles: the read-only preview opens through viewCard }}
                        </div>
                        <div class='door-footer'>
                          <span class='door-title data'>{{this.doorTitle
                              index
                            }}</span>
                          <Button
                            @kind='primary'
                            @size='extra-small'
                            @rectangular={{true}}
                            class='door-open'
                            {{on 'click' (this.openDoor index)}}
                          >Open</Button>
                        </div>
                      </article>
                    {{/each}}
                    {{#if @canEdit}}
                      {{! the pin affordance: a ghost tile ending the row }}
                      <Button
                        @kind='text-only'
                        @size='auto'
                        class='door-add'
                        {{on 'click' this.pinCard}}
                      >
                        <span class='door-add-mark' aria-hidden='true'>＋</span>
                        <span class='door-add-label'>Pin a card…</span>
                      </Button>
                    {{/if}}
                  </div>
                </section>
              {{else}}
                <section class='zone welcome'>
                  {{! Realm README replaces the WelcomeCard: hero position
                while the space has no pins — the landing content for a
                realm that just got cloned or remixed. }}
                  {{#if @model.readme}}
                    <div class='readme-embed' data-test-readme>
                      <div class='readme-body' data-test-readme-body>
                        <MarkdownPreview
                          @model={{@model.readme}}
                          @format='isolated'
                          @displayContainer={{false}}
                        />
                      </div>
                    </div>
                  {{else}}
                    <p class='welcome-copy'>This space holds cards — documents,
                      lists, and apps. Browse the Library to see what is here,
                      install a starter from the catalog, or ask the assistant
                      to create something for you.</p>
                  {{/if}}
                  <div class='welcome-actions'>
                    <Button
                      @kind='primary'
                      class='welcome-cta'
                      {{on 'click' (this.setSegment 'library')}}
                    >Open Library</Button>
                    {{#if @canEdit}}
                      <Button
                        @kind='default'
                        class='welcome-alt'
                        {{on 'click' this.createNew}}
                        data-test-welcome-new-card
                      >New card</Button>
                    {{/if}}
                  </div>
                </section>
              {{/if}}
            {{else if (eq mod 'about')}}
              {{#if @model.entryPoints.length}}
                {{#if this.aboutVisible}}
                  {{! with pins, the README settles into a collapsed section }}
                  <section class='zone'>
                    <div class='section-head'>
                      <h2 class='section-title'>About this space</h2>
                    </div>
                    <div
                      class='readme-embed
                        {{unless this.readmeExpanded "collapsed"}}'
                      data-test-readme
                      data-test-readme-state={{if
                        this.readmeExpanded
                        'expanded'
                        'collapsed'
                      }}
                    >
                      <div class='readme-body' data-test-readme-body>
                        <MarkdownPreview
                          @model={{@model.readme}}
                          @format='isolated'
                          @displayContainer={{false}}
                        />
                      </div>
                    </div>
                    <Button
                      @kind='text-only'
                      @size='auto'
                      class='readme-toggle'
                      {{on 'click' this.toggleReadme}}
                      data-test-readme-toggle
                    >{{if this.readmeExpanded 'Show less' 'Read more'}}</Button>
                  </section>
                {{/if}}
              {{/if}}
            {{else if (eq mod 'browse')}}
              {{#if this.browseVisible}}
                <section class='zone' data-test-browse>
                  <div class='section-head'>
                    <h2 class='section-title'>Browse</h2>
                    <p class='section-hint'>All cards and files in this space.</p>
                  </div>
                  <div class='inventory'>
                    {{#if this.contentCardChips.length}}
                      <div class='inventory-group'>
                        <span class='inventory-label kicker'>Cards</span>
                        <div class='inventory-chips'>
                          {{#each this.contentCardChips as |option|}}
                            <TypeChip
                              @option={{option}}
                              @count={{this.countFor option}}
                              @onSelect={{this.jumpToFilter option}}
                            />
                          {{/each}}
                        </div>
                      </div>
                    {{/if}}
                    {{#if this.fileChips.length}}
                      <div class='inventory-group'>
                        <span class='inventory-label kicker'>Files</span>
                        <div class='inventory-chips'>
                          {{#each this.fileChips as |option|}}
                            <TypeChip
                              @option={{option}}
                              @count={{this.countFor option}}
                              @onSelect={{this.jumpToFilter option}}
                            />
                          {{/each}}
                        </div>
                      </div>
                    {{/if}}
                  </div>
                </section>
              {{/if}}
            {{/if}}
          {{/each}}

          {{#unless this.runningJobs.length}}
            {{#if this.latest}}
              <Button
                @kind='text-only'
                @size='auto'
                class='recent-preview'
                {{on 'click' (this.setSegment 'activity')}}
              >
                <span class='recent-text data'>{{this.latest.title}}{{#if
                    this.latest.when
                  }}
                    ·
                    {{this.latest.when}}{{/if}}</span>
                <span class='recent-action'>Open Activity</span>
              </Button>
            {{/if}}
          {{/unless}}

          {{! Space details: quiet realm facts, data register }}
          <div class='space-details data'>
            <span
              class='space-live'
              role='img'
              aria-label='Live updates connected'
            ></span>
            {{#if this.realmVisibility}}
              <span>{{this.realmVisibility}}</span>
              <span class='space-sep'>·</span>
            {{/if}}
            <span>{{this.cardTotal}} cards</span>
            <span class='space-sep'>·</span>
            <span>{{this.fileTotal}} files</span>
            {{#if this.latest.when}}
              <span class='space-sep'>·</span>
              <span>Updated {{this.latest.when}}</span>
            {{/if}}
            {{#if this.publishedSites.length}}
              <span class='space-sep'>·</span>
              <span>Published to
                {{this.firstPublishedSiteHost}}{{#if
                  (this.moreSites this.publishedSites)
                }}
                  +{{this.moreSites this.publishedSites}}{{/if}}</span>
            {{/if}}
            {{#if this.routeCount}}
              <span class='space-sep'>·</span>
              <span>{{this.routeCount}}
                {{if (eq this.routeCount 1) 'route' 'routes'}}</span>
            {{/if}}
            {{#if this.configInstance}}
              <span class='space-sep'>·</span>
              <Button
                @kind='link'
                class='space-config'
                {{on 'click' (this.openCard this.configInstance)}}
              >Configuration</Button>
            {{/if}}
          </div>
        </div>
      {{else if (eq this.segment 'library')}}
        <div class='library' {{this.watchLibraryWidth}} data-test-library>
          {{! Stays mounted so it can slide shut; inert while closed keeps its
            controls out of the tab order and the accessibility tree. }}
          <div
            class={{cn
              'rail-slot'
              open=this.isRailOpen
              animates=this.railAnimates
            }}
            inert={{if this.isRailOpen false true}}
            data-test-library-rail-slot
          >
            <div class='rail-panel'>
              <nav
                id={{this.railId}}
                class='rail scroll-container'
                aria-label='Library filters'
                data-test-library-rail
              >
                <div class='rail-group' data-test-rail-group>
                  <h3 class='rail-label kicker'>Library</h3>
                  <FilterList
                    @filters={{this.libraryFilters}}
                    @activeFilter={{this.activeFilter}}
                    @onChanged={{this.onChangeFilter}}
                    class='rail-list'
                  />
                </div>
                {{#if this.cardTypeFilters.length}}
                  <div class='rail-group' data-test-rail-group>
                    <h3 class='rail-label kicker'>Card types</h3>
                    <FilterList
                      @filters={{this.cardTypeFilters}}
                      @activeFilter={{this.activeFilter}}
                      @onChanged={{this.onChangeFilter}}
                      class='rail-list'
                    >
                      <:action as |option|>
                        {{#if @canEdit}}
                          <Tooltip @placement='right'>
                            <:trigger>
                              <IconButton
                                @icon={{PlusIcon}}
                                @variant='text-only'
                                @size='small'
                                @width='12'
                                @height='12'
                                class='rail-add'
                                aria-label='New {{option.displayName}}'
                                {{on 'click' (this.createOfType option)}}
                              />
                            </:trigger>
                            <:content>New {{option.displayName}}</:content>
                          </Tooltip>
                        {{/if}}
                      </:action>
                    </FilterList>
                  </div>
                {{/if}}
                {{#if this.fileTypeFilters.length}}
                  <div class='rail-group' data-test-rail-group>
                    <h3 class='rail-label kicker'>File types</h3>
                    <FilterList
                      @filters={{this.fileTypeFilters}}
                      @activeFilter={{this.activeFilter}}
                      @onChanged={{this.onChangeFilter}}
                      class='rail-list'
                    />
                  </div>
                {{/if}}
              </nav>
            </div>
          </div>
          <CardsGridLayout
            class='library-grid'
            @format='fitted'
            @displaySidebar={{false}}
            @isContentInert={{this.isGridCovered}}
            @context={{@context}}
            @query={{this.query}}
            @realms={{this.realms}}
            @isLive={{true}}
            @filterOptions={{this.filterOptions}}
            @sortOptions={{this.sortOptions}}
            @viewOptions={{this.viewOptions}}
            @activeViewId={{this.activeViewId}}
            @activeFilter={{this.activeFilter}}
            @activeSort={{this.activeSort}}
            @onChangeFilter={{this.onChangeFilter}}
            @onChangeView={{this.onChangeView}}
            @onChangeSort={{this.onChangeSort}}
          >
            <:contentHeaderStart>
              <Tooltip @placement='bottom'>
                <:trigger>
                  <IconButton
                    @icon={{if
                      this.isRailOpen
                      PanelLeftCloseIcon
                      PanelLeftOpenIcon
                    }}
                    @variant='text-only'
                    @size='small'
                    @width='16'
                    @height='16'
                    class='rail-toggle'
                    aria-label={{this.railToggleLabel}}
                    aria-expanded={{if this.isRailOpen 'true' 'false'}}
                    aria-controls={{this.railId}}
                    {{on 'click' this.toggleRail}}
                    data-test-rail-toggle
                  />
                </:trigger>
                <:content>{{this.railToggleLabel}}</:content>
              </Tooltip>
            </:contentHeaderStart>
          </CardsGridLayout>
        </div>
      {{else}}
        <div class='activity-pane' data-test-activity>
          {{! Collapsing dock: the full panel scrolls away with the log;
            a one-line summary pins under the frame while it is off-screen. }}
          {{#if this.runningJobs.length}}
            {{! No aria-label here: one would replace this button's own text as
              its accessible name, and that text is the live summary of what is
              being set up. The action is appended instead, so the name carries
              both. }}
            <Button
              @kind='text-only'
              @size='auto'
              @disabled={{if this.dockCondensed false true}}
              class='dock-mini {{if this.dockCondensed "shown"}}'
              {{on 'click' this.revealDock}}
            >
              <span class='dock-dot' aria-hidden='true' />
              <span class='dock-mini-title'>In progress</span>
              <span class='dock-mini-summary'>{{this.dockSummary}}</span>
              <span class='dock-mini-track' aria-hidden='true'>
                <span
                  class='dock-mini-fill'
                  style={{this.jobFillStyle this.firstRunningJob}}
                />
              </span>
              <span class='boxel-sr-only'>Show progress details</span>
            </Button>
          {{/if}}
          <div
            class='stage scroll-container
              {{if this.runningJobs.length "flush-top"}}'
          >
            {{! flush-top instead of a negative top margin on the dock:
              content pulled above a scroll container's origin can never be
              scrolled back into view. }}
            {{#if this.runningJobs.length}}
              <div class='dock' {{this.trackDock}}>
                <div class='dock-head'>
                  <span class='dock-dot' aria-hidden='true' />
                  <h2 class='dock-title'>In progress</h2>
                  <span class='dock-hint'>Keep this tab open until it finishes.</span>
                </div>
                {{#each this.runningJobs as |job|}}
                  {{! build and invite side by side — the
                    living manifest next to the survey advertising itself.
                    The invite IS the survey card's embedded format
                    (themed; lazy segment, so prerender-safe). }}
                  {{#let (this.surveyComponentFor job) as |SurveyComp|}}
                    {{#if SurveyComp}}
                      <div class='dock-duo'>
                        <div class='dock-pane build'>
                          <span class='dock-pane-label kicker'>Building</span>
                          <div class='job-cell'>
                            <job.component
                              @format='embedded'
                              @displayContainer={{false}}
                              class='job-face'
                            />
                            <Button
                              @kind='text-only'
                              @size='auto'
                              class='tile-open'
                              aria-label='Open progress details'
                              {{on 'click' (this.openCard job.card)}}
                            />
                          </div>
                        </div>
                        <div class='dock-pane invite'>
                          {{! the pane IS the wizard — no
                            click-through overlay; popping to the stack is
                            this explicit header affordance instead }}
                          <div class='dock-pane-head'>
                            <span class='dock-pane-label kicker'>While you wait
                              · Optional</span>
                            <Button
                              @kind='text-only'
                              @size='auto'
                              class='dock-pane-open'
                              title='Open as a card'
                              {{on
                                'click'
                                (this.openCard job.card.setupSurvey)
                              }}
                            >Open
                              <span aria-hidden='true'>↗</span></Button>
                          </div>
                          <div class='job-cell wizard'>
                            <SurveyComp @format='embedded' />
                          </div>
                        </div>
                      </div>
                    {{else}}
                      <div class='job-cell'>
                        <job.component
                          @format='embedded'
                          @displayContainer={{false}}
                          class='job-face'
                        />
                        <Button
                          @kind='text-only'
                          @size='auto'
                          class='tile-open'
                          aria-label='Open progress details'
                          {{on 'click' (this.openCard job.card)}}
                        />
                      </div>
                    {{/if}}
                  {{/let}}
                {{/each}}
              </div>
            {{/if}}
            <section class='zone'>
              <div class='section-head'>
                <h2 class='section-title'>Recent</h2>
                <p class='section-hint'>Changes to cards and files, newest
                  first.</p>
              </div>
              <div class='feed'>
                {{#each this.visibleFeed as |item|}}
                  {{#if item.showDay}}
                    {{! a heading, not a div: the rows' zebra striping counts
                      divs, so a div here would shift it at every day }}
                    <h3 class='feed-day'>
                      <span
                        class='feed-day-label kicker'
                      >{{item.dayLabel}}</span>
                      <span class='feed-day-rule' />
                    </h3>
                  {{/if}}
                  <div class='feed-row' data-test-feed-row>
                    <time
                      class='feed-when data'
                      datetime={{item.absoluteIso}}
                      data-test-feed-when
                    >
                      {{if item.when item.when '—'}}
                      {{#if item.absolute}}<span
                          class='boxel-sr-only'
                        >({{item.absolute}})</span>{{/if}}
                    </time>
                    <div class='feed-card'>
                      <item.component @format='embedded' class='feed-face' />
                      <Button
                        @kind='text-only'
                        @size='auto'
                        class='tile-open'
                        aria-label='Open {{if item.title item.title "card"}}'
                        {{on 'click' (this.openFeedItem item)}}
                      />
                    </div>
                    <div class='feed-note'>
                      {{! Rich event entry: verb + type (icon) meta row,
                        title anchor, then the change note. The right column
                        reads as a log line without the embedded card. }}
                      <div class='feed-meta'>
                        <span
                          class='feed-verb kicker
                            {{if (eq item.verb "Created") "created"}}
                            {{if (eq item.verb "Remixed") "remixed"}}'
                          data-test-feed-verb={{item.verb}}
                        >{{item.verb}}</span>
                        <span class='feed-type kicker'>
                          <item.typeIcon
                            width='12'
                            height='12'
                            class='feed-type-icon'
                          />
                          {{item.typeName}}</span>
                      </div>
                      {{#if item.title}}
                        <p
                          class='feed-title'
                          data-test-feed-title
                        >{{item.title}}</p>
                      {{/if}}
                      {{#let (this.remixSourceTitle item) as |source|}}
                        {{#if source}}
                          <p
                            class='feed-remix-source'
                            data-test-feed-remix-source
                          >from {{source}}</p>
                        {{/if}}
                      {{/let}}
                      {{#if item.note}}
                        <p class='feed-note-text'>{{item.note}}</p>
                      {{/if}}
                    </div>
                  </div>
                {{else}}
                  <div class='empty-state'>
                    <p class='empty-note'>No activity yet. Changes to cards and
                      files in this space will appear here.</p>
                    {{#if @canEdit}}
                      <Button
                        @kind='secondary'
                        @size='extra-small'
                        {{on 'click' this.createNew}}
                      >New card</Button>
                    {{/if}}
                  </div>
                {{/each}}
                {{#if this.moreFeed}}
                  {{! reveal-on-scroll: the sentinel appends the next chunk }}
                  <div class='feed-more' {{this.watchFeedEnd}}>
                    <span class='feed-more-note data'>Showing
                      {{this.visibleFeed.length}}
                      of
                      {{this.feedItems.length}}</span>
                  </div>
                {{else if this.feedAtCap}}
                  <p class='feed-end-note data'>Showing the last
                    {{this.activityFeedCap}}
                    changes.</p>
                {{/if}}
              </div>
            </section>
          </div>
        </div>
      {{/if}}
    </section>
    <style scoped>
      .card-grid {
        /* Derived values only; everything else reads the theme contract
           directly. Attention tints are mixes of --attention over --card so
           the register moves with the theme as one. */
        --grid-attention-soft: color-mix(
          in oklch,
          var(--attention) 60%,
          var(--card)
        );
        --grid-attention-surface: color-mix(
          in oklch,
          var(--attention) 6%,
          var(--card)
        );
        --grid-attention-border: color-mix(
          in oklch,
          var(--attention) 18%,
          var(--card)
        );
        --grid-attention-rule: color-mix(
          in oklch,
          var(--attention) 30%,
          var(--card)
        );
        --grid-chip-border: color-mix(in oklch, var(--border) 50%, transparent);
        /* looser leading for the welcome prose; no line-height token runs past 1.4 */
        --grid-prose-leading: 1.6;
        /* fixed geometry the layout is built around */
        --grid-rail-width: 13.375rem;
        --grid-search-width: 10.625rem;
        --grid-search-results-size: 20rem;
        --grid-frame-height: 3.375rem;
        /* the tab strip's height: an extra-small tab plus the strip's padding
           and border; the search input matches it */
        --grid-tabs-height: calc(
          var(--boxel-button-xs) + 2 * var(--boxel-sp-4xs) + 2px
        );
        --grid-bar-height: 2.875rem;
        --grid-readme-width: 45rem;
        --grid-readme-collapsed-height: 12.5rem;
        --grid-pill: 100rem;
        /* motion tokens (0.4s meter fill and 2s pulses stay as
           deliberate exceptions) */
        --grid-quick: 0.12s;
        --grid-soft: 0.18s;
        --grid-slide: 0.26s;
        --grid-ease-out: cubic-bezier(0.2, 0, 0, 1);
        /* the chrome and the stage tighten to the card's width, not the
           viewport's: the card can share the screen with a neighbor stack */
        container-type: inline-size;

        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      /* the chrome's buttons are Buttons; the component's own type and
         letter-spacing yield to the surrounding text register */
      .card-grid .search-result,
      .card-grid .search-see-all,
      .card-grid .setup-bar,
      .card-grid .setup-tease,
      .card-grid .door-unpin,
      .card-grid .tile-open,
      .card-grid .door-add,
      .card-grid .readme-toggle,
      .card-grid .type-chip,
      .card-grid .recent-preview,
      .card-grid .space-config,
      .card-grid .dock-mini,
      .card-grid .dock-pane-open {
        line-height: inherit;
        letter-spacing: inherit;
      }

      /* two text registers shared across the chrome: kickers (tracked mono
         caps) and data (tabular mono) */
      .kicker {
        font-family: var(--font-mono);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
      }
      .data {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }

      /* ── Frame ─────────────────────────────────────────────── */
      /* two groups, like the grid header: when the actions wrap they start
         their own row at the left edge instead of floating right */
      .frame {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
        min-height: var(--grid-frame-height);
        padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        background-color: var(--card);
        color: var(--card-foreground);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .frame-lead {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .tabs {
        display: flex;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-4xs);
        background-color: var(--muted);
        border: 1px solid var(--grid-chip-border);
        border-radius: var(--boxel-border-radius-sm);
      }
      .nav-tab {
        --boxel-button-border: none;
        position: relative;
        gap: var(--boxel-sp-3xs);
        transition: none;
      }
      .nav-tab--active {
        --boxel-button-box-shadow: var(--shadow-sm);
      }
      .tab-icon {
        flex-shrink: 0;
      }
      .attention-dot {
        position: absolute;
        top: var(--boxel-sp-4xs);
        right: var(--boxel-sp-4xs);
        width: 0.3125rem;
        height: 0.3125rem;
        border-radius: 50%;
        background-color: var(--attention);
        animation: softpulse 2s ease-in-out infinite;
      }
      .frame-actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
      }
      /* workspace signage & description */
      .signage {
        display: inline-block;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-2xs);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-sm);
        color: var(--muted-foreground);
        white-space: nowrap;
        cursor: default;
      }
      .space-desc {
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--muted-foreground);
      }
      .search-box {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
      }
      /* a plain BoxelInput with the card's own small glyph laid over it: the
         component's search variant fixes a 20px primary icon and an inverted
         fill. The plain input also darkens its border on hover by itself. */
      /* icon and shortcut hint sit inside the field, over its padding zones;
         neither takes pointer events */
      .search-box .search-icon,
      .search-box .search-kbd {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 1;
        display: block;
        pointer-events: none;
      }
      .search-box .search-icon {
        left: var(--boxel-sp-xs);
        color: var(--muted-foreground);
      }
      .search-box .search-kbd {
        right: var(--boxel-sp-xs);
        font-weight: 500;
        color: var(--subtle-foreground);
      }
      .search-box .search-input {
        /* BoxelInput draws its border from --border; this is the input
           element itself, so nothing inherits it. Same edge as the tabs. */
        --border: var(--grid-chip-border);
        --boxel-input-height: var(--grid-tabs-height);
        --boxel-form-control-border-radius: var(--boxel-border-radius-sm);
        width: var(--grid-search-width);
        /* right padding clears the widest hint (Ctrl+K) while it shows */
        padding: var(--boxel-sp-3xs) var(--boxel-sp-3xl) var(--boxel-sp-3xs)
          var(--boxel-sp-xl);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      /* the hint is for finding the field; once it has focus it gets out of
         the way of the text */
      .search-box:focus-within .search-kbd {
        display: none;
      }
      .search-box:focus-within .search-input {
        padding-inline-end: var(--boxel-sp-sm);
      }
      .search-results {
        position: absolute;
        top: calc(100% + var(--boxel-sp-3xs));
        right: 0;
        z-index: 20;
        width: var(--grid-search-results-size);
        max-height: var(--grid-search-results-size);
        overflow-y: auto;
        padding: var(--boxel-sp-4xs);
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--shadow-lg);
      }
      .search-result-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .card-grid .search-result {
        justify-content: flex-start;
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        width: 100%;
        text-align: start;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
      }
      .card-grid .search-result:hover {
        background-color: var(--hover);
      }
      .search-result-title {
        flex: 1;
        min-width: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .search-result-type {
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      /* a flat footer row: a corner here would round the rule above it */
      .card-grid .search-see-all {
        --boxel-button-border-radius: 0;
        --boxel-button-border: none;
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        width: 100%;
        border-top: 1px solid var(--border);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--primary-ink);
        text-align: start;
      }
      .card-grid .search-see-all:hover {
        background-color: var(--hover);
      }
      .search-scope-note {
        font-weight: 500;
        color: var(--muted-foreground);
      }
      @keyframes softpulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      /* ── Stage & zones ─────────────────────────────────────── */
      .stage {
        flex-grow: 1;
        min-height: 0;
        overflow-y: auto;
        padding: var(--boxel-sp-xl);
        display: grid;
        /* minmax(0, …): an auto column grows to its widest unwrappable line
           (setup name, recent activity, chip labels) and overflows the card */
        grid-template-columns: minmax(0, 1fr);
        align-content: start;
        gap: var(--boxel-sp-xl);
      }
      .library {
        flex-grow: 1;
        min-height: 0;
        display: flex;
      }

      /* ── Facet rail ────────────────────────────────────────── */
      /* The slot's width animates and pushes the grid; the panel keeps its
         full width and is pinned to the slot's end edge, so it slides out
         rather than being squeezed. */
      .rail-slot {
        flex-shrink: 0;
        display: flex;
        justify-content: flex-end;
        width: 0;
        overflow: hidden;
      }
      /* only a toggle slides it; the first width reading and resizes across
         the breakpoint snap, so a narrow card doesn't open the Library with
         the rail sliding shut */
      .rail-slot.animates {
        transition: width var(--grid-slide) var(--grid-ease-out);
      }
      .rail-slot.open {
        width: var(--grid-rail-width);
      }
      .rail-panel {
        flex-shrink: 0;
        width: var(--grid-rail-width);
        display: flex;
        flex-direction: column;
        background-color: var(--muted);
        border-inline-end: 1px solid var(--border);
      }
      .rail {
        flex-grow: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        /* top matches the grid header's padding */
        padding: var(--boxel-cards-grid-layout-padding, var(--boxel-sp-lg))
          var(--boxel-sp-xs) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .rail-group {
        display: grid;
        gap: 1px;
      }
      .rail-label {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-2xs);
        color: var(--muted-foreground);
      }
      /* as tall as the grid header's first row (the toggle and the sort button
         are --boxel-button-sm), so the Library heading sits level with the
         toggle */
      .rail-group:first-child .rail-label {
        min-height: var(--boxel-button-sm);
        display: flex;
        align-items: center;
        padding-block: 0;
      }
      /* FilterList paints its own rows; the selected and hover surfaces follow
         the card's neutral tier through the component's knobs */
      .rail-list {
        --boxel-filter-hover-background: var(--hover);
        --boxel-filter-hover-foreground: var(--foreground);
        --boxel-filter-selected-background: var(--selected);
        --boxel-filter-selected-foreground: var(--foreground);
        --boxel-filter-selected-hover-background: var(--selected);
        --boxel-filter-selected-hover-foreground: var(--foreground);
        min-width: 0;
      }
      /* quiet ink at rest, full ink when pointed at or focused; always at full
         opacity so it clears the non-text contrast floor */
      .rail-add {
        --boxel-icon-button-color: var(--subtle-foreground);
        flex-shrink: 0;
        margin-inline-end: var(--boxel-sp-4xs);
      }
      .rail-add:hover,
      .rail-add:focus-visible {
        --boxel-icon-button-color: var(--foreground);
      }
      .rail-toggle {
        --boxel-icon-button-background: var(--muted);
        flex-shrink: 0;
        border: 1px solid var(--grid-chip-border);
      }
      .rail-toggle:hover {
        border-color: currentColor;
      }
      .zone {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--boxel-sp-sm);
      }
      /* ── Activity dock: collapsing panel (). The full panel is the
         first block inside the scrolling stage; once it scrolls off-screen
         a one-line summary bar pins under the frame. ── */
      .activity-pane {
        position: relative;
        flex-grow: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .stage.flush-top {
        /* the dock supplies its own top spacing; a negative top margin
           would clip above the scroll origin */
        padding-top: 0;
      }
      .dock {
        position: relative;
        display: grid;
        gap: var(--boxel-sp-xs);
        margin: 0 calc(-1 * var(--boxel-sp-xl)); /* counter the stage side padding: flush edges */
        padding: var(--boxel-sp) var(--boxel-sp-xl) var(--boxel-sp);
        background-color: var(--grid-attention-surface);
        color: var(--attention-ink);
        border-bottom: 1px solid var(--grid-attention-border);
        /* no overflow: hidden here — an overflow-hidden grid item's
           content contributes zero to its auto row, collapsing the panel
           to padding height. Nothing here needs clipping anyway. */
      }
      .dock-head {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      .dock-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        align-self: center;
        background-color: var(--attention);
        animation: softpulse 2s ease-in-out infinite;
      }
      .dock-hint {
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
      }
      .card-grid .dock-mini {
        justify-content: flex-start;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 4;
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-xl) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--grid-attention-border);
        background-color: var(--grid-attention-surface);
        color: var(--attention-ink);
        box-shadow: var(--shadow-sm);
        text-align: start;
        opacity: 0;
        transform: translateY(-6px);
        pointer-events: none;
        transition:
          opacity var(--grid-soft) ease,
          transform var(--grid-soft) ease;
      }
      .card-grid .dock-mini.shown {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .dock-mini-title {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .dock-mini-summary {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }
      .dock-mini-track {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        overflow: hidden;
        background-color: var(--grid-attention-rule);
      }
      .dock-mini-fill {
        display: block;
        height: 100%;
        background-color: var(--attention);
        transition: width 0.4s ease;
      }

      /* Two-register typography: guidance speaks bold sans sentences (the
         Boxel voice), data speaks mono fragments. */
      .section-head {
        display: grid;
        gap: var(--boxel-sp-6xs);
      }
      .section-hint {
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
        color: var(--muted-foreground);
      }

      /* ── Setup status bar (passive; one click target → Activity) ── */
      .card-grid .setup-bar {
        justify-content: flex-start;
        position: relative;
        overflow: hidden;
        display: flex;
        gap: var(--boxel-sp-sm);
        width: 100%;
        min-height: var(--grid-bar-height);
        text-align: start;
        border: 1px solid var(--grid-attention-border);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        background-color: var(--grid-attention-surface);
        color: var(--attention-ink);
        transition:
          border-color var(--grid-quick) ease,
          box-shadow var(--grid-quick) ease;
      }
      .card-grid .setup-bar:hover {
        border-color: var(--grid-attention-rule);
        box-shadow: var(--shadow-sm);
      }
      /* the HB strip anatomy. NO overflow:hidden here — an
         overflow-hidden grid item collapses to padding height (see
         learnings 2026-07-15); the children carry their own radii. */
      .setup-strip {
        border: 1px solid var(--grid-attention-border);
        border-radius: var(--boxel-border-radius-lg);
      }
      .card-grid .setup-strip .setup-bar {
        border-radius: var(--boxel-border-radius);
      }
      .card-grid .setup-strip .setup-bar:not(:last-child) {
        border-radius: var(--boxel-border-radius) var(--boxel-border-radius) 0 0;
      }
      .card-grid .setup-tease {
        justify-content: flex-start;
        border-radius: 0 0 var(--boxel-border-radius) var(--boxel-border-radius);
      }
      .setup-ring {
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        flex-shrink: 0;
        display: grid;
        place-items: center;
        animation: softpulse 3s ease-in-out infinite;
      }
      .setup-ring-hole {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        background-color: var(--grid-attention-surface);
      }
      .setup-lines {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .setup-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .setup-name strong {
        font-weight: 600;
      }
      .setup-data {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .setup-track {
        flex: 1;
        min-width: 3.75rem;
        height: 0.375rem;
        border-radius: var(--grid-pill);
        background-color: var(--grid-attention-rule);
        overflow: hidden;
      }
      .setup-fill {
        display: block;
        height: 100%;
        border-radius: var(--grid-pill);
        background: linear-gradient(
          90deg,
          var(--grid-attention-soft),
          var(--attention)
        );
      }
      .setup-pct {
        flex-shrink: 0;
        font-weight: 600;
      }
      .setup-action {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .card-grid .setup-tease {
        display: flex;
        gap: var(--boxel-sp-2xs);
        width: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-top: 1px dashed var(--grid-attention-border);
        background-color: var(--card);
        text-align: start;
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
        color: var(--muted-foreground);
      }
      .setup-tease-mark {
        color: var(--attention);
      }
      .setup-tease-link {
        font-weight: 600;
        color: var(--primary-ink);
      }
      .setup-tease:hover .setup-tease-link {
        text-decoration: underline;
      }
      .card-grid .setup-tease:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }

      /* ── Doors ─────────────────────────────────────────────── */
      .doors {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(100%, var(--grid-search-results-size)), 1fr)
        );
        /* tile height set from DOOR_TILE_HEIGHT_* via doorsStyle */
        grid-auto-rows: var(--door-h);
        gap: var(--boxel-sp-lg);
      }
      /* Containment: the fitted face IS the shadowed card (so the host's
         selection outline and overlay land exactly on the visible box); the
         grid's kicker and footer are stage-level metadata placed AROUND it. */
      .door {
        height: 100%;
        min-width: 0; /* Long pinned-card labels must not widen their grid track */
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }
      .door-kicker {
        display: flex;
        align-items: baseline;
        padding: 0 var(--boxel-sp-6xs) var(--boxel-sp-2xs);
      }
      /* pin management affordances */
      /* quiet ink at rest so touch users can find it; full ink when pointed at */
      .card-grid .door-unpin {
        --boxel-icon-button-color: var(--subtle-foreground);
        margin-inline-start: auto;
      }
      .card-grid .door-unpin:hover {
        background-color: var(--hover);
        color: var(--foreground);
      }
      .card-grid .door-add {
        display: grid;
        place-content: center;
        gap: var(--boxel-sp-3xs);
        justify-items: center;
        border: 1.5px dashed var(--border);
        border-radius: var(--boxel-border-radius-lg);
        color: var(--muted-foreground);
        transition:
          border-color var(--grid-quick) ease,
          color var(--grid-quick) ease;
      }
      .card-grid .door-add:hover {
        border-color: var(--primary-ink);
        color: var(--primary-ink);
      }
      .door-add-mark {
        font-size: var(--boxel-font-size-xl);
        font-weight: 300;
        line-height: 1;
      }
      .door-add-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .door-kind {
        color: var(--muted-foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .door-face {
        min-height: 0;
        position: relative; /* Containing block for the shared click-to-open overlay */
      }
      /* the class lands on the pinned card's CardContainer; the card draws
         the edge itself, so the host's boundary ring is off */
      .door-card {
        height: 100%;
        max-height: 100%;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        box-shadow: var(--shadow-sm);
        transition:
          box-shadow var(--grid-quick) ease,
          border-color var(--grid-quick) ease;
      }
      .door:hover .door-card {
        border-color: var(--border-strong);
        box-shadow: var(--shadow-lg);
      }
      .door-footer {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0; /* Establish the flex shrink boundary for title + action */
        padding: var(--boxel-sp-xs) var(--boxel-sp-6xs) 0;
      }
      .door-title {
        flex: 1 1 auto; /* The label owns only the space left by Open */
        min-width: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .door-open {
        flex: 0 0 auto; /* Keep the action inside its tile while the label ellipsizes */
        --boxel-button-min-width: 0; /* Stay as narrow as the label; the tile is tight */
        white-space: nowrap;
      }

      /* ── Inventory (Home): what lives here, grouped by kind ── */
      .inventory {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .inventory-group {
        display: grid;
        grid-template-columns: 2.75rem minmax(0, 1fr);
        gap: var(--boxel-sp-sm);
        align-items: start;
      }
      .inventory-label {
        padding-top: var(--boxel-sp-2xs);
        color: var(--muted-foreground);
      }
      .inventory-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-2xs);
      }
      /* ── Recent preview (passive, one row → Activity) ──────── */
      .card-grid .recent-preview {
        justify-content: flex-start;
        display: flex;
        gap: var(--boxel-sp-sm);
        width: 100%;
        text-align: start;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background-color: var(--muted);
        transition: border-color var(--grid-quick) ease;
      }
      .card-grid .recent-preview:hover {
        border-color: var(--border-strong);
      }
      .recent-text {
        flex: 1;
        min-width: 0;
        color: var(--muted-foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .recent-action {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground);
      }

      /* ── Activity log: when | what | why ───────────────────── */
      .feed {
        container-type: inline-size;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .feed-day {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: inherit;
        margin-top: var(--boxel-sp-2xs);
      }
      .feed-day:first-child {
        margin-top: 0;
      }
      .feed-day-label {
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .feed-day-rule {
        flex: 1;
        height: 1px;
        background-color: var(--border);
      }
      .feed-row {
        display: grid;
        grid-template-columns: 4.5rem minmax(0, 27.5rem) minmax(10rem, 1fr);
        gap: var(--boxel-sp);
        align-items: start;
      }
      .feed-when {
        padding-top: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        text-align: right;
        white-space: nowrap;
      }
      .feed-card {
        min-width: 0;
      }
      /* the class lands on the child's CardContainer; its boundary ring
         draws the edge and its corners follow the theme */
      .feed-face {
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .feed-note {
        min-width: 0;
        padding-top: var(--boxel-sp-xs);
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      @container (width < 40rem) {
        .feed-row {
          grid-template-columns: 4.5rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-2xs);
          border-radius: var(--boxel-sp-xs);
        }
        .feed-row:nth-of-type(even) {
          background-color: var(--stripe);
        }
        .feed-note {
          grid-column: -1 / 1;
          padding-top: 0;
        }
        .feed-when {
          text-align: left;
        }
      }
      .feed-meta {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        min-width: 0;
      }
      .feed-verb {
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      .feed-verb.created {
        color: var(--success-ink);
      }
      .feed-verb.remixed {
        color: var(--info-ink);
      }
      .feed-type {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        font-weight: 500;
        color: var(--muted-foreground);
      }
      .feed-type-icon {
        flex-shrink: 0;
      }
      .feed-title {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .feed-remix-source {
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--muted-foreground);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* pagination rail-end markers */
      .feed-more {
        display: grid;
        place-items: center;
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-4xs);
      }
      .feed-more-note,
      .feed-end-note {
        color: var(--muted-foreground);
      }
      .feed-end-note {
        text-align: center;
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-4xs);
      }
      .feed-note-text {
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
        color: var(--muted-foreground);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      /* build-and-invite panes inside the dock */
      .dock-duo {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        align-items: flex-start;
      }
      .dock-pane {
        display: grid;
        gap: var(--boxel-sp-3xs);
        min-width: 0;
      }
      .dock-pane.build {
        flex: 1.45 1 21.25rem;
      }
      .dock-pane.invite {
        flex: 1 1 16.25rem;
      }
      .dock-pane-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .card-grid .dock-pane-open {
        padding: 0;
        font-family: var(--font-mono);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
      }
      .card-grid .dock-pane-open:hover {
        color: var(--foreground);
      }
      /* the wizard pane accepts input — never dim or intercept it */
      .job-cell.wizard {
        cursor: auto;
      }

      /* Click-to-open overlay for tiles rendered outside the field
         system. Stretched transparent button; wrapper gets position. */
      .job-cell,
      .feed-card {
        position: relative;
      }
      .card-grid .tile-open {
        height: auto;
        position: absolute;
        inset: 0;
        z-index: 2;
        border-radius: var(--boxel-border-radius);
      }
      .card-grid .tile-open:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }

      /* ── Jobs ──────────────────────────────────────────────── */
      /* Same containment rule: the card container is the visible box. */
      .job-cell + .job-cell {
        margin-top: var(--boxel-sp-sm);
      }
      .job-face {
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        box-shadow: var(--shadow-sm);
      }

      /* ── Welcome & empties ─────────────────────────────────── */
      .welcome {
        justify-items: start;
        max-width: 44rem;
      }
      .welcome-copy {
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        line-height: var(--grid-prose-leading);
        color: var(--muted-foreground);
      }
      /* README rendering: the realm's markdown document, content-only (no file
         shell chrome). The card owns its own frame and its own collapse clamp,
         so nothing reaches into the renderer's markup. */
      .readme-embed {
        position: relative;
        width: 100%;
        max-width: var(--grid-readme-width);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        box-shadow: var(--shadow-sm);
        /* Same panel surface as the rest of the card; the markdown inherits
           the paired foreground. */
        background-color: var(--card);
        color: var(--card-foreground);
        overflow: hidden;
      }
      .readme-body {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
      }
      /* Collapsed (About this space, before Read more): bound the height and
         fade the cut so it reads as "more below". The empty-space hero and the
         expanded state render the whole document. */
      .readme-embed.collapsed .readme-body {
        max-height: var(--grid-readme-collapsed-height);
        overflow: hidden;
        -webkit-mask-image: linear-gradient(to bottom, black 72%, transparent);
        mask-image: linear-gradient(to bottom, black 72%, transparent);
      }
      .card-grid .readme-toggle {
        justify-self: start;
        padding: var(--boxel-sp-6xs) 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--primary-ink);
      }
      /* space details strip */
      .space-details {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
        padding-top: var(--boxel-sp-3xs);
        color: var(--muted-foreground);
      }
      .space-live {
        width: 0.375rem;
        height: 0.375rem;
        border-radius: 50%;
        background-color: var(--success);
        flex-shrink: 0;
      }
      .space-sep {
        color: var(--subtle-foreground);
      }
      /* the link kinds inherit family and weight; the size is the strip's.
         A knob cannot say `inherit` (that would inherit the knob itself), so
         the shorthand is spelled out. */
      .space-config {
        --boxel-button-font: var(--boxel-font-size-2xs) var(--font-mono);
      }
      .welcome-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .welcome-cta {
        padding-inline: var(--boxel-sp-lg);
      }
      .empty-state {
        display: grid;
        justify-items: start;
        gap: var(--boxel-sp-xs);
      }
      .empty-note {
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--muted-foreground);
      }

      /* A buried card sits behind another in the stack, so it must not keep
         offering chrome to interact with. Both ancestors are host chrome the
         host really renders: `.operator-mode` on the operator-mode container,
         and `buried` on a stack item that isn't on top. They resolve from here
         because scoping only attaches this card's attribute to the selector's
         last compound, leaving the ancestor part to match outside it.
         Host mode marks its stack items `buried` too, but has no
         `.operator-mode` ancestor, so there this chrome stays visible. */
      .operator-mode .buried .frame-actions,
      .operator-mode .buried .doors {
        display: none;
      }
      /* after the base rules it overrides: same selectors, so source order
         decides */
      @container (width < 40rem) {
        .frame {
          padding-inline: var(--boxel-sp);
        }
        .stage {
          padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp-xl);
          gap: var(--boxel-sp-lg);
        }
        .dock {
          margin: 0 calc(-1 * var(--boxel-sp));
          padding-inline: var(--boxel-sp);
        }
        .card-grid .dock-mini {
          padding-inline: var(--boxel-sp);
        }
        /* the rail pushes the grid aside instead of narrowing it, so nothing
           in the grid reflows while the rail slides; clip rather than hidden,
           so focus can't scroll the covered part into view */
        .library {
          --boxel-cards-grid-layout-padding: var(--boxel-sp);
          overflow: clip;
        }
        .library-grid {
          flex-shrink: 0;
        }
        /* the percentage already reports progress; the bar is the first thing
           to give up its width */
        .setup-track {
          display: none;
        }
        .readme-body {
          padding: var(--boxel-sp);
        }
      }
      /* phone widths: the tabs and the search each take a full row, and the
         results match the search's width */
      @container (width < 30rem) {
        .frame-lead,
        .frame-actions {
          flex-basis: 100%;
        }
        .tabs,
        .search-box {
          flex-grow: 1;
        }
        .nav-tab {
          flex: 1;
        }
        .search-box .search-input,
        .search-results {
          width: 100%;
        }
        .search-box .search-input {
          background-color: var(--field);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .attention-dot,
        .setup-ring,
        .dock-dot {
          animation: none;
        }
        .card-grid .dock-mini,
        .dock-mini-fill,
        .rail-slot.animates {
          transition: none;
        }
      }
    </style>
  </template>

  private cardTypeFilters: RailOption[] = new TrackedArray();
  private fileTypeFilters: RailOption[] = new TrackedArray();
  private jobComponents: {
    id: string;
    card: JobCard;
    component: BoxComponent;
    status: string;
  }[] = new TrackedArray();
  private viewOptions: ViewOption[] = new TrackedArray([StripView, GridView]);
  private sortOptions: SortOption[] = new TrackedArray(SORT_OPTIONS);

  @tracked segment: Segment = 'home';
  @tracked private activeViewId: ViewOption['id'] =
    this.args.model.defaultView === 'strip' ? StripView.id : GridView.id; // settings-seeded
  @tracked private activeFilter!: FilterOption;
  @tracked private activeSort: SortOption = this.sortOptions[0];
  @tracked cardTotal = 0;
  @tracked fileTotal = 0;

  #unsubscribeFromRealm: (() => void) | undefined;
  #subscribedRealm: string | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.activeFilter = this.filterOptions[0];
    registerDestructor(this, () => this.teardownRealmSubscription());
  }

  // The Library rail opens by default and closes by default once the pane is
  // narrower than LIBRARY_NARROW_WIDTH_REM; a toggle overrides the width until
  // the card re-renders. The width is read in JS rather than a container query
  // so the toggle's aria-expanded always matches what is on screen.
  @tracked private railPreference: boolean | undefined;
  @tracked private isLibraryNarrow = false;
  private railId = `${guidFor(this)}-rail`;

  private get isRailOpen(): boolean {
    return this.railPreference ?? !this.isLibraryNarrow;
  }

  @tracked private railAnimates = false;

  // Under the breakpoint the open rail pushes part of the grid out of view.
  private get isGridCovered(): boolean {
    return this.isLibraryNarrow && this.isRailOpen;
  }

  private get railToggleLabel(): string {
    return this.isRailOpen ? 'Hide Sidebar' : 'Show Sidebar';
  }

  @action private toggleRail() {
    this.railAnimates = true;
    this.railPreference = !this.isRailOpen;
  }

  watchLibraryWidth = modifier((element: Element) => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    let observer = new ResizeObserver(([entry]) => {
      this.isLibraryNarrow =
        entry.contentRect.width < remToPx(LIBRARY_NARROW_WIDTH_REM);
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  setSegment = (segment: Segment) => () => {
    this.segment = segment;
    if (segment === 'activity') {
      // Lazy: the whole-realm reverse-chron search only runs when the
      // Activity segment is actually opened — keeps index-time prerenders
      // (which render Home) off the expensive path.
      this.loadFeed.perform();
    }
  };

  @cached
  get runningJobs() {
    return this.jobComponents.filter(
      (j) => j.status === 'running' || j.status === 'queued',
    );
  }

  // A live region going from text to empty announces nothing, so the progress
  // region falling silent would never speak that setup finished. This carries a
  // one-shot "Setup complete", set only on the running→idle transition tracked
  // in `loadJobs` — never on the initial load of a space whose jobs finished in
  // a past session, which is why it is pushed state rather than derived.
  @tracked private setupCompleteAnnouncement = '';
  #hadRunningJobs = false;

  // Door surround chrome: the grid owns the kicker and footer
  // around each entry point's fitted face; index-aligned with the
  // @fields.entryPoints iteration.
  doorKind = (index: number) => {
    let card = this.args.model.entryPoints?.[index];
    if (!card) {
      return '';
    }
    let ctor = card.constructor as typeof CardDef;
    let kind = ctor.prefersWideFormat ? 'App' : 'Card';
    return `${kind}: ${ctor.displayName}`;
  };

  doorTitle = (index: number) => {
    return this.args.model.entryPoints?.[index]?.cardTitle ?? '';
  };

  openDoor = (index: number) => () => {
    let card = this.args.model.entryPoints?.[index];
    if (card) {
      this.args.viewCard?.(card as CardDef);
    }
  };

  // Pin management: the ghost tile appends via the card chooser; the
  // kicker × removes. Both mutate the grid's own entryPoints linksToMany.
  pinCard = () => {
    this.pinCardTask.perform();
  };

  private pinCardTask = restartableTask(async () => {
    let chosenId = await chooseCard(
      {
        filter: {
          every: [
            { type: baseCardRef },
            ...excludeSelfReferentialCards(baseCardRef),
          ],
        },
        page: { size: SEARCH_PAGE_SIZE },
      },
      {
        consumingRealm: this.args.model[realmURL],
        lockConsumingRealm: true,
      },
    );
    if (!chosenId) {
      return;
    }
    let card = await this.args.context?.store.get<CardDef>(chosenId);
    if (card && isCardInstance(card)) {
      let existing = (this.args.model.entryPoints ?? []) as CardDef[];
      if (existing.some((c) => c?.id === card.id)) {
        return; // already pinned
      }
      this.args.model.entryPoints = [...existing, card];
    }
  });

  unpinDoor = (index: number) => () => {
    let pts = (this.args.model.entryPoints ?? []) as CardDef[];
    this.args.model.entryPoints = pts.filter((_, i) => i !== index);
  };

  // ── Typeahead search ──────────────────────────────────────
  @tracked private searchTerm = '';
  private searchResults: {
    id: string;
    title: string;
    type: string;
    card: CardDef;
  }[] = new TrackedArray();

  // What the search status region says, held as settled state rather than
  // derived live from `searchResults`. Two consequences the live form got wrong:
  //  - it read the debounce window as "no matches" for every prefix on the way
  //    to a term that matches, and blanking to '' each keystroke made the region
  //    re-announce an unchanged count as if it were new;
  //  - it read the term, not the results, so a blur that clears the dropdown but
  //    leaves the term announced "No matching cards" for a search that matched.
  // Instead this is set only where a search actually settles, and cleared only
  // where the dropdown is dismissed, so an in-flight search keeps showing the
  // previous answer and a dismissal falls silent.
  @tracked private searchAnnouncement = '';

  setupSearchHotkey = modifier((element: Element) => {
    let input = element.querySelector('input');
    let onKeydown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        input?.focus();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  @action private onSearchInput(value: string) {
    this.searchTerm = value;
    this.runSearch.perform();
  }

  // Wired to the input and to every result button, so Escape dismisses the
  // search from wherever focus is. Left to bubble, the operator mode reads
  // Escape on anything but a text field as "close this card" and the whole
  // workspace goes.
  @action private onSearchKeydown(ev: Event) {
    let ke = ev as KeyboardEvent;
    let target = ev.target as HTMLElement;
    if (ke.key === 'Escape') {
      ke.stopPropagation();
      this.searchTerm = '';
      this.searchResults.splice(0, this.searchResults.length);
      this.searchAnnouncement = ''; // dismissed, not "no matches"
      this.clearLibrarySearch(); // Esc also restores the rail selection
      target.blur();
    } else if (ke.key === 'Enter' && target instanceof HTMLInputElement) {
      this.seeAllResults(); // Enter in the field = full results in Library
      target.blur();
    }
  }

  @action private onSearchFocus() {
    this.hideResults.cancelAll();
    if (this.searchTerm.trim()) {
      this.runSearch.perform();
    }
  }

  // Dismissal follows focus leaving the whole search box, not the input: Tab
  // onto a result, or a click on one, keeps focus inside and must not close the
  // list under the user. The delay covers a click that lands outside.
  @action private onSearchFocusOut(ev: Event) {
    let box = ev.currentTarget as HTMLElement;
    let next = (ev as FocusEvent).relatedTarget as Node | null;
    if (next && box.contains(next)) {
      return;
    }
    this.hideResults.perform();
  }

  private hideResults = restartableTask(async () => {
    await timeout(200);
    this.searchResults.splice(0, this.searchResults.length);
    // Clearing the dropdown on blur is a dismissal, not a search that returned
    // nothing — leaving the term set here would otherwise re-announce
    // "No matching cards" for a search that did match.
    this.searchAnnouncement = '';
  });

  openResult = (result: { card: CardDef }) => () => {
    this.args.viewCard?.(result.card);
    this.searchTerm = '';
    this.hideResults.cancelAll();
    this.searchResults.splice(0, this.searchResults.length);
    this.searchAnnouncement = '';
  };

  private runSearch = restartableTask(async () => {
    await timeout(200);
    let term = this.searchTerm.trim();
    let store = this.args.context?.store;
    if (!term || !store) {
      this.searchResults.splice(0, this.searchResults.length);
      this.searchAnnouncement = ''; // never ran; nothing settled to announce
      return;
    }
    // CLI-verified shape: `contains` only matches when paired with a
    // `type` clause, and `on` goes inside each predicate.
    let clauses: unknown[] = [
      { type: baseCardRef },
      { on: baseCardRef, contains: { cardTitle: term } },
      ...excludeSelfReferentialCards(baseCardRef),
    ];
    if (this.args.model.searchIncludesSystem !== true) {
      // machinery stays out of results unless opted in
      for (let name of SYSTEM_TYPE_NAMES) {
        clauses.push({ not: { on: baseCardRef, eq: { _cardType: name } } });
      }
    }
    let instances = await this.searchRealm({
      // Use the bounded realm-local search path.
      filter: { every: clauses },
      sort: [{ by: 'lastModified', direction: 'desc' }],
    } as Query);
    let hits = (instances ?? []).filter(
      (i) => isCardInstance(i) && i.id,
    ) as CardDef[];
    this.searchTotal = hits.length;
    this.searchResults.splice(0, this.searchResults.length);
    for (let card of hits.slice(0, SEARCH_RESULTS_CAP)) {
      this.searchResults.push({
        id: card.id!,
        title: card.cardTitle ?? 'Untitled',
        type: (card.constructor as typeof CardDef).displayName,
        card,
      });
    }
    // Settled: this is the one place a real count (including a genuine zero)
    // becomes the announcement.
    this.searchAnnouncement = describeSearchResults(
      this.searchResults.length,
      this.searchTotal,
    );
  });

  @tracked private searchTotal = 0; // full hit count for the See-all row

  // Full results live in Library: a transient `Search: "term"` rail state
  // that remembers and restores the previous rail selection.
  @tracked private librarySearchTerm = '';
  private railReturnFilter: FilterOption | undefined;

  @cached
  private get searchFilter(): RailOption | undefined {
    let term = this.librarySearchTerm;
    if (!term) {
      return undefined;
    }
    return {
      id: 'search',
      displayName: `Search: “${term}”`,
      icon: SearchIcon,
      query: {
        filter: {
          every: [
            { type: baseCardRef },
            { on: baseCardRef, contains: { cardTitle: term } },
            ...excludeSelfReferentialCards(baseCardRef),
          ],
        },
      },
    };
  }

  @action private seeAllResults() {
    let term = this.searchTerm.trim();
    if (!term) {
      return;
    }
    if (!this.librarySearchTerm) {
      this.railReturnFilter = this.activeFilter; // remember where we were
    }
    this.librarySearchTerm = term;
    this.activeFilter = this.searchFilter!;
    this.segment = 'library';
    this.hideResults.cancelAll();
    this.searchResults.splice(0, this.searchResults.length);
  }

  private clearLibrarySearch() {
    if (!this.librarySearchTerm) {
      return;
    }
    this.librarySearchTerm = '';
    if (this.railReturnFilter) {
      this.activeFilter = this.railReturnFilter;
      this.railReturnFilter = undefined;
    }
  }

  // the invite pane renders the survey card itself (themed, lazy)
  surveyComponentFor = (job: { card: JobCard }): BoxComponent | undefined => {
    let survey = job.card.setupSurvey;
    return survey
      ? (survey.constructor as typeof BaseDef).getComponent(survey)
      : undefined;
  };

  // ── Home: setup bar, inventory, recent preview ──
  jobName = (job: { card: JobCard }) => {
    return job.card.listingName ?? job.card.cardTitle ?? 'your space';
  };

  jobCount = (job: { card: JobCard }) => {
    let total = job.card.progressTotal;
    if (!total) {
      return '';
    }
    return `${job.card.progressDone ?? 0} of ${total} items`;
  };

  jobFillStyle = (job: { card: JobCard }): SafeString => {
    let total = job.card.progressTotal;
    let pct = total
      ? Math.round(((job.card.progressDone ?? 0) / total) * 100)
      : 8;
    return htmlSafe(`width: ${Math.max(4, Math.min(100, pct))}%`);
  };

  // the HB strip pieces
  jobPct = (job: { card: JobCard }) => {
    let total = job.card.progressTotal;
    return total ? Math.round(((job.card.progressDone ?? 0) / total) * 100) : 0;
  };

  ringStyle = (job: { card: JobCard }): SafeString => {
    return htmlSafe(
      `background: conic-gradient(var(--attention) ${this.jobPct(job)}%, var(--grid-attention-rule) 0)`,
    );
  };

  jobEta = (job: { card: JobCard }) => {
    let mins = etaMinutes(job.card);
    if (mins === undefined) {
      return undefined;
    }
    return mins < 1 ? 'under a minute left' : `about ${mins} min left`;
  };

  surveyRemaining = (job: { card: JobCard }): number => {
    let survey = job.card.setupSurvey as
      | (CardDef & { questions?: unknown[]; answers?: unknown[] })
      | undefined;
    let questions = survey?.questions?.length ?? 0;
    let answers = survey?.answers?.length ?? 0;
    return questions > answers ? questions - answers : 0;
  };

  @tracked private dockCondensed = false; // True while the full dock is scrolled off-screen.

  private get firstRunningJob() {
    return this.runningJobs[0]!; // Read only under the runningJobs.length guard.
  }

  // What the progress status region says. Deliberately coarser than the meters
  // it stands in for: those advance continuously, and a region that changed with
  // them would talk over everything else on the page. Quantising to quarters
  // means the text changes at most four times per job, plus whenever the set of
  // running jobs changes.
  get progressAnnouncement(): string {
    let jobs = this.runningJobs;
    if (!jobs.length) {
      // Empty until a run has finished this session, then the one-shot
      // "Setup complete" — so falling idle is spoken instead of going silent.
      return this.setupCompleteAnnouncement;
    }
    if (jobs.length > 1) {
      return `${jobs.length} tasks running`;
    }
    let job = jobs[0]!;
    let name = this.jobName(job);
    if (!job.card.progressTotal) {
      // No total means jobPct is a placeholder, not a measurement.
      return `Setting up ${name}`;
    }
    return `Setting up ${name}, ${progressMilestone(
      this.jobPct(job),
    )}% complete`;
  }

  get dockSummary(): string {
    let jobs = this.runningJobs;
    if (jobs.length === 1) {
      let name = this.jobName(jobs[0]);
      let count = this.jobCount(jobs[0]);
      return count ? `Setting up ${name} · ${count}` : `Setting up ${name}`;
    }
    return `${jobs.length} tasks running`;
  }

  trackDock = modifier((element: Element) => {
    // Collapsing-header pattern: the summary bar shows only while the
    // full panel is out of the stage's viewport.
    let root = element.closest('.scroll-container');
    let observer = new IntersectionObserver(
      ([entry]) => {
        this.dockCondensed = !entry.isIntersecting;
      },
      { root, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  revealDock = (event: Event) => {
    (event.currentTarget as HTMLElement)
      .closest('.activity-pane')
      ?.querySelector('.scroll-container')
      ?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Inventory groups: content types by size, files by size, machinery folded.
  @cached
  private get contentCardChips(): RailOption[] {
    return this.cardTypeFilters
      .filter((o) => !SYSTEM_TYPE_NAMES.has(o.displayName))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  }

  @cached
  private get fileChips(): RailOption[] {
    return [...this.fileTypeFilters].sort(
      (a, b) => (b.count ?? 0) - (a.count ?? 0),
    );
  }

  @cached
  private get systemTypeCount(): number {
    return this.cardTypeFilters
      .filter((o) => SYSTEM_TYPE_NAMES.has(o.displayName))
      .reduce((sum, o) => sum + (o.count ?? 0), 0);
  }

  private get hasInventory() {
    return (
      this.contentCardChips.length > 0 ||
      this.fileChips.length > 0 ||
      this.systemTypeCount > 0
    );
  }

  // Home modules in the administrator's order
  private get homeModules(): string[] {
    return homeModulesOf(this.args.model);
  }

  private get doorsStyle(): SafeString {
    let height =
      this.args.model.pinnedSize === 'compact'
        ? DOOR_TILE_HEIGHT_COMPACT_PX
        : DOOR_TILE_HEIGHT_PX;
    return htmlSafe(`--door-h: ${height}px`);
  }

  // Settings gates. About and Browse show by default and are opt-out: an unset
  // `hideAbout`/`hideBrowse` (BooleanField `emptyValue` is `false`) reads as
  // "not hidden", so both surfaces appear until the administrator turns them
  // off. The negative naming is load-bearing, not a style choice — a
  // `show`-prefixed boolean cannot express a default-on setting here, because
  // an unset field and an explicitly-disabled one both read as `false`.
  private get aboutVisible() {
    return Boolean(this.args.model.readme) && !this.args.model.hideAbout;
  }

  private get browseVisible() {
    return this.hasInventory && !this.args.model.hideBrowse;
  }

  @tracked private latest: { title: string; when?: string } | undefined;

  // A one-row passive preview of the newest change; strings only, so no
  // child card render (and no nested-theme prerender risk) on Home.
  private loadLatest = restartableTask(async () => {
    let store = this.args.context?.store;
    if (!store) {
      return;
    }
    let instances = await this.searchRealm({
      // Keep Home preview lookup inside this realm.
      filter: {
        every: [...excludeSelfReferentialCards()],
      },
      sort: [{ by: 'lastModified', direction: 'desc' }],
      page: { size: 1 }, // Home preview reads only the single newest card.
    } as Query);
    let first = (instances ?? []).find((i) => isCardInstance(i) && i.id) as
      | CardDef
      | undefined;
    if (!first) {
      this.latest = undefined;
      return;
    }
    this.latest = {
      title: first.cardTitle ?? 'Untitled',
      when: relativeTime(getCardMeta(first, 'lastModified')),
    };
  });

  // README expander (About this space)
  @tracked private readmeExpanded = false;

  toggleReadme = () => {
    this.readmeExpanded = !this.readmeExpanded;
  };

  // Space details: what the card can truthfully know about its realm
  // today (visibility via realmInfo, counts, last change). Indexing error
  // state needs a host surface — dependency D7.
  private get realmVisibility(): string | undefined {
    let info = this.args.model[realmInfo] as
      | { visibility?: string }
      | undefined;
    let v = info?.visibility;
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : undefined;
  }

  // Host-mode data
  private get publishedSites() {
    return publishedSitesOf(this.args.model);
  }

  get firstPublishedSiteHost(): string | undefined {
    return this.publishedSites[0]?.host;
  }

  // the config card itself, for host/routing data and the
  // direct Configuration open. Loaded once per realm subscription.
  @tracked private configInstance: CardDef | undefined;

  private get routeCount(): number {
    let config = this.configInstance as
      | (CardDef & { hostRoutingRules?: unknown[] })
      | undefined;
    return config?.hostRoutingRules?.length ?? 0;
  }

  private loadConfig = restartableTask(async () => {
    let instances = await this.searchRealm({
      filter: { eq: { _cardType: 'Realm Config' } },
    } as Query);
    this.configInstance = (instances ?? []).find(
      (i) => isCardInstance(i) && i.id,
    ) as CardDef | undefined;
  });

  openCard = (card: CardDef | undefined) => () => {
    // Shared click-to-open for tiles rendered outside the field system
    // (welcome embed, dock job cells, feed rows) — bare getComponent
    // renders never get the host's click-through on their own.
    if (card) {
      this.args.viewCard?.(card);
    }
  };

  // The feed mixes cards and files; a file opens through `viewCard`'s
  // `type: 'file'` path (keyed by its URL) rather than as a card on the stack.
  openFeedItem =
    (item: { card: CardDef | FileDef; kind: 'card' | 'file' }) => () => {
      if (item.kind === 'file') {
        this.args.viewCard?.((item.card as FileDef).id, undefined, {
          type: 'file',
        });
      } else {
        this.args.viewCard?.(item.card as CardDef);
      }
    };

  moreSites = (sites: unknown[]) => (sites.length > 1 ? sites.length - 1 : 0);

  jumpToFilter = (option: FilterOption | undefined) => () => {
    if (!option) {
      return;
    }
    this.activeFilter = option;
    this.segment = 'library';
  };

  iconHtml = (option: RailOption): SafeString | undefined => {
    return typeof option.icon === 'string' ? htmlSafe(option.icon) : undefined;
  };

  @action private createNew() {
    this.createCard.perform();
  }

  private get query(): Query | undefined {
    if (!this.activeFilter?.query) {
      return undefined;
    }
    let filter = this.activeFilter.query.filter;
    // Search-within-filter: typing in Library narrows the visible list to
    // filter ∧ term (the dropdown stays realm-wide). CLI-verified: the
    // composed clause needs its own `type` sibling to match.
    let term = this.searchTerm.trim();
    if (
      filter &&
      term &&
      this.segment === 'library' &&
      this.activeFilter !== this.searchFilter
    ) {
      filter = {
        every: [
          filter,
          { type: baseCardRef },
          { on: baseCardRef, contains: { cardTitle: term } },
        ],
      } as Query['filter'];
    }
    return {
      ...this.activeFilter.query,
      filter,
      sort: this.activeSort?.sort,
      // Bound the unified Library search on the server.
      page: { size: SEARCH_PAGE_SIZE },
    };
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  private get primaryRealm(): string | undefined {
    return this.realms[0];
  }

  private searchRealm = async (query: Query): Promise<CardDef[]> => {
    // Centralize the indexing-safe search boundary.
    let store = this.args.context?.store; // Use only the Card Grid host context.
    let realm = this.primaryRealm; // Resolve the realm owned by this Card Grid instance.
    if (!store || !realm) {
      // Never fall back to all available realms.
      return []; // An unscoped search must remain idle.
    } //
    // Bound hydration and federated-search scope. Default to SEARCH_PAGE_SIZE
    // but let a caller that needs fewer (e.g. a single-row preview) request a
    // smaller page.
    try {
      return await store.search(
        { page: { size: SEARCH_PAGE_SIZE }, ...query } as Query,
        [realm],
      );
    } catch (e) {
      // These searches feed passive panels — the Home inventory, the recent
      // preview, the Activity feed — every one of which reads fine as empty.
      // The realm can also be unsearchable for reasons the card can't fix: the
      // host refuses to mint a token for a realm on a different realm server
      // than its own, so a Workspace rendered from a foreign realm server
      // rejects here on every panel. Degrade to empty instead of letting the
      // rejection escape the task and surface as an unhandled error.
      console.warn(`Workspace search failed for realm ${realm}`, e);
      return [];
    }
  }; //

  // The four library-group rows keep stable identities (@cached, no tracked
  // count on the object — counts render via `countFor`), so the selected row
  // survives count refreshes. Entry points carries prebuilt components (the
  // already-loaded links) instead of a query.
  @cached
  private get everythingFilter(): RailOption {
    let self = this;
    return {
      id: 'everything',
      displayName: 'Everything',
      icon: LayoutGridIcon,
      get count() {
        return self.cardTotal + self.fileTotal;
      },
      query: {
        filter: {
          every: [...excludeSelfReferentialCards()],
        },
      },
    };
  }

  @cached
  private get entryPointsFilter(): RailOption {
    // `cards` is a lazy getter: this option object is built in the component
    // constructor, before linksToMany entries resolve in a cold render —
    // touching `.constructor` on an unresolved entry there crashes prerender.
    let model = this.args.model;
    return {
      id: 'entry-points',
      displayName: 'Entry points',
      icon: DoorOpenIcon,
      get count() {
        return model.entryPoints?.length ?? 0;
      },
      get cards() {
        return (model.entryPoints ?? [])
          .filter(Boolean)
          .map((card: CardDef) =>
            (card.constructor as typeof BaseDef).getComponent(card),
          );
      },
    };
  }

  @cached
  private get cardsFilter(): RailOption {
    let self = this;
    return {
      id: 'cards',
      displayName: 'Cards',
      icon: Captions,
      get count() {
        return self.cardTotal;
      },
      query: {
        filter: {
          every: [
            ...excludeSelfReferentialCards(),
            { not: { type: this.fileDefRef } },
          ],
        },
      },
    };
  }

  @cached
  private get filesFilter(): RailOption {
    let self = this;
    return {
      id: 'files',
      displayName: 'Files',
      icon: FileIcon,
      get count() {
        return self.fileTotal;
      },
      query: {
        filter: {
          type: this.fileDefRef,
        },
      },
    };
  }

  private get fileDefRef(): CodeRef {
    return { module: `${baseRealmRRI}card-api`, name: 'FileDef' } as CodeRef;
  }

  @cached
  private get libraryFilters(): RailOption[] {
    let options: RailOption[] = [];
    if (this.searchFilter) {
      options.push(this.searchFilter); // transient row while a search is open
    }
    options.push(this.everythingFilter);
    if (this.args.model.entryPoints?.length) {
      options.push(this.entryPointsFilter);
    }
    options.push(this.cardsFilter, this.filesFilter);
    return options;
  }

  @cached
  private get filterOptions(): FilterOption[] {
    return [
      ...this.libraryFilters,
      ...this.cardTypeFilters,
      ...this.fileTypeFilters,
    ];
  }

  countFor = (option: RailOption) => option.count ?? 0;

  createOfType = (option: FilterOption) => () => {
    // rail +: create an instance of exactly this row's type
    let filter = option.query?.filter;
    if (filter && 'type' in filter) {
      this.createCard.perform(filter.type as CodeRef); // Glint narrows query unions at the command boundary
    }
  };

  selectFilter = (option: FilterOption) => () => {
    if (option !== this.searchFilter) {
      this.librarySearchTerm = ''; // picking a real filter ends the search state
      this.railReturnFilter = undefined;
    }
    this.activeFilter = option;
  };

  private teardownRealmSubscription() {
    this.#unsubscribeFromRealm?.();
    this.#unsubscribeFromRealm = undefined;
    this.#subscribedRealm = undefined;
  }

  setupRealmSubscription = modifier(
    (_element: HTMLElement, [realm]: [string | undefined]) => {
      // Explicit modifier element type for standalone Glint
      if (!realm) {
        this.teardownRealmSubscription();
        return;
      }
      if (realm !== this.#subscribedRealm) {
        this.teardownRealmSubscription();
        this.#subscribedRealm = realm;
        this.#unsubscribeFromRealm = subscribeToRealm(
          realm,
          this.refreshOnIndex,
        );
        this.loadFilterList.perform();
        this.loadJobs.perform();
        this.loadLatest.perform();
        this.loadConfig.perform(); // host/routing data for space details
        if (this.segment === 'activity') {
          this.loadFeed.perform();
        }
      }

      return () => {
        this.teardownRealmSubscription();
      };
    },
  );

  @action private onChangeFilter(filter: FilterOption) {
    if (filter !== this.searchFilter) {
      this.librarySearchTerm = '';
      this.railReturnFilter = undefined;
    }
    this.activeFilter = filter;
  }

  @action private onChangeSort(option: SortOption) {
    this.activeSort = option;
  }

  @action private onChangeView(viewId: ViewOption['id']) {
    this.activeViewId = viewId;
  }

  private createCard = restartableTask(async (presetRef?: CodeRef) => {
    let filter = this.activeFilter?.query?.filter;
    let activeFilterRef =
      presetRef ??
      (filter && 'type' in filter ? (filter.type as CodeRef) : undefined); // Glint-safe query projection

    let spec: Spec | CardErrorJSONAPI | undefined;
    if (activeFilterRef) {
      let instances = await this.searchRealm({
        // Keep Spec lookup inside this realm.
        filter: {
          on: specRef,
          eq: { ref: activeFilterRef },
        },
        sort: [
          {
            by: 'createdAt',
            direction: 'desc',
          },
        ],
      } as Query);
      if (instances?.[0]?.id) {
        spec = instances[0] as Spec;
      }
    } else {
      let specId = await chooseCard(
        // Offer Specs from every realm the user can reach — the new card is
        // created in this Workspace's realm regardless of where its Spec lives.
        {
          filter: {
            on: specRef,
            every: [{ eq: { isCard: true } }],
          },
          page: { size: SEARCH_PAGE_SIZE }, // Keep chooser result pages bounded.
        },
      );

      if (!specId) {
        return;
      }

      spec = await this.args.context?.store.get<Spec>(specId);
    }

    if (spec && isCardInstance<Spec>(spec)) {
      await this.args.createCard?.(spec.ref, spec.id, {
        realmURL: this.args.model[realmURL],
      });
    } else if (activeFilterRef) {
      await this.args.createCard?.(activeFilterRef, undefined, {
        realmURL: this.args.model[realmURL],
      });
    }
  });

  private loadFilterList = restartableTask(async () => {
    let realm = this.primaryRealm;
    if (!realm) {
      return;
    }
    let response = await fetch(`${realm}_types`, {
      headers: {
        Accept: SupportedMimeType.CardTypeSummary,
      },
    });
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} -
          ${response.statusText}. ${responseText}`,
      ) as Error & { status?: number; responseText?: string };

      err.status = response.status;
      err.responseText = responseText;

      throw err;
    }
    let cardTypeSummaries = (await response.json()).data as {
      id: string;
      attributes: {
        displayName: string;
        total: number;
        iconHTML: string | null;
        kind?: 'instance' | 'file';
      };
    }[];
    this.cardTypeFilters.splice(0, this.cardTypeFilters.length);
    this.fileTypeFilters.splice(0, this.fileTypeFilters.length);
    let cardTotal = 0;
    let fileTotal = 0;

    cardTypeSummaries.forEach((summary) => {
      if (!summary.id) {
        return;
      }
      let ref = codeRefFromInternalKey(summary.id);
      if (!ref) {
        return;
      }
      let kind = summary.attributes.kind ?? 'instance';
      if (TYPE_RAIL_EXCLUDED_IDS.includes(summary.id)) {
        return;
      }
      if (summary.id.endsWith('workspace/Workspace')) {
        return;
      }
      // Accumulate after the exclusion guards so the rail counts match the
      // grid each row opens: the Workspace card (always present, rendering
      // itself) and the excluded system types must not inflate the totals.
      if (kind === 'file') {
        fileTotal += summary.attributes.total ?? 0;
      } else {
        cardTotal += summary.attributes.total ?? 0;
      }
      // Types stay one flat vocabulary (JPGs and PDFs are types like Product
      // and Order) but the rail groups them by kind: CARD TYPES / FILE TYPES.
      let group = kind === 'file' ? this.fileTypeFilters : this.cardTypeFilters;
      group.push({
        id: summary.id,
        displayName: summary.attributes.displayName ?? ref.name,
        icon:
          summary.attributes.iconHTML ??
          (kind === 'file' ? FileIcon : Captions),
        count: summary.attributes.total ?? 0,
        query: {
          filter: {
            type: ref,
          },
        },
      });
    });

    this.cardTotal = cardTotal;
    this.fileTotal = fileTotal;

    this.activeFilter =
      this.filterOptions.find((filter) => filter.id === this.activeFilter.id) ??
      this.filterOptions[0];
  });

  private loadJobs = restartableTask(async () => {
    if (!this.args.context?.store) {
      return;
    }
    let processRef = codeRef(here, './process-card', 'ProcessCard');
    let remixRef = codeRef(here, './remix-card', 'RemixCard');
    let instances = await this.searchRealm({
      // Keep job discovery inside this realm.
      filter: {
        any: [{ type: processRef }, { type: remixRef }],
      },
      sort: [
        {
          by: 'lastModified',
          direction: 'desc',
        },
      ],
    } as Query);

    this.jobComponents.splice(0, this.jobComponents.length);
    let seen = new Set<string>();
    for (let instance of instances ?? []) {
      if (!isCardInstance(instance) || !instance.id || seen.has(instance.id)) {
        continue;
      }
      seen.add(instance.id);
      let card = instance as JobCard & { processStatus?: string };
      this.jobComponents.push({
        id: card.id!,
        card,
        status: card.processStatus ?? 'running',
        component: (card.constructor as typeof BaseDef).getComponent(card),
      });
    }
    // Speak completion once, on the running→idle edge. A fresh run underway
    // clears the terminal announcement (the region is showing "Setting up…"
    // anyway); the last job leaving clears it on the next start, not now.
    let running = this.runningJobs.length > 0;
    if (running) {
      this.setupCompleteAnnouncement = '';
    } else if (this.#hadRunningJobs) {
      this.setupCompleteAnnouncement = 'Setup complete';
    }
    this.#hadRunningJobs = running;
  });

  private refreshOnIndex = (ev: RealmEventContent) => {
    // React to a completed index pass — incremental, full, or copy — not the
    // 'incremental-index-initiation' pre-index signal, whose new state is not
    // queryable yet. Widening past 'incremental' keeps the rail, counts, jobs
    // dock, and feed fresh after a full reindex or a realm copy/remix, not just
    // after incremental edits.
    if (
      ev.eventName === 'index' &&
      (ev.indexType === 'incremental' ||
        ev.indexType === 'full' ||
        ev.indexType === 'copy')
    ) {
      this.refreshAfterIndex.perform();
    }
  };

  // Coalesce a burst of index events into a single refresh: each event restarts
  // the task, cancelling the pending timeout, so the panel searches fan out once
  // the burst settles rather than 3–4× per event.
  private refreshAfterIndex = restartableTask(async () => {
    await timeout(INDEX_REFRESH_DEBOUNCE_MS);
    this.loadFilterList.perform();
    this.loadJobs.perform();
    this.loadLatest.perform();
    if (this.segment === 'activity') {
      this.loadFeed.perform();
    }
  });

  // The Activity log: everything in the realm — cards and uploaded files —
  // reverse-chron by lastModified. Each row carries when / what / why:
  // timestamp rail, the card or file preview, and a change note
  // (`cardInfo.notes` — the convention slot a human or AI fills in when saving
  // a change; files carry none).
  private feedItems: {
    id: string;
    component: BoxComponent;
    when: string | undefined;
    absolute: string | undefined;
    absoluteIso: string | undefined;
    note: string | undefined;
    verb: ActivityVerb;
    dayLabel: string;
    showDay: boolean;
    title: string | undefined; // card / file identity for the log line
    typeName: string;
    typeIcon: typeof CardDef.icon;
    // The instance behind the tile-open overlay. A file row opens through
    // `viewCard`'s `type: 'file'` path, so the two kinds are distinguished.
    card: CardDef | FileDef;
    kind: 'card' | 'file';
  }[] = new TrackedArray();

  // Reveal-on-scroll pagination over the fetched window.
  @tracked private feedShown = FEED_REVEAL_CHUNK;
  private activityFeedCap = ACTIVITY_FEED_CAP; // for the "last N changes" note

  private get visibleFeed() {
    return this.feedItems.slice(0, this.feedShown);
  }

  private get moreFeed() {
    return this.feedItems.length > this.feedShown;
  }

  private get feedAtCap() {
    return this.feedItems.length >= ACTIVITY_FEED_CAP;
  }

  // The source a remix was cloned from, read live off the card so it fills in
  // when the linked instance finishes loading (the linksTo getter lazily loads
  // and tracks). Undefined for non-remix rows and remixes with no source set.
  remixSourceTitle = (item: {
    verb: ActivityVerb;
    card: CardDef | FileDef;
  }): string | undefined => {
    if (item.verb !== 'Remixed' || !isCardInstance(item.card)) {
      // Only a card is ever classified 'Remixed'; the guard also narrows the
      // card/file union so the cast below starts from CardDef.
      return undefined;
    }
    return (item.card as RemixCardLike).remixedFrom?.cardTitle ?? undefined;
  };

  watchFeedEnd = modifier((element: Element) => {
    let root = element.closest('.scroll-container');
    let observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.feedShown = Math.min(
            this.feedShown + FEED_REVEAL_CHUNK,
            this.feedItems.length,
          );
          // re-arm: observe() always delivers a fresh async notification
          // after the next layout, so a still-visible sentinel fires again
          observer.unobserve(element);
          observer.observe(element);
        }
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  private loadFeed = restartableTask(async () => {
    let store = this.args.context?.store;
    let realm = this.primaryRealm; // Keep the live activity query realm-local.
    if (!store || !realm) {
      // Do not fall back to the store's full accessible realm set.
      return;
    }
    let instances = await store.search(
      {
        // The feed mixes cards and uploaded files. The self-referential
        // exclusion is qualified to card rows (`on: baseCardRef`) on purpose:
        // it filters on `_cardType`, a search-doc key only card rows carry, and
        // a top-level negated match against a key a file row lacks is SQL NULL
        // (not true), which would silently drop every file. Qualified by `on`,
        // the negation wraps a type gate a file row fails, so files survive.
        // `excludeCardInstanceFileRows()` drops a card's dual-indexed `.json`
        // file row so each card shows once (via its instance row) — still
        // required alongside `scope: 'all'`. `excludeExecutableFiles()` keeps
        // source-module saves from consuming the shared row budget.
        filter: {
          every: [
            ...excludeSelfReferentialCards(baseCardRef),
            excludeCardInstanceFileRows(),
            excludeExecutableFiles(),
          ],
        },
        sort: [{ by: 'lastModified', direction: 'desc' }],
        // Bound server results before instance hydration.
        page: { size: ACTIVITY_FEED_CAP },
      } as Query,
      [realm],
      // Opt into the mixed instance + file scope; the loop discriminates each
      // row by kind. An untyped query would otherwise be pinned to cards only.
      { scope: 'all' },
    ); // Search only the Card Grid instance's realm.
    this.feedItems.splice(0, this.feedItems.length);
    let seen = new Set<string>();
    let prevDay: string | undefined;
    for (let instance of instances ?? []) {
      // build the full fetched window (≤100); the template reveals in 20s
      let card = isCardInstance(instance) ? instance : undefined;
      let file = !card && isFileDefInstance(instance) ? instance : undefined;
      let entry = card ?? file;
      if (!entry || !entry.id || seen.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      // A single malformed row (a throwing `cardTitle`/`name` getter, an
      // unreadable timestamp) must not cost the rows after it — skip it and
      // keep going. The restartable task would otherwise swallow the throw and
      // truncate the feed at the failing row. This guards only the row build:
      // `getComponent` just returns the component, so a preview that throws
      // does so later, when Glimmer renders it in the template.
      try {
        // Timestamps read the same way for both kinds: a file carries its
        // `lastModified` / `resourceCreatedAt` on `meta` from the serialization
        // source (FileDef's first-class getters), so `getCardMeta` answers
        // uniformly for cards and files.
        let modMs = toMs(getCardMeta(entry, 'lastModified'));
        let createdMs = toMs(getCardMeta(entry, 'resourceCreatedAt'));
        let ctor = entry.constructor as typeof BaseDef; // type identity for the log line
        // A file is a Created/Updated event by write timing; only a card can be
        // a first-class Remix.
        let verb = card
          ? activityVerbFor(
              (ctor as typeof CardDef).displayName,
              modMs,
              createdMs,
            )
          : classifyActivityVerb(modMs, createdMs);
        let day = modMs !== undefined ? dayLabelFor(modMs) : '';
        this.feedItems.push({
          id: entry.id,
          component: ctor.getComponent(entry),
          when: modMs !== undefined ? relativeTime(modMs) : undefined,
          absolute:
            modMs !== undefined ? new Date(modMs).toLocaleString() : undefined,
          absoluteIso:
            modMs !== undefined ? new Date(modMs).toISOString() : undefined,
          note: card?.cardInfo?.notes ?? undefined,
          verb,
          dayLabel: day,
          showDay: Boolean(day) && day !== prevDay,
          title: card
            ? (card.cardTitle ?? undefined)
            : (file!.name ?? undefined),
          typeName: (ctor as typeof CardDef).displayName,
          typeIcon: (ctor as typeof CardDef).icon,
          card: entry,
          kind: card ? 'card' : 'file',
        });
        prevDay = day || prevDay;
      } catch (err) {
        console.warn(
          `workspace activity feed: skipping ${entry.id} — ${
            (err as Error)?.message ?? err
          }`,
        );
      }
    }
  });
}

export class Workspace extends CardDef {
  static displayName = 'Workspace';
  static icon = LayoutGridPlusIcon;
  static isolated = Isolated;
  static prefersWideFormat = true;

  // the edit format IS the workspace's settings page.
  // Five sections; every control wires to live behavior.
  static edit = class Edit extends Component<typeof Workspace> {
    // distinct ids per render: the same card can be open in several stacks
    private idBase = guidFor(this);

    get workspaceName() {
      return this.args.model.workspace?.cardInfo?.name ?? '';
    }

    get workspaceIcon() {
      return (
        (this.args.model.workspace as RealmConfigCard | undefined)?.iconURL ??
        ''
      );
    }

    setWorkspaceName = (value: string) => {
      let ws = this.args.model.workspace;
      if (ws?.cardInfo) {
        ws.cardInfo.name = value;
      }
    };

    setWorkspaceIcon = (value: string) => {
      let ws = this.args.model.workspace as RealmConfigCard | undefined;
      if (ws) {
        ws.iconURL = value;
      }
    };

    setView = (view: string) => () => {
      this.args.model.defaultView = view;
    };

    get activeView() {
      return this.args.model.defaultView === 'strip' ? 'strip' : 'grid';
    }

    // identity fields (description lives on cardInfo.summary)
    get description() {
      return this.args.model.cardInfo?.summary ?? '';
    }

    setDescription = (value: string) => {
      if (this.args.model.cardInfo) {
        this.args.model.cardInfo.summary = value;
      }
    };

    setSignage = (value: string) => {
      this.args.model.signage = value;
    };

    setPurpose = (value: string) => {
      this.args.model.purpose = value;
    };

    // module order & size
    get moduleList() {
      return homeModulesOf(this.args.model);
    }

    moveModule = (mod: string, dir: number) => () => {
      let order = homeModulesOf(this.args.model);
      let i = order.indexOf(mod);
      let j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) {
        return;
      }
      [order[i], order[j]] = [order[j], order[i]];
      this.args.model.moduleOrder = order.join(',');
    };

    moduleLabel = (mod: string) =>
      mod === 'pinned' ? 'Pinned' : mod === 'about' ? 'About' : 'Browse';

    orderPos = (index: number) => `${index + 1}.`;

    setPinnedSize = (size: string) => () => {
      this.args.model.pinnedSize = size;
    };

    get activePinnedSize() {
      return this.args.model.pinnedSize === 'compact' ? 'compact' : 'regular';
    }

    // Hosting: present published sites and mutate them via the registered
    // publish-realm / unpublish-realm host tools. First-time publish (domain
    // choice) stays in the host submode's publish flow; this format acts on
    // destinations that already exist.
    //
    // The list starts from `meta.realmInfo`, which is a snapshot taken when the
    // card was (de)serialized — a mutation here changes hosting state without
    // changing that snapshot, and unpublish triggers no reindex, so nothing
    // would rebuild it in-session. Once a mutation lands, re-read the list
    // through the get-published-realms tool and prefer its answer from then on;
    // otherwise an unpublished site would keep being listed as live until the
    // card was reloaded. `TrackedObject` rather than `@tracked` fields because
    // this is a class expression, where decorators aren't allowed.
    private hosting = new TrackedObject<{
      sites: PublishedSite[] | undefined;
      error: string | undefined;
    }>({ sites: undefined, error: undefined });

    get publishedSites(): PublishedSite[] {
      return this.hosting.sites ?? publishedSitesOf(this.args.model);
    }

    get hostingError() {
      return this.hosting.error;
    }

    // Re-reads the authoritative list. The tool reports RealmService's own
    // hosting state, which both mutations write through, so this reflects what
    // actually happened server-side rather than what was requested.
    private reloadPublishedSites = async () => {
      let commandContext = this.args.context?.commandContext;
      let realm = this.args.model[realmURL]?.href;
      if (!commandContext || !realm) {
        return;
      }
      let { results } = await new GetPublishedRealmsTool(
        commandContext,
      ).execute(new GetPublishedRealmsInput({ realmURL: realm }));
      // Annotated because this module is also compiled by projects that don't
      // map `@cardstack/boxel-host/tools/*` and so see the tool as `any`.
      this.hosting.sites = (results ?? []).map((site: PublishedRealmInfo) =>
        publishedSite(site.publishedRealmURL, site.lastPublishedAt),
      );
    };

    get isPublishable() {
      return this.args.model[realmInfo]?.publishable === true;
    }

    republish = () => {
      this.republishTask.perform();
    };

    private republishTask = restartableTask(async () => {
      let commandContext = this.args.context?.commandContext;
      let realm = this.args.model[realmURL]?.href;
      let urls = this.publishedSites.map((s) => s.url);
      if (!commandContext || !realm || !urls.length) {
        return;
      }
      this.hosting.error = undefined;
      let { results } = await new PublishRealmTool(commandContext).execute(
        new PublishRealmInput({
          realmURL: realm,
          publishedRealmURLs: urls,
        }),
      );
      // Per-destination outcomes come back on the result rather than as a
      // rejection, so a publish that didn't happen is only visible here.
      let failure = (results ?? []).find(
        (result: PublishTargetResult) => result.status === 'error',
      );
      if (failure) {
        this.hosting.error = `Could not republish ${hostOf(
          failure.publishedRealmURL,
        )}: ${failure.error || 'unknown error'}`;
      }
      // Refresh either way: with the publish timestamps of whatever did land.
      await this.reloadPublishedSites();
    });

    get publishBusy() {
      return this.republishTask.isRunning;
    }

    unpublish = (publishedRealmURL: string) => () => {
      this.unpublishTask.perform(publishedRealmURL);
    };

    // Which site is in flight, so one row can label itself while the others
    // stay idle — `unpublishTask.isRunning` is true for all of them.
    private unpublishing = new TrackedSet<string>();

    private unpublishTask = restartableTask(
      async (publishedRealmURL: string) => {
        let commandContext = this.args.context?.commandContext;
        let realm = this.args.model[realmURL]?.href;
        if (!commandContext || !realm) {
          return;
        }
        this.hosting.error = undefined;
        this.unpublishing.add(publishedRealmURL);
        try {
          let result = await new UnpublishRealmTool(commandContext).execute(
            new UnpublishRealmInput({
              realmURL: realm,
              publishedRealmURL,
            }),
          );
          // The tool maps a rejected request onto an error result instead of
          // throwing, so leaving the row in place depends on reading it.
          if (result.status === 'error') {
            this.hosting.error = `Could not unpublish ${hostOf(
              publishedRealmURL,
            )}: ${result.error || 'unknown error'}`;
            return;
          }
          await this.reloadPublishedSites();
        } finally {
          this.unpublishing.delete(publishedRealmURL);
        }
      },
    );

    isUnpublishing = (publishedRealmURL: string) =>
      this.unpublishing.has(publishedRealmURL);

    get unpublishBusy() {
      return this.unpublishTask.isRunning;
    }

    // Either mutation blocks both controls: Republish acts on the whole list,
    // so republishing a destination that is mid-unpublish would put the site
    // back up. Matches the host submode's modal, which disables its publish
    // controls whenever an unpublish is running.
    get hostingBusy() {
      return this.publishBusy || this.unpublishBusy;
    }

    <template>
      <div class='settings'>
        <header class='settings-head'>
          <h2 class='settings-title' data-test-settings-title>Workspace settings</h2>
          <p class='settings-lede'>Everything the Home, Library, and Activity
            tabs do — and the identity of the workspace behind them.</p>
        </header>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Pinned</h3>
            <p class='group-desc'>The cards at the top of Home — the two or
              three things this space is really about.</p>
          </div>
          <div class='group-card'>
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>Pinned cards</span>
                <p class='setting-help'>Add, remove, and reorder. Pins show as
                  large tiles at the top of Home.</p>
              </div>
              <div class='setting-control'><@fields.entryPoints /></div>
            </div>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Tile size</span>
                <p class='setting-help'>Regular is a full preview. Compact fits
                  more tiles in a row.</p>
              </div>
              <div class='setting-control'>
                <div class='choice'>
                  {{#let (eq this.activePinnedSize 'regular') as |isSelected|}}
                    <Button
                      @kind={{if isSelected 'default' 'muted'}}
                      @size='extra-small'
                      @rectangular={{true}}
                      class='choice-opt'
                      aria-pressed={{if isSelected 'true' 'false'}}
                      {{on 'click' (this.setPinnedSize 'regular')}}
                    >Regular</Button>
                  {{/let}}
                  {{#let (eq this.activePinnedSize 'compact') as |isSelected|}}
                    <Button
                      @kind={{if isSelected 'default' 'muted'}}
                      @size='extra-small'
                      @rectangular={{true}}
                      class='choice-opt'
                      aria-pressed={{if isSelected 'true' 'false'}}
                      {{on 'click' (this.setPinnedSize 'compact')}}
                    >Compact</Button>
                  {{/let}}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Home</h3>
            <p class='group-desc'>What the landing tab shows, and in what order.</p>
          </div>
          <div class='group-card'>
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>About file</span>
                <p class='setting-help'>A Markdown file rendered on Home. On a
                  fresh space it is the landing content; once cards are pinned
                  it collapses into an About section.</p>
              </div>
              <div class='setting-control'><@fields.readme /></div>
            </div>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Hide About</span>
                <p class='setting-help'>The About section shows below the pins
                  by default. Turn on to keep Home to cards only.</p>
              </div>
              <div class='setting-control'><@fields.hideAbout /></div>
            </div>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Hide Browse</span>
                <p class='setting-help'>Browse shows the inventory of card and
                  file types, with counts, linking into the Library. Turn on to
                  hide it.</p>
              </div>
              <div class='setting-control'><@fields.hideBrowse /></div>
            </div>
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>Section order</span>
                <p class='setting-help'>Home renders these top to bottom.</p>
              </div>
              <div class='setting-control'>
                <div class='order-list'>
                  {{#each this.moduleList as |mod index|}}
                    <div class='order-row'>
                      <span class='order-pos data'>{{this.orderPos
                          index
                        }}</span>
                      <span class='order-name'>{{this.moduleLabel mod}}</span>
                      <IconButton
                        @icon={{ArrowUpIcon}}
                        @variant='default'
                        @size='extra-small'
                        @width='14'
                        @height='14'
                        class='order-move'
                        aria-label='Move {{this.moduleLabel mod}} up'
                        {{on 'click' (this.moveModule mod -1)}}
                      />
                      <IconButton
                        @icon={{ArrowDownIcon}}
                        @variant='default'
                        @size='extra-small'
                        @width='14'
                        @height='14'
                        class='order-move'
                        aria-label='Move {{this.moduleLabel mod}} down'
                        {{on 'click' (this.moveModule mod 1)}}
                      />
                    </div>
                  {{/each}}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Search</h3>
            <p class='group-desc'>The search box in the frame finds cards across
              this whole space, from any tab.</p>
          </div>
          <div class='group-card'>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Include system cards</span>
                <p class='setting-help'>Themes, configs, specs, and other
                  machinery. Off keeps results to your content.</p>
              </div>
              <div class='setting-control'><@fields.searchIncludesSystem
                /></div>
            </div>
          </div>
        </section>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Library</h3>
            <p class='group-desc'>The browsing tab — a filter rail beside the
              full card list.</p>
          </div>
          <div class='group-card'>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Default view</span>
                <p class='setting-help'>Grid shows tiles. Strip shows rows.</p>
              </div>
              <div class='setting-control'>
                <div class='choice'>
                  {{#let (eq this.activeView 'grid') as |isSelected|}}
                    <Button
                      @kind={{if isSelected 'default' 'muted'}}
                      @size='extra-small'
                      @rectangular={{true}}
                      class='choice-opt'
                      aria-pressed={{if isSelected 'true' 'false'}}
                      {{on 'click' (this.setView 'grid')}}
                    >Grid</Button>
                  {{/let}}
                  {{#let (eq this.activeView 'strip') as |isSelected|}}
                    <Button
                      @kind={{if isSelected 'default' 'muted'}}
                      @size='extra-small'
                      @rectangular={{true}}
                      class='choice-opt'
                      aria-pressed={{if isSelected 'true' 'false'}}
                      {{on 'click' (this.setView 'strip')}}
                    >Strip</Button>
                  {{/let}}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Identity</h3>
            <p class='group-desc'>How this space introduces itself to anyone who
              lands here.</p>
          </div>
          <div class='group-card'>
            <div class='setting stack'>
              <div class='setting-text'>
                <label
                  class='setting-label'
                  for={{concat this.idBase '-description'}}
                >Description</label>
                <p class='setting-help'>One line shown at the top of Home.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
                  @id={{concat this.idBase '-description'}}
                  @value={{this.description}}
                  @onInput={{this.setDescription}}
                  @placeholder='One line about this space'
                />
              </div>
            </div>
            <div class='setting stack'>
              <div class='setting-text'>
                <label
                  class='setting-label'
                  for={{concat this.idBase '-signage'}}
                >Signage</label>
                <p class='setting-help'>A short badge beside the tabs — a status
                  or role, like DESIGN LAB or STAGING.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
                  @id={{concat this.idBase '-signage'}}
                  @value={{@model.signage}}
                  @onInput={{this.setSignage}}
                  @placeholder='e.g. DESIGN LAB'
                />
              </div>
            </div>
            <div class='setting stack'>
              <div class='setting-text'>
                <label
                  class='setting-label'
                  for={{concat this.idBase '-purpose'}}
                >Purpose</label>
                <p class='setting-help'>What this space is for. Shown when
                  hovering the signage badge.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
                  @id={{concat this.idBase '-purpose'}}
                  @value={{@model.purpose}}
                  @onInput={{this.setPurpose}}
                  @placeholder='What this space is for'
                />
              </div>
            </div>
          </div>
        </section>

        <section class='group'>
          <div class='group-info'>
            <h3 class='group-name'>Workspace &amp; hosting</h3>
            <p class='group-desc'>Settings that live on the realm itself — the
              name in the app frame, the icon, and where this space is
              published.</p>
          </div>
          <div class='group-card'>
            {{#if @model.workspace}}
              <div class='setting stack'>
                <div class='setting-text'>
                  <label
                    class='setting-label'
                    for={{concat this.idBase '-name'}}
                  >Name</label>
                  <p class='setting-help'>Shown in the app frame and in
                    workspace lists. Applies to the whole workspace.</p>
                </div>
                <div class='setting-control'>
                  <BoxelInput
                    @id={{concat this.idBase '-name'}}
                    @value={{this.workspaceName}}
                    @onInput={{this.setWorkspaceName}}
                    @placeholder='Workspace name'
                  />
                </div>
              </div>
              <div class='setting stack'>
                <div class='setting-text'>
                  <label
                    class='setting-label'
                    for={{concat this.idBase '-icon-url'}}
                  >Icon URL</label>
                  <p class='setting-help'>A square image shown beside the name.</p>
                </div>
                <div class='setting-control'>
                  <BoxelInput
                    @id={{concat this.idBase '-icon-url'}}
                    @value={{this.workspaceIcon}}
                    @onInput={{this.setWorkspaceIcon}}
                    @placeholder='https://…'
                  />
                </div>
              </div>
            {{/if}}
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>Configuration card</span>
                <p class='setting-help'>Routing rules and advanced options live
                  on the full configuration card.</p>
              </div>
              <div class='setting-control'><@fields.workspace /></div>
            </div>
            {{#if this.hostingError}}
              <div class='setting'>
                <div class='setting-text'>
                  <span class='setting-label'>Hosting</span>
                  <p
                    class='setting-help hosting-error'
                    data-test-hosting-error
                  >{{this.hostingError}}</p>
                </div>
              </div>
            {{/if}}
            {{#if this.publishedSites.length}}
              {{#each this.publishedSites as |site|}}
                <div class='setting'>
                  <div class='setting-text'>
                    <span class='setting-label'>Published</span>
                    <p class='setting-help'>Live on the web at this address.</p>
                  </div>
                  <div class='setting-control site'>
                    <span class='site-host data'>{{site.host}}</span>
                    {{#if site.when}}
                      <span class='site-when'>{{site.when}}</span>
                    {{/if}}
                    <Button
                      @kind='default'
                      @size='extra-small'
                      @rectangular={{true}}
                      @disabled={{this.hostingBusy}}
                      class='publish-btn unpublish-btn'
                      {{on 'click' (this.unpublish site.url)}}
                      data-test-unpublish-site={{site.url}}
                    >{{if
                        (this.isUnpublishing site.url)
                        'Unpublishing…'
                        'Unpublish'
                      }}</Button>
                  </div>
                </div>
              {{/each}}
              <div class='setting'>
                <div class='setting-text'>
                  <span class='setting-label'>Republish</span>
                  <p class='setting-help'>Updates the live site with the current
                    content.</p>
                </div>
                <div class='setting-control'>
                  <Button
                    @kind='default'
                    @size='extra-small'
                    @rectangular={{true}}
                    @disabled={{this.hostingBusy}}
                    class='publish-btn'
                    {{on 'click' this.republish}}
                    data-test-republish
                  >{{if this.publishBusy 'Publishing…' 'Republish'}}</Button>
                </div>
              </div>
            {{else if this.isPublishable}}
              <div class='setting'>
                <div class='setting-text'>
                  <span class='setting-label'>Publishing</span>
                  <p class='setting-help'>Not published. Use Publish in the Host
                    submode toolbar to put this space on the web.</p>
                </div>
              </div>
            {{else}}
              <div class='setting'>
                <div class='setting-text'>
                  <span class='setting-label'>Publishing</span>
                  <p class='setting-help'>This workspace is not publishable.</p>
                </div>
              </div>
            {{/if}}
          </div>
        </section>
      </div>
      <style scoped>
        /* Shopify-pattern settings page in the grid's own voice: narrow
           column, group rail left, control card right, help under every
           setting. */
        .settings {
          --grid-settings-width: 55rem;
          --grid-pill: 100rem;
          container-type: inline-size;
          max-width: var(--grid-settings-width);
          margin: 0 auto;
          display: grid;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-xl) var(--boxel-sp-lg) var(--boxel-sp-2xl);
        }
        .settings .order-move,
        .settings .publish-btn {
          line-height: inherit;
          letter-spacing: inherit;
        }
        .data {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }
        .settings-head {
          display: grid;
          gap: var(--boxel-sp-4xs);
        }
        .settings-lede {
          font-size: var(--boxel-font-size-sm);
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .group {
          display: grid;
          grid-template-columns: 13.75rem minmax(0, 1fr);
          gap: var(--boxel-sp-lg);
          align-items: start;
        }
        @container (width < 42.5rem) {
          .group {
            grid-template-columns: 1fr;
            gap: var(--boxel-sp-xs);
          }
        }
        .group-info {
          display: grid;
          gap: var(--boxel-sp-4xs);
          padding-top: var(--boxel-sp-4xs);
        }
        .group-desc {
          font-size: var(--boxel-font-size-xs);
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .group-card {
          background-color: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-lg);
          box-shadow: var(--shadow-sm);
        }
        .setting {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: var(--boxel-sp-2xs) var(--boxel-sp-lg);
          padding: var(--boxel-sp);
        }
        .setting.stack {
          grid-template-columns: 1fr;
          align-items: start;
        }
        .setting + .setting {
          border-top: 1px solid var(--border);
        }
        .setting-text {
          display: grid;
          gap: var(--boxel-sp-5xs);
          min-width: 0;
        }
        .setting-label {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--foreground);
        }
        .setting-help {
          font-size: var(--boxel-font-size-xs);
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .setting-control {
          min-width: 0;
        }
        .setting-control.site {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .site-host {
          font-size: var(--boxel-font-size-xs);
          color: var(--foreground);
        }
        .site-when {
          font-size: var(--boxel-font-size-xs);
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .choice {
          display: inline-flex;
          padding: var(--boxel-sp-4xs);
          gap: var(--boxel-sp-4xs);
          border: 1px solid var(--border);
          /* outer radius = the options' radius + the padding */
          border-radius: var(--boxel-border-radius);
          background-color: var(--muted);
        }
        .choice-opt {
          --boxel-button-border: none;
        }
        .order-list {
          display: grid;
          gap: var(--boxel-sp-3xs);
        }
        .order-row {
          display: grid;
          grid-template-columns: 1.375rem minmax(0, 1fr) auto auto;
          align-items: center;
          gap: var(--boxel-sp-2xs);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius);
          background-color: var(--card);
          color: var(--card-foreground);
        }
        .order-pos {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .order-name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
        }
        .settings .order-move {
          width: 1.5rem;
          height: 1.5rem;
          display: grid;
          place-items: center;
          border-radius: var(--boxel-border-radius-sm);
        }
        .settings .order-move:hover {
          border-color: var(--border-strong);
          color: var(--foreground);
        }
        .settings .publish-btn {
        }
        .settings .publish-btn:hover {
          border-color: var(--primary-ink);
          color: var(--primary-ink);
        }
        .settings .publish-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        /* Sits at the end of the site row, and reads as the destructive
          counterpart to Republish rather than a second primary action. */
        .settings .unpublish-btn {
          margin-inline-start: auto;
          color: var(--muted-foreground);
        }
        .settings .unpublish-btn:hover:not(:disabled) {
          border-color: var(--destructive-ink);
          color: var(--destructive-ink);
        }
        .hosting-error {
          color: var(--destructive-ink);
        }
      </style>
    </template>
  };

  @field entryPoints = linksToMany(CardDef);
  @field readme = linksTo(MarkdownDef); // realm README shown on Home
  // settings — every field wires to live behavior. Booleans read unset as
  // `false` (BooleanField `emptyValue`), so each is framed to make that the
  // intended default: About and Browse are opt-out (hide*, default shown),
  // system cards in search are opt-in (searchIncludesSystem, default off).
  @field hideAbout = contains(BooleanField);
  @field hideBrowse = contains(BooleanField);
  @field searchIncludesSystem = contains(BooleanField);
  @field defaultView = contains(StringField); // 'grid' | 'strip'
  @field workspace = linksTo(CardDef); // the realm's config card
  // workspace administration: identity + layout
  @field signage = contains(StringField); // short frame badge
  @field purpose = contains(StringField); // annotation: what this is for
  @field moduleOrder = contains(StringField); // csv of pinned,about,browse
  @field pinnedSize = contains(StringField); // 'regular' | 'compact'

  @field realmName = contains(StringField, {
    computeVia: function (this: Workspace) {
      return this[realmInfo]?.name;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Workspace) {
      return this.realmName;
    },
  });

  static getDisplayName(instance: BaseDef) {
    if (isCardInstance(instance)) {
      return (instance as CardDef)[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}
