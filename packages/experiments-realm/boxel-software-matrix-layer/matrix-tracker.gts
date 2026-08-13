import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import { DonutChart, type DonutSegment } from './donut-chart';
import { MatrixConcept, displayState } from './matrix-concept';
import { ConceptReview } from './concept-review';

const TIER_ORDER = [
  { key: 'Platform', color: '#16a34a' },
  { key: 'Catalog shared', color: '#2563eb' },
  { key: 'Catalog listing', color: '#7c3aed' },
  { key: 'POC realm', color: '#d97706' },
  { key: 'No evidence', color: '#e5e7eb' },
];
// The progress story: DONE means a Spec here whose ref resolves (to a shared
// block, base-realm code, or a pure catalog listing). Catalog and platform
// code without a Spec is available, not done; POC folds into not-started.
const SPEC_STATES = [
  { key: 'verified', label: 'Spec-verified', color: '#16a34a' },
  { key: 'catalog', label: 'Catalog available', color: '#7c3aed' },
  { key: 'platform', label: 'Platform available', color: '#2563eb' },
  { key: 'none', label: 'Not started', color: '#e5e7eb' },
];
const STATE_ORDER = ['Done', 'In Progress', 'Next', 'Blocked'];
const REVIEW_STATES = ['awaiting review', 'changes requested', 'approved'];
const ALL = 'all';
// Card-context searches are clamped to 100 items per page (search-bounds.ts),
// so the full matrix is read as fixed pages and concatenated. Bump when the
// matrix outgrows PAGE_COUNT * PAGE_SIZE.
const PAGE_SIZE = 100;
const PAGE_COUNT = 8;

