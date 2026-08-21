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
import { fn, get } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import {
  Stat,
  DataGrid,
  type ColumnSpec,
  type Row,
} from 'https://realms-staging.stack.cards/richard.tan1/pretui/reading';
import { FilterChips } from 'https://realms-staging.stack.cards/richard.tan1/pretui/controls';
import { SearchInput } from 'https://realms-staging.stack.cards/richard.tan1/pretui/controls-extras';
import { EmptyState } from 'https://realms-staging.stack.cards/richard.tan1/pretui/structure';
import { MatrixConcept } from './matrix-concept';
import { ProgressReport } from './progress-report';
import { Blocker } from './blocker';
import {
  qualityBucket,
  qualityScore,
  bucketLabel,
  consumerList,
  BUCKETS,
  type QualityBucket,
} from './spec-quality';

// The wall and the availability drills speak spec-state: what evidences a
// concept right now — a verified Spec, catalog code, platform code, nothing.
const SPEC_STATES = [
  { key: 'verified', label: 'Spec-verified', color: '#16a34a' },
  { key: 'catalog', label: 'Catalog available', color: '#7c3aed' },
  { key: 'platform', label: 'Platform available', color: '#2563eb' },
  { key: 'none', label: 'Not started', color: '#e5e7eb' },
];
const ALL = 'all';
// Card-context searches are clamped to 100 items per page (search-bounds.ts),
// so the full matrix is read as fixed pages and concatenated. Bump when the
// matrix outgrows PAGE_COUNT * PAGE_SIZE.
const PAGE_SIZE = 100;
const PAGE_COUNT = 8;
const RECENT_DAYS = 30;

const GRID_COLUMNS: ColumnSpec[] = [
  { key: 'symbol', label: 'Symbol', mono: true, sortable: true },
  { key: 'concept', label: 'Concept', sortable: true },
  { key: 'layer', label: 'Layer', sortable: true },
  { key: 'lane', label: 'Lane', sortable: true },
  { key: 'tier', label: 'Evidence', sortable: true },
  { key: 'score', label: 'Quality', num: true, sortable: true },
  { key: 'consumers', label: 'Consumers', num: true, sortable: true },
];

export class MatrixTracker extends CardDef {
  static prefersWideFormat = true;
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

