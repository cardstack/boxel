import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe, type SafeString } from '@ember/template';
import { cached, tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

import { BoxelInput } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import BooleanField from './boolean';
// host-mode mutation: publish is a registered host tool (tools/index.ts)
import PublishRealmCommand from '@cardstack/boxel-host/tools/publish-realm';
import { PublishRealmInput } from './command';

import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import Captions from '@cardstack/boxel-icons/captions';
import FileIcon from '@cardstack/boxel-icons/file';
import HouseIcon from '@cardstack/boxel-icons/house';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import ActivityIcon from '@cardstack/boxel-icons/activity';
import DoorOpenIcon from '@cardstack/boxel-icons/door-open';
import SearchIcon from '@cardstack/boxel-icons/search';

import {
  chooseCard,
  codeRef,
  specRef,
  baseCardRef,
  baseRealmRRI,
  isCardInstance,
  SupportedMimeType,
  subscribeToRealm,
  codeRefFromInternalKey,
  type Query,
  type CodeRef,
  CardErrorJSONAPI,
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
} from './card-api';
import { MarkdownDef } from './markdown-file-def'; // realm README
import type { RealmEventContent } from './matrix-event';
import { Spec } from './spec';

// This file is always loaded through the Boxel loader, which supplies
// `import.meta`. When type-checking, tsc sees the file as CommonJS output and
// rejects the meta-property, so suppress it — the same pattern used elsewhere
// in packages/base.
// @ts-ignore
const here: string = (import.meta as any).url;

const [, StripView, GridView] = VIEW_OPTIONS;

type Segment = 'home' | 'library' | 'activity';

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

// honest ETA (same rules as the job card): linear from arrival rate,
// only once 3 pieces are in, suppressed when implausible (> 30 min).
function etaMinutes(job: JobCard): number | undefined {
  let done = job.progressDone ?? 0;
  let total = job.progressTotal ?? 0;
  let started = job.startedAt ? new Date(job.startedAt).getTime() : undefined;
  if (done < 3 || total <= done || !started) {
    return undefined;
  }
  let elapsed = Date.now() - started;
  if (elapsed <= 0) {
    return undefined;
  }
  let mins = Math.round(((elapsed / done) * (total - done)) / 60000);
  return mins > 30 ? undefined : mins;
}

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

// published sites, read synchronously off meta.realmInfo (source-realm
// shape: lastPublishedAt is a map of publishedRealmURL → epoch-ms string)
function publishedSitesOf(
  model: Partial<Workspace>,
): { url: string; host: string; when?: string }[] {
  let info = model[realmInfo];
  let published = info?.lastPublishedAt;
  if (!published || typeof published !== 'object') {
    return [];
  }
  return Object.entries(published).map(([url, at]) => {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    let ms = Number(at);
    return {
      url,
      host,
      when: Number.isFinite(ms) ? relativeTime(ms) : undefined,
    };
  });
}

// Types that are machinery rather than content — the Home inventory folds
// them behind one "System (n)" link. The Library rail still lists them all.
const SYSTEM_TYPE_NAMES = new Set([
  'Theme',
  'Realm Config',
  'Remix',
  'Spec',
  'Skill',
  'Process',
  'Onboarding Survey',
  'Setup Survey',
]);

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
  let now = new Date();
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
  let diff = Math.max(0, Date.now() - ms);
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

class Isolated extends Component<typeof Workspace> {
  <template>
    <section
      class='card-grid'
      {{this.setupRealmSubscription this.primaryRealm}}
    >
      <header class='frame'>
        <nav class='tabs' aria-label='Sections'>
          <button
            type='button'
            class='tab {{if (eq this.segment "home") "active"}}'
            {{on 'click' (this.setSegment 'home')}}
          ><HouseIcon class='tab-icon' /> Home</button>
          <button
            type='button'
            class='tab {{if (eq this.segment "library") "active"}}'
            {{on 'click' (this.setSegment 'library')}}
          ><LayoutGridIcon class='tab-icon' /> Library</button>
          <button
            type='button'
            class='tab {{if (eq this.segment "activity") "active"}}'
            {{on 'click' (this.setSegment 'activity')}}
          ><ActivityIcon class='tab-icon' />
            Activity{{#if this.runningJobs.length}}<span
                class='attention-dot'
              />{{/if}}</button>
        </nav>
        {{#if @model.signage}}
          {{! workspace signage — hover reveals the purpose annotation }}
          <span class='signage' title={{@model.purpose}}>
            {{@model.signage}}</span>
        {{/if}}
        <div class='frame-actions'>
          <div class='search-box' {{this.setupSearchHotkey}}>
            <SearchIcon class='search-icon' />
            <input
              class='search-input'
              type='text'
              placeholder='Search'
              aria-label='Search this space'
              value={{this.searchTerm}}
              {{on 'input' this.onSearchInput}}
              {{on 'keydown' this.onSearchKeydown}}
              {{on 'focus' this.onSearchFocus}}
              {{on 'focusout' this.onSearchBlur}}
            />
            <span class='search-kbd'>⌘K</span>
            {{#if this.searchResults.length}}
              <div class='search-results'>
                {{#each this.searchResults as |result|}}
                  <button
                    type='button'
                    class='search-result'
                    {{on 'click' (this.openResult result)}}
                  >
                    <span class='search-result-title'>{{result.title}}</span>
                    <span class='search-result-type'>{{result.type}}</span>
                  </button>
                {{/each}}
                <button
                  type='button'
                  class='search-see-all'
                  {{on 'click' this.seeAllResults}}
                >
                  See all
                  {{this.searchTotal}}
                  results
                  <span class='search-scope-note'>Cards only</span>
                </button>
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
              <button
                type='button'
                class='setup-bar'
                {{on 'click' (this.setSegment 'activity')}}
              >
                <span class='setup-ring' style={{this.ringStyle job}}>
                  <span class='setup-ring-hole' /></span>
                <span class='setup-lines'>
                  <span class='setup-name'>Setting up
                    <strong>{{this.jobName job}}</strong></span>
                  <span class='setup-data'>{{this.jobCount job}}{{#if
                      (this.jobEta job)
                    }}
                      ·
                      {{this.jobEta job}}{{/if}}</span>
                </span>
                <span class='setup-track'><span
                    class='setup-fill'
                    style={{this.jobFillStyle job}}
                  /></span>
                <span class='setup-pct'>{{this.jobPct job}}%</span>
                <span class='setup-action'>View in Activity ›</span>
              </button>
              {{#if (this.surveyRemaining job)}}
                <button
                  type='button'
                  class='setup-tease'
                  {{on 'click' (this.openCard job.card.setupSurvey)}}
                >
                  <span class='setup-tease-mark'>✦</span>
                  Want it to arrive already yours?
                  <span class='setup-tease-link'>Answer
                    {{this.surveyRemaining job}}
                    quick questions ›</span>
                </button>
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
                          <span class='door-kind'>{{this.doorKind index}}</span>
                          {{#if @canEdit}}
                            <button
                              type='button'
                              class='door-unpin'
                              aria-label='Unpin'
                              title='Unpin'
                              {{on 'click' (this.unpinDoor index)}}
                            >×</button>
                          {{/if}}
                        </div>
                        <div class='door-face'>
                          <Door @format='fitted' />
                          <button
                            type='button'
                            class='tile-open'
                            aria-label='Open {{this.doorTitle index}}'
                            title='Open in stack'
                            {{on 'click' (this.openDoor index)}}
                          ></button>
                          {{! Match Library fitted tiles: the read-only preview opens through viewCard }}
                        </div>
                        <div class='door-footer'>
                          <span class='door-title'>{{this.doorTitle
                              index
                            }}</span>
                          <button
                            type='button'
                            class='door-open'
                            {{on 'click' (this.openDoor index)}}
                          >Open</button>
                        </div>
                      </article>
                    {{/each}}
                    {{#if @canEdit}}
                      {{! the pin affordance: a ghost tile ending the row }}
                      <button
                        type='button'
                        class='door-add'
                        {{on 'click' this.pinCard}}
                      >
                        <span class='door-add-mark'>＋</span>
                        <span class='door-add-label'>Pin a card…</span>
                      </button>
                    {{/if}}
                  </div>
                </section>
              {{else}}
                <section class='zone welcome'>
                  {{! Realm README replaces the WelcomeCard: hero position
                while the space has no pins — the landing content for a
                realm that just got cloned or remixed. }}
                  {{#if @model.readme}}
                    <div class='readme-embed'>
                      <@fields.readme @format='embedded' />
                    </div>
                  {{else}}
                    <p class='welcome-copy'>This space holds cards — documents,
                      lists, and apps. Browse the Library to see what is here,
                      install a starter from the catalog, or ask the assistant
                      to create something for you.</p>
                  {{/if}}
                  <div class='welcome-actions'>
                    <button
                      type='button'
                      class='welcome-cta'
                      {{on 'click' (this.setSegment 'library')}}
                    >Open Library</button>
                    {{#if @canEdit}}
                      <button
                        type='button'
                        class='welcome-alt'
                        {{on 'click' this.createNew}}
                      >New card</button>
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
                    >
                      <@fields.readme @format='embedded' />
                    </div>
                    <button
                      type='button'
                      class='readme-toggle'
                      {{on 'click' this.toggleReadme}}
                    >{{if this.readmeExpanded 'Show less' 'Read more'}}</button>
                  </section>
                {{/if}}
              {{/if}}
            {{else if (eq mod 'browse')}}
              {{#if this.browseVisible}}
                <section class='zone'>
                  <div class='section-head'>
                    <h2 class='section-title'>Browse</h2>
                    <p class='section-hint'>All cards and files in this space.</p>
                  </div>
                  <div class='inventory'>
                    {{#if this.contentCardChips.length}}
                      <div class='inventory-group'>
                        <span class='inventory-label'>Cards</span>
                        <div class='inventory-chips'>
                          {{#each this.contentCardChips as |option|}}
                            <button
                              type='button'
                              class='type-chip'
                              {{on 'click' (this.jumpToFilter option)}}
                            >
                              {{#if (this.iconHtml option)}}
                                <span class='type-chip-icon'>{{this.iconHtml
                                    option
                                  }}</span>
                              {{/if}}
                              {{option.displayName}}
                              <span class='type-chip-count'>{{this.countFor
                                  option
                                }}</span>
                            </button>
                          {{/each}}
                        </div>
                      </div>
                    {{/if}}
                    {{#if this.fileChips.length}}
                      <div class='inventory-group'>
                        <span class='inventory-label'>Files</span>
                        <div class='inventory-chips'>
                          {{#each this.fileChips as |option|}}
                            <button
                              type='button'
                              class='type-chip'
                              {{on 'click' (this.jumpToFilter option)}}
                            >
                              {{#if (this.iconHtml option)}}
                                <span class='type-chip-icon'>{{this.iconHtml
                                    option
                                  }}</span>
                              {{/if}}
                              {{option.displayName}}
                              <span class='type-chip-count'>{{this.countFor
                                  option
                                }}</span>
                            </button>
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
              <button
                type='button'
                class='recent-preview'
                {{on 'click' (this.setSegment 'activity')}}
              >
                <span class='recent-text'>{{this.latest.title}}{{#if
                    this.latest.when
                  }}
                    ·
                    {{this.latest.when}}{{/if}}</span>
                <span class='recent-action'>Open Activity</span>
              </button>
            {{/if}}
          {{/unless}}

          {{! Space details: quiet realm facts, data register }}
          <div class='space-details'>
            <span class='space-live' title='Live updates connected'></span>
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
              <button
                type='button'
                class='space-config'
                {{on 'click' (this.openCard this.configInstance)}}
              >Configuration</button>
            {{/if}}
          </div>
        </div>
      {{else if (eq this.segment 'library')}}
        <div class='library'>
          <nav class='rail scroll-container' aria-label='Library filters'>
            <div class='rail-group'>
              <h3 class='rail-label'>Library</h3>
              {{#each this.libraryFilters as |option|}}
                <button
                  type='button'
                  class='rail-row
                    {{if
                      (eq option.displayName this.activeFilter.displayName)
                      "selected"
                    }}'
                  {{on 'click' (this.selectFilter option)}}
                >
                  {{#let (this.iconComponent option) as |Icon|}}
                    {{#if Icon}}<Icon class='rail-icon' />{{/if}}
                  {{/let}}
                  <span class='rail-name'>{{option.displayName}}</span>
                  <span class='rail-count'>{{this.countFor option}}</span>
                </button>
              {{/each}}
            </div>
            {{#if this.cardTypeFilters.length}}
              <div class='rail-group'>
                <h3 class='rail-label'>Card types</h3>
                {{#each this.cardTypeFilters as |option|}}
                  {{! + New moved from the frame into the rail: each card
                    type row grows a hover + that creates one of that type. }}
                  <div class='rail-row-wrap'>
                    <button
                      type='button'
                      class='rail-row type
                        {{if
                          (eq option.displayName this.activeFilter.displayName)
                          "selected"
                        }}'
                      {{on 'click' (this.selectFilter option)}}
                    >
                      {{#if (this.iconHtml option)}}
                        <span class='rail-type-icon'>{{this.iconHtml
                            option
                          }}</span>
                      {{else if (this.iconComponent option)}}
                        {{#let (this.iconComponent option) as |Icon|}}
                          {{#if Icon}}<Icon class='rail-icon' />{{/if}}
                        {{/let}}
                      {{else}}
                        <span class='rail-swatch' />
                      {{/if}}
                      <span class='rail-name'>{{option.displayName}}</span>
                      <span class='rail-count'>{{this.countFor option}}</span>
                    </button>
                    {{#if @canEdit}}
                      <button
                        type='button'
                        class='rail-add'
                        aria-label='New {{option.displayName}}'
                        title='New {{option.displayName}}'
                        {{on 'click' (this.createOfType option)}}
                      >+</button>
                    {{/if}}
                  </div>
                {{/each}}
              </div>
            {{/if}}
            {{#if this.fileTypeFilters.length}}
              <div class='rail-group'>
                <h3 class='rail-label'>File types</h3>
                {{#each this.fileTypeFilters as |option|}}
                  <button
                    type='button'
                    class='rail-row type
                      {{if
                        (eq option.displayName this.activeFilter.displayName)
                        "selected"
                      }}'
                    {{on 'click' (this.selectFilter option)}}
                  >
                    {{#if (this.iconHtml option)}}
                      <span class='rail-type-icon'>{{this.iconHtml
                          option
                        }}</span>
                    {{else if (this.iconComponent option)}}
                      {{#let (this.iconComponent option) as |Icon|}}
                        {{#if Icon}}<Icon class='rail-icon' />{{/if}}
                      {{/let}}
                    {{else}}
                      <span class='rail-swatch' />
                    {{/if}}
                    <span class='rail-name'>{{option.displayName}}</span>
                    <span class='rail-count'>{{this.countFor option}}</span>
                  </button>
                {{/each}}
              </div>
            {{/if}}
          </nav>
          <CardsGridLayout
            @format='fitted'
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
          />
        </div>
      {{else}}
        <div class='activity-pane'>
          {{! Collapsing dock: the full panel scrolls away with the log;
            a one-line summary pins under the frame while it is off-screen. }}
          {{#if this.runningJobs.length}}
            <button
              type='button'
              class='dock-mini {{if this.dockCondensed "shown"}}'
              aria-label='Show progress details'
              disabled={{if this.dockCondensed false true}}
              {{on 'click' this.revealDock}}
            >
              <span class='dock-dot' />
              <span class='dock-mini-title'>In progress</span>
              <span class='dock-mini-summary'>{{this.dockSummary}}</span>
              <span class='dock-mini-track'>
                <span
                  class='dock-mini-fill'
                  style={{this.jobFillStyle this.firstRunningJob}}
                />
              </span>
            </button>
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
                  <span class='dock-dot' />
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
                          <span class='dock-pane-label'>Building</span>
                          <div class='job-cell'>
                            <job.component @format='embedded' />
                            <button
                              type='button'
                              class='tile-open'
                              aria-label='Open progress details'
                              {{on 'click' (this.openCard job.card)}}
                            ></button>
                          </div>
                        </div>
                        <div class='dock-pane invite'>
                          {{! the pane IS the wizard — no
                            click-through overlay; popping to the stack is
                            this explicit header affordance instead }}
                          <div class='dock-pane-head'>
                            <span class='dock-pane-label'>While you wait ·
                              Optional</span>
                            <button
                              type='button'
                              class='dock-pane-open'
                              title='Open as a card'
                              {{on
                                'click'
                                (this.openCard job.card.setupSurvey)
                              }}
                            >Open ↗</button>
                          </div>
                          <div class='job-cell wizard'>
                            <SurveyComp @format='embedded' />
                          </div>
                        </div>
                      </div>
                    {{else}}
                      <div class='job-cell'>
                        <job.component @format='embedded' />
                        <button
                          type='button'
                          class='tile-open'
                          aria-label='Open progress details'
                          {{on 'click' (this.openCard job.card)}}
                        ></button>
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
                    <div class='feed-day'>
                      <span class='feed-day-label'>{{item.dayLabel}}</span>
                      <span class='feed-day-rule' />
                    </div>
                  {{/if}}
                  <div class='feed-row'>
                    <span class='feed-when' title={{item.absolute}}>{{if
                        item.when
                        item.when
                        '—'
                      }}</span>
                    <div class='feed-card'>
                      <item.component @format='embedded' />
                      <button
                        type='button'
                        class='tile-open'
                        aria-label='Open {{if item.title item.title "card"}}'
                        {{on 'click' (this.openCard item.card)}}
                      ></button>
                    </div>
                    <div class='feed-note'>
                      {{! Rich event entry: verb + type (icon) meta row,
                        title anchor, then the change note. The right column
                        reads as a log line without the embedded card. }}
                      <div class='feed-meta'>
                        <span
                          class='feed-verb
                            {{if (eq item.verb "Created") "created"}}'
                        >{{item.verb}}</span>
                        <span class='feed-type'>
                          <item.typeIcon class='feed-type-icon' />
                          {{item.typeName}}</span>
                      </div>
                      {{#if item.title}}
                        <p class='feed-title'>{{item.title}}</p>
                      {{/if}}
                      {{#if item.note}}
                        <p class='feed-note-text'>{{item.note}}</p>
                      {{/if}}
                    </div>
                  </div>
                {{else}}
                  <p class='empty-note'>No activity yet.</p>
                {{/each}}
                {{#if this.moreFeed}}
                  {{! reveal-on-scroll: the sentinel appends the next 20 }}
                  <div class='feed-more' {{this.watchFeedEnd}}>
                    <span class='feed-more-note'>Showing
                      {{this.visibleFeed.length}}
                      of
                      {{this.feedItems.length}}</span>
                  </div>
                {{else if this.feedAtCap}}
                  <p class='feed-end-note'>Showing the last 100 changes.</p>
                {{/if}}
              </div>
            </section>
          </div>
        </div>
      {{/if}}
    </section>
    <style scoped>
      .card-grid {
        /* Derived light-surface tier. System constants — the
           chrome's switchgear. The realm theme may tint exactly two
           channels: surface (--background) and accent (--primary). */
        --grid-ink: #272330;
        --grid-ink-body: #5a586a;
        --grid-ink-quiet: #8b8b93;
        --grid-ink-kicker: #919191;
        --grid-ink-meta: #a2a2ab;
        --grid-ink-faint: #b7b7bd;
        --grid-ink-ghost: #c0c0c7;
        --grid-stage: var(--background, #f7f8fa);
        --grid-surface: #ffffff;
        --grid-shelf: #fafbfc;
        --grid-control: #f6f7f9;
        --grid-track: #eef0f4;
        --grid-nav-ink: #3f3d49;
        --grid-border: #e2e8f0;
        --grid-hairline: #eceef1;
        --grid-hover-border: #cbd0d8;
        --grid-interactive: var(--primary, #0c9d7c);
        --grid-live: #00c495;
        --grid-accent: var(--boxel-teal, #00ffba);
        --grid-accent-ink: #12241e;
        --grid-attention: #d97706;
        --grid-attention-text: #b45309;
        --grid-attention-surface: #fff9f2;
        --grid-attention-border: #f4e6d4;
        --grid-attention-rule: #f0ddc0;
        --grid-broken: var(--boxel-red, #ff5050);
        --grid-shadow-rest: 0 2px 8px rgba(28, 28, 50, 0.05);
        --grid-shadow-hover: 0 10px 26px rgba(28, 28, 50, 0.11);
        --grid-mono: var(
          --boxel-monospace-font-family,
          'IBM Plex Mono',
          monospace
        );
        --grid-sans: var(--boxel-font-family, 'IBM Plex Sans', sans-serif);
        --grid-serif: var(
          --boxel-serif-font-family,
          'IBM Plex Serif',
          Georgia,
          serif
        );
        /* motion tokens (0.4s meter fill and 2s pulses stay as
           deliberate exceptions) + the created-verb ink */
        --grid-quick: 0.12s;
        --grid-soft: 0.18s;
        --grid-created: #00893a;

        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
        background-color: var(--grid-stage);
        color: var(--grid-ink);
        font-family: var(--grid-sans);
      }

      /* ── Frame ─────────────────────────────────────────────── */
      .frame {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 54px;
        padding: 0 18px;
        background-color: var(--grid-surface);
        border-bottom: 1px solid var(--grid-border);
        flex-shrink: 0;
      }
      .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        background-color: var(--grid-track);
        border: 1px solid var(--grid-border);
        border-radius: 9px;
      }
      .tab {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: none;
        padding: 5px 12px;
        border-radius: 7px;
        font: 500 12.5px var(--grid-sans);
        color: var(--grid-ink-quiet);
        cursor: pointer;
      }
      .tab.active {
        background-color: var(--grid-surface);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        color: var(--grid-ink);
        font-weight: 600;
      }
      .tab-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }
      .attention-dot {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background-color: var(--grid-attention);
        animation: softpulse 2s ease-in-out infinite;
      }
      .frame-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      /* workspace signage & description */
      .signage {
        margin-left: 10px;
        padding: 3px 8px;
        border: 1px solid var(--grid-border);
        border-radius: 5px;
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
        white-space: nowrap;
        cursor: default;
      }
      .space-desc {
        margin: 0;
        font: 400 13px/1.5 var(--grid-sans);
        color: var(--grid-ink-quiet);
      }
      .search-box {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-width: 170px;
        border: 1px solid var(--grid-border);
        border-radius: 8px;
        padding: 6px 11px;
        background-color: var(--grid-control);
      }
      .search-box:focus-within {
        border-color: var(--grid-interactive);
        background-color: var(--grid-surface);
      }
      .search-icon {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
        color: var(--grid-ink-quiet);
      }
      .search-input {
        border: none;
        background: none;
        outline: none;
        padding: 0;
        width: 110px;
        font: 500 12.5px var(--grid-sans);
        color: var(--grid-ink);
      }
      .search-input::placeholder {
        color: #9a9aa2;
      }
      .search-kbd {
        margin-left: auto;
        font: 500 10px var(--grid-mono);
        color: var(--grid-ink-ghost);
      }
      .search-results {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 20;
        width: 320px;
        max-height: 320px;
        overflow-y: auto;
        padding: 4px;
        background-color: var(--grid-surface);
        border: 1px solid var(--grid-border);
        border-radius: 10px;
        box-shadow: var(--grid-shadow-hover);
      }
      .search-result {
        display: flex;
        align-items: baseline;
        gap: 10px;
        width: 100%;
        border: none;
        background: none;
        text-align: left;
        padding: 7px 10px;
        border-radius: 7px;
        cursor: pointer;
      }
      .search-result:hover {
        background-color: var(--grid-track);
      }
      .search-result-title {
        flex: 1;
        min-width: 0;
        font: 500 12.5px var(--grid-sans);
        color: var(--grid-ink);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .search-result-type {
        flex-shrink: 0;
        font: 600 9px var(--grid-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
      }
      .search-see-all {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        border: 0;
        border-top: 1px solid var(--grid-hairline);
        padding: 8px 12px;
        background: transparent;
        font: 600 12px var(--grid-sans);
        color: var(--grid-interactive);
        text-align: left;
        cursor: pointer;
      }
      .search-see-all:hover {
        background-color: var(--grid-track);
      }
      .search-scope-note {
        font: 500 9px var(--grid-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--grid-ink-ghost);
      }
      .new-button {
        border: 0;
        border-radius: 8px;
        padding: 7px 13px;
        background-color: var(--grid-accent);
        color: var(--grid-accent-ink);
        font: 600 12.5px var(--grid-sans);
        cursor: pointer;
        white-space: nowrap;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.5),
          0 1px 2px rgba(0, 0, 0, 0.1);
      }
      .new-button:hover {
        background-color: var(--boxel-dark-teal, #00da9f);
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
        padding: 24px 26px 30px;
        display: grid;
        align-content: start;
        gap: 28px;
      }
      .library {
        flex-grow: 1;
        min-height: 0;
        display: flex;
      }

      /* ── Facet rail ────────────────────────────────────────── */
      .rail {
        width: 214px;
        flex-shrink: 0;
        overflow-y: auto;
        background-color: var(--grid-shelf);
        border-right: 1px solid var(--grid-hairline);
        padding: 16px 10px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .rail-group {
        display: grid;
        gap: 1px;
      }
      .rail-label {
        margin: 0;
        padding: 4px 10px 6px;
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
      }
      .rail-row {
        display: flex;
        align-items: center;
        gap: 8px;
        border: none;
        background: none;
        text-align: left;
        padding: 6px 10px;
        border-radius: 7px;
        font: 500 13px var(--grid-sans);
        color: var(--grid-nav-ink);
        cursor: pointer;
      }
      .rail-row.type {
        padding: 5px 10px;
      }
      .rail-row:hover {
        background-color: var(--grid-track);
      }
      .rail-row.selected {
        color: #12463a;
        background-color: rgba(0, 255, 186, 0.16);
        box-shadow: inset 0 0 0 1px rgba(0, 201, 150, 0.4);
      }
      .rail-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--grid-ink-quiet);
      }
      .rail-row.selected .rail-icon {
        color: var(--grid-interactive);
      }
      .rail-swatch {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background-color: var(--grid-ink-faint);
        flex-shrink: 0;
        margin: 0 3px;
      }
      /* hover + on card-type rows (the relocated New button) */
      .rail-row-wrap {
        position: relative;
        display: grid;
      }
      .rail-row-wrap .rail-row {
        padding-right: 30px;
      }
      .rail-add {
        position: absolute;
        right: 5px;
        top: 50%;
        transform: translateY(-50%);
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 5px;
        background-color: var(--grid-control);
        color: var(--grid-ink-quiet);
        font: 600 13px/1 var(--grid-sans);
        cursor: pointer;
        /* quietly present at rest — hover-only proved undiscoverable */
        opacity: 0.45;
        transition: opacity var(--grid-quick) ease;
      }
      .rail-row-wrap:hover .rail-add,
      .rail-add:focus-visible {
        opacity: 1;
      }
      .rail-add:hover {
        opacity: 1;
        background-color: var(--grid-accent);
        color: var(--grid-accent-ink);
      }
      .rail-type-icon {
        display: grid;
        place-items: center;
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--grid-ink-quiet);
      }
      .rail-type-icon :deep(svg) {
        width: 14px;
        height: 14px;
        display: block;
      }
      .rail-row.selected .rail-type-icon {
        color: var(--grid-interactive);
      }
      .rail-name {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .rail-count {
        margin-left: auto;
        font: 500 11px var(--grid-mono);
        color: var(--grid-ink-meta);
      }
      .rail-row.selected .rail-count {
        color: var(--grid-interactive);
      }
      .library :deep(.boxel-cards-grid-layout .sidebar) {
        display: none;
      }
      .zone {
        display: grid;
        gap: 12px;
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
        gap: 10px;
        margin: 0 -26px; /* counter the stage side padding: flush edges */
        padding: 14px 26px 16px;
        background-color: var(--grid-attention-surface);
        border-bottom: 1px solid var(--grid-attention-border);
        /* no overflow: hidden here — an overflow-hidden grid item's
           content contributes zero to its auto row, collapsing the panel
           to padding height. Nothing here needs clipping anyway. */
      }
      .dock::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
          90deg,
          transparent,
          #f0a94b,
          #d97706,
          transparent
        );
        background-size: 200% 100%;
        animation: scan 2.4s linear infinite;
      }
      .dock-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .dock-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        align-self: center;
        background-color: var(--grid-attention);
        animation: softpulse 2s ease-in-out infinite;
      }
      .dock-title {
        margin: 0;
        font: 600 15px/1.3 var(--grid-sans);
        letter-spacing: -0.01em;
        color: var(--grid-attention-text);
      }
      .dock-hint {
        font: 400 12px var(--grid-sans);
        color: #c78b4a;
      }
      .dock-mini {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 26px 11px;
        border: 0;
        border-bottom: 1px solid var(--grid-attention-border);
        background-color: var(--grid-attention-surface);
        box-shadow: 0 2px 8px rgba(28, 28, 50, 0.08);
        text-align: left;
        cursor: pointer;
        opacity: 0;
        transform: translateY(-6px);
        pointer-events: none;
        transition:
          opacity var(--grid-soft) ease,
          transform var(--grid-soft) ease;
      }
      .dock-mini.shown {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .dock-mini-title {
        flex-shrink: 0;
        font: 600 12.5px var(--grid-sans);
        letter-spacing: -0.01em;
        color: var(--grid-attention-text);
      }
      .dock-mini-summary {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font: 400 12.5px var(--grid-sans);
        font-variant-numeric: tabular-nums;
        color: #c78b4a;
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
        background-color: var(--grid-attention);
        transition: width 0.4s ease;
      }
      @keyframes scan {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }

      /* Two-register typography: guidance speaks bold sans sentences (the
         Boxel voice), data speaks mono fragments. */
      .section-head {
        display: grid;
        gap: 2px;
      }
      .section-title {
        margin: 0;
        font: 600 17px/1.3 var(--grid-sans);
        letter-spacing: -0.01em;
        color: var(--grid-ink);
      }
      .section-hint {
        margin: 0;
        font: 400 12px var(--grid-sans);
        color: var(--grid-ink-quiet);
      }
      .notice .section-hint {
        color: #c78b4a;
      }

      /* ── Setup status bar (passive; one click target → Activity) ── */
      .setup-bar {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 46px;
        text-align: left;
        border: 1px solid var(--grid-attention-border);
        border-radius: 12px;
        padding: 11px 16px;
        background-color: var(--grid-attention-surface);
        cursor: pointer;
        transition:
          border-color var(--grid-quick) ease,
          box-shadow var(--grid-quick) ease;
      }
      .setup-bar:hover {
        border-color: #e6c893;
        box-shadow: var(--grid-shadow-rest);
      }
      /* canvas `sweep`: a soft light pass keeps the bar alive */
      .setup-bar::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(217, 119, 6, 0.07),
          transparent
        );
        transform: translateX(-100%);
        animation: sweep 2.2s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes sweep {
        0% {
          transform: translateX(-100%);
        }
        60%,
        100% {
          transform: translateX(320%);
        }
      }
      /* the HB strip anatomy. NO overflow:hidden here — an
         overflow-hidden grid item collapses to padding height (see
         learnings 2026-07-15); the children carry their own radii. */
      .setup-strip {
        border: 1px solid var(--grid-attention-border);
        border-radius: 12px;
      }
      .setup-strip .setup-bar {
        border: 0;
        border-radius: 11px;
      }
      .setup-strip .setup-bar:not(:last-child) {
        border-radius: 11px 11px 0 0;
      }
      .setup-tease {
        border-radius: 0 0 11px 11px;
      }
      .setup-ring {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        flex-shrink: 0;
        display: grid;
        place-items: center;
        animation: softpulse 3s ease-in-out infinite;
      }
      .setup-ring-hole {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: var(--grid-attention-surface);
      }
      .setup-lines {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .setup-name {
        font: 400 13px var(--grid-sans);
        color: var(--grid-attention-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .setup-name strong {
        font-weight: 600;
      }
      .setup-data {
        font: 500 10.5px var(--grid-mono);
        color: #a35a00;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }
      .setup-track {
        flex: 1;
        min-width: 60px;
        height: 6px;
        border-radius: 100px;
        background-color: #f2e2c8;
        overflow: hidden;
      }
      .setup-fill {
        display: block;
        height: 100%;
        border-radius: 100px;
        background: linear-gradient(90deg, #e0b878, #d97706);
      }
      .setup-pct {
        flex-shrink: 0;
        font: 600 11px var(--grid-mono);
        color: var(--grid-attention-text);
        font-variant-numeric: tabular-nums;
      }
      .setup-action {
        flex-shrink: 0;
        font: 600 12.5px var(--grid-sans);
        color: var(--grid-interactive);
      }
      .setup-tease {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 9px 16px;
        border: 0;
        border-top: 1px dashed var(--grid-attention-border);
        background-color: #fffdf8;
        text-align: left;
        font: 400 12.5px var(--grid-sans);
        color: var(--grid-ink-body);
        cursor: pointer;
      }
      .setup-tease-mark {
        color: var(--grid-attention);
      }
      .setup-tease-link {
        font-weight: 600;
        color: var(--grid-interactive);
      }
      .setup-tease:hover .setup-tease-link {
        text-decoration: underline;
      }
      .setup-tease:focus-visible {
        outline: 2px solid var(--grid-interactive);
        outline-offset: -2px;
      }

      /* ── Doors ─────────────────────────────────────────────── */
      .doors {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        grid-auto-rows: var(--door-h, 300px); /* settings: tile size */
        gap: 20px;
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
        padding: 0 2px 8px;
      }
      /* pin management affordances */
      .door-unpin {
        margin-left: auto;
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--grid-ink-ghost);
        font: 500 13px/1 var(--grid-sans);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--grid-quick) ease;
      }
      .door:hover .door-unpin,
      .door-unpin:focus-visible {
        opacity: 1;
      }
      .door-unpin:hover {
        background-color: var(--grid-track);
        color: var(--grid-ink);
      }
      .door-add {
        display: grid;
        place-content: center;
        gap: 6px;
        justify-items: center;
        border: 1.5px dashed var(--grid-border);
        border-radius: 13px;
        background: transparent;
        color: var(--grid-ink-quiet);
        cursor: pointer;
        transition:
          border-color var(--grid-quick) ease,
          color var(--grid-quick) ease;
      }
      .door-add:hover {
        border-color: var(--grid-interactive);
        color: var(--grid-interactive);
      }
      .door-add-mark {
        font: 300 30px/1 var(--grid-sans);
      }
      .door-add-label {
        font: 600 12.5px var(--grid-sans);
      }
      .door-kind {
        font: 600 9px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-ink-kicker);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .door-face {
        min-height: 0;
        position: relative; /* Containing block for the shared click-to-open overlay */
      }
      .door-face :deep(.field-component-card) {
        height: 100%;
        max-height: 100%;
        overflow: hidden;
      }
      .door-face :deep(.boxel-card-container) {
        height: 100%;
        border: 1px solid var(--grid-border);
        border-radius: 12px;
        box-shadow: var(--grid-shadow-rest);
        overflow: hidden;
        transition:
          box-shadow var(--grid-quick) ease,
          border-color var(--grid-quick) ease;
      }
      .door:hover :deep(.boxel-card-container) {
        border-color: var(--grid-hover-border);
        box-shadow: var(--grid-shadow-hover);
      }
      .door-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0; /* Establish the flex shrink boundary for title + action */
        padding: 10px 2px 0;
      }
      .door-title {
        flex: 1 1 auto; /* The label owns only the space left by Open */
        min-width: 0;
        font: 500 10.5px var(--grid-mono);
        color: var(--grid-ink-kicker);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .door-open {
        flex: 0 0 auto; /* Keep the action inside its tile while the label ellipsizes */
        border: none;
        background: none;
        padding: 0;
        font: 600 12.5px var(--grid-sans);
        color: var(--grid-interactive);
        cursor: pointer;
        white-space: nowrap;
      }

      /* ── Inventory (Home): what lives here, grouped by kind ── */
      .inventory {
        display: grid;
        gap: 10px;
      }
      .inventory-group {
        display: grid;
        grid-template-columns: 44px 1fr;
        gap: 12px;
        align-items: start;
      }
      .inventory-label {
        padding-top: 8px;
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
      }
      .inventory-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .type-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 1px solid var(--grid-border);
        border-radius: 100px;
        padding: 5px 12px 5px 9px;
        background-color: var(--grid-surface);
        font: 500 12.5px var(--grid-sans);
        color: var(--grid-nav-ink);
        cursor: pointer;
      }
      .type-chip:hover {
        border-color: var(--grid-hover-border);
        box-shadow: var(--grid-shadow-rest);
      }
      .type-chip-icon {
        display: grid;
        place-items: center;
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--grid-ink-quiet);
      }
      .type-chip-icon :deep(svg) {
        width: 14px;
        height: 14px;
        display: block;
      }
      .type-chip-count {
        font: 500 10.5px var(--grid-mono);
        color: var(--grid-ink-meta);
      }
      /* ── Recent preview (passive, one row → Activity) ──────── */
      .recent-preview {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        text-align: left;
        border: 1px solid var(--grid-hairline);
        border-radius: 10px;
        padding: 10px 14px;
        background-color: var(--grid-shelf);
        cursor: pointer;
        transition: border-color var(--grid-quick) ease;
      }
      .recent-preview:hover {
        border-color: var(--grid-hover-border);
      }
      .recent-text {
        flex: 1;
        min-width: 0;
        font: 500 11px var(--grid-mono);
        color: var(--grid-ink-body);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .recent-action {
        flex-shrink: 0;
        font: 600 12.5px var(--grid-sans);
        color: var(--grid-interactive);
      }

      /* ── Activity log: when | what | why ───────────────────── */
      .feed {
        display: grid;
        gap: 10px;
      }
      .feed-day {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
      }
      .feed-day:first-child {
        margin-top: 0;
      }
      .feed-day-label {
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
        white-space: nowrap;
      }
      .feed-day-rule {
        flex: 1;
        height: 1px;
        background-color: var(--grid-hairline);
      }
      .feed-row {
        display: grid;
        grid-template-columns: 72px minmax(0, 440px) minmax(160px, 1fr);
        gap: 14px;
        align-items: start;
      }
      .feed-when {
        padding-top: 12px;
        font: 500 10.5px var(--grid-mono);
        color: var(--grid-ink-meta);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .feed-card {
        min-width: 0;
      }
      .feed-card :deep(.boxel-card-container) {
        background-color: var(--grid-surface);
        border: 1px solid var(--grid-border);
        border-radius: 10px;
        overflow: hidden;
      }
      .feed-note {
        min-width: 0;
        padding-top: 10px;
        display: grid;
        gap: 3px;
      }
      .feed-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .feed-verb {
        flex-shrink: 0;
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--grid-ink-faint);
      }
      .feed-verb.created {
        color: var(--grid-created);
      }
      .feed-type {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        font: 500 9.5px var(--grid-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--grid-ink-meta);
      }
      .feed-type-icon {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }
      .feed-title {
        margin: 0;
        font: 600 12.5px/1.35 var(--grid-sans);
        color: var(--grid-ink);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* pagination rail-end markers */
      .feed-more {
        display: grid;
        place-items: center;
        padding: 10px 0 4px;
      }
      .feed-more-note,
      .feed-end-note {
        margin: 0;
        font: 500 10.5px var(--grid-mono);
        letter-spacing: 0.04em;
        color: var(--grid-ink-ghost);
        font-variant-numeric: tabular-nums;
      }
      .feed-end-note {
        text-align: center;
        padding: 10px 0 4px;
      }
      .feed-note-text {
        margin: 0;
        font: 400 12.5px/1.5 var(--grid-sans);
        color: var(--grid-ink-body);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      /* build-and-invite panes inside the dock */
      .dock-duo {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-start;
      }
      .dock-pane {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .dock-pane.build {
        flex: 1.45 1 340px;
      }
      .dock-pane.invite {
        flex: 1 1 260px;
      }
      .dock-pane-label {
        font: 600 9.5px var(--grid-mono);
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--grid-attention-text);
      }
      .dock-pane-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .dock-pane-open {
        border: 0;
        background: none;
        padding: 0;
        font: 600 10px var(--grid-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--grid-attention-text);
        cursor: pointer;
      }
      .dock-pane-open:hover {
        color: var(--grid-ink);
      }
      .dock-pane-open:focus-visible {
        outline: 2px solid var(--grid-interactive);
        outline-offset: 2px;
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
      .tile-open {
        position: absolute;
        inset: 0;
        z-index: 2;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
        border-radius: 10px;
      }
      .tile-open:focus-visible {
        outline: 2px solid var(--grid-interactive);
        outline-offset: -2px;
      }

      /* ── Jobs ──────────────────────────────────────────────── */
      /* Same containment rule: the card container is the visible box. */
      .job-cell + .job-cell {
        margin-top: 12px;
      }
      .job-cell :deep(.boxel-card-container) {
        background-color: var(--grid-surface);
        border: 1px solid var(--grid-border);
        border-radius: 13px;
        box-shadow: var(--grid-shadow-rest);
        overflow: hidden;
      }

      /* ── Welcome & empties ─────────────────────────────────── */
      .welcome {
        justify-items: start;
        max-width: 44rem;
      }
      .welcome-copy {
        margin: 0;
        font: 400 14px/1.6 var(--grid-sans);
        color: var(--grid-ink-body);
      }
      /* README rendering: hero on empty spaces, collapsed once pinned */
      .readme-embed {
        position: relative;
        width: 100%;
        max-width: 720px;
      }
      .readme-embed :deep(.boxel-card-container) {
        border: 1px solid var(--grid-border);
        border-radius: 12px;
        box-shadow: var(--grid-shadow-rest);
      }
      /* b MarkdownDef's embedded format self-caps its content at 200px
         with a fade mask (base def scoped style). Collapsed state = that
         built-in preview. Everywhere else — hero on unpinned realms, or
         after Read more — lift the inner cap so the whole document renders
         inline. The extra .markdown-embedded hop outranks the scoped rule. */
      .readme-embed:not(.collapsed)
        :deep(.markdown-embedded .markdown-embedded__content) {
        max-height: none;
        mask-image: none;
        -webkit-mask-image: none;
      }
      .readme-toggle {
        justify-self: start;
        border: 0;
        background: none;
        padding: 2px 0;
        font: 600 12.5px var(--grid-sans);
        color: var(--grid-interactive);
        cursor: pointer;
      }
      /* space details strip */
      .space-details {
        display: flex;
        align-items: center;
        gap: 7px;
        padding-top: 6px;
        font: 500 10.5px var(--grid-mono);
        letter-spacing: 0.03em;
        color: var(--grid-ink-ghost);
        font-variant-numeric: tabular-nums;
      }
      .space-live {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: var(--grid-live);
        flex-shrink: 0;
      }
      .space-sep {
        color: var(--grid-ink-ghost);
      }
      .space-config {
        border: 0;
        background: none;
        padding: 0;
        font: 500 10.5px var(--grid-mono);
        letter-spacing: 0.03em;
        color: var(--grid-ink-quiet);
        cursor: pointer;
      }
      .space-config:hover {
        color: var(--grid-interactive);
      }
      .welcome-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .welcome-cta {
        border: 0;
        border-radius: 8px;
        padding: 9px 16px;
        background-color: var(--grid-accent);
        color: var(--grid-accent-ink);
        font: 600 13px var(--grid-sans);
        cursor: pointer;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.5),
          0 1px 2px rgba(0, 0, 0, 0.1);
      }
      .welcome-alt {
        border: 1px solid var(--grid-border);
        border-radius: 8px;
        padding: 8px 16px;
        background-color: var(--grid-surface);
        font: 600 13px var(--grid-sans);
        color: var(--grid-nav-ink);
        cursor: pointer;
      }
      .welcome-alt:hover {
        border-color: var(--grid-hover-border);
      }
      .empty-note {
        margin: 0;
        font: 400 13px var(--grid-sans);
        color: var(--grid-ink-body);
      }

      /* one focus language across the chrome: every
         interactive chrome element earns the same ring */
      .tab:focus-visible,
      .search-result:focus-visible,
      .search-see-all:focus-visible,
      .setup-bar:focus-visible,
      .type-chip:focus-visible,
      .door-open:focus-visible,
      .door-unpin:focus-visible,
      .door-add:focus-visible,
      .welcome-cta:focus-visible,
      .welcome-alt:focus-visible,
      .readme-toggle:focus-visible,
      .space-config:focus-visible,
      .recent-preview:focus-visible,
      .rail-row:focus-visible,
      .dock-mini:focus-visible,
      .wait-open:focus-visible {
        outline: 2px solid var(--grid-interactive);
        outline-offset: 2px;
      }
      .search-input:focus-visible {
        outline: none;
      }
      .search-box:focus-within {
        border-color: var(--grid-interactive);
      }

      /* P1-4: the stock Library content header joins the
         chrome's type ramp (typography only; structure stays stock) */
      .library :deep(.boxel-cards-grid-layout .content-title) {
        font: 600 17px/1.3 var(--grid-sans);
        letter-spacing: -0.01em;
        color: var(--grid-ink);
      }
      .library :deep(.boxel-cards-grid-layout .content-icon) {
        width: 16px;
        height: 16px;
        color: var(--grid-ink-quiet);
      }

      .operator-mode .buried .frame-actions,
      .operator-mode .buried .doors {
        display: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .attention-dot,
        .setup-ring,
        .dock-dot,
        .setup-bar::before {
          animation: none;
        }
        .dock::after {
          animation: none;
          background-position: 50% 0;
        }
        .dock-mini,
        .dock-mini-fill {
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

  setSegment = (segment: Segment) => () => {
    this.segment = segment;
    if (segment === 'activity') {
      // Lazy: the whole-realm reverse-chron search only runs when the
      // Activity segment is actually opened — keeps index-time prerenders
      // (which render Home) off the expensive path.
      this.loadFeed.perform();
    }
  };

  get runningJobs() {
    return this.jobComponents.filter(
      (j) => j.status === 'running' || j.status === 'queued',
    );
  }

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
            { not: { on: baseCardRef, eq: { _cardType: 'Cards Grid' } } },
            { not: { on: baseCardRef, eq: { _cardType: 'Workspace' } } },
          ],
        },
        page: { size: 100 },
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

  @action private onSearchInput(ev: Event) {
    this.searchTerm = (ev.target as HTMLInputElement).value;
    this.runSearch.perform();
  }

  @action private onSearchKeydown(ev: Event) {
    let ke = ev as KeyboardEvent;
    if (ke.key === 'Escape') {
      this.searchTerm = '';
      this.searchResults.splice(0, this.searchResults.length);
      this.clearLibrarySearch(); // Esc also restores the rail selection
      (ev.target as HTMLInputElement).blur();
    } else if (ke.key === 'Enter') {
      this.seeAllResults(); // Enter = full results in Library
      (ev.target as HTMLInputElement).blur();
    }
  }

  @action private onSearchFocus() {
    this.hideResults.cancelAll();
    if (this.searchTerm.trim()) {
      this.runSearch.perform();
    }
  }

  @action private onSearchBlur() {
    // delayed so a click on a result lands before the dropdown closes
    this.hideResults.perform();
  }

  private hideResults = restartableTask(async () => {
    await timeout(200);
    this.searchResults.splice(0, this.searchResults.length);
  });

  openResult = (result: { card: CardDef }) => () => {
    this.args.viewCard?.(result.card);
    this.searchTerm = '';
    this.hideResults.cancelAll();
    this.searchResults.splice(0, this.searchResults.length);
  };

  private runSearch = restartableTask(async () => {
    await timeout(200);
    let term = this.searchTerm.trim();
    let store = this.args.context?.store;
    if (!term || !store) {
      this.searchResults.splice(0, this.searchResults.length);
      return;
    }
    // CLI-verified shape: `contains` only matches when paired with a
    // `type` clause, and `on` goes inside each predicate.
    let clauses: unknown[] = [
      { type: baseCardRef },
      { on: baseCardRef, contains: { cardTitle: term } },
      { not: { on: baseCardRef, eq: { _cardType: 'Cards Grid' } } },
      { not: { on: baseCardRef, eq: { _cardType: 'Workspace' } } },
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
    for (let card of hits.slice(0, 8)) {
      this.searchResults.push({
        id: card.id!,
        title: card.cardTitle ?? 'Untitled',
        type: (card.constructor as typeof CardDef).displayName,
        card,
      });
    }
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
      displayName: `Search: “${term}”`,
      icon: SearchIcon,
      query: {
        filter: {
          every: [
            { type: baseCardRef },
            { on: baseCardRef, contains: { cardTitle: term } },
            { not: { on: baseCardRef, eq: { _cardType: 'Cards Grid' } } },
            { not: { on: baseCardRef, eq: { _cardType: 'Workspace' } } },
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
      `background: conic-gradient(var(--grid-attention) ${this.jobPct(job)}%, var(--grid-attention-rule) 0)`,
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

  private get doorsStyle(): SafeString | undefined {
    return this.args.model.pinnedSize === 'compact'
      ? htmlSafe('--door-h: 220px')
      : undefined;
  }

  // settings gates: unset booleans read as their defaults
  private get aboutVisible() {
    return (
      Boolean(this.args.model.readme) && this.args.model.showReadme !== false
    );
  }

  private get browseVisible() {
    return this.hasInventory && this.args.model.showBrowse !== false;
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
        every: [
          { not: { eq: { _cardType: 'Cards Grid' } } },
          { not: { eq: { _cardType: 'Workspace' } } },
        ],
      },
      sort: [{ by: 'lastModified', direction: 'desc' }],
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

  // Component form of `icon` (undefined when the icon is an HTML string, which
  // `iconHtml` renders instead) — lets the template invoke `<Icon />` safely.
  iconComponent = (option: RailOption): typeof SearchIcon | undefined =>
    typeof option.icon === 'string' ? undefined : option.icon;

  @action private createNew() {
    this.createCard.perform();
  }

  createOfType = (option: RailOption) => () => {
    // rail hover +: create an instance of exactly this row's type
    let filter = option.query?.filter;
    if (filter && 'type' in filter) {
      this.createCard.perform(filter.type as CodeRef); // Glint narrows query unions at the command boundary
    }
  };

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
      page: { size: 100 }, // Bound the unified Library search on the server.
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
    return store.search({ ...query, page: { size: 100 } } as Query, [realm]); // Bound hydration and federated-search scope.
  }; //

  // The four library-group rows keep stable identities (@cached, no tracked
  // count on the object — counts render via `countFor`), so the selected row
  // survives count refreshes. Entry points carries prebuilt components (the
  // already-loaded links) instead of a query.
  @cached
  private get everythingFilter(): RailOption {
    return {
      displayName: 'Everything',
      icon: LayoutGridIcon,
      query: {
        filter: {
          every: [
            { not: { eq: { _cardType: 'Cards Grid' } } },
            { not: { eq: { _cardType: 'Workspace' } } },
          ],
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
      displayName: 'Entry points',
      icon: DoorOpenIcon,
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
    return {
      displayName: 'Cards',
      icon: Captions,
      query: {
        filter: {
          every: [
            { not: { eq: { _cardType: 'Cards Grid' } } },
            { not: { eq: { _cardType: 'Workspace' } } },
            { not: { type: this.fileDefRef } },
          ],
        },
      },
    };
  }

  @cached
  private get filesFilter(): RailOption {
    return {
      displayName: 'Files',
      icon: FileIcon,
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

  countFor = (option: RailOption) => {
    switch (option.displayName) {
      case 'Everything':
        return this.cardTotal + this.fileTotal;
      case 'Entry points':
        return this.args.model.entryPoints?.length ?? 0;
      case 'Cards':
        return this.cardTotal;
      case 'Files':
        return this.fileTotal;
      default:
        return option.count ?? 0;
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
        // Constrain the interactive Spec query too.
        {
          filter: {
            on: specRef,
            every: [{ eq: { isCard: true } }],
          },
          page: { size: 100 }, // Keep chooser result pages bounded.
        },
        {
          consumingRealm: this.args.model[realmURL], // Scope the chooser to this Card Grid's realm.
          lockConsumingRealm: true, // Prevent broadening into other realms.
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
    let excludedTypeIds = [
      `${baseRealmRRI}card-api/CardDef`,
      `${baseRealmRRI}cards-grid/CardsGrid`,
      `${baseRealmRRI}card-api/FieldDef`,
      `${baseRealmRRI}card-api/FileDef`,
    ];

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
      if (kind === 'file') {
        fileTotal += summary.attributes.total ?? 0;
      } else {
        cardTotal += summary.attributes.total ?? 0;
      }
      if (excludedTypeIds.includes(summary.id)) {
        return;
      }
      if (summary.id.endsWith('workspace/Workspace')) {
        return;
      }
      // Types stay one flat vocabulary (JPGs and PDFs are types like Product
      // and Order) but the rail groups them by kind: CARD TYPES / FILE TYPES.
      let group = kind === 'file' ? this.fileTypeFilters : this.cardTypeFilters;
      group.push({
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
      this.filterOptions.find(
        (filter) => filter.displayName === this.activeFilter.displayName,
      ) ?? this.filterOptions[0];
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
  });

  private refreshOnIndex = (ev: RealmEventContent) => {
    if (ev.eventName === 'index' && ev.indexType === 'incremental') {
      this.loadFilterList.perform();
      this.loadJobs.perform();
      this.loadLatest.perform();
      if (this.segment === 'activity') {
        this.loadFeed.perform();
      }
    }
  };

  // The Activity log: everything in the realm, reverse-chron by
  // lastModified. Each row carries when / what / why: timestamp rail,
  // the card, and a change note (`cardInfo.notes` — the convention slot a
  // human or AI fills in when saving a change).
  private feedItems: {
    id: string;
    component: BoxComponent;
    when: string | undefined;
    absolute: string | undefined;
    note: string | undefined;
    verb: 'Created' | 'Updated';
    dayLabel: string;
    showDay: boolean;
    title: string | undefined; // card identity for the log line
    typeName: string;
    typeIcon: typeof CardDef.icon;
    card: CardDef; // for the tile-open overlay
  }[] = new TrackedArray();

  // Reveal-on-scroll pagination over the fetched window.
  @tracked private feedShown = 20;

  private get visibleFeed() {
    return this.feedItems.slice(0, this.feedShown);
  }

  private get moreFeed() {
    return this.feedItems.length > this.feedShown;
  }

  private get feedAtCap() {
    return this.feedItems.length >= 100;
  }

  watchFeedEnd = modifier((element: Element) => {
    let root = element.closest('.scroll-container');
    let observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.feedShown = Math.min(this.feedShown + 20, this.feedItems.length);
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
        filter: {
          every: [
            { not: { eq: { _cardType: 'Cards Grid' } } },
            { not: { eq: { _cardType: 'Workspace' } } },
          ],
        },
        sort: [{ by: 'lastModified', direction: 'desc' }],
        page: { size: 100 }, // Bound server results before instance hydration.
      } as Query,
      [realm],
    ); // Search only the Card Grid instance's realm.
    this.feedItems.splice(0, this.feedItems.length);
    let seen = new Set<string>();
    let prevDay: string | undefined;
    for (let instance of instances ?? []) {
      // build the full fetched window (≤100); the template reveals in 20s
      if (!isCardInstance(instance) || !instance.id || seen.has(instance.id)) {
        continue;
      }
      seen.add(instance.id);
      let card = instance as CardDef;
      let modMs = toMs(getCardMeta(card, 'lastModified'));
      let createdMs = toMs(getCardMeta(card, 'resourceCreatedAt'));
      let verb: 'Created' | 'Updated' =
        modMs !== undefined &&
        createdMs !== undefined &&
        Math.abs(modMs - createdMs) < 120000
          ? 'Created'
          : 'Updated';
      let day = modMs !== undefined ? dayLabelFor(modMs) : '';
      let ctor = card.constructor as typeof CardDef; // type identity for the log line
      this.feedItems.push({
        id: card.id!,
        component: (card.constructor as typeof BaseDef).getComponent(card),
        when: modMs !== undefined ? relativeTime(modMs) : undefined,
        absolute:
          modMs !== undefined ? new Date(modMs).toLocaleString() : undefined,
        note: card.cardInfo?.notes ?? undefined,
        verb,
        dayLabel: day,
        showDay: Boolean(day) && day !== prevDay,
        title: card.cardTitle ?? undefined,
        typeName: ctor.displayName,
        typeIcon: ctor.icon,
        card,
      });
      prevDay = day || prevDay;
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

    // Hosting: present published sites (free on realmInfo) and mutate
    // via the registered publish-realm host command. First-time publish
    // (domain choice) stays in the workspace menu's publish flow.
    get publishedSites() {
      return publishedSitesOf(this.args.model);
    }

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
      await new PublishRealmCommand(commandContext).execute(
        new PublishRealmInput({
          realmURL: realm,
          publishedRealmURLs: urls,
        }),
      );
    });

    get publishBusy() {
      return this.republishTask.isRunning;
    }

    <template>
      <div class='settings'>
        <header class='settings-head'>
          <h2 class='settings-title'>Workspace settings</h2>
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
                  <button
                    type='button'
                    class='choice-opt
                      {{if (eq this.activePinnedSize "regular") "selected"}}'
                    {{on 'click' (this.setPinnedSize 'regular')}}
                  >Regular</button>
                  <button
                    type='button'
                    class='choice-opt
                      {{if (eq this.activePinnedSize "compact") "selected"}}'
                    {{on 'click' (this.setPinnedSize 'compact')}}
                  >Compact</button>
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
                <span class='setting-label'>Show About</span>
                <p class='setting-help'>Keep the About section visible below the
                  pins. Turn off to keep Home to cards only.</p>
              </div>
              <div class='setting-control'><@fields.showReadme /></div>
            </div>
            <div class='setting'>
              <div class='setting-text'>
                <span class='setting-label'>Show Browse</span>
                <p class='setting-help'>The inventory of card and file types,
                  with counts, linking into the Library.</p>
              </div>
              <div class='setting-control'><@fields.showBrowse /></div>
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
                      <span class='order-pos'>{{this.orderPos index}}</span>
                      <span class='order-name'>{{this.moduleLabel mod}}</span>
                      <button
                        type='button'
                        class='order-move'
                        aria-label='Move {{this.moduleLabel mod}} up'
                        {{on 'click' (this.moveModule mod -1)}}
                      >↑</button>
                      <button
                        type='button'
                        class='order-move'
                        aria-label='Move {{this.moduleLabel mod}} down'
                        {{on 'click' (this.moveModule mod 1)}}
                      >↓</button>
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
                  <button
                    type='button'
                    class='choice-opt
                      {{if (eq this.activeView "grid") "selected"}}'
                    {{on 'click' (this.setView 'grid')}}
                  >Grid</button>
                  <button
                    type='button'
                    class='choice-opt
                      {{if (eq this.activeView "strip") "selected"}}'
                    {{on 'click' (this.setView 'strip')}}
                  >Strip</button>
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
                <span class='setting-label'>Description</span>
                <p class='setting-help'>One line shown at the top of Home.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
                  @value={{this.description}}
                  @onInput={{this.setDescription}}
                  @placeholder='One line about this space'
                />
              </div>
            </div>
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>Signage</span>
                <p class='setting-help'>A short badge beside the tabs — a status
                  or role, like DESIGN LAB or STAGING.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
                  @value={{@model.signage}}
                  @onInput={{this.setSignage}}
                  @placeholder='e.g. DESIGN LAB'
                />
              </div>
            </div>
            <div class='setting stack'>
              <div class='setting-text'>
                <span class='setting-label'>Purpose</span>
                <p class='setting-help'>What this space is for. Shown when
                  hovering the signage badge.</p>
              </div>
              <div class='setting-control'>
                <BoxelInput
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
                  <span class='setting-label'>Name</span>
                  <p class='setting-help'>Shown in the app frame and in
                    workspace lists. Applies to the whole workspace.</p>
                </div>
                <div class='setting-control'>
                  <BoxelInput
                    @value={{this.workspaceName}}
                    @onInput={{this.setWorkspaceName}}
                    @placeholder='Workspace name'
                  />
                </div>
              </div>
              <div class='setting stack'>
                <div class='setting-text'>
                  <span class='setting-label'>Icon URL</span>
                  <p class='setting-help'>A square image shown beside the name.</p>
                </div>
                <div class='setting-control'>
                  <BoxelInput
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
            {{#if this.publishedSites.length}}
              {{#each this.publishedSites as |site|}}
                <div class='setting'>
                  <div class='setting-text'>
                    <span class='setting-label'>Published</span>
                    <p class='setting-help'>Live on the web at this address.</p>
                  </div>
                  <div class='setting-control site'>
                    <span class='site-host'>{{site.host}}</span>
                    {{#if site.when}}
                      <span class='site-when'>{{site.when}}</span>
                    {{/if}}
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
                  <button
                    type='button'
                    class='publish-btn'
                    disabled={{this.publishBusy}}
                    {{on 'click' this.republish}}
                  >{{if this.publishBusy 'Publishing…' 'Republish'}}</button>
                </div>
              </div>
            {{else if this.isPublishable}}
              <div class='setting'>
                <div class='setting-text'>
                  <span class='setting-label'>Publishing</span>
                  <p class='setting-help'>Not published. Use Publish in the
                    workspace menu to put this space on the web.</p>
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
           setting. Token subset mirrors the isolated chrome ladder. */
        .settings {
          --grid-ink: #272330;
          --grid-ink-body: #5a586a;
          --grid-ink-quiet: #8b8b93;
          --grid-surface: #ffffff;
          --grid-control: #f6f7f9;
          --grid-border: #e2e8f0;
          --grid-hairline: #eceef1;
          --grid-hover-border: #cbd0d8;
          --grid-interactive: var(--primary, #0c9d7c);
          --grid-shadow-rest: 0 2px 8px rgba(28, 28, 50, 0.05);
          --grid-mono: var(
            --boxel-monospace-font-family,
            'IBM Plex Mono',
            monospace
          );
          --grid-sans: var(--boxel-font-family, 'IBM Plex Sans', sans-serif);

          container-type: inline-size;
          max-width: 880px;
          margin: 0 auto;
          display: grid;
          gap: 26px;
          padding: 26px 22px 40px;
          font-family: var(--grid-sans);
          color: var(--grid-ink);
        }
        .settings-head {
          display: grid;
          gap: 4px;
        }
        .settings-title {
          margin: 0;
          font: 700 20px/1.25 var(--grid-sans);
          letter-spacing: -0.02em;
        }
        .settings-lede {
          margin: 0;
          font: 400 13px/1.5 var(--grid-sans);
          color: var(--grid-ink-quiet);
        }
        .group {
          display: grid;
          grid-template-columns: 220px minmax(0, 1fr);
          gap: 22px;
          align-items: start;
        }
        @container (width < 680px) {
          .group {
            grid-template-columns: 1fr;
            gap: 10px;
          }
        }
        .group-info {
          display: grid;
          gap: 4px;
          padding-top: 4px;
        }
        .group-name {
          margin: 0;
          font: 600 13.5px/1.3 var(--grid-sans);
          color: var(--grid-ink);
        }
        .group-desc {
          margin: 0;
          font: 400 12.5px/1.5 var(--grid-sans);
          color: var(--grid-ink-quiet);
        }
        .group-card {
          background-color: var(--grid-surface);
          border: 1px solid var(--grid-border);
          border-radius: 13px;
          box-shadow: var(--grid-shadow-rest);
        }
        .setting {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px 20px;
          padding: 14px 16px;
        }
        .setting.stack {
          grid-template-columns: 1fr;
          align-items: start;
        }
        .setting + .setting {
          border-top: 1px solid var(--grid-hairline);
        }
        .setting-text {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .setting-label {
          font: 600 13px/1.3 var(--grid-sans);
          color: var(--grid-ink);
        }
        .setting-help {
          margin: 0;
          font: 400 12px/1.5 var(--grid-sans);
          color: var(--grid-ink-quiet);
        }
        .setting-control {
          min-width: 0;
        }
        .setting-control.site {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .site-host {
          font: 500 12.5px var(--grid-mono);
          color: var(--grid-ink);
        }
        .site-when {
          font: 400 11px var(--grid-sans);
          color: var(--grid-ink-quiet);
        }
        .choice {
          display: inline-flex;
          padding: 2px;
          gap: 2px;
          border: 1px solid var(--grid-border);
          border-radius: 8px;
          background-color: var(--grid-control);
        }
        .choice-opt {
          border: 0;
          border-radius: 6px;
          padding: 5px 12px;
          background: transparent;
          font: 500 12.5px var(--grid-sans);
          color: var(--grid-ink-body);
          cursor: pointer;
        }
        .choice-opt.selected {
          background-color: var(--grid-surface);
          color: var(--grid-ink);
          box-shadow: 0 1px 2px rgba(28, 28, 50, 0.1);
        }
        .order-list {
          display: grid;
          gap: 6px;
        }
        .order-row {
          display: grid;
          grid-template-columns: 22px minmax(0, 1fr) auto auto;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border: 1px solid var(--grid-border);
          border-radius: 8px;
          background-color: var(--grid-surface);
        }
        .order-pos {
          font: 600 10.5px var(--grid-mono);
          color: var(--grid-ink-quiet);
        }
        .order-name {
          font: 500 13px var(--grid-sans);
        }
        .order-move {
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
          border: 1px solid var(--grid-border);
          border-radius: 6px;
          background: none;
          color: var(--grid-ink-body);
          cursor: pointer;
        }
        .order-move:hover {
          border-color: var(--grid-hover-border);
          color: var(--grid-ink);
        }
        .publish-btn {
          padding: 7px 14px;
          border: 1px solid var(--grid-border);
          border-radius: 8px;
          background-color: var(--grid-surface);
          font: 600 12.5px var(--grid-sans);
          color: var(--grid-ink);
          cursor: pointer;
        }
        .publish-btn:hover {
          border-color: var(--grid-interactive);
          color: var(--grid-interactive);
        }
        .publish-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .choice-opt:focus-visible,
        .order-move:focus-visible,
        .publish-btn:focus-visible {
          outline: 2px solid var(--grid-interactive);
          outline-offset: 2px;
        }
      </style>
    </template>
  };

  @field entryPoints = linksToMany(CardDef);
  @field readme = linksTo(MarkdownDef); // realm README shown on Home
  // settings — every field wires to live behavior. Booleans
  // read unset as their default (showReadme/showBrowse default ON,
  // searchIncludesSystem defaults OFF).
  @field showReadme = contains(BooleanField);
  @field showBrowse = contains(BooleanField);
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