function timeAgo(d: Date | undefined): string {
  let t = d?.getTime?.();
  if (!t) return '';
  let s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 2592000)}mo ago`;
}

export class MatrixTracker extends CardDef {
  static displayName = 'Matrix Tracker';
  static icon = LayoutGridIcon;

  @field headline = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: MatrixTracker) {
      return this.headline?.trim()?.length
        ? this.headline
        : 'Software Layer Matrix';
    },
  });

  static isolated = class Isolated extends Component<typeof MatrixTracker> {
    @tracked activeTab = 'overview';
    @tracked layerFilter = ALL;
    @tracked laneFilter = ALL;
    @tracked tierFilter = ALL;
    @tracked stateFilter = ALL;
    @tracked ownerFilter = ALL;
    @tracked specStateFilter = ALL;
    @tracked reviewFilter = ALL;
    @tracked lagOnly = false;
    @tracked implementedOnly = false;
    @tracked queueFilter = 'awaiting review';
    @tracked query = '';

    private conceptPages: (ReturnType<getCards> | undefined)[] = [];
    private reviewList: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      let ctx = this.args.context;
      this.conceptPages = Array.from({ length: PAGE_COUNT }, (_, i) =>
        ctx?.getCards(
          this,
          () => {
            let ref = identifyCard(MatrixConcept);
            return ref
              ? {
                  filter: { type: ref },
                  sort: [{ by: 'concept', on: ref }],
                  page: { number: i, size: PAGE_SIZE },
                }
              : undefined;
          },
          () => this.realms,
          { isLive: true },
        ),
      );
      // Reviews are young; one page is plenty until the team outgrows it.
      this.reviewList = ctx?.getCards(
        this,
        () => {
          let ref = identifyCard(ConceptReview);
          return ref ? { filter: { type: ref } } : undefined;
        },
        () => this.realms,
        { isLive: true },
      );
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    private get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }

    // Pages can overlap while the realm is mid-index (windows shift as the
    // total grows), so identity — not page position — decides uniqueness.
    get concepts(): MatrixConcept[] {
      let seen = new Set<string>();
      let out: MatrixConcept[] = [];
      for (let page of this.conceptPages) {
        for (let c of (page?.instances ?? []) as MatrixConcept[]) {
          let id = (c as any)?.id;
          if (!c || !id || seen.has(id)) continue;
          seen.add(id);
          out.push(c);
        }
      }
      return out;
    }

    get total() {
      return this.concepts.length;
    }
    get implementedCount() {
      return this.concepts.filter((c) => c.implemented).length;
    }

    get specStateSegments(): DonutSegment[] {
      return SPEC_STATES.map(({ key, label, color }) => ({
        label,
        color,
        value: this.concepts.filter((c) => this.specState(c) === key).length,
      }));
    }

    get stateCounts() {
      return STATE_ORDER.map((state) => ({
        state,
        label: displayState(state),
        count: this.concepts.filter((c) => c.workState === state).length,
      }));
    }

    // A Done claim is verified only by a resolving Spec in this realm —
    // catalog matches and platform code are available material, not done.
    isVerified = (c: MatrixConcept) => Boolean(c.sharedSpec);

    specState = (c: MatrixConcept): string => {
      if (c.sharedSpec) return 'verified';
      if (
        c.catalogMatch ||
        c.evidenceTier === 'Catalog shared' ||
        c.evidenceTier === 'Catalog listing'
      )
        return 'catalog';
      if (c.evidenceTier === 'Platform') return 'platform';
      return 'none';
    };

    get specVerifiedCount() {
      return this.concepts.filter((c) => c.sharedSpec).length;
    }
    get catalogAvailable(): MatrixConcept[] {
      return this.concepts.filter((c) => this.specState(c) === 'catalog');
    }
    get platformAvailable(): MatrixConcept[] {
      return this.concepts.filter((c) => this.specState(c) === 'platform');
    }

    get funnel() {
      let total = this.total || 1;
      let bar = (count: number) => ({
        count,
        style: htmlSafe(`width: ${Math.round((count / total) * 100)}%`),
      });
      return [
        { label: 'Code exists', ...bar(this.implementedCount) },
        { label: 'Spec-verified', ...bar(this.specVerifiedCount) },
        { label: 'Approved', ...bar(this.approved.length) },
      ];
    }

    get allReviews(): ConceptReview[] {
      return ((this.reviewList?.instances ?? []) as ConceptReview[])
        .filter(Boolean)
        .sort(
          (a, b) =>
            (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0),
        );
    }

    reviewsFor = (c: MatrixConcept) =>
      this.allReviews.filter((r) => (r.concept as any)?.id === (c as any).id);

    // Review status is derived from the thread, never stored: an unresolved
    // "needs work" blocks; an approve verdict accepts; Done with neither is
    // waiting on the review team.
    reviewStatus = (c: MatrixConcept): string | undefined => {
      let reviews = this.reviewsFor(c);
      if (reviews.some((r) => r.verdict === 'needs work' && !r.resolved)) {
        return 'changes requested';
      }
      if (reviews.some((r) => r.verdict === 'approve')) {
        return 'approved';
      }
      if (c.workState === 'Done') {
        return 'awaiting review';
      }
      return undefined;
    };

    openReviewCount = (c: MatrixConcept) =>
      this.reviewsFor(c).filter((r) => !r.resolved).length;

    lastActivity = (c: MatrixConcept) =>
      timeAgo(this.reviewsFor(c)[0]?.createdAt);

    get awaitingReview(): MatrixConcept[] {
      return this.concepts.filter(
        (c) => this.reviewStatus(c) === 'awaiting review',
      );
    }
    get changesRequested(): MatrixConcept[] {
      return this.concepts.filter(
        (c) => this.reviewStatus(c) === 'changes requested',
      );
    }
    get approved(): MatrixConcept[] {
      return this.concepts.filter((c) => this.reviewStatus(c) === 'approved');
    }
    get recentReviews(): ConceptReview[] {
      return this.allReviews.slice(0, 15);
    }

    get doneVerifiedCount() {
      return this.concepts.filter(
        (c) => c.workState === 'Done' && this.isVerified(c),
      ).length;
    }
    get doneUnverifiedCount() {
      return this.concepts.filter(
        (c) => c.workState === 'Done' && !this.isVerified(c),
      ).length;
    }

    get layerRows() {
      let layers = [...new Set(this.concepts.map((c) => c.layer))]
        .filter(Boolean)
        .sort((a, b) => parseFloat(a!) - parseFloat(b!));
      return layers.map((layer) => {
        let group = this.concepts.filter((c) => c.layer === layer);
        let coded = group.filter((c) => c.implemented).length;
        let verified = group.filter((c) => this.isVerified(c)).length;
        let pct = (n: number) =>
          group.length ? Math.round((n / group.length) * 100) : 0;
        return {
          layer,
          layerName: group[0]?.layerName,
          coded,
          verified,
          total: group.length,
          codedStyle: htmlSafe(`width: ${pct(coded)}%`),
          verifiedStyle: htmlSafe(`width: ${pct(verified)}%`),
        };
      });
    }

    get layerOptions() {
      return [...new Set(this.concepts.map((c) => c.layer))]
        .filter(Boolean)
        .sort((a, b) => parseFloat(a!) - parseFloat(b!)) as string[];
    }
    get laneOptions() {
      return [...new Set(this.concepts.map((c) => c.lane))].filter(
        Boolean,
      ) as string[];
    }
    get tierOptions() {
      return TIER_ORDER.map((t) => t.key);
    }
    get stateOptions() {
      return STATE_ORDER;
    }
    get reviewStateOptions() {
      return REVIEW_STATES;
    }
    get ownerOptions() {
      return [...new Set(this.concepts.map((c) => c.owner))].filter(
        Boolean,
      ) as string[];
    }
    get tabs() {
      return [
        { key: 'overview', label: 'Overview' },
        { key: 'queue', label: 'Review queue' },
        { key: 'concepts', label: 'Concepts' },
      ];
    }
    get showOverview() {
      return !this.isInteractive || this.activeTab === 'overview';
    }

    get queueChips() {
      let stateCount = (s: string) =>
        this.stateCounts.find((x) => x.state === s)?.count ?? 0;
      return [
        {
          key: 'awaiting review',
          label: 'Awaiting review',
          count: this.awaitingReview.length,
        },
        {
          key: 'changes requested',
          label: 'Changes requested',
          count: this.changesRequested.length,
        },
        { key: 'approved', label: 'Approved', count: this.approved.length },
        { key: 'Done', label: 'Built', count: stateCount('Done') },
        {
          key: 'In Progress',
          label: 'In Progress',
          count: stateCount('In Progress'),
        },
        { key: 'Next', label: 'Next', count: stateCount('Next') },
        { key: 'Blocked', label: 'Blocked', count: stateCount('Blocked') },
      ];
    }

    get queueList(): MatrixConcept[] {
      switch (this.queueFilter) {
        case 'awaiting review':
          return this.awaitingReview;
        case 'changes requested':
          return this.changesRequested;
        case 'approved':
          return this.approved;
        default:
          return this.concepts.filter(
            (c) => c.workState === this.queueFilter,
          );
      }
    }

    get filtered(): MatrixConcept[] {
      let q = this.query.trim().toLowerCase();
      return this.concepts
        .filter((c) => {
          if (this.layerFilter !== ALL && c.layer !== this.layerFilter)
            return false;
          if (this.laneFilter !== ALL && c.lane !== this.laneFilter)
            return false;
          if (
            this.tierFilter !== ALL &&
            (c.evidenceTier ?? 'No evidence') !== this.tierFilter
          )
            return false;
          if (this.stateFilter !== ALL && c.workState !== this.stateFilter)
            return false;
          if (this.ownerFilter !== ALL && c.owner !== this.ownerFilter)
            return false;
          if (
            this.specStateFilter !== ALL &&
            this.specState(c) !== this.specStateFilter
          )
            return false;
          if (
            this.reviewFilter !== ALL &&
            this.reviewStatus(c) !== this.reviewFilter
          )
            return false;
          if (this.implementedOnly && !c.implemented) return false;
          if (
            this.lagOnly &&
            !(c.workState === 'Done' && !this.isVerified(c))
          )
            return false;
          if (
            q &&
            !`${c.concept} ${c.symbol} ${c.provenance} ${c.domainKit} ${c.owner}`
              .toLowerCase()
              .includes(q)
          )
            return false;
          return true;
        })
        .sort(
          (a, b) =>
            parseFloat(a.layer ?? '0') - parseFloat(b.layer ?? '0') ||
            (a.lane ?? '').localeCompare(b.lane ?? '') ||
            (a.concept ?? '').localeCompare(b.concept ?? ''),
        );
    }

    tierOf = (c: MatrixConcept) => c.evidenceTier ?? '—';
    stateOf = (c: MatrixConcept) => displayState(c.workState) ?? '';

    private resetFilters() {
      this.layerFilter = ALL;
      this.laneFilter = ALL;
      this.tierFilter = ALL;
      this.stateFilter = ALL;
      this.ownerFilter = ALL;
      this.specStateFilter = ALL;
      this.reviewFilter = ALL;
      this.lagOnly = false;
      this.implementedOnly = false;
      this.query = '';
    }

    @action setLayer(e: Event) {
      this.layerFilter = (e.target as HTMLSelectElement).value;
    }
    @action setLane(e: Event) {
      this.laneFilter = (e.target as HTMLSelectElement).value;
    }
    @action setTier(e: Event) {
      this.tierFilter = (e.target as HTMLSelectElement).value;
    }
    @action setState(e: Event) {
      this.stateFilter = (e.target as HTMLSelectElement).value;
    }
    @action setOwner(e: Event) {
      this.ownerFilter = (e.target as HTMLSelectElement).value;
    }
    @action setSpecState(e: Event) {
      this.specStateFilter = (e.target as HTMLSelectElement).value;
    }
    @action setReviewFilter(e: Event) {
      this.reviewFilter = (e.target as HTMLSelectElement).value;
    }
    @action setTab(key: string) {
      this.activeTab = key;
    }
    @action setQueueFilter(key: string) {
      this.queueFilter = key;
    }
    @action drillToBacklog(state: string) {
      this.resetFilters();
      this.specStateFilter = state;
      this.activeTab = 'concepts';
    }
    @action drillState(state: string) {
      this.resetFilters();
      this.stateFilter = state;
      this.activeTab = 'concepts';
    }
    @action drillVerifiedDone() {
      this.resetFilters();
      this.stateFilter = 'Done';
      this.specStateFilter = 'verified';
      this.activeTab = 'concepts';
    }
    @action drillLag() {
      this.resetFilters();
      this.lagOnly = true;
      this.activeTab = 'concepts';
    }
    @action drillFunnel(label: string) {
      this.resetFilters();
      if (label === 'Code exists') {
        this.implementedOnly = true;
      } else if (label === 'Spec-verified') {
        this.specStateFilter = 'verified';
      } else {
        this.reviewFilter = 'approved';
      }
      this.activeTab = 'concepts';
    }
    @action drillQueue(key: string) {
      this.queueFilter = key;
      this.activeTab = 'queue';
    }
    @action drillSpecState(label: string) {
      let s = SPEC_STATES.find((x) => x.label === label);
      if (!s) return;
      this.resetFilters();
      this.specStateFilter = s.key;
      this.activeTab = 'concepts';
    }
    @action drillLayer(layer: string) {
      this.resetFilters();
      this.layerFilter = layer;
      this.activeTab = 'concepts';
    }
    @action clearLag() {
      this.lagOnly = false;
    }
    @action clearImplementedOnly() {
      this.implementedOnly = false;
    }
    get specStateOptions() {
      return SPEC_STATES.map((s) => ({ key: s.key, label: s.label }));
    }
    @action setQuery(value: string) {
      this.query = value;
    }
    reviewComponent = (card: ConceptReview) =>
      (card.constructor as typeof CardDef).getComponent(card);
    @action openCard(item: CardDef) {
      (this.args as any).viewCard?.(item, 'isolated');
    }

    <template>
      <article class='tracker'>
        <header class='head'>
          <div class='brand'>
            <LayoutGridIcon class='brand-icon' />
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <div class='funnel'>
            {{#each this.funnel as |stage|}}
              <button
                type='button'
                class='funnel-row'
                title='Show these concepts'
                {{on 'click' (fn this.drillFunnel stage.label)}}
              >
                <span class='funnel-label'>{{stage.label}}</span>
                <div class='funnel-bar'><div
                    class='funnel-fill'
                    style={{stage.style}}
                  ></div></div>
                <span class='funnel-count'>{{stage.count}}</span>
                <span class='chev'>›</span>
              </button>
            {{/each}}
            <p class='sub'>of {{this.total}} concepts</p>
          </div>
        </header>

        {{#if this.isInteractive}}
          <nav class='tab-bar'>
            {{#each this.tabs as |tab|}}
              <button
                type='button'
                class='tab {{if (eq this.activeTab tab.key) "active"}}'
                {{on 'click' (fn this.setTab tab.key)}}
              >{{tab.label}}</button>
            {{/each}}
          </nav>
        {{/if}}

        {{#if this.showOverview}}
        <section class='summary'>
          <div class='panel donut-panel'>
            <h2>Progress</h2>
            <DonutChart
              @segments={{this.specStateSegments}}
              @centerValue='{{this.specVerifiedCount}}'
              @centerLabel='spec-verified'
              @onSelect={{this.drillSpecState}}
            />
            <p class='tier-note'>Done means a Spec here whose ref resolves —
              to a shared block, base-realm code, or a pure catalog listing.
              Catalog and platform code without a Spec is available material,
              not done.</p>
          </div>

          <div class='panel'>
            <h2>Coverage by layer</h2>
            <div class='layer-list'>
              {{#each this.layerRows as |row|}}
                <button
                  type='button'
                  class='layer-row'
                  title='Show layer {{row.layer}}'
                  {{on 'click' (fn this.drillLayer row.layer)}}
                >
                  <span class='layer-id'>{{row.layer}}</span>
                  <span class='layer-name'>{{row.layerName}}</span>
                  <span
                    class='layer-count'
                  >{{row.verified}}/{{row.total}}</span>
                  <div class='bar'>
                    <div class='bar-code' style={{row.codedStyle}}></div>
                    <div
                      class='bar-verified'
                      style={{row.verifiedStyle}}
                    ></div>
                  </div>
                </button>
              {{/each}}
            </div>
            <p class='tier-note'>Solid = spec-verified · pale = code exists</p>
          </div>

          <div class='panel'>
            <h2>Work in flight</h2>
            <div class='state-list'>
              {{#each this.stateCounts as |s|}}
                <button
                  type='button'
                  class='state-row'
                  title='Show these concepts'
                  {{on 'click' (fn this.drillState s.state)}}
                >
                  <span class='state-name'>{{s.label}}</span>
                  <span class='state-count'>{{s.count}}
                    <span class='chev'>›</span></span>
                </button>
              {{/each}}
            </div>
            <div class='verify-row'>
              {{#if this.doneVerifiedCount}}
                <button
                  type='button'
                  class='chip chip-verified'
                  {{on 'click' this.drillVerifiedDone}}
                >{{this.doneVerifiedCount}}
                  built, verified
                  <span class='chev'>›</span></button>
              {{/if}}
              {{#if this.doneUnverifiedCount}}
                <button
                  type='button'
                  class='chip chip-lag'
                  {{on 'click' this.drillLag}}
                >{{this.doneUnverifiedCount}}
                  built, no evidence yet
                  <span class='chev'>›</span></button>
              {{/if}}
            </div>
          </div>

          <div class='panel'>
            <h2>Review pipeline</h2>
            <div class='state-list'>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillQueue 'awaiting review')}}
              >
                <span class='state-name'>Awaiting review</span>
                <span class='state-count'>{{this.awaitingReview.length}}
                  <span class='chev'>›</span></span>
              </button>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillQueue 'changes requested')}}
              >
                <span class='state-name'>Changes requested</span>
                <span class='state-count'>{{this.changesRequested.length}}
                  <span class='chev'>›</span></span>
              </button>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillQueue 'approved')}}
              >
                <span class='state-name'>Approved</span>
                <span class='state-count'>{{this.approved.length}}
                  <span class='chev'>›</span></span>
              </button>
            </div>
          </div>
        </section>
        {{/if}}

        {{#if (eq this.activeTab 'queue')}}
          {{#if this.isInteractive}}
            <section class='queue-grid'>
              <div class='panel queue-panel'>
                <div class='chip-row'>
                  {{#each this.queueChips as |chip|}}
                    <button
                      type='button'
                      class='filter-chip
                        {{if (eq this.queueFilter chip.key) "active"}}'
                      {{on 'click' (fn this.setQueueFilter chip.key)}}
                    >{{chip.label}}
                      <span class='chip-count'>{{chip.count}}</span></button>
                  {{/each}}
                </div>
                <div class='queue-list'>
                  {{#each this.queueList as |c|}}
                    <button
                      type='button'
                      class='queue-row'
                      {{on 'click' (fn this.openCard c)}}
                    >
                      <span class='cell-symbol'>{{c.symbol}}</span>
                      <span class='cell-concept'>{{c.concept}}</span>
                      {{#if c.sharedSpec}}
                        <span class='mini-chip'>spec ✓</span>
                      {{else}}
                        <span class='mini-chip mini-missing'>no spec</span>
                      {{/if}}
                      <span class='cell-owner'>{{if c.owner c.owner ''}}</span>
                      <span class='cell-time'>{{this.lastActivity c}}</span>
                    </button>
                  {{else}}
                    <p class='empty'>Nothing here — this list is clear</p>
                  {{/each}}
                </div>
              </div>
              <div class='queue-side'>
                <div class='panel'>
                  <h2>Spec backlog</h2>
                  <div class='queue-list'>
                    <button
                      type='button'
                      class='queue-row backlog-row'
                      {{on 'click' (fn this.drillToBacklog 'catalog')}}
                    >
                      <span class='cell-concept'>Catalog available — needs a
                        Spec here (pure listing) or a block</span>
                      <span
                        class='backlog-count'
                      >{{this.catalogAvailable.length}}</span>
                    </button>
                    <button
                      type='button'
                      class='queue-row backlog-row'
                      {{on 'click' (fn this.drillToBacklog 'platform')}}
                    >
                      <span class='cell-concept'>Platform available — code in
                        base, needs a Spec here</span>
                      <span
                        class='backlog-count'
                      >{{this.platformAvailable.length}}</span>
                    </button>
                  </div>
                </div>
                <div class='panel feed-panel'>
                  <h2>Recent activity</h2>
                  <div class='feed'>
                    {{#each this.recentReviews as |r|}}
                      <button
                        type='button'
                        class='feed-item'
                        {{on 'click' (fn this.openCard r)}}
                      >
                        {{#let (this.reviewComponent r) as |R|}}
                          <R @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No reviews yet — open a concept and
                        file the first one</p>
                    {{/each}}
                  </div>
                </div>
              </div>
            </section>
          {{/if}}
        {{/if}}

        {{#if (eq this.activeTab 'concepts')}}
          <section class='panel table-panel'>
            <div class='table-head'>
              <h2>Concepts</h2>
              <span class='count'>{{this.filtered.length}} shown</span>
            </div>
            <div class='filters'>
              <select aria-label='Layer' {{on 'change' this.setLayer}}>
                <option value='all' selected={{eq this.layerFilter 'all'}}>All
                  layers</option>
                {{#each this.layerOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.layerFilter opt}}
                  >Layer {{opt}}</option>
                {{/each}}
              </select>
              <select aria-label='Lane' {{on 'change' this.setLane}}>
                <option value='all' selected={{eq this.laneFilter 'all'}}>All
                  lanes</option>
                {{#each this.laneOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.laneFilter opt}}
                  >{{opt}}</option>
                {{/each}}
              </select>
              <select aria-label='Evidence tier' {{on 'change' this.setTier}}>
                <option value='all' selected={{eq this.tierFilter 'all'}}>All
                  tiers</option>
                {{#each this.tierOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.tierFilter opt}}
                  >{{opt}}</option>
                {{/each}}
              </select>
              <select aria-label='Work state' {{on 'change' this.setState}}>
                <option value='all' selected={{eq this.stateFilter 'all'}}>Any
                  work state</option>
                {{#each this.stateOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.stateFilter opt}}
                  >{{displayState opt}}</option>
                {{/each}}
              </select>
              <select aria-label='Owner' {{on 'change' this.setOwner}}>
                <option value='all' selected={{eq this.ownerFilter 'all'}}>Any
                  owner</option>
                {{#each this.ownerOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.ownerFilter opt}}
                  >{{opt}}</option>
                {{/each}}
              </select>
              <select
                aria-label='Spec state'
                {{on 'change' this.setSpecState}}
              >
                <option
                  value='all'
                  selected={{eq this.specStateFilter 'all'}}
                >Any spec state</option>
                {{#each this.specStateOptions as |opt|}}
                  <option
                    value={{opt.key}}
                    selected={{eq this.specStateFilter opt.key}}
                  >{{opt.label}}</option>
                {{/each}}
              </select>
              <select
                aria-label='Review status'
                {{on 'change' this.setReviewFilter}}
              >
                <option
                  value='all'
                  selected={{eq this.reviewFilter 'all'}}
                >Any review status</option>
                {{#each this.reviewStateOptions as |opt|}}
                  <option
                    value={{opt}}
                    selected={{eq this.reviewFilter opt}}
                  >{{opt}}</option>
                {{/each}}
              </select>
              <BoxelInput
                class='search'
                @type='search'
                @value={{this.query}}
                @onInput={{this.setQuery}}
                @placeholder='Search concept, symbol, provenance…'
              />
            </div>
            {{#if this.lagOnly}}
              <div class='active-filters'>
                <button
                  type='button'
                  class='chip chip-lag'
                  {{on 'click' this.clearLag}}
                >Built, no evidence yet ✕</button>
              </div>
            {{/if}}
            {{#if this.implementedOnly}}
              <div class='active-filters'>
                <button
                  type='button'
                  class='chip chip-verified'
                  {{on 'click' this.clearImplementedOnly}}
                >Code exists ✕</button>
              </div>
            {{/if}}
            <div class='rows'>
              <div class='row row-head'>
                <span>Symbol</span>
                <span>Concept</span>
                <span>Layer</span>
                <span>Lane</span>
                <span>Evidence</span>
                <span>State</span>
                <span>Owner</span>
                <span>Review</span>
              </div>
              {{#each this.filtered as |c|}}
                <button
                  type='button'
                  class='row'
                  {{on 'click' (fn this.openCard c)}}
                >
                  <span class='cell-symbol'>{{c.symbol}}</span>
                  <span class='cell-concept'>{{c.concept}}</span>
                  <span class='cell-layer'>{{c.layer}}</span>
                  <span class='cell-lane'>{{c.lane}}</span>
                  <span class='cell-tier'>{{this.tierOf c}}</span>
                  <span class='cell-state'>{{this.stateOf c}}</span>
                  <span class='cell-owner'>{{if c.owner c.owner ''}}</span>
                  <span class='cell-review'>
                    {{#if (eq (this.reviewStatus c) 'approved')}}
                      <span class='badge badge-approved'>✓</span>
                    {{else if (eq (this.reviewStatus c) 'changes requested')}}
                      <span
                        class='badge badge-changes'
                      >{{this.openReviewCount c}}</span>
                    {{else if (eq (this.reviewStatus c) 'awaiting review')}}
                      <span class='badge badge-waiting'>?</span>
                    {{/if}}
                  </span>
                </button>
              {{else}}
                <p class='empty'>No concepts match the current filters</p>
              {{/each}}
            </div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .tracker {
          min-height: 100%;
          padding: 1.25rem 1.5rem 2rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          background: var(--background, #fafafa);
          color: var(--foreground, #111111);
        }
        .head {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .brand-icon {
          width: 22px;
          height: 22px;
        }
        h1 {
          margin: 0;
          font-size: 1.375rem;
          font-family: var(--font-heading, inherit);
        }
        .sub {
          margin: 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .chev {
          color: var(--muted-foreground, #9ca3af);
          font-weight: 700;
        }
        .funnel {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          max-width: 34rem;
          margin-top: 0.375rem;
        }
        .funnel-row {
          display: grid;
          grid-template-columns: 7.5rem 1fr 3rem 0.75rem;
          align-items: center;
          gap: 0.625rem;
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.125rem 0.25rem;
          margin: -0.125rem -0.25rem;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .funnel-row:hover {
          background: var(--muted, #f3f4f6);
        }
        .funnel-label {
          color: var(--muted-foreground, #6b7280);
        }
        .funnel-bar {
          height: 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
        }
        .funnel-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--tier-platform-fg, #16a34a);
        }
        .funnel-row:nth-child(2) .funnel-fill {
          background: var(--state-progress-fg, #2563eb);
        }
        .funnel-row:nth-child(3) .funnel-fill {
          background: var(--tier-listing-fg, #7c3aed);
        }
        .funnel-count {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .backlog-row {
          grid-template-columns: 1fr auto;
        }
        .backlog-row .cell-concept {
          white-space: normal;
          font-weight: 500;
        }
        .backlog-count {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
          gap: 1rem;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .tier-note {
          margin: 0.75rem 0 0;
          font-size: 0.75rem;
          line-height: 1.4;
          color: var(--muted-foreground, #6b7280);
        }
        .layer-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .layer-row {
          display: grid;
          grid-template-columns: 2.5rem 1fr auto;
          grid-template-rows: auto auto;
          align-items: baseline;
          column-gap: 0.5rem;
          row-gap: 0.25rem;
          width: 100%;
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.25rem 0.375rem;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .layer-row:hover {
          background: var(--muted, #f3f4f6);
        }
        .layer-id {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .layer-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .layer-count {
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .bar {
          position: relative;
          grid-column: 1 / -1;
          height: 0.375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
        }
        .bar-code,
        .bar-verified {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 999px;
        }
        .bar-code {
          background: var(--tier-platform-bg, #bbf7d0);
        }
        .bar-verified {
          background: var(--tier-platform-fg, #16a34a);
        }
        .state-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .state-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.25rem 0.375rem;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .state-row:hover {
          background: var(--muted, #f3f4f6);
        }
        .state-count {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .verify-row {
          margin-top: 0.75rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font: inherit;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.625rem;
          border-radius: 999px;
          cursor: pointer;
        }
        .chip-verified {
          border: 1px solid var(--state-done-fg, #166534);
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .chip-verified:hover {
          background: var(--state-done-fg, #166534);
          color: var(--state-done-bg, #dcfce7);
        }
        .chip-lag {
          border: 1px solid var(--state-next-fg, #92400e);
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .chip-lag:hover {
          background: var(--state-next-fg, #92400e);
          color: var(--state-next-bg, #fef3c7);
        }
        .chip .chev {
          color: inherit;
          opacity: 0.7;
        }
        .active-filters {
          display: flex;
          gap: 0.375rem;
        }
        .table-panel {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .table-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .count {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
        }
        .filters select {
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--card, #ffffff);
          color: inherit;
        }
        .search {
          max-width: 18rem;
        }
        .rows {
          display: flex;
          flex-direction: column;
          max-height: 34rem;
          overflow-y: auto;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .tab-bar {
          display: flex;
          gap: 0.25rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        .tab {
          font: inherit;
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 0.5rem 0.875rem;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--muted-foreground, #6b7280);
          cursor: pointer;
        }
        .tab.active {
          color: var(--foreground, #111111);
          border-bottom-color: var(--foreground, #111111);
        }
        .queue-grid {
          display: grid;
          grid-template-columns: minmax(0, 3fr) minmax(18rem, 2fr);
          gap: 1rem;
          align-items: start;
        }
        .queue-side {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .queue-panel {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
        }
        .filter-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font: inherit;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.625rem;
          border-radius: 999px;
          border: 1px solid var(--border, #e5e7eb);
          background: transparent;
          color: var(--muted-foreground, #6b7280);
          cursor: pointer;
        }
        .filter-chip:hover {
          background: var(--muted, #f3f4f6);
        }
        .filter-chip.active {
          border-color: var(--foreground, #111111);
          background: var(--foreground, #111111);
          color: var(--background, #ffffff);
        }
        .chip-count {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .queue-list,
        .feed {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          max-height: 28rem;
          overflow-y: auto;
        }
        .queue-row {
          display: grid;
          grid-template-columns: 2.5rem 1fr auto 4.5rem 4rem;
          gap: 0.5rem;
          align-items: center;
          padding: 0.4375rem 0.625rem;
          font: inherit;
          font-size: 0.8125rem;
          text-align: left;
          background: transparent;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          cursor: pointer;
          color: inherit;
        }
        .queue-row:hover {
          background: var(--muted, #f3f4f6);
        }
        .mini-chip {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
          white-space: nowrap;
        }
        .mini-missing {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .cell-time {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          text-align: right;
          white-space: nowrap;
        }
        .feed-item {
          padding: 0;
          font: inherit;
          text-align: left;
          background: transparent;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          cursor: pointer;
          color: inherit;
        }
        .feed-item:hover {
          background: var(--muted, #f3f4f6);
        }
        .feed-item :deep(.boxel-card-container) {
          box-shadow: none;
          background: transparent;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.25rem;
          height: 1.25rem;
          padding: 0 0.25rem;
          border-radius: 999px;
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .badge-approved {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .badge-changes {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .badge-waiting {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .row {
          display: grid;
          grid-template-columns: 3rem 1fr 3rem 9.5rem 7.5rem 6.5rem 4.5rem 2.5rem;
          gap: 0.5rem;
          align-items: center;
          padding: 0.4375rem 0.75rem;
          font: inherit;
          font-size: 0.8125rem;
          text-align: left;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border, #e5e7eb);
          cursor: pointer;
          color: inherit;
        }
        .row-head {
          cursor: default;
          position: sticky;
          top: 0;
          z-index: 1;
          background: var(--card, #ffffff);
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, #6b7280);
        }
        .row:last-child {
          border-bottom: none;
        }
        .row:not(.row-head):hover {
          background: var(--muted, #f3f4f6);
        }
        .cell-symbol {
          font-family: var(--font-mono, monospace);
          font-weight: 700;
        }
        .cell-concept {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cell-layer {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, #6b7280);
        }
        .cell-lane,
        .cell-tier,
        .cell-state,
        .cell-owner {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .empty {
          margin: 0;
          padding: 1rem;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        @media (max-width: 800px) {
          .queue-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .row {
            grid-template-columns: 3rem 1fr 6.5rem;
          }
          .cell-layer,
          .cell-lane,
          .cell-tier,
          .cell-owner {
            display: none;
          }
          .row-head {
            display: none;
          }
        }
      </style>
    </template>
  };
}