  // Read-only by design: every number is a live count over real cards, every
  // click is a drill or a navigation — the tracker writes nothing.
  static isolated = class Isolated extends Component<typeof MatrixTracker> {
    @tracked activeTab = 'overview';
    @tracked bucketFilter = ALL;
    @tracked specStateFilter = ALL;
    @tracked layerFilter = ALL;
    @tracked laneFilter = ALL;
    @tracked tierFilter = ALL;
    @tracked query = '';

    private conceptPages: (ReturnType<getCards> | undefined)[] = [];
    private reportList: ReturnType<getCards> | undefined;
    private blockerList: ReturnType<getCards> | undefined;

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
      this.reportList = ctx?.getCards(
        this,
        () => {
          let ref = identifyCard(ProgressReport);
          return ref
            ? {
                filter: { type: ref },
                sort: [{ by: 'roundDate', on: ref, direction: 'desc' }],
              }
            : undefined;
        },
        () => this.realms,
        { isLive: true },
      );
      this.blockerList = ctx?.getCards(
        this,
        () => {
          let ref = identifyCard(Blocker);
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

    bucketOf = (c: MatrixConcept): QualityBucket => qualityBucket(c);

    get specVerifiedCount() {
      return this.concepts.filter((c) => c.sharedSpec).length;
    }
    get consumedCount() {
      return this.concepts.filter((c) => consumerList(c).length >= 1).length;
    }
    get reusedCount() {
      return this.concepts.filter((c) => consumerList(c).length >= 2).length;
    }
    get goldCount() {
      return this.concepts.filter((c) => this.bucketOf(c) === 'gold').length;
    }

    get recentlyVerified(): MatrixConcept[] {
      let cutoff = Date.now() - RECENT_DAYS * 86400000;
      return this.concepts
        .filter((c) => (c.verifiedAt?.getTime?.() ?? 0) >= cutoff)
        .sort(
          (a, b) =>
            (b.verifiedAt?.getTime?.() ?? 0) - (a.verifiedAt?.getTime?.() ?? 0),
        );
    }

    get latestReport(): ProgressReport | undefined {
      return ((this.reportList?.instances ?? []) as ProgressReport[]).filter(
        Boolean,
      )[0];
    }

    get openBlockers(): Blocker[] {
      return ((this.blockerList?.instances ?? []) as Blocker[])
        .filter(Boolean)
        .filter((b) => b.status !== 'resolved');
    }
    get blockedConcepts(): MatrixConcept[] {
      return this.concepts.filter((c) => c.workState === 'Blocked');
    }
    get hasBlockers() {
      return this.openBlockers.length > 0 || this.blockedConcepts.length > 0;
    }

    // The wall: one cell per concept, grouped by layer, sorted stably so a
    // cell stays where the eye left it between visits.
    get layerBands() {
      let layers = [...new Set(this.concepts.map((c) => c.layer))]
        .filter(Boolean)
        .sort((a, b) => parseFloat(a!) - parseFloat(b!)) as string[];
      return layers.map((layer) => {
        let group = this.concepts
          .filter((c) => c.layer === layer)
          .sort(
            (a, b) =>
              (a.lane ?? '').localeCompare(b.lane ?? '') ||
              (a.concept ?? '').localeCompare(b.concept ?? ''),
          );
        let verified = group.filter((c) => c.sharedSpec).length;
        let coded = group.filter((c) => c.implemented).length;
        let pct = (n: number) =>
          group.length ? Math.round((n / group.length) * 100) : 0;
        return {
          layer,
          layerName: group[0]?.layerName,
          verified,
          coded,
          total: group.length,
          pctVerified: pct(verified),
          codedStyle: htmlSafe(`width: ${pct(coded)}%`),
          verifiedStyle: htmlSafe(`width: ${pct(verified)}%`),
          cells: group.map((c) => ({
            card: c,
            cls: `sp-${this.specState(c)}`,
            hint: `${c.symbol} ${c.concept} — ${
              SPEC_STATES.find((s) => s.key === this.specState(c))?.label
            }`,
          })),
        };
      });
    }

    get bucketChips() {
      let counts = new Map<string, number>();
      for (let c of this.concepts) {
        let b = this.bucketOf(c);
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      return [
        { value: ALL, label: 'All', count: this.total },
        ...BUCKETS.map((b) => ({
          value: b.key,
          label: b.label,
          count: counts.get(b.key) ?? 0,
        })),
      ];
    }

    get qualityRows() {
      return this.bucketChips.slice(1).map((chip) => ({
        ...chip,
        color: BUCKETS.find((b) => b.key === chip.value)?.color,
        dotStyle: htmlSafe(
          `background: ${BUCKETS.find((b) => b.key === chip.value)?.color}`,
        ),
      }));
    }

    get catalogAvailable(): MatrixConcept[] {
      return this.concepts.filter((c) => this.specState(c) === 'catalog');
    }
    get platformAvailable(): MatrixConcept[] {
      return this.concepts.filter((c) => this.specState(c) === 'platform');
    }
    get thinCount() {
      return this.concepts.filter((c) => this.bucketOf(c) === 'thin').length;
    }
    get missingExampleCount() {
      return this.concepts.filter(
        (c) => c.sharedSpec && (c.specExampleCount ?? 0) === 0,
      ).length;
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
      return [
        'Platform',
        'Catalog shared',
        'Catalog listing',
        'POC realm',
        'No evidence',
      ];
    }
    get activeSpecState() {
      return SPEC_STATES.find((s) => s.key === this.specStateFilter);
    }

    get filtered(): MatrixConcept[] {
      let q = this.query.trim().toLowerCase();
      return this.concepts.filter((c) => {
        if (this.bucketFilter !== ALL && this.bucketOf(c) !== this.bucketFilter)
          return false;
        if (
          this.specStateFilter !== ALL &&
          this.specState(c) !== this.specStateFilter
        )
          return false;
        if (this.layerFilter !== ALL && c.layer !== this.layerFilter)
          return false;
        if (this.laneFilter !== ALL && c.lane !== this.laneFilter) return false;
        if (
          this.tierFilter !== ALL &&
          (c.evidenceTier ?? 'No evidence') !== this.tierFilter
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
      });
    }

    get gridRows(): Row[] {
      return this.filtered.map((c) => ({
        symbol: c.symbol,
        concept: c.concept,
        layer: c.layer,
        lane: c.lane,
        tier: c.evidenceTier ?? '—',
        score: c.sharedSpec ? qualityScore(c) : -1,
        quality: bucketLabel(this.bucketOf(c)),
        qkey: this.bucketOf(c),
        consumers: consumerList(c).length,
        __card: c,
      }));
    }

    private get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }
    get showOverview() {
      return !this.isInteractive || this.activeTab === 'overview';
    }
    get showConcepts() {
      return this.isInteractive && this.activeTab === 'concepts';
    }

    private resetFilters() {
      this.bucketFilter = ALL;
      this.specStateFilter = ALL;
      this.layerFilter = ALL;
      this.laneFilter = ALL;
      this.tierFilter = ALL;
      this.query = '';
    }

    @action setBucket(value: string) {
      this.bucketFilter = value;
    }
    @action setQuery(value: string) {
      this.query = value;
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
    @action clearSpecState() {
      this.specStateFilter = ALL;
    }

    @action drillBucket(bucket: string) {
      this.resetFilters();
      this.bucketFilter = bucket;
      this.activeTab = 'concepts';
    }
    @action drillSpecState(state: string) {
      this.resetFilters();
      this.specStateFilter = state;
      this.activeTab = 'concepts';
    }
    @action drillVerified() {
      this.drillSpecState('verified');
    }
    @action drillConsumed() {
      // Consumed/reused are not grid filters; the quality buckets carry
      // them — Solid and Gold both require consumption.
      this.resetFilters();
      this.activeTab = 'concepts';
    }
    @action drillLayer(layer: string) {
      this.resetFilters();
      this.layerFilter = layer;
      this.activeTab = 'concepts';
    }
    @action setTab(key: string) {
      this.activeTab = key;
    }
    @action openCard(item: CardDef) {
      (this.args as any).viewCard?.(item, 'isolated');
    }

    cardComponent = (card: CardDef) =>
      (card.constructor as typeof CardDef).getComponent(card);

    get wallLegend() {
      return SPEC_STATES.map((s) => ({
        ...s,
        dotStyle: htmlSafe(`background: ${s.color}`),
      }));
    }

    <template>
      <article class='tracker'>
        <header class='head'>
          <div class='brand'>
            <LayoutGridIcon class='brand-icon' />
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <p class='sub'>{{this.total}}
            concepts · a concept counts as done when a Spec in this realm
            resolves to shared code — quality is six mechanical checks, no
            approval step</p>
        </header>

        {{#if this.isInteractive}}
          <nav class='tab-bar'>
            <button
              type='button'
              class='tab {{if (eq this.activeTab "overview") "active"}}'
              {{on 'click' (fn this.setTab 'overview')}}
            >Overview</button>
            <button
              type='button'
              class='tab {{if (eq this.activeTab "concepts") "active"}}'
              {{on 'click' (fn this.setTab 'concepts')}}
            >Concepts</button>
          </nav>
        {{/if}}

        {{#if this.showOverview}}
        <section class='stat-band'>
          <button
            type='button'
            class='stat-cell'
            {{on 'click' this.drillVerified}}
          >
            <Stat
              @label='Spec-verified'
              @value={{this.specVerifiedCount}}
              @hint='of {{this.total}} concepts'
            />
          </button>
          <button
            type='button'
            class='stat-cell'
            {{on 'click' this.drillConsumed}}
          >
            <Stat
              @label='Consumed'
              @value={{this.consumedCount}}
              @hint='blocks with ≥1 consumer'
            />
          </button>
          <button
            type='button'
            class='stat-cell'
            {{on 'click' this.drillConsumed}}
          >
            <Stat
              @label='Reused'
              @value={{this.reusedCount}}
              @hint='two-consumer rule met'
            />
          </button>
          <button
            type='button'
            class='stat-cell'
            {{on 'click' (fn this.drillBucket 'gold')}}
          >
            <Stat
              @label='Gold specs'
              @value={{this.goldCount}}
              @hint='all 6 checks pass'
            />
          </button>
          {{#if this.recentlyVerified.length}}
            <div class='stat-cell stat-static'>
              <Stat
                @label='Verified · 30d'
                @value={{this.recentlyVerified.length}}
                @hint='since the last crawl rounds'
              />
            </div>
          {{/if}}
        </section>

        {{#if this.latestReport}}
          <section class='panel report-panel'>
            <h2>Latest crawl round</h2>
            <button
              type='button'
              class='report-body'
              title='Open the full report'
              {{on 'click' (fn this.openCard this.latestReport)}}
            >
              {{#let (this.cardComponent this.latestReport) as |R|}}
                <R @format='embedded' />
              {{/let}}
            </button>
          </section>
        {{/if}}

        {{#if this.hasBlockers}}
          <section class='panel blockers-panel'>
            <h2>Known blockers</h2>
            <div class='blocker-list'>
              {{#each this.openBlockers as |b|}}
                <button
                  type='button'
                  class='blocker-item'
                  {{on 'click' (fn this.openCard b)}}
                >
                  {{#let (this.cardComponent b) as |B|}}
                    <B @format='embedded' />
                  {{/let}}
                </button>
              {{/each}}
              {{#each this.blockedConcepts as |c|}}
                <button
                  type='button'
                  class='blocked-concept'
                  {{on 'click' (fn this.openCard c)}}
                >
                  <span class='cell-symbol'>{{c.symbol}}</span>
                  <span class='blocked-name'>{{c.concept}}</span>
                  <span class='blocked-note'>{{if
                      c.notes
                      c.notes
                      'Blocked — no reason recorded'
                    }}</span>
                </button>
              {{/each}}
            </div>
          </section>
        {{/if}}

        <section class='panel wall-panel'>
          <h2>The matrix — every concept, its evidence right now</h2>
          <div class='wall'>
            {{#each this.layerBands as |band|}}
              <div class='band'>
                <button
                  type='button'
                  class='band-head'
                  title='Show layer {{band.layer}} in the grid'
                  {{on 'click' (fn this.drillLayer band.layer)}}
                >
                  <span class='band-id'>{{band.layer}}</span>
                  <span class='band-name'>{{band.layerName}}</span>
                  <span class='band-count'>{{band.verified}}/{{band.total}}
                    verified · {{band.coded}} coded</span>
                  <div class='band-bar'>
                    <div class='bar-code' style={{band.codedStyle}}></div>
                    <div
                      class='bar-verified'
                      style={{band.verifiedStyle}}
                    ></div>
                  </div>
                </button>
                <div class='band-cells'>
                  {{#each band.cells as |cell|}}
                    <button
                      type='button'
                      class='cell {{cell.cls}}'
                      title={{cell.hint}}
                      {{on 'click' (fn this.openCard cell.card)}}
                    ></button>
                  {{/each}}
                </div>
              </div>
            {{/each}}
          </div>
          <div class='legend'>
            {{#each this.wallLegend as |item|}}
              <button
                type='button'
                class='legend-item'
                {{on 'click' (fn this.drillSpecState item.key)}}
              >
                <span class='legend-dot' style={{item.dotStyle}}></span>
                {{item.label}}
              </button>
            {{/each}}
          </div>
        </section>

        <section class='two-col'>
          <div class='panel'>
            <h2>Spec quality — six checks, computed live</h2>
            <div class='state-list'>
              {{#each this.qualityRows as |row|}}
                <button
                  type='button'
                  class='state-row'
                  {{on 'click' (fn this.drillBucket row.value)}}
                >
                  <span class='state-name'>
                    <span class='legend-dot' style={{row.dotStyle}}></span>
                    {{row.label}}
                  </span>
                  <span class='state-count'>{{row.count}}
                    <span class='chev'>›</span></span>
                </button>
              {{/each}}
            </div>
            <p class='tier-note'>Gold = verified Spec, populated example,
              substantial readMe, consumed, reused, right spec kind. The bar
              is set by the top-10 exemplars in
              spec-quality-standard.md.</p>
          </div>

          <div class='panel'>
            <h2>Next best actions</h2>
            <div class='state-list'>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillSpecState 'catalog')}}
              >
                <span class='state-name'>Catalog code without a Spec — cheap
                  wins</span>
                <span
                  class='state-count'
                >{{this.catalogAvailable.length}}
                  <span class='chev'>›</span></span>
              </button>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillSpecState 'platform')}}
              >
                <span class='state-name'>Platform code without a Spec</span>
                <span
                  class='state-count'
                >{{this.platformAvailable.length}}
                  <span class='chev'>›</span></span>
              </button>
              <button
                type='button'
                class='state-row'
                {{on 'click' (fn this.drillBucket 'thin')}}
              >
                <span class='state-name'>Thin specs to lift (≤3 checks)</span>
                <span class='state-count'>{{this.thinCount}}
                  <span class='chev'>›</span></span>
              </button>
            </div>
            <p class='tier-note'>{{this.missingExampleCount}}
              verified specs still lack an example — the single biggest
              quality gap, and each is one fixture away from moving up.</p>
          </div>
        </section>

        {{/if}}

        {{#if this.showConcepts}}
        <section class='panel grid-panel' id='matrix-concept-grid'>
          <div class='table-head'>
            <h2>Concepts</h2>
            <span class='count'>{{this.filtered.length}} shown</span>
          </div>
          <FilterChips
            @options={{this.bucketChips}}
            @value={{this.bucketFilter}}
            @onValueChange={{this.setBucket}}
          />
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
            <SearchInput
              class='search'
              @value={{this.query}}
              @placeholder='Search concept, symbol, provenance…'
              @onInput={{this.setQuery}}
            />
            {{#if this.activeSpecState}}
              <button
                type='button'
                class='active-chip'
                {{on 'click' this.clearSpecState}}
              >{{this.activeSpecState.label}} ✕</button>
            {{/if}}
          </div>
          {{#if this.filtered.length}}
            <div class='grid-scroll'>
              <DataGrid
                @columns={{gridColumns}}
                @rows={{this.gridRows}}
                @rowKey='symbol'
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'concept')}}
                    <button
                      type='button'
                      class='concept-link'
                      {{on 'click' (fn this.openCard (getCardOf row))}}
                    >{{row.concept}}</button>
                  {{else if (eq column.key 'score')}}
                    <span class='q-chip q-{{row.qkey}}'>{{row.quality}}
                      {{#if (isScored row.score)}}·
                        {{row.score}}/6{{/if}}</span>
                  {{else}}
                    {{get row column.key}}
                  {{/if}}
                </:cell>
              </DataGrid>
            </div>
          {{else}}
            <EmptyState
              @title='No concepts match'
              @message='Clear a filter or the search to widen the view'
            />
          {{/if}}
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
          max-width: 52rem;
        }
        .chev {
          color: var(--muted-foreground, #9ca3af);
          font-weight: 700;
        }
        .stat-band {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
          gap: 0.75rem;
        }
        .stat-cell {
          font: inherit;
          text-align: left;
          padding: 0.875rem 1rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          background: var(--card, #ffffff);
          color: inherit;
          cursor: pointer;
        }
        .stat-cell:hover {
          border-color: var(--foreground, #111111);
        }
        .stat-static {
          cursor: default;
        }
        .stat-static:hover {
          border-color: var(--border, #e5e7eb);
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
        .report-panel .report-body {
          display: block;
          width: 100%;
          font: inherit;
          text-align: left;
          padding: 0;
          border: none;
          background: transparent;
          color: inherit;
          cursor: pointer;
          border-radius: 0.5rem;
        }
        .report-body:hover {
          background: var(--muted, #f3f4f6);
        }
        .report-body :deep(.boxel-card-container) {
          box-shadow: none;
          background: transparent;
        }
        .blockers-panel {
          border-color: var(--state-blocked-fg, #991b1b);
        }
        .blockers-panel h2 {
          color: var(--state-blocked-fg, #991b1b);
        }
        .blocker-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .blocker-item {
          font: inherit;
          text-align: left;
          padding: 0;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .blocker-item:hover {
          background: var(--muted, #f3f4f6);
        }
        .blocker-item :deep(.boxel-card-container) {
          box-shadow: none;
          background: transparent;
        }
        .blocked-concept {
          display: grid;
          grid-template-columns: 2.5rem auto 1fr;
          gap: 0.5rem;
          align-items: baseline;
          font: inherit;
          font-size: 0.8125rem;
          text-align: left;
          padding: 0.4375rem 0.625rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .blocked-concept:hover {
          background: var(--muted, #f3f4f6);
        }
        .blocked-name {
          font-weight: 600;
          white-space: nowrap;
        }
        .blocked-note {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wall {
          display: flex;
          flex-direction: column;
          gap: 0.875rem;
        }
        .band {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .band-head {
          display: grid;
          grid-template-columns: 2.5rem auto 1fr;
          grid-template-rows: auto auto;
          align-items: baseline;
          column-gap: 0.625rem;
          row-gap: 0.25rem;
          font: inherit;
          font-size: 0.8125rem;
          text-align: left;
          padding: 0.25rem 0.375rem;
          margin: -0.25rem -0.375rem 0;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .band-head:hover {
          background: var(--muted, #f3f4f6);
        }
        .band-id {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .band-name {
          font-weight: 600;
        }
        .band-count {
          justify-self: end;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .band-bar {
          position: relative;
          grid-column: 1 / -1;
          height: 0.25rem;
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
        .band-cells {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
        }
        .cell {
          width: 12px;
          height: 12px;
          padding: 0;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        .cell:hover {
          transform: scale(1.5);
          outline: 1px solid var(--foreground, #111111);
        }
        .sp-verified {
          background: #16a34a;
        }
        .sp-catalog {
          background: #7c3aed;
        }
        .sp-platform {
          background: #2563eb;
        }
        .sp-none {
          background: var(--muted, #e5e7eb);
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-top: 0.875rem;
        }
        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font: inherit;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          padding: 0.125rem 0.375rem;
          margin: -0.125rem -0.375rem;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          cursor: pointer;
        }
        .legend-item:hover {
          background: var(--muted, #f3f4f6);
          color: var(--foreground, #111111);
        }
        .legend-dot {
          display: inline-block;
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .two-col {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
          gap: 1rem;
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
          gap: 0.75rem;
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
        .state-name {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        .state-count {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .tier-note {
          margin: 0.75rem 0 0;
          font-size: 0.75rem;
          line-height: 1.4;
          color: var(--muted-foreground, #6b7280);
        }
        .grid-panel {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          scroll-margin-top: 1rem;
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
          min-width: 16rem;
        }
        .active-chip {
          font: inherit;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.625rem;
          border-radius: 999px;
          border: 1px solid var(--foreground, #111111);
          background: var(--foreground, #111111);
          color: var(--background, #ffffff);
          cursor: pointer;
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
        .grid-scroll {
          max-height: 75vh;
          overflow-y: auto;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .concept-link {
          font: inherit;
          font-size: inherit;
          font-weight: 600;
          padding: 0;
          border: none;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .concept-link:hover {
          text-decoration: underline;
        }
        .cell-symbol {
          font-family: var(--font-mono, monospace);
          font-weight: 700;
        }
        .q-chip {
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .q-gold {
          background: #fef9c3;
          color: #854d0e;
        }
        .q-solid {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .q-adequate {
          background: var(--tier-shared-bg, #dbeafe);
          color: var(--tier-shared-fg, #1e40af);
        }
        .q-thin,
        .q-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        @media (max-width: 640px) {
          .band-count {
            display: none;
          }
        }
      </style>
    </template>
  };
}

const gridColumns = GRID_COLUMNS;

function getCardOf(row: Row): CardDef {
  return row['__card'] as CardDef;
}

function isScored(score: number): boolean {
  return score >= 0;
}
