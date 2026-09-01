import {
  CardDef,
  field,
  contains,
  Component,
  StringField,
  realmURL,
} from '@cardstack/base/card-api';
import { identifyCard } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { debounce } from 'lodash-es';
import {
  BoxelInput,
  Button,
  LoadingIndicator,
  Pill,
  ProgressBar,
  ViewSelector,
  type ViewItem,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { StatePill } from './components/state-pill';
// The pulled catalogue panel, consumed for the Market tab — search + view
// switcher + prerendered-fitted grid + shared Table, all in one block, which
// is what retired this file's hand-drawn listing rows.
import { CollectionPanel } from './components/collection-panel';
// The shared record table, pulled from the matrix realm and consumed unchanged.
//
// NOTE FOR THE NEXT READER: this is NOT the schema-driven table that
// `boxel-search-with-filter` §7.2c describes. Its own header states the split —
// `fulfilment-table` takes a `Query` + `cardTypeRef` and derives its own columns;
// THIS one takes resolved instances and an explicit column list, so the consumer
// decides what a row shows. Consequences, all verified against the copy in this
// realm: it has zero relative imports (so none of §7.2c's "copy the siblings"
// applies), no `@cardstack/runtime-common` imports (so the
// `codeRefWithAbsoluteURL` staleness trap cannot bite), and no `@showClean` /
// `[linked card]` bugs because it renders no field components at all — columns
// declare a `value:` accessor returning a primitive.
import { Table, type TableColumn } from './table';
import ArchiveIcon from '@cardstack/boxel-icons/archive';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import LayoutListIcon from '@cardstack/boxel-icons/layout-list';
import TableIcon from '@cardstack/boxel-icons/table';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';
import PlusIcon from '@cardstack/boxel-icons/plus';
import { CollectionItem } from './collection-item';
import { CollectibleProduct } from './collectible-product';
import { CompletionSet, computeCompletion } from './completion-set';
import { Listing } from './listing';
import {
  AuthenticationRecord,
  AuthOutcomeField,
} from './authentication-record';
import { Order, OrderStatusField } from './sole-vault-order';
import { Offer } from './sole-vault-offer';
import { statusOption } from './status-field';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import LockIcon from '@cardstack/boxel-icons/lock';
import { formatMoney } from './money-format';

// SoleVaultApp — stage 2. The app exists to prove the blocks compose, so its
// rule is: consume them UNCHANGED. Nothing here reimplements a block, overrides a
// block's internals with app CSS, or hand-rolls something a block should own.
//
// COMPOSABLE TALLY (the app's actual job — what composed vs what stayed bespoke):
//
//   CONSUMED UNCHANGED
//     CollectionItem, CollectibleProduct, CompletionSet, Listing,
//     AuthenticationRecord ...... all five as live queries; every value the rows
//                                 render is a plain attribute or one of the
//                                 blocks' denormalized computed fields, so no
//                                 block was modified to make the app work
//     computeCompletion() ....... set progress arithmetic, imported not re-derived
//     formatMoney() ............. every amount on this page
//     boxel-ui .................. BoxelInput (@type='search'), Pill, Button
//
//   BESPOKE, AND WHY
//     the tab shell + toolbar ... app chrome, which is the app's own job
//     the stat strip ............ app-level aggregate across blocks
//     the row/cell faces ........ THE ONE TO FIX. The panes read fields off each
//                                instance (the pattern this realm uses for
//                                live-query results), so the blocks' own fitted
//                                templates are not what the grid shows. The
//                                upstream move is `@context.searchResultsComponent`
//                                fed a wire query, which renders prerendered
//                                fitted — the block's real face — and brings the
//                                overlay and click-to-open for free. Recorded
//                                rather than hidden, because a hand-drawn row is
//                                exactly the block-shaped code this stage is
//                                supposed to stop accumulating.
//
//   HONEST GAPS pushed upstream rather than papered over
//     Order / Payment / Offer /
//     Shipment .................. NOW CONSUMED (2026-08-26). Built in this realm
//                                as Wave 1 and pulled in the same way as the
//                                original five — `liveQuery(Order)` is one line,
//                                and the Orders pane renders only plain
//                                attributes plus Order's own denormalized
//                                computed fields (`productTitle`, `sellerName`),
//                                so no block was modified to make the app work.
//                                The status LABEL and HUE come from the block's
//                                exported `OrderStatusField` via `statusOption`,
//                                so eight statuses are never hand-mapped to eight
//                                colours here.
//                                Still absent by design: a Buy button. Placing an
//                                order is a COMMAND, and the command does not
//                                exist yet — see the no-lying-affordances rule.
//     Table view ................ needs matrix `table.gts` pulled in with its
//                                paginator/field-renderer siblings.
//     PlaceOrder / RefundOrder /
//     MarkDelivered ............. unbuilt commands, so there is deliberately no
//                                button for them here (see below).
//
// NO LYING AFFORDANCES. Every control on this page either navigates to a real
// card or changes a real filter. There is no "Buy now", no "Submit for
// authentication" and no checkout button, because the commands behind them do not
// exist yet — a control that looks live and no-ops teaches the user to distrust
// every other control. The stat tiles are deliberately static text, not fake
// links: a metric is clickable only if its destination shows the records the
// number was computed from, pre-filtered.

type TabId = 'collection' | 'sets' | 'market' | 'orders' | 'authentication';

class Isolated extends Component<typeof SoleVaultApp> {
  @tracked tab: TabId = 'collection';
  @tracked search = '';
  @tracked saleFilter: 'all' | 'for-sale' | 'kept' = 'all';

  // Exactly three views — grid, list, table. `card` is deliberately absent:
  // boxel-ui offers it, but it renders the card's EMBEDDED template into a row
  // envelope, which squeezes a template written for a tall envelope into a short
  // row and clips its own text.
  //
  // Grid and list share one renderer and one row set; only `table` is a different
  // layer. Switching views changes the DRAWING ONLY — never the row set, the
  // search text or the active badge — because all three read `filteredItems`.
  // That is the mirroring rule, and here it is structural rather than maintained:
  // there is one filter, so the views cannot disagree.
  @tracked view: 'grid' | 'list' | 'table' = 'grid';

  viewItems: ViewItem[] = [
    { id: 'grid', icon: LayoutGridIcon },
    { id: 'list', icon: LayoutListIcon },
    { id: 'table', icon: TableIcon },
  ];

  @action setView(id: string) {
    this.view = id as 'grid' | 'list' | 'table';
  }

  // Explicit columns, because "which of a card's twenty fields belong in the
  // table" is a design decision. Each declares a `value:` accessor returning a
  // primitive — every one of these is a plain attribute or a denormalized
  // computed field, so no cell needs link resolution.
  get itemColumns(): TableColumn[] {
    return [
      {
        key: 'itemTitle',
        label: 'Pair',
        sortable: true,
        value: (i: any) => i.itemTitle,
      },
      {
        key: 'variantLabel',
        label: 'Size',
        width: '7rem',
        sortable: true,
        value: (i: any) => i.variantLabel,
      },
      {
        key: 'condition',
        label: 'Condition',
        width: '8rem',
        showAbove: 640,
        sortable: true,
        value: (i: any) => i.condition?.code,
      },
      {
        key: 'paid',
        label: 'Paid',
        align: 'right',
        width: '8rem',
        showAbove: 720,
        sortable: true,
        // sortValue keeps the numeric order — sorting the FORMATTED string would
        // order "$1,000.00" before "$90.00" because it compares character by
        // character.
        value: (i: any) => formatMoney(i.acquisition?.price),
        sortValue: (i: any) => i.acquisition?.price?.amount ?? null,
      },
      {
        key: 'worth',
        label: 'Worth',
        align: 'right',
        width: '8rem',
        sortable: true,
        value: (i: any) => formatMoney(i.lastKnownValue),
        sortValue: (i: any) => i.lastKnownValue?.amount ?? null,
      },
      {
        key: 'state',
        label: 'State',
        width: '9rem',
        showAbove: 480,
        value: (i: any) =>
          [i.verified ? 'Verified' : null, i.forSale ? 'For sale' : null]
            .filter(Boolean)
            .join(' · ') || null,
      },
    ];
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get realmHrefs() {
    let realm = this.currentRealm;
    return realm ? [realm.href] : [];
  }

  // Prerender gets a STATIC SHELL. The interactive panes are gated on a CRUD
  // function actually being present, which keeps indexing light and avoids the
  // known Glimmer backtracking assertion when an app card mounts themed fitted
  // cards during prerender (that stores an error_doc and surfaces as "Card
  // Error" in the app).
  get isInteractive() {
    return Boolean((this.args as any).viewCard);
  }

  private liveQuery(cardClass: any) {
    return this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(cardClass);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realmHrefs,
      { isLive: true },
    );
  }

  // One factory, five collections — each is one line, and none can drift from
  // its type because identifyCard derives the CodeRef from the class itself.
  itemsQuery = this.liveQuery(CollectionItem);
  productsQuery = this.liveQuery(CollectibleProduct);
  setsQuery = this.liveQuery(CompletionSet);
  listingsQuery = this.liveQuery(Listing);
  authQuery = this.liveQuery(AuthenticationRecord);
  // Wave 1 commerce blocks, consumed the same way as the original five — one
  // line each, no block modified to make the app work. This is what closes the
  // "Order/Payment are Done+Spec but the app never pulled them" gap the header
  // note recorded.
  ordersQuery = this.liveQuery(Order);
  offersQuery = this.liveQuery(Offer);

  // Read through a getter that drops dead slots. A deleted target leaves its
  // slot in place, so a raw `.length` counts records that no longer exist.
  get items(): any[] {
    return (this.itemsQuery?.instances ?? []).filter(Boolean);
  }
  get products(): any[] {
    return (this.productsQuery?.instances ?? []).filter(Boolean);
  }
  get sets(): any[] {
    return (this.setsQuery?.instances ?? []).filter(Boolean);
  }
  get listings(): any[] {
    return (this.listingsQuery?.instances ?? []).filter(Boolean);
  }
  get authRecords(): any[] {
    return (this.authQuery?.instances ?? []).filter(Boolean);
  }

  // Label and hue from AuthOutcomeField's own option list — same rule as
  // orderRows: the app never hand-maps outcomes to colours, so the queue's
  // chips cannot drift from the block's.
  get authRows() {
    let rows = this.authRecords.map((a) => {
      let opt = statusOption(AuthOutcomeField, a?.outcome);
      return {
        card: a,
        itemTitle: a?.itemTitle,
        service: a?.service,
        turnaroundDays: a?.turnaroundDays,
        outcomeLabel: opt?.label ?? a?.outcome,
        outcomeHue: opt?.hue,
        photoUrl: a?.submittedPhotos?.primaryUrl,
        certificateId: a?.certificateId,
        authenticator: a?.authenticator,
        pending: a?.outcome === 'pending',
      };
    });
    // A queue, not an archive: the record still awaiting a verdict is the
    // one the owner opened this tab for, so it sorts to the top.
    return [...rows.filter((r) => r.pending), ...rows.filter((r) => !r.pending)];
  }
  get orders(): any[] {
    return (this.ordersQuery?.instances ?? []).filter(Boolean);
  }
  get offers(): any[] {
    return (this.offersQuery?.instances ?? []).filter(Boolean);
  }

  // Money currently held in escrow, summed across orders whose status the graph
  // marks as holding. Computed here rather than stored on any card: it is an
  // app-level aggregate across records, which is the app's own job.
  get escrowHeldLabel(): string {
    let sum = 0;
    let currency: any = null;
    for (let o of this.orders) {
      if (o?.fundsHeld && o?.total?.amount != null) {
        sum += o.total.amount;
        currency = currency ?? o.total.currency;
      }
    }
    return sum === 0 ? '' : formatMoney({ amount: sum, currency });
  }

  // Rows precomputed here rather than reaching for getters that do not exist on
  // the card. The status LABEL and HUE come from the block's own exported
  // option list via `statusOption`, so the app never hand-maps eight statuses to
  // eight colours — one definition, in the block.
  get orderRows() {
    return this.orders.map((o) => {
      let opt = statusOption(OrderStatusField, o?.orderStatus);
      return {
        card: o,
        reference: o?.reference,
        productTitle: o?.productTitle,
        statusLabel: opt?.label ?? o?.orderStatus,
        statusHue: opt?.hue,
        total: formatMoney(o?.total),
      };
    });
  }

  get openOffersCount(): number {
    return this.offers.filter((o) => o?.isOpen).length;
  }

  // --- the owner's product ids, which is what set completion intersects with ---
  get ownedProductIds(): Set<string> {
    let ids = new Set<string>();
    for (let item of this.items) {
      let id = item?.item?.id;
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  }

  // --- aggregates. Computed here, never stored on a card. ---
  get collectionValue() {
    let total = 0;
    let currency: any = null;
    for (let item of this.items) {
      let v = item?.lastKnownValue;
      if (v?.amount != null) {
        total += v.amount;
        currency = currency ?? v.currency;
      }
    }
    return total === 0 ? '' : formatMoney({ amount: total, currency });
  }

  get forSaleCount() {
    return this.items.filter((i) => i?.forSale).length;
  }

  get verifiedCount() {
    return this.items.filter((i) => i?.verified).length;
  }

  get activeListings() {
    return this.listings.filter((l) => l?.listingStatus === 'active');
  }

  // Set progress uses the block's own exported arithmetic — the app does not
  // re-derive it, which is what keeps one definition of "80% complete".
  get setProgress() {
    let owned = this.ownedProductIds;
    return this.sets.map((s) => {
      let ids = (s?.products ?? []).map((p: any) => p?.id);
      let result = computeCompletion(ids, owned);
      // No styleWidth here any more: the meter is boxel-ui's ProgressBar, which
      // owns its own fill width, so the app no longer hand-builds a style
      // string for it. `result.percent` is passed as @value instead.
      return {
        set: s,
        result,
        coverUrl: s?.coverImage?.resolvedUrl,
        // A finished goal renders a chip, not a bar — a 100% meter carries no
        // information, and three full amber stripes stacked was the pane's
        // whole problem.
        complete:
          result.targetCount > 0 && result.missingProductIds.length === 0,
      };
    });
  }

  // --- filtering. Client-side over resolved instances, because these panes need
  // real JS over fields. Named predicates then &&, so a three-criteria filter
  // stays reviewable. ---
  // The panes' live queries share one loading/error read. An unresolved
  // query MUST NOT render the empty message — "No pairs match this filter"
  // while the realm is still answering is a false statement, and a failed
  // query rendered as an empty vault sends the owner to re-create records
  // that exist. Coarse on purpose: the queries resolve together against one
  // realm, and a glance surface needs one honest answer, not five spinners.
  get vaultLoading() {
    return [
      this.itemsQuery,
      this.setsQuery,
      this.listingsQuery,
      this.ordersQuery,
      this.authQuery,
    ].some((q) => Boolean(q) && !q?.instances);
  }

  get vaultError(): string | undefined {
    for (let q of [
      this.itemsQuery,
      this.setsQuery,
      this.listingsQuery,
      this.ordersQuery,
      this.authQuery,
    ]) {
      let message = (q as any)?.errors?.[0]?.message;
      if (message) {
        return message;
      }
    }
    return undefined;
  }

  private matchesText(haystack: (string | undefined)[]) {
    let q = this.search.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return haystack.some((h) => h?.toLowerCase().includes(q));
  }

  get filteredItems() {
    return this.items.filter((i) => {
      let saleOk =
        this.saleFilter === 'all' ||
        (this.saleFilter === 'for-sale' ? Boolean(i?.forSale) : !i?.forSale);
      let textOk = this.matchesText([
        i?.itemTitle,
        i?.variantLabel,
        i?.condition?.code,
        i?.packaging,
      ]);
      return saleOk && textOk;
    });
  }

  // Market pane scope, handed to CollectionPanel's `extraFilter` so grid,
  // strip and table all read the identical active-only query. Anchored with
  // `on:` — an `eq` on a field CardDef does not carry resolves against
  // CardDef without it and the request 500s (same rule as the reverse
  // queries).
  get activeListingFilter() {
    let ref = identifyCard(Listing);
    return ref
      ? ({ on: ref, eq: { listingStatus: 'active' } } as any)
      : undefined;
  }

  // Table columns for the market pane's table view. Keys are read straight
  // off the resolved Listing instance — plain attributes and the block's own
  // denormalized computed fields only, per the consume-unchanged rule.
  get listingColumns(): TableColumn[] {
    return [
      {
        key: 'productTitle',
        label: 'Listing',
        sortable: true,
        value: (l: any) => l.productTitle,
      },
      {
        key: 'variantLabel',
        label: 'Size',
        width: '7rem',
        sortable: true,
        value: (l: any) => l.variantLabel,
      },
      {
        key: 'conditionCode',
        label: 'Condition',
        width: '8rem',
        showAbove: 640,
        sortable: true,
        value: (l: any) => l.conditionCode,
      },
      {
        key: 'price',
        label: 'Price',
        width: '7rem',
        align: 'end',
        sortable: true,
        value: (l: any) => formatMoney(l.price),
      },
    ];
  }

  // 'all' is index 0, always — the row starts from the widest set and narrows
  // left to right, and the reset is where it can be found without reading.
  get saleBadges() {
    return [
      { id: 'all' as const, label: 'All', count: this.items.length },
      {
        id: 'for-sale' as const,
        label: 'For sale',
        count: this.forSaleCount,
      },
      {
        id: 'kept' as const,
        label: 'Kept',
        count: this.items.length - this.forSaleCount,
      },
    ];
  }

  get tabs() {
    return [
      {
        id: 'collection' as const,
        label: 'Collection',
        count: this.items.length,
      },
      { id: 'sets' as const, label: 'Sets', count: this.sets.length },
      {
        id: 'market' as const,
        label: 'Market',
        count: this.activeListings.length,
      },
      // Orders sits between Market and Authentication because that is the order
      // of the actual flow: browse, buy, then the check that releases the money.
      {
        id: 'orders' as const,
        label: 'Orders',
        count: this.orders.length,
      },
      {
        id: 'authentication' as const,
        label: 'Authentication',
        count: this.authRecords.length,
      },
    ];
  }

  @action setTab(id: TabId) {
    this.tab = id;
  }

  @action setSaleFilter(id: 'all' | 'for-sale' | 'kept') {
    this.saleFilter = id;
  }

  // Debounce the ASSIGNMENT to tracked state, not the input's own value — the
  // field must feel immediate; it is the filtering that waits.
  private debouncedSearch = debounce((v: string) => {
    this.search = v;
  }, 250);

  @action setSearch(v: string) {
    this.debouncedSearch(v);
  }

  // CRUD rides on component args, not context.actions — the wrong path silently
  // no-ops rather than erroring.
  @action open(card: any) {
    (this.args as any).viewCard?.(card, 'isolated');
  }

  @action addCollectionItem() {
    let ref = identifyCard(CollectionItem);
    let realm = this.currentRealm;
    if (!ref || !realm) {
      return;
    }
    (this.args as any).createCard?.(ref, undefined, { realmURL: realm });
  }

  @action addSet() {
    let ref = identifyCard(CompletionSet);
    let realm = this.currentRealm;
    if (!ref || !realm) {
      return;
    }
    (this.args as any).createCard?.(ref, undefined, { realmURL: realm });
  }

  <template>
    <article class='vault'>
      {{! Split-screen shell: a sticky identity rail on the left (brand,
          value plaque, ledger, vertical section nav), the content stage on
          the right. The rail is what breaks the templated
          masthead-tabs-content stack; under 860px it folds back on top.
          `.frame` exists because `.vault` IS the container and a container
          cannot be laid out by its own query. }}
      <div class='frame'>
        <aside class='rail'>
          <div class='brand'>
            <ArchiveIcon class='plaque-glyph' aria-hidden='true' />
            <h1 class='wordmark'>{{if
                @model.cardTitle
                @model.cardTitle
                'Sole Vault'
              }}</h1>
            <p class='tagline'>{{if
                @model.tagline
                @model.tagline
                'Your collection is your storefront'
              }}</p>
          </div>

          {{! Static figures, deliberately not links — see the
              no-lying-affordances note at the top of this module. }}
          <dl class='ledger'>
            <div class='ledger-hero'>
              <dt>Collection value</dt>
              <dd>{{if this.collectionValue this.collectionValue '—'}}</dd>
            </div>
            <div class='ledger-facts'>
              <div class='fact'>
                <dt>Pairs</dt>
                <dd>{{this.items.length}}</dd>
              </div>
              <div class='fact'>
                <dt>Authenticated</dt>
                <dd>{{this.verifiedCount}}</dd>
              </div>
              <div class='fact'>
                <dt>Listed</dt>
                <dd>{{this.forSaleCount}}</dd>
              </div>
            </div>
          </dl>

          <nav class='tabs' aria-label='Sections'>
            {{#each this.tabs as |t|}}
              <button
                type='button'
                class='tab {{if (eq this.tab t.id) "tab--on"}}'
                aria-pressed='{{eq this.tab t.id}}'
                {{on 'click' (fn this.setTab t.id)}}
              ><span class='tab-label'>{{t.label}}</span><span
                  class='tab-n'
                >{{t.count}}</span></button>
            {{/each}}
          </nav>
        </aside>

        <main class='stage'>
          {{#if this.isInteractive}}
        {{#if (eq this.tab 'collection')}}
          <section class='pane pane--collection'>
            <div class='toolbar'>
              <div class='toolbar-left'>
                <div class='search'>
                  <BoxelInput
                    @type='search'
                    @value={{this.search}}
                    @onInput={{this.setSearch}}
                    @placeholder='Search your collection'
                    autocomplete='off'
                  />
                </div>
                <div class='badges'>
                  {{#each this.saleBadges as |b|}}
                    <Pill
                      @kind='button'
                      @variant={{if
                        (eq this.saleFilter b.id)
                        'primary'
                        'muted'
                      }}
                      aria-pressed='{{eq this.saleFilter b.id}}'
                      {{on 'click' (fn this.setSaleFilter b.id)}}
                    >{{b.label}}
                      <span class='b-n'>{{b.count}}</span></Pill>
                  {{/each}}
                </div>
              </div>
              <div class='toolbar-right'>
                <ViewSelector
                  @items={{this.viewItems}}
                  @selectedId={{this.view}}
                  @onChange={{this.setView}}
                />
                <Button
                  @kind='primary'
                  @size='small'
                  {{on 'click' this.addCollectionItem}}
                >
                  <PlusIcon width='16' height='16' role='presentation' />
                  Add Item
                </Button>
              </div>
            </div>

            {{#if this.vaultError}}
              <p class='empty' role='alert'>
                <ArchiveIcon width='22' height='22' aria-hidden='true' />
                The vault could not load: {{this.vaultError}}
              </p>
            {{else if this.vaultLoading}}
              <p class='empty' role='status'><LoadingIndicator />Opening the
                vault…</p>
            {{else if this.filteredItems.length}}
              {{#if (eq this.view 'table')}}
                {{! Same `filteredItems` the grid and list read — one filter, so
                    the three views cannot show different row counts. }}
                <div class='table-wrap'>
                  <Table
                    @columns={{this.itemColumns}}
                    @items={{this.filteredItems}}
                    @onRowClick={{this.open}}
                    @rowKey='id'
                    @pageSize={{25}}
                    @caption='Your collection'
                    @emptyMessage='No pairs match this filter.'
                  />
                </div>
              {{else}}
                <ul class='wall {{if (eq this.view "list") "wall--list"}}'>
                  {{#each this.filteredItems as |item|}}
                    <li>
                      <button
                        type='button'
                        class='tile'
                        {{on 'click' (fn this.open item)}}
                      >
                        {{! THE SNEAKER WALL — spec's own aesthetic anchor: the
                            collection reads as a curated store, not a
                            spreadsheet, which means the photo leads. Falls back
                            to a quiet glyph rather than leaving a blank tile
                            when an item has no photo yet. }}
                        <div class='tile-thumb'>
                          {{#if item.photos.primaryUrl}}
                            <img
                              src={{item.photos.primaryUrl}}
                              alt=''
                              loading='lazy'
                            />
                          {{else}}
                            <ArchiveIcon
                              class='tile-thumb-icon'
                              width='24'
                              height='24'
                              aria-hidden='true'
                            />
                          {{/if}}
                        </div>
                        <div class='tile-body'>
                          {{! Fields read straight off the instance — the pattern this
                            realm actually uses for live-query results (see
                            client-filter-playground.gts). Every value here is a
                            plain attribute or a denormalized computed field, which
                            is why the row needs no link resolution. }}
                          <span class='tile-title'>{{item.itemTitle}}</span>
                          <span class='tile-meta'>
                            {{#if item.variantLabel}}<span
                              >{{item.variantLabel}}</span>{{/if}}
                            {{#if item.condition.code}}<span
                                class='tile-grade'
                              >{{item.condition.code}}</span>{{/if}}
                          </span>
                          {{! StatePill (the realm's own Pill wrapper), not
                              hand-rolled chip spans. It derives its dilution from
                              the SAME hue and from the card's own
                              --card/--card-foreground pair, at percentages that
                              were contrast-checked against every hue — which a
                              hand-tuned color-mix toward `transparent` is not, and
                              which does not follow a linked theme. }}
                          <span class='tile-foot'>
                            {{#if item.verified}}
                              <StatePill @label='Verified' @hue='green' />
                            {{/if}}
                            {{#if item.forSale}}
                              <StatePill @label='For sale' @hue='amber' />
                            {{/if}}
                          </span>
                        </div>
                        {{! The STATIC open cue. A :hover rule alone only pays out
                            after the pointer has arrived, and the pointer only
                            arrives if something already suggested it should — so a
                            row that looks inert at rest never gets hovered. }}
                        <ChevronRightIcon
                          class='tile-open'
                          width='16'
                          height='16'
                          role='presentation'
                        />
                      </button>
                    </li>
                  {{/each}}
                </ul>
              {{/if}}
            {{else}}
              <p class='empty'>
                <ArchiveIcon width='22' height='22' aria-hidden='true' />
                {{if
                  this.items.length
                  'No pairs match this filter.'
                  'Nothing catalogued yet — add your first pair.'
                }}
              </p>
            {{/if}}
          </section>
        {{else if (eq this.tab 'sets')}}
          <section class='pane pane--sets'>
            <div class='toolbar'>
              <div class='toolbar-left'><h2 class='pane-h'>Completion goals</h2></div>
              <div class='toolbar-right'>
                <Button
                  @kind='primary'
                  @size='small'
                  {{on 'click' this.addSet}}
                >
                  <PlusIcon width='16' height='16' role='presentation' />
                  Add Set
                </Button>
              </div>
            </div>

            {{#if this.vaultError}}
              <p class='empty' role='alert'>
                <TargetArrowIcon width='22' height='22' aria-hidden='true' />
                Goals could not load: {{this.vaultError}}
              </p>
            {{else if this.vaultLoading}}
              <p class='empty' role='status'><LoadingIndicator />Checking the
                goals…</p>
            {{else if this.setProgress.length}}
              <ul class='ledger-list'>
                {{#each this.setProgress as |row|}}
                  <li class='goal'>
                    <button
                      type='button'
                      class='goal-head'
                      {{on 'click' (fn this.open row.set)}}
                    >
                      {{! The set's own cover as the row anchor; the target
                          glyph only stands in when no cover is recorded. }}
                      {{#if row.coverUrl}}
                        <img
                          class='goal-thumb'
                          src={{row.coverUrl}}
                          alt=''
                          loading='lazy'
                        />
                      {{else}}
                        <TargetArrowIcon
                          class='goal-glyph'
                          width='18'
                          height='18'
                          aria-hidden='true'
                        />
                      {{/if}}
                      {{! `cardTitle`, not the removed legacy `title` — the
                          latter reads undefined and the goal renders nameless. }}
                      <span class='goal-title'>{{row.set.cardTitle}}</span>
                      {{#if row.complete}}
                        <StatePill @label='Complete' @hue='green' />
                      {{/if}}
                      <span
                        class='goal-frac'
                      >{{row.result.ownedCount}}<span
                          class='goal-frac-slash'
                        >/{{row.result.targetCount}}</span></span>
                    </button>
                    {{! Progress is computed here from the block's own exported
                        function — the Set card never stored it. Drawn by
                        boxel-ui's ProgressBar rather than a hand-rolled meter:
                        it brings role='progressbar' with real
                        aria-valuenow/min/max, replacing the role='img' +
                        aria-label sentence this used to carry, and it owns its
                        own fill width so the app stops building style strings. }}
                    {{! aria-label attribute, NOT @label: ProgressBar renders
                        @label as VISIBLE text inside the bar, and this meter is
                        8px tall — the words shear straight across the track.
                        The splatted attribute still names the progressbar for
                        screen readers, which is all @label was here for.
                        Rendered only while the hunt is on: at 100% the bar
                        carries no information and the chip above says it. }}
                    {{#unless row.complete}}
                      <ProgressBar
                        class='meter'
                        @value={{row.result.percent}}
                        @max={{100}}
                        aria-label='Set completion'
                      />
                      <p class='goal-sub'>{{row.result.percent}}% complete ·
                        {{row.result.missingProductIds.length}}
                        still needed</p>
                    {{/unless}}
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>
                <TargetArrowIcon width='22' height='22' aria-hidden='true' />
                No goals yet — a set is how the hunt gets tracked.
              </p>
            {{/if}}
          </section>
        {{else if (eq this.tab 'market')}}
          {{! MARKET — the pulled CollectionPanel consumed as-built (its own
              search, view switcher, table and prerendered-fitted grid), which
              retires this pane's hand-drawn listing rows: the grid tiles ARE
              Listing's real fitted face, not an app re-drawing of it. Scoped
              to active listings through the panel's `extraFilter` arg (a
              sanctioned API addition — see the panel's own doc note), so all
              three views read the identical query. }}
          <section class='pane pane--market'>
            {{! @sortBy is REQUIRED here, not a tuning knob: the panel's
                default sort field is the legacy `title`, which cards no
                longer carry (it is `cardTitle` now) — and a sort naming a
                field the card does not have returns an EMPTY result on the
                prerendered grid/strip path, while the table's instances path
                tolerates it. That asymmetry rendered "No active listings
                yet" in grid view over the same three rows the table showed. }}
            <CollectionPanel
              @cardClass={{Listing}}
              @context={{@context}}
              @realms={{this.realmHrefs}}
              @label='Active listings'
              @searchPlaceholder='Search active listings'
              @newLabel='Listing'
              @defaultView='grid'
              @sortBy='productTitle'
              @extraFilter={{this.activeListingFilter}}
              @columns={{this.listingColumns}}
            />
          </section>
        {{else if (eq this.tab 'orders')}}
          {{! ORDERS — the app consuming the Wave 1 Order block unchanged. Every
              value in a row is a plain attribute or one of Order's own
              denormalized computed fields (`productTitle`, `sellerName`), so no
              row needs a link resolved. The escrow figure above is the app's own
              cross-record aggregate, which is the app's job rather than any
              card's. }}
          <section class='pane pane--orders'>
            <div class='toolbar'>
              <div class='toolbar-left'>
                <h2 class='pane-h'>Orders</h2>
                {{#if this.escrowHeldLabel}}
                  <span class='escrow'>
                    <LockIcon width='13' height='13' aria-hidden='true' />
                    {{this.escrowHeldLabel}}
                    <span class='escrow-k'>in escrow</span>
                  </span>
                {{/if}}
              </div>
            </div>

            {{#if this.vaultError}}
              <p class='empty' role='alert'>
                <ReceiptIcon width='22' height='22' aria-hidden='true' />
                Orders could not load: {{this.vaultError}}
              </p>
            {{else if this.vaultLoading}}
              <p class='empty' role='status'><LoadingIndicator />Fetching
                orders…</p>
            {{else if this.orderRows.length}}
              <ul class='ledger-rows'>
                {{#each this.orderRows as |r|}}
                  <li>
                    <button
                      type='button'
                      class='o-row'
                      {{on 'click' (fn this.open r.card)}}
                    >
                      <span class='cell-ref'>{{r.reference}}</span>
                      <span class='tile-title'>{{r.productTitle}}</span>
                      {{#if r.statusLabel}}
                        <StatePill
                          @label={{r.statusLabel}}
                          @hue={{r.statusHue}}
                        />
                      {{/if}}
                      <span class='cell-total'>{{r.total}}</span>
                      <ChevronRightIcon
                        class='tile-open'
                        width='16'
                        height='16'
                        role='presentation'
                      />
                    </button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>
                <ReceiptIcon width='22' height='22' aria-hidden='true' />
                No orders yet. An order is created when a buyer purchases an
                active listing.
              </p>
            {{/if}}
          </section>
        {{else}}
          <section class='pane pane--auth'>
            <h2 class='pane-h'>Authentication queue</h2>
            {{#if this.vaultError}}
              <p class='empty' role='alert'>
                <ShieldCheckIcon width='22' height='22' aria-hidden='true' />
                The queue could not load: {{this.vaultError}}
              </p>
            {{else if this.vaultLoading}}
              <p class='empty' role='status'><LoadingIndicator />Fetching the
                queue…</p>
            {{else if this.authRows.length}}
              {{! A wall of certificate plaques, not rows: each record IS a
                  certificate, so it renders as one — the submitted photo,
                  the verdict, and the mono certificate number a collector
                  quotes into a dispute. The record still awaiting a verdict
                  sorts first and wears the gold top rule unfinished (dashed):
                  the vault's mark for "in the authenticator's hands". }}
              <div class='cert-wall'>
                {{#each this.authRows as |a|}}
                  <button
                    type='button'
                    class='cert {{if a.pending "cert--pending"}}'
                    {{on 'click' (fn this.open a.card)}}
                  >
                    {{#if a.photoUrl}}
                      <img
                        class='cert-photo'
                        src={{a.photoUrl}}
                        alt=''
                        loading='lazy'
                      />
                    {{else}}
                      <span class='cert-photo cert-photo--glyph'>
                        <ShieldCheckIcon
                          width='28'
                          height='28'
                          aria-hidden='true'
                        />
                      </span>
                    {{/if}}
                    <span class='cert-body'>
                      {{#if a.outcomeLabel}}
                        <StatePill
                          @label={{a.outcomeLabel}}
                          @hue={{a.outcomeHue}}
                        />
                      {{/if}}
                      {{! The certificate number is the artifact — it gets the
                          display treatment. A pending check has none yet and
                          says so rather than sitting blank. }}
                      {{#if a.certificateId}}
                        <span class='cert-no'>{{a.certificateId}}</span>
                      {{else}}
                        <span class='cert-no cert-no--none'>awaiting
                          verdict</span>
                      {{/if}}
                      <span class='cert-item'>{{a.itemTitle}}</span>
                    </span>
                    <span class='cert-foot'>
                      {{#if a.service}}<span
                          class='cert-svc'
                        >{{a.service}}</span>{{/if}}
                      {{#if a.turnaroundDays}}<span
                          class='cert-turn'
                        >{{a.turnaroundDays}}</span>{{/if}}
                    </span>
                  </button>
                {{/each}}
              </div>
            {{else}}
              <p class='empty'>
                <ShieldCheckIcon width='22' height='22' aria-hidden='true' />
                No legit checks recorded.
              </p>
            {{/if}}
          </section>
        {{/if}}
          {{else}}
            {{! Static shell for prerender — see isInteractive. }}
            <p class='empty'>
              <ArchiveIcon width='22' height='22' aria-hidden='true' />
              Open this card to browse the vault.
            </p>
          {{/if}}
        </main>
      </div>
    </article>

    <style scoped>

      /* An isolated card has NO host container, so declaring one here is what
         makes the @container rules below live rather than inert. This file
         owns its own fixed visual identity — literal colour values, not
         theme tokens — so nothing here is meant to be swappable. */
      .vault {
        container-type: inline-size;
        container-name: vault;
        width: 100%;
        height: 100%;
        overflow-y: auto;

        /* --- palette: near-black warm stone ground, committed gold identity --- */
        --ink-950: var(--primary-foreground, oklch(0.216 0.006 56.04));
        --background: oklch(0.985 0.001 106.42);
        --ink-900: var(--background);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.147 0.004 49.25);
        --ink-800: var(--card);
        --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
        --foreground: oklch(0.147 0.004 49.25);
        --paper: var(--foreground);
        --muted: oklch(0.97 0.001 106.42);
        --secondary: oklch(0.923 0.003 48.72);
        --secondary-foreground: oklch(0.216 0.006 56.04);
        --input: oklch(1 0 0);
        --popover: oklch(1 0 0);
        --popover-foreground: oklch(0.147 0.004 49.25);
        --muted-foreground: oklch(0.553 0.013 58.07);
        --smoke: var(--muted-foreground);
        --border: oklch(0.869 0.005 56.37);
        --hairline: color-mix(in oklch, var(--border) 55%, transparent);
        --primary: oklch(0.666 0.179 58.32);
        --primary-foreground: oklch(0.216 0.006 56.04);
        --destructive: oklch(0.577 0.245 27.32);
        --destructive-foreground: oklch(0.985 0.001 106.42);
        --ring: var(--primary);
        --gold: var(--primary);
        /* Text-grade gold: --gold at 11-12px on white measures ~3.3:1, under
           AA's 4.5:1. Small gold STRINGS use this darkened mix; --gold stays
           for fills, rules and large serif figures. oklab per the stateColor
           note (oklch hue-rotates against achromatic endpoints). */
        --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
        --accent: oklch(0.769 0.188 70.08);
        --accent-foreground: oklch(0.216 0.006 56.04);
        --gold-bright: var(--accent);
        --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);
        --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
        --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

        /* The theme's geometricLanguage: sharp-ish 6px radius, technical not
           friendly — applied to boxel-ui buttons too, whose default is a
           100px pill. */
        --radius: 6px;
        --boxel-button-border-radius: 6px;

        --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;

        background: var(--ink-900);
        background-image: radial-gradient(
          ellipse 1200px 640px at 15% -10%,
          var(--ink-800) 0%,
          transparent 60%
        );
        color: var(--paper);
        font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 1.75rem;

        scrollbar-color: var(--gold) var(--ink-800);
      }
      .vault::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .vault::-webkit-scrollbar-track {
        background: var(--ink-800);
      }
      .vault::-webkit-scrollbar-thumb {
        background: var(--gold);
        border-radius: 999px;
        border: 2px solid var(--ink-800);
      }
      .vault ::selection {
        background: var(--gold);
        color: var(--ink-950);
      }
      .vault *:focus-visible {
        outline: 2px solid var(--gold);
        outline-offset: 2px;
      }

      /* --- the split shell: sticky identity rail + content stage --- */
      .frame {
        display: grid;
        grid-template-columns: minmax(15rem, 18rem) minmax(0, 1fr);
        gap: 2.25rem;
        align-items: start;
      }
      /* Sticky against .vault's own scroll, so the identity, the value and
         the section nav stay in view while the stage scrolls past. */
      .rail {
        position: sticky;
        top: 0;
        display: grid;
        gap: 1.5rem;
        padding-right: 2rem;
        border-right: 1px solid var(--hairline);
        min-width: 0;
      }
      .stage {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .brand {
        display: grid;
        gap: 0.5rem;
        justify-items: start;
      }
      .plaque-glyph {
        width: 2rem;
        height: 2rem;
        color: var(--gold-ink, var(--gold));
      }
      .wordmark {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(2rem, 1.2rem + 2.4cqi, 3rem);
        line-height: 1.02;
        font-weight: 900;
        letter-spacing: -0.02em;
      }
      .tagline {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.45;
        color: var(--smoke);
      }

      /* The ledger: a filled gold slab for the one figure that matters most,
         with three quieter supporting facts beside it. Gold here is real
         surface area, not a hairline accent. */
      .ledger {
        margin: 0;
        display: grid;
        gap: 0.75rem;
      }
      /* Light-mode translation of the vault plaque signature: a gold
         hairline TOP-RULE over a serif ink value — gold as a mark, never a
         slab. The theme's own materialVocabulary caps gold near 5% of any
         screen; the old filled gradient slab was that rule broken. */
      .ledger-hero {
        display: grid;
        align-content: center;
        gap: 0.2rem;
        background: var(--ink-800);
        border: 1px solid var(--hairline);
        border-top: 3px solid var(--gold);
        border-radius: 6px;
        /* Same 1rem inline inset as .fact rows — two grounded siblings with
           different insets read as misregistered (measured 55.4 vs 49 px). */
        padding: 1.1rem 1rem;
        box-shadow: var(--shadow-1);
      }
      .ledger-hero dt {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--gold-ink, var(--gold));
      }
      .ledger-hero dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(2.25rem, 1rem + 4.5cqi, 3.75rem);
        line-height: 1;
        font-weight: 900;
        letter-spacing: -0.02em;
        color: var(--paper);
        font-variant-numeric: tabular-nums;
        animation: vault-reveal 640ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes vault-reveal {
        from {
          opacity: 0;
          transform: translateY(0.35em);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      /* Supporting facts: hairline ledger rows, label left, figure right —
         a register, not three tiles. */
      .ledger-facts {
        display: grid;
        gap: 0;
        border: 1px solid var(--hairline);
        border-radius: 6px;
        background: var(--ink-800);
        box-shadow: var(--shadow-1);
      }
      .fact {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.7rem 1rem;
        border-top: 1px solid var(--hairline);
      }
      .fact:first-child {
        border-top: 0;
      }
      .fact dt {
        font-size: 0.75rem;
        color: var(--smoke);
      }
      .fact dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.25rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--paper);
      }

      /* --- section nav: vertical in the rail, a 2px gold bar marking the
         active section — the label left, its live count right, register
         style. --- */
      .tabs {
        display: grid;
        gap: 0.15rem;
      }
      .tab {
        position: relative;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        width: 100%;
        min-height: 44px;
        padding: 0.55em 0.9em;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--smoke);
        font: inherit;
        font-size: 0.9375rem;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
        transition:
          color 150ms ease-out,
          background-color 150ms ease-out;
      }
      .tab::before {
        content: '';
        position: absolute;
        left: 0;
        top: 20%;
        bottom: 20%;
        width: 2px;
        border-radius: 999px;
        background: var(--gold);
        opacity: 0;
        transform: scaleY(0.4);
        transition:
          opacity 180ms ease-out,
          transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .tab:hover,
      .tab:focus-visible {
        color: var(--paper);
        background: color-mix(in oklch, var(--gold) 7%, transparent);
      }
      .tab--on {
        color: var(--paper);
        background: color-mix(in oklch, var(--gold) 10%, transparent);
      }
      .tab--on::before {
        opacity: 1;
        transform: scaleY(1);
      }
      .tab-n {
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--gold-ink, var(--gold));
      }
      @media (prefers-reduced-motion: reduce) {
        .tab,
        .tab::before {
          transition: none;
        }
      }

      /* --- one toolbar shell, reused by every pane --- */
      .toolbar {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }
      .toolbar-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1 1 auto;
        min-width: 0;
        flex-wrap: nowrap;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 0 0 auto;
        margin-left: auto;
      }
      /* ViewSelector's own defaults leave the ACTIVE view transparent-background
         with only a small text-color step — invisible on this dark ground. The
         selected view gets the family's gold-plaque treatment through the
         component's own knobs (its documented `--boxel-view-option-*` API), so
         active reads at a glance and hover/focus keep the theme's 150ms motion. */
      .toolbar-right :deep(.view-options-group) {
        --boxel-view-option-foreground: var(--smoke);
        --boxel-view-option-hover-foreground: var(--paper);
        --boxel-view-option-hover-background: var(--ink-700);
        --boxel-view-option-selected-background: var(--gold);
        --boxel-view-option-selected-foreground: var(--ink-950);
        --boxel-view-option-selected-hover-background: var(--gold-bright);
        --boxel-view-option-selected-hover-foreground: var(--ink-950);
        --boxel-view-option-transition:
          color 150ms ease-out, background-color 150ms ease-out;
      }
      /* The "View as" label boxel-ui prints beside the icons. */
      .toolbar-right :deep(.view-options-label) {
        color: var(--smoke);
        font-size: 0.75rem;
      }
      /* Basis IS the maximum, with no grow — `flex:1 1` plus max-width leaves the
         difference allocated as dead space that shoves the badges across. */
      .search {
        flex: 0 1 28rem;
        min-width: 8rem;
      }
      /* 44px touch-target floor on the search field, same rule as the tabs
         and filter pills (measured 40px at default). */
      .search :deep(input) {
        min-height: 44px;
      }
      /* The search vars live on BoxelInput's own inner element, and @type='search'
         defaults to INVERTED colours (foreground as ground). Pinned to this
         file's own literal tokens rather than left to a theme default. */
      .search :deep(.search) {
        --boxel-input-search-background-color: var(--ink-800);
        --boxel-input-search-color: var(--paper);
      }
      .search :deep(.search-icon) {
        --boxel-input-search-icon-color: var(--smoke);
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        min-width: 0;
      }
      /* 44px touch-target floor on the filter pills — the label stays compact,
         the hit area does not. */
      .badges :deep(.pill) {
        min-height: 44px;
      }
      .b-n {
        font-variant-numeric: tabular-nums;
        opacity: 0.75;
        margin-left: 0.35em;
      }
      /* Escrow figure: gold, tabular, sitting beside the pane heading. It is the
         one number on this tab a reader checks first — money the platform is
         currently holding on someone's behalf. */
      .escrow {
        display: inline-flex;
        align-items: center;
        gap: 0.35em;
        font-size: 0.875rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--gold-ink, var(--gold));
        white-space: nowrap;
      }
      .escrow-k {
        font-size: 0.6875rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--smoke);
      }
      /* An order reference is quoted into support threads — mono, never cut. */
      .cell-ref {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--smoke);
        white-space: nowrap;
      }
      .cell-total {
        font-family: var(--font-display);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--gold-ink, var(--gold));
        white-space: nowrap;
      }
      /* Motion: a pane entering the stage rises 12px over 240ms — the one
         choreographed moment, communicating the section change the vertical
         nav just made. Static under reduced motion. */
      .pane {
        animation: stage-enter 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes stage-enter {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pane {
          animation: none;
        }
      }
      .pane-h {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.625rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      /* --- collection: the sneaker wall --- */
      .wall,
      .ledger-list,
      .ledger-rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .wall {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1.25rem;
      }
      /* The list view is the SAME renderer as the grid — one full-width row per
         card rather than tile columns. Only the cell shape changes, which is why
         both read one filtered array. */
      .wall.wall--list {
        grid-template-columns: 1fr;
        gap: 0.6rem;
      }
      .table-wrap {
        /* The table scrolls sideways inside its own wrapper; the page never
           does. */
        overflow-x: auto;
      }
      .ledger-rows {
        display: grid;
        gap: 0.5rem;
      }
      .ledger-list {
        display: grid;
        gap: 0.85rem;
      }

      /* A clickable cell needs a static cue plus hover AND focus-visible —
         cursor:pointer alone appears only under the pointer. Depth comes from a
         real layered shadow, never a 1px border alone. */
      .tile,
      .o-row {
        position: relative;
        display: block;
        width: 100%;
        text-align: left;
        padding: 0;
        background: var(--ink-800);
        border: 1px solid var(--hairline);
        border-radius: 6px;
        color: inherit;
        font: inherit;
        cursor: pointer;
        overflow: hidden;
        box-shadow: var(--shadow-1);
        transition:
          transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
          box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
          border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .tile:hover,
      .tile:focus-visible,
      .o-row:hover,
      .o-row:focus-visible {
        transform: translateY(-3px);
        box-shadow: var(--shadow-3);
        border-color: color-mix(in oklch, var(--gold) 55%, var(--hairline));
      }
      .tile:focus-visible,
      .o-row:focus-visible {
        outline: 2px solid var(--gold);
        outline-offset: 2px;
      }
      /* The static open cue: visible at rest, so the row reads as clickable
         BEFORE the pointer arrives. It nudges on hover/focus as confirmation. */
      .tile-open {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        color: var(--smoke);
        transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .tile:hover .tile-open,
      .tile:focus-visible .tile-open {
        color: var(--paper);
        transform: translateX(2px);
      }
      @media (prefers-reduced-motion: reduce) {
        .tile,
        .o-row,
        .cert,
        .tile-open,
        .tab-n {
          transition: none;
        }
        .tile:hover,
        .tile:focus-visible,
        .o-row:hover,
        .o-row:focus-visible,
        .cert:hover,
        .cert:focus-visible {
          transform: none;
        }
        .tile:hover .tile-open,
        .tile:focus-visible .tile-open {
          transform: none;
        }
        .ledger-hero dd {
          animation: none;
        }
      }

      /* The tile is the photo-led card: thumbnail on top, text body below.
         Padding lives on `.tile-body`, not here, so the image can bleed to the
         tile's own edges — the sneaker-wall read the spec calls for. */
      .tile {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .tile-thumb {
        aspect-ratio: 1 / 1;
        background: var(--ink-700);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .tile-thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .tile-thumb-icon {
        color: var(--smoke);
        opacity: 0.5;
      }
      .tile-body {
        display: grid;
        align-content: start;
        gap: 0.3rem;
        padding: 0.9rem;
      }
      /* List view: the photo shrinks to a leading square instead of a header
         strip, so a row reads as one line again rather than a stacked card. */
      .wall--list .tile {
        grid-template-rows: none;
        grid-template-columns: 3.5rem minmax(0, 1fr);
        align-items: center;
      }
      .wall--list .tile-thumb {
        width: 3.5rem;
        height: 3.5rem;
        aspect-ratio: auto;
      }
      .wall--list .tile-body {
        padding: 0.5rem 0.9rem;
      }
      .tile-title {
        font-weight: 700;
        font-size: 0.9375rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tile-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        font-size: 0.75rem;
        color: var(--smoke);
      }
      .tile-grade {
        font-weight: 700;
        color: var(--paper);
        text-transform: capitalize;
      }
      .tile-foot {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      /* No hand-rolled chip rules any more: StatePill owns the dilution. The
         tile only sizes the row the pills sit in. */
      .tile-foot :deep(.state-pill) {
        font-size: 0.6875rem;
      }

      /* --- market: CollectionPanel consumed as-built. The panel is a pulled
         block whose default chrome reads the semantic token set (which this
         root pins), so only the knobs it exposes need touching here — never
         its internals. --- */
      .pane--market :deep(.cp) {
        --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
      }
      /* BoxelInput @type='search' defaults to INVERTED colours (dark ground),
         which is a black bar on this light page. Same knob override the
         collection tab's own search box carries. */
      .pane--market :deep(.cp-search .search) {
        --boxel-input-search-background-color: var(--ink-800);
        --boxel-input-search-color: var(--paper);
      }
      .pane--market :deep(.cp-search .search-icon) {
        --boxel-input-search-icon-color: var(--smoke);
      }

      /* --- sets: a wide ledger of goals, not a row of identical cards --- */
      .goal {
        background: var(--ink-800);
        border: 1px solid var(--hairline);
        border-top: 2px solid var(--gold);
        border-radius: 6px;
        padding: 1.1rem 1.4rem;
        display: grid;
        gap: 0.5rem;
        box-shadow: var(--shadow-1);
        transition: box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .goal:hover,
      .goal:focus-within {
        box-shadow: var(--shadow-2);
      }
      .goal-head {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
        min-width: 0;
      }
      .goal-thumb {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        object-fit: cover;
        flex: none;
      }
      .goal-glyph {
        color: var(--gold-ink, var(--gold));
        flex: none;
      }
      .goal-title {
        font-family: var(--font-display);
        font-size: 1.125rem;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .goal-frac {
        margin-left: auto;
        font-family: var(--font-display);
        font-size: 1.75rem;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        flex: none;
        color: var(--paper);
      }
      .goal-frac-slash {
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--smoke);
      }
      /* ProgressBar re-skinned through its own published knobs — same hairline
         gold meter, but the component owns the semantics. */
      .meter {
        --boxel-progress-bar-height: 5px;
        --boxel-progress-bar-border-radius: 999px;
        --boxel-progress-bar-background-color: var(--muted, var(--ink-700));
        --boxel-progress-bar-fill-color: var(--gold-ink, var(--gold));
        --boxel-progress-bar-border-color: transparent;
      }
      .goal-sub {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--smoke);
      }

      /* --- orders: a dense ledger row, mono reference leading --- */
      .o-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto auto;
        align-items: center;
        gap: 0.9rem;
        padding: 0.75rem 1rem;
      }

      /* --- authentication: the certificate wall --- */
      .cert-wall {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1.25rem;
      }
      /* Each record rendered as the certificate it represents: photo, then
         the plaque body under the family's gold top rule, the mono number as
         the display element. Same interactive physics as the wall tiles. */
      .cert {
        position: relative;
        display: flex;
        flex-direction: column;
        text-align: left;
        padding: 0;
        background: var(--ink-800);
        border: 1px solid var(--hairline);
        border-top: 3px solid var(--gold);
        border-radius: 6px;
        color: inherit;
        font: inherit;
        cursor: pointer;
        overflow: hidden;
        box-shadow: var(--shadow-1);
        transition:
          transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
          box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cert:hover,
      .cert:focus-visible {
        transform: translateY(-3px);
        box-shadow: var(--shadow-3);
      }
      .cert:focus-visible {
        outline: 2px solid var(--gold);
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        .cert {
          transition: none;
        }
        .cert:hover,
        .cert:focus-visible {
          transform: none;
        }
      }
      /* Verdict not in yet: the top rule renders unfinished. Semantic (a
         real waiting state), not decoration. */
      .cert--pending {
        border-top-style: dashed;
      }
      .cert-photo {
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
        display: block;
      }
      .cert-photo--glyph {
        display: grid;
        place-items: center;
        background: var(--muted, var(--ink-700));
        color: var(--smoke);
      }
      .cert-body {
        display: grid;
        justify-items: start;
        gap: 0.4rem;
        padding: 0.85rem 1rem 0.6rem;
      }
      .cert-no {
        font-family: var(--font-mono, ui-monospace, Menlo, monospace);
        font-size: 1.0625rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--paper);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .cert-no--none {
        font-style: italic;
        font-weight: 400;
        color: var(--smoke);
      }
      .cert-item {
        font-size: 0.875rem;
        line-height: 1.35;
        color: var(--smoke);
      }
      .cert-foot {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: auto;
        padding: 0.6rem 1rem 0.85rem;
        border-top: 1px solid var(--hairline);
        font-size: 0.75rem;
        color: var(--smoke);
      }
      .cert-svc {
        font-weight: 600;
        color: var(--paper);
      }

      .empty {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 2rem;
        background: var(--ink-800);
        border: 1px solid var(--hairline);
        border-radius: 6px;
        color: var(--smoke);
        font-size: 0.9375rem;
        box-shadow: var(--shadow-1);
      }

      /* The split shell folds back on top under 860px: rail becomes a
         header band, nav goes to a horizontal scroll strip, the value plaque
         and the ledger share one row. */
      @container vault (width < 860px) {
        .frame {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
        .rail {
          position: static;
          border-right: 0;
          border-bottom: 1px solid var(--hairline);
          padding-right: 0;
          padding-bottom: 1.5rem;
          gap: 1.25rem;
        }
        .ledger {
          grid-template-columns: minmax(11rem, 1fr) minmax(0, 1.4fr);
          align-items: stretch;
        }
        .tabs {
          grid-auto-flow: column;
          grid-auto-columns: max-content;
          overflow-x: auto;
          gap: 0.25rem;
          padding-bottom: 0.25rem;
        }
        .tab::before {
          top: auto;
          left: 15%;
          right: 15%;
          bottom: 0;
          width: auto;
          height: 2px;
          transform: scaleX(0.4);
        }
        .tab--on::before {
          transform: scaleX(1);
        }
        .toolbar-left {
          flex-wrap: wrap;
        }
      }
      @container vault (width < 620px) {
        .ledger {
          grid-template-columns: 1fr;
        }
      }
      @container vault (width < 460px) {
        .wordmark {
          font-size: 1.625rem;
        }
        .wall {
          grid-template-columns: minmax(0, 1fr);
        }
        .o-row {
          grid-template-columns: auto minmax(0, 1fr) auto;
        }
      }
    </style>
  </template>
}

export class SoleVaultApp extends CardDef {
  static displayName = 'Sole Vault';
  static icon = ArchiveIcon;

  // This card IS a layout surface, not one record's detail view: it lays out
  // tabbed collections, prerendered tile grids and a paginated field table, all
  // of which the default ~800px stack cap would force into a cramped scroller.
  // That is exactly the case `prefersWideFormat` exists for — CardsGrid,
  // Workspace and SkillSet in the base realm all set it for the same reason.
  //
  // It is also a PLATFORM-LEVEL SIGNAL, not only a width knob: the workspace's
  // entry-point grid reads this flag to label a door "App" rather than "Card".
  // Without it, Sole Vault advertises itself as a single card.
  //
  // ORDERING NOTE: this flag changes the actual pixel width every
  // `@container vault (...)` rule below sees (full stack width instead of the
  // 800px cap), so it is set BEFORE the breakpoints are re-tuned — a breakpoint
  // measured against the capped width fires at the wrong place once the flag
  // flips. The 820/620/460 stops still hold because they are container-relative
  // and the reflow order they encode is unchanged; what needs a fresh measured
  // walk is whether the toolbar now has slack it never had.
  static prefersWideFormat = true;

  @field tagline = contains(StringField);

  static isolated = Isolated;

  // FITTED — this is the app's DOOR: the tile the workspace entry-point grid
  // draws, so it is the first thing anyone sees of Sole Vault. Without it the
  // card falls back to the library default template, which is the generic
  // white-card-with-an-icon this family exists not to look like.
  //
  // Hand-rolled rather than FittedCard, and this is the one place in the family
  // where that fork is right: the app has no image field and only two strings,
  // so FittedCard's slot model would render exactly the boring tell. What
  // carries it instead is a TYPOGRAPHIC anchor (Rule 2, tier 3) — the wordmark
  // at weight 900 in the display serif — over the plaque rule the rest of the
  // family uses. Two facts, two slots, no repeats.
  static fitted = class Fitted extends Component<typeof SoleVaultApp> {
    <template>
      <div class='fit'>
        <div class='r-head'>
          <ArchiveIcon class='glyph' aria-hidden='true' />
          <h3 class='wordmark'>{{if
              @model.cardTitle
              @model.cardTitle
              'Sole Vault'
            }}</h3>
        </div>
        <p class='r-meta'>{{@model.tagline}}</p>
      </div>

      <style scoped>

        /* NO container-type / container-name — the HOST wrapper declares
           `container-type: size; container-name: fitted-card`, and declaring one
           here would capture those queries and make every rule below inert. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          /* The meta row is `auto`, never a fixed height: a fixed text row under
             overflow:hidden is what shears type through the middle of its
             letters. Visibility is the lever, not truncation. */
          grid-template-rows: minmax(0, 1fr) auto;
          gap: 0.2rem;

          --card: oklch(1 0 0);

          --card-foreground: oklch(0.147 0.004 49.25);

          --background: oklch(0.985 0.001 106.42);

          --border: oklch(0.869 0.005 56.37);

          --accent: oklch(0.769 0.188 70.08);

          --accent-foreground: oklch(0.216 0.006 56.04);

          --ink-800: var(--card);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);

          /* ONE type scale for the whole template, CAPPED against the container
             HEIGHT as well as its width. The cap belongs on the base — a per-role
             cqb cap never binds in a wide+short cell, because cqb is tiny there
             and the cqi term is what overflows. */
          --type-base: clamp(11px, min(calc(4px + 1.9cqi + 1cqb), 10cqb), 17px);

          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 0.6rem 0.85rem;
          box-sizing: border-box;
          /* The vault plaque, as the family's inset gold edge. */
          box-shadow: inset 3px 0 0 0 var(--gold);
          overflow: hidden;
        }

        .r-head {
          min-height: 0;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 0.45em;
        }
        /* Rule 2: the glyph identifies, it does not compete — and it is the
           card's OWN static icon, the same one the isolated masthead uses. */
        .glyph {
          width: max(14px, 1.3em);
          height: max(14px, 1.3em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        /* THE ANCHOR — typographic, because this card has no image to lead with.
           Display serif at 900, decisively the loudest thing at all 16 sizes. */
        .wordmark {
          margin: 0;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: calc(var(--type-base) * 1.55);
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.01em;
          min-width: 0;
          /* Clamped at a LINE boundary with an ellipsis — the reader never sees
             half a letter. */
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .r-meta {
          margin: 0;
          min-height: 0;
          overflow: hidden;
          font-size: var(--type-base);
          line-height: 1.25;
          color: var(--smoke);
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        /* ---- quanta: structure and visibility only; the scale never steps ---- */

        /* Badge tier: the wordmark is the only survivor and must still shout. */
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            padding: 0.25rem 0.4rem;
          }
          .r-meta {
            display: none;
          }
          .wordmark {
            -webkit-line-clamp: 1;
          }
        }

        /* Thin strips: one line of tagline rather than two, so the block-axis
           budget stays inside 100cqb without shrinking anything into a clip. */
        @container fitted-card (height > 50px) and (height <= 105px) {
          .r-meta {
            -webkit-line-clamp: 1;
          }
          .wordmark {
            -webkit-line-clamp: 1;
          }
        }

        /* Narrow cells: the glyph would take the row the wordmark needs, so it
           is the first thing dropped — a decorative mark never costs the
           anchor its space. */
        @container fitted-card (width <= 150px) {
          .glyph {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default SoleVaultApp;
