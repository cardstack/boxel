import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  PropertyListing,
  PROPERTY_LISTING_STATUSES,
  PROPERTY_LISTING_STATUS_LABELS,
} from './property-listing';
import { formatMoney } from './money';

// Property Marketplace — the agent's market-command console ("Command your
// market"). Composes the Real Estate blocks UNCHANGED: PropertyListing rows
// from a live query, the publish lifecycle read off the shared status enum,
// DOM read off the card's own computed. One hero number (value on market),
// a pipeline rail, and the book itself — not a stat-tile grid.
//
// Identity-bearing dark app (the marketplace spec pins navy + gold), so the
// brand pair is declared ONCE at the root as overridable knobs
// (boxel-theming §4a: a card that asserts a brand pins it as a fallback
// behind a family token, never scatters raw hex).
export class PropertyMarketplaceApp extends CardDef {
  static displayName = 'Property Marketplace';
  static headerColor = '#1a2234';
  static prefersWideFormat = true;

  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return 'Property Marketplace';
    },
  });

  static isolated = class Isolated extends Component<
    typeof PropertyMarketplaceApp
  > {
    @tracked statusFilter = 'all';
    @tracked sortKey: 'newest' | 'dom' | 'price' = 'newest';
    @tracked search = '';

    private listingsQuery: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      if (this.isInteractive) {
        this.listingsQuery = this.args.context?.getCards(
          this,
          () => {
            let ref = identifyCard(PropertyListing);
            return ref ? { filter: { type: ref } } : undefined;
          },
          () => this.realms,
          { isLive: true },
        );
      }
    }

    // Prerender gets a static shell — the live grid mounts only in a real
    // session (avoids heavy indexing and the themed-fitted prerender trap).
    get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    get listings(): PropertyListing[] {
      return ((this.listingsQuery?.instances ?? []) as PropertyListing[])
        .filter(Boolean);
    }

    // --- the numbers the desk is judged on -------------------------------
    get onMarket(): PropertyListing[] {
      return this.listings.filter(
        (l) => l.status === 'published' || l.status === 'under-offer',
      );
    }
    get valueOnMarket(): string {
      let total = this.onMarket.reduce(
        (sum, l) => sum + (l.askingPrice?.amount ?? 0),
        0,
      );
      return formatMoney(total, 'USD');
    }
    get activeCount() {
      return this.listings.filter((l) => l.status === 'published').length;
    }
    get underOfferCount() {
      return this.listings.filter((l) => l.status === 'under-offer').length;
    }
    get avgDom(): number | undefined {
      let doms = this.onMarket
        .map((l) => l.daysOnMarket)
        .filter((d): d is number => d != null);
      if (!doms.length) {
        return undefined;
      }
      return Math.round(doms.reduce((a, b) => a + b, 0) / doms.length);
    }

    // --- pipeline --------------------------------------------------------
    ladder = ['draft', 'prepared', 'published', 'under-offer', 'sold'];
    exits = ['withdrawn', 'expired'];

    countOf = (status: string) =>
      this.listings.filter((l) => (l.status ?? 'draft') === status).length;

    labelOf = (status: string) =>
      PROPERTY_LISTING_STATUS_LABELS[status] ?? status;

    // --- needs attention -------------------------------------------------
    get stale(): PropertyListing[] {
      return this.onMarket
        .filter((l) => (l.daysOnMarket ?? 0) >= 30)
        .sort((a, b) => (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0));
    }
    get unprepared(): PropertyListing[] {
      return this.listings.filter(
        (l) =>
          (l.status === 'draft' || !l.status) &&
          (!(l.photoCount ?? 0) || l.askingPrice?.amount == null),
      );
    }
    domOf = (l: PropertyListing) => l.daysOnMarket ?? 0;

    // --- the book --------------------------------------------------------
    get filterOptions() {
      return ['all', ...PROPERTY_LISTING_STATUSES];
    }

    get visible(): PropertyListing[] {
      let rows = this.listings;
      if (this.statusFilter !== 'all') {
        rows = rows.filter(
          (l) => (l.status ?? 'draft') === this.statusFilter,
        );
      }
      let q = this.search.trim().toLowerCase();
      if (q) {
        rows = rows.filter((l) =>
          [l.cardTitle, l.address?.city, l.neighborhood]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q)),
        );
      }
      let sorted = [...rows];
      if (this.sortKey === 'dom') {
        sorted.sort((a, b) => (b.daysOnMarket ?? -1) - (a.daysOnMarket ?? -1));
      } else if (this.sortKey === 'price') {
        sorted.sort(
          (a, b) => (b.askingPrice?.amount ?? 0) - (a.askingPrice?.amount ?? 0),
        );
      } else {
        sorted.sort((a, b) =>
          String(b.publishedAt ?? '').localeCompare(
            String(a.publishedAt ?? ''),
          ),
        );
      }
      return sorted;
    }

    setFilter = (value: string) => (this.statusFilter = value);
    setSort = (event: Event) =>
      (this.sortKey = (event.target as HTMLSelectElement).value as any);
    setSearch = (event: Event) =>
      (this.search = (event.target as HTMLInputElement).value);

    priceOf = (l: PropertyListing) => {
      let p = l.askingPrice;
      return p?.amount != null ? formatMoney(p.amount, p.currency?.code) : '—';
    };
    factsOf = (l: PropertyListing) =>
      [
        l.bedrooms != null ? `${l.bedrooms} bd` : null,
        l.bathrooms != null ? `${l.bathrooms} ba` : null,
        l.areaSqft != null ? `${l.areaSqft.toLocaleString('en-US')} sf` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    placeOf = (l: PropertyListing) =>
      [l.neighborhood, l.address?.city].filter(Boolean).join(', ');
    heroOf = (l: PropertyListing) => l.photos?.resolvedUrls?.[0];

    openCard = (card: CardDef) => {
      (this.args as any).viewCard?.(card, 'isolated');
    };

    newListing = () => {
      let ref = identifyCard(PropertyListing);
      let realm = this.realms?.[0];
      if (!ref || !realm) {
        return;
      }
      (this.args as any).createCard?.(ref, undefined, {
        realmURL: new URL(realm),
        doc: {
          data: {
            attributes: { status: 'draft' },
            meta: { adoptsFrom: ref },
          },
        },
      });
    };

    <template>
      <div class='market'>
        <header class='bar'>
          <div>
            <p class='kicker'>Residential · listing desk</p>
            <h1>Property Marketplace</h1>
          </div>
          {{#if this.isInteractive}}
            <button type='button' class='cta' {{on 'click' this.newListing}}>
              + New Listing
            </button>
          {{/if}}
        </header>

        {{#if this.isInteractive}}
          <section class='hero'>
            <div class='hero-main'>
              <p class='hero-label'>Value on the market</p>
              <p class='hero-number'>{{this.valueOnMarket}}</p>
              <p class='hero-sub'>across
                {{this.onMarket.length}}
                live listing{{if (eq this.onMarket.length 1) '' 's'}}</p>
            </div>
            <dl class='hero-side'>
              <div class='hero-stat'>
                <dt>Active</dt>
                <dd>{{this.activeCount}}</dd>
              </div>
              <div class='hero-stat'>
                <dt>Under offer</dt>
                <dd>{{this.underOfferCount}}</dd>
              </div>
              <div class='hero-stat'>
                <dt>Avg days on market</dt>
                <dd>{{if this.avgDom this.avgDom '—'}}</dd>
              </div>
            </dl>
          </section>

          <section class='pipeline' aria-label='Listing pipeline'>
            {{#each this.ladder as |status|}}
              <button
                type='button'
                class='stage {{if (eq this.statusFilter status) "on"}}'
                {{on 'click' (fn this.setFilter status)}}
              >
                <span class='stage-count'>{{this.countOf status}}</span>
                <span class='stage-label'>{{this.labelOf status}}</span>
              </button>
            {{/each}}
            <span class='pipeline-exits'>
              {{#each this.exits as |status|}}
                <button
                  type='button'
                  class='exit {{if (eq this.statusFilter status) "on"}}'
                  {{on 'click' (fn this.setFilter status)}}
                >{{this.countOf status}} {{this.labelOf status}}</button>
              {{/each}}
            </span>
          </section>

          <div class='cols'>
            <section class='book'>
              <div class='book-bar'>
                <button
                  type='button'
                  class='pill {{if (eq this.statusFilter "all") "on"}}'
                  {{on 'click' (fn this.setFilter 'all')}}
                >All ({{this.listings.length}})</button>
                <input
                  class='search'
                  type='search'
                  placeholder='Search address, city, neighborhood…'
                  value={{this.search}}
                  {{on 'input' this.setSearch}}
                />
                <label class='sort'>
                  Sort
                  <select {{on 'change' this.setSort}}>
                    <option
                      value='newest'
                      selected={{eq this.sortKey 'newest'}}
                    >Newest</option>
                    <option value='dom' selected={{eq this.sortKey 'dom'}}>
                      Days on market</option>
                    <option
                      value='price'
                      selected={{eq this.sortKey 'price'}}
                    >Price</option>
                  </select>
                </label>
              </div>

              {{#if this.visible.length}}
                <ul class='rows'>
                  {{#each this.visible as |l|}}
                    <li>
                      <button
                        type='button'
                        class='row'
                        {{on 'click' (fn this.openCard l)}}
                      >
                        {{#if (this.heroOf l)}}
                          <img class='row-img' src={{this.heroOf l}} alt='' />
                        {{else}}
                          <span class='row-img row-img-empty'>—</span>
                        {{/if}}
                        <span class='row-who'>
                          <span class='row-name'>{{l.cardTitle}}</span>
                          <span class='row-meta'>{{this.placeOf l}}
                            {{#if (this.factsOf l)}}· {{this.factsOf l}}{{/if}}
                          </span>
                        </span>
                        <span class='row-price'>{{this.priceOf l}}</span>
                        <span class='row-dom'>
                          {{#if l.daysOnMarket}}{{l.daysOnMarket}}d{{/if}}
                        </span>
                        <span
                          class='row-status s-{{if l.status l.status "draft"}}'
                        >{{this.labelOf (if l.status l.status 'draft')}}</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='empty'>No listings match — clear the filter or
                  create the first listing.</p>
              {{/if}}
            </section>

            <aside class='attn'>
              <h2>Needs attention</h2>
              {{#if this.stale.length}}
                <h3>30+ days on market</h3>
                <ul class='attn-list'>
                  {{#each this.stale as |l|}}
                    <li>
                      <button
                        type='button'
                        class='attn-row warn'
                        {{on 'click' (fn this.openCard l)}}
                      >
                        <span class='attn-name'>{{l.cardTitle}}</span>
                        <span class='attn-tag'>{{this.domOf l}}d — consider a
                          price move</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              {{/if}}
              {{#if this.unprepared.length}}
                <h3>Drafts missing photos or price</h3>
                <ul class='attn-list'>
                  {{#each this.unprepared as |l|}}
                    <li>
                      <button
                        type='button'
                        class='attn-row'
                        {{on 'click' (fn this.openCard l)}}
                      >
                        <span class='attn-name'>{{l.cardTitle}}</span>
                        <span class='attn-tag'>not ready to publish</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              {{/if}}
              {{#unless this.stale.length}}
                {{#unless this.unprepared.length}}
                  <p class='attn-quiet'>Nothing waiting. The market is
                    yours.</p>
                {{/unless}}
              {{/unless}}
            </aside>
          </div>
        {{else}}
          <section class='shell'>
            <p class='hero-label'>Value on the market</p>
            <p class='hero-number'>—</p>
            <p class='hero-sub'>Open the app to load the live book.</p>
          </section>
        {{/if}}
      </div>
      <style scoped>
        .market {
          /* the marketplace brand pair, declared once (§4a): navy ground,
             slate surfaces, gold accents — overridable per theme */
          --pm-bg: var(--marketplace-navy, #1a2234);
          --pm-surface: var(--marketplace-surface, #334155);
          --pm-gold: var(--marketplace-gold, #d4a84b);
          --pm-ink: var(--marketplace-ink, #ffffff);
          --pm-muted: var(--marketplace-muted, #94a3b8);
          --pm-line: color-mix(in oklch, var(--pm-muted) 25%, transparent);

          container-type: inline-size;
          min-height: 100%;
          background: var(--pm-bg);
          color: var(--pm-ink);
          font-family: var(--font-sans, inherit);
          padding: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp);
          align-content: start;
        }
        .bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--pm-muted);
        }
        h1 {
          margin: 2px 0 0;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .cta {
          border: 0;
          border-radius: var(--radius, var(--boxel-border-radius));
          background: var(--pm-gold);
          color: var(--pm-bg);
          font: inherit;
          font-weight: 700;
          padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          cursor: pointer;
        }
        .cta:hover {
          filter: brightness(1.08);
        }
        .hero,
        .shell {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: var(--boxel-sp-xl);
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: color-mix(in oklch, var(--pm-surface) 45%, transparent);
          padding: var(--boxel-sp-lg);
        }
        .hero-label {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--pm-muted);
        }
        .hero-number {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: 2.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .hero-sub {
          margin: var(--boxel-sp-5xs) 0 0;
          color: var(--pm-muted);
          font-size: 0.875rem;
        }
        .hero-side {
          display: flex;
          gap: var(--boxel-sp-lg);
          margin: 0;
        }
        .hero-stat dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--pm-muted);
        }
        .hero-stat dd {
          margin: 2px 0 0;
          font-size: 1.375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pipeline {
          display: flex;
          align-items: stretch;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .stage {
          flex: 1 1 7rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
        }
        .stage.on,
        .exit.on {
          border-color: var(--pm-gold);
          background: color-mix(in oklch, var(--pm-gold) 12%, transparent);
        }
        .stage-count {
          font-size: 1.25rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .stage-label {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--pm-muted);
        }
        .pipeline-exits {
          display: flex;
          flex-direction: column;
          gap: 4px;
          justify-content: center;
        }
        .exit {
          border: 0;
          background: none;
          color: var(--pm-muted);
          font: inherit;
          font-size: 0.75rem;
          cursor: pointer;
          text-align: left;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .cols {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 17rem;
          gap: var(--boxel-sp);
          align-items: start;
        }
        .book {
          display: grid;
          gap: var(--boxel-sp-sm);
          min-width: 0;
        }
        .book-bar {
          display: flex;
          gap: var(--boxel-sp-xs);
          align-items: center;
          flex-wrap: wrap;
        }
        .pill {
          border: 1px solid var(--pm-line);
          border-radius: 999px;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 0.8125rem;
          padding: 4px 12px;
          cursor: pointer;
        }
        .pill.on {
          border-color: var(--pm-gold);
          color: var(--pm-gold);
        }
        .search {
          flex: 1 1 12rem;
          min-width: 0;
          background: color-mix(in oklch, var(--pm-surface) 55%, transparent);
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          color: inherit;
          font: inherit;
          font-size: 0.875rem;
          padding: 6px 10px;
        }
        .search::placeholder {
          color: var(--pm-muted);
        }
        .sort {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          color: var(--pm-muted);
        }
        .sort select {
          background: color-mix(in oklch, var(--pm-surface) 55%, transparent);
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          color: var(--pm-ink);
          font: inherit;
          font-size: 0.8125rem;
          padding: 4px 8px;
        }
        .rows {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .row {
          width: 100%;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto auto auto;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: color-mix(in oklch, var(--pm-surface) 35%, transparent);
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .row:hover {
          border-color: color-mix(in oklch, var(--pm-gold) 55%, transparent);
        }
        .row-img {
          width: 64px;
          height: 44px;
          object-fit: cover;
          border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        }
        .row-img-empty {
          display: grid;
          place-items: center;
          background: color-mix(in oklch, var(--pm-surface) 70%, transparent);
          color: var(--pm-muted);
        }
        .row-who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .row-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-meta {
          font-size: 0.75rem;
          color: var(--pm-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-price {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .row-dom {
          font-size: 0.75rem;
          color: var(--pm-muted);
          font-variant-numeric: tabular-nums;
          min-width: 2.25rem;
          text-align: right;
        }
        .row-status {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid var(--pm-line);
          color: var(--pm-muted);
        }
        .row-status.s-published {
          color: var(--pm-gold);
          border-color: color-mix(in oklch, var(--pm-gold) 55%, transparent);
        }
        .row-status.s-under-offer {
          color: var(--pm-ink);
          border-color: var(--pm-muted);
        }
        .empty {
          margin: 0;
          padding: var(--boxel-sp-xl);
          text-align: center;
          color: var(--pm-muted);
          border: 1px dashed var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
        }
        .attn {
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: color-mix(in oklch, var(--pm-surface) 45%, transparent);
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-xs);
          align-content: start;
        }
        .attn h2 {
          margin: 0;
          font-size: 0.75rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--pm-muted);
        }
        .attn h3 {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: 0.8125rem;
          font-weight: 600;
        }
        .attn-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 4px;
        }
        .attn-row {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          border: 1px solid var(--pm-line);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          padding: var(--boxel-sp-xs);
          cursor: pointer;
        }
        .attn-row.warn {
          border-color: color-mix(in oklch, var(--pm-gold) 45%, transparent);
        }
        .attn-name {
          font-size: 0.8125rem;
          font-weight: 600;
        }
        .attn-tag {
          font-size: 0.6875rem;
          color: var(--pm-muted);
        }
        .attn-quiet {
          margin: 0;
          font-size: 0.8125rem;
          font-style: italic;
          color: var(--pm-muted);
        }
        @container (max-width: 760px) {
          .cols {
            grid-template-columns: 1fr;
          }
          .hero,
          .shell {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };
}
