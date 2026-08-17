import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import {
  identifyCard,
  type getCards,
  type CodeRef,
  type Filter,
  type Query,
} from '@cardstack/runtime-common';
import CardList from '@cardstack/base/components/card-list';
import { Table } from './fulfilment-table';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { debounce } from 'lodash-es';
import type Owner from '@ember/owner';
import {
  Button,
  BoxelInput,
  Pill,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import PackageIcon from '@cardstack/boxel-icons/package';
import PlusIcon from '@cardstack/boxel-icons/plus';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import LayoutListIcon from '@cardstack/boxel-icons/layout-list';
import TableIcon from '@cardstack/boxel-icons/table';

import { FulfilmentOrder } from './fulfilment-order';
import { Shipment } from './shipment';
import { InventoryStock } from './inventory-stock';
import { Warehouse } from './warehouse';
import { Carrier, quoteService } from './carrier';
import { ProductReturn } from './product-return';
import { PickList } from './pick-list';
import { ORDER_STATUSES, orderStatusStyle } from './order-status';
import { isShipmentException } from './shipment-status';
import { OrderFulfilmentBoard, type BoardColumn } from './order-fulfilment-board';
import { ShipmentTracker } from './shipment-tracker';
import StatusChip from './fulfilment-status-chip';

// The app declares the domain; the blocks stay neutral. These columns are the
// fulfilment pipeline — the board block itself has no idea what "packing"
// means, which is what lets the same block run a returns board or a purchase
// order board without a fork.
const BOARD_COLUMNS: BoardColumn[] = [
  'pending',
  'processing',
  'picking',
  'packing',
  'shipped',
]
  .map((value) => orderStatusStyle(value))
  .map((s) => ({ key: s.value, label: s.label, hue: s.hue }));

const TABS = [
  { key: 'board', label: 'Board' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'ship', label: 'Ship desk' },
  { key: 'transit', label: 'In transit' },
  { key: 'returns', label: 'Returns' },
];

function money(amount: number | undefined, code = 'GBP') {
  if (amount == null) {
    return '—';
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

function pct(value: number | undefined) {
  return htmlSafe(`width: ${Math.min(100, Math.max(0, value ?? 0))}%`);
}

// Three views, same ids on every collection in the card. grid and list are two
// cell shapes over ONE renderer (the base realm's CardList, which draws
// prerendered fitted); only `table` is a different layer, rendering individual
// fields. `list` maps to CardList's own vocabulary word, `strip`.
//
// boxel-ui also offers a `card` option; it is deliberately NOT shipped here,
// because it renders the embedded template into a row envelope and clips.
const VIEW_ITEMS = [
  { id: 'grid', icon: LayoutGridIcon },
  { id: 'list', icon: LayoutListIcon },
  { id: 'table', icon: TableIcon },
];

// Our switcher id → CardList's `@viewOption` vocabulary.
const VIEW_OPTION: Record<string, string> = {
  list: 'strip',
  grid: 'grid',
};

class Isolated extends Component<typeof OrderFulfilmentApp> {
  @tracked tab = 'board';

  // One set of state names per collection, rather than a single `search` the
  // tabs fight over: `<x>Search` / `<x>Status` / `<x>View`.
  @tracked boardSearch = '';
  @tracked inventorySearch = '';
  @tracked returnsSearch = '';
  @tracked inventoryStatus: 'all' | 'low' | 'out' = 'all';
  @tracked returnsStatus: 'all' | 'open' | 'closed' = 'all';
  // Inventory defaults to the table: a stock row is six numeric columns, and
  // that is what a table is for. Returns defaults to the grid — an RMA reads as
  // a card. Both offer the other view; neither is forced into the wrong shape.
  @tracked inventoryView = 'table';
  @tracked returnsView = 'grid';
  @tracked selectedShipmentId: string | undefined = undefined;

  private orderQuery: ReturnType<getCards> | undefined;
  private shipmentQuery: ReturnType<getCards> | undefined;
  private stockQuery: ReturnType<getCards> | undefined;
  private warehouseQuery: ReturnType<getCards> | undefined;
  private carrierQuery: ReturnType<getCards> | undefined;
  private returnQuery: ReturnType<getCards> | undefined;
  private pickQuery: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    let ctx = this.args.context;
    let realms = () => this.realms;
    let live = { isLive: true } as const;
    this.orderQuery = ctx?.getCards(this, () => byType(FulfilmentOrder), realms, live);
    this.shipmentQuery = ctx?.getCards(this, () => byType(Shipment), realms, live);
    this.stockQuery = ctx?.getCards(this, () => byType(InventoryStock), realms, live);
    this.warehouseQuery = ctx?.getCards(this, () => byType(Warehouse), realms, live);
    this.carrierQuery = ctx?.getCards(this, () => byType(Carrier), realms, live);
    this.returnQuery = ctx?.getCards(this, () => byType(ProductReturn), realms, live);
    this.pickQuery = ctx?.getCards(this, () => byType(PickList), realms, live);
  }

  private get realms(): string[] | undefined {
    let url = (this.args.model as any)?.[realmURL];
    return url ? [url.href] : undefined;
  }

  // ── Search plumbing ──────────────────────────────────────────────────────

  // No text → a plain type filter. Text → the type AND (full-document `matches`
  // OR title `contains`). Both halves of the `any` are needed: `matches` finds a
  // term buried in the document but can miss the title the user obviously meant;
  // `contains` on cardTitle guarantees that case. The `every` keeps the type
  // anchor so a search never returns cards of other types.
  private searchTextFilter(ref: CodeRef, search: string): Filter {
    let q = search.trim();
    if (!q) {
      return { type: ref };
    }
    return {
      every: [
        { type: ref },
        { any: [{ matches: q }, { contains: { cardTitle: q } }] },
      ],
    };
  }

  // ONE Query per collection, handed unchanged to all four views. The mirroring
  // rule of the skill stops being something maintained by hand here: card, list
  // and grid render it through CardList, and table renders the same object
  // through the Table component, so they cannot disagree about the row set.
  private collectionQuery(
    cardClass: typeof CardDef,
    search: string,
    sortBy: string,
    // The status predicate, as an indexed field/value pair. It must be a real
    // field on the card — a getter is invisible to the query engine.
    status?: { field: string; value: string },
  ): Query | undefined {
    let ref = identifyCard(cardClass);
    // Rendering nothing beats querying every realm for every type while the ref
    // is still unresolved.
    if (!ref || !this.realms?.length) {
      return undefined;
    }
    let textFilter = this.searchTextFilter(ref, search);
    // The `eq` node carries its own `on` anchor. Without it the node inherits
    // the ambient default, which is `baseCardRef` (index-query-engine.ts:746) —
    // so the engine looks for `stockState` on CardDef, does not find it, and the
    // whole request fails with HTTP 500 and
    // `Your filter refers to a nonexistent field "stockState" on type CardDef`.
    let filter: Filter = status
      ? {
          every: [textFilter, { on: ref, eq: { [status.field]: status.value } }],
        }
      : textFilter;
    return {
      filter,
      sort: [{ by: sortBy, on: ref, direction: 'asc' as const }],
    };
  }

  get inventoryQuery() {
    return this.collectionQuery(
      InventoryStock,
      this.inventorySearch,
      'sku',
      this.inventoryStatus === 'all'
        ? undefined
        : { field: 'stockState', value: this.inventoryStatus },
    );
  }

  get returnsQuery() {
    return this.collectionQuery(
      ProductReturn,
      this.returnsSearch,
      'rmaNumber',
      this.returnsStatus === 'all'
        ? undefined
        : { field: 'lifecycleState', value: this.returnsStatus },
    );
  }

  get inventoryTypeRef() {
    return identifyCard(InventoryStock);
  }

  get returnsTypeRef() {
    return identifyCard(ProductReturn);
  }

  // The Table paginates itself, which is why it wants a SINGLE realm — passing
  // an array is how a table quietly starts dropping rows.
  get realm() {
    return this.realms?.[0];
  }

  // `card` / `list` / `grid` are cell shapes over one renderer; `table` is the
  // other layer entirely.
  isCardListView = (view: string) => view !== 'table';
  viewOptionFor = (view: string) => VIEW_OPTION[view] ?? 'grid';

  // Debounce the assignment to tracked state, not the input's own value: the
  // field must feel immediate, it is the query that waits.
  private debouncedBoardSearch = debounce((v: string) => {
    this.boardSearch = v;
  }, 250);
  private debouncedInventorySearch = debounce((v: string) => {
    this.inventorySearch = v;
  }, 250);
  private debouncedReturnsSearch = debounce((v: string) => {
    this.returnsSearch = v;
  }, 250);

  @action setBoardSearch(v: string) {
    this.debouncedBoardSearch(v);
  }
  @action setInventorySearch(v: string) {
    this.debouncedInventorySearch(v);
  }
  @action setReturnsSearch(v: string) {
    this.debouncedReturnsSearch(v);
  }

  viewItems = VIEW_ITEMS;

  @action setInventoryView(id: string) {
    this.inventoryView = id;
  }
  @action setReturnsView(id: string) {
    this.returnsView = id;
  }

  // Prerender gets a static shell. The CRUD functions are only present in the
  // interactive host, so gating on them keeps indexing light and avoids
  // rendering boards of themed fitted cards during prerender.
  get isInteractive() {
    return Boolean((this.args as any).viewCard);
  }

  get orders(): FulfilmentOrder[] {
    return ((this.orderQuery?.instances ?? []) as FulfilmentOrder[]).filter(
      Boolean,
    );
  }

  get shipments(): Shipment[] {
    return ((this.shipmentQuery?.instances ?? []) as Shipment[]).filter(Boolean);
  }

  get stock(): InventoryStock[] {
    return ((this.stockQuery?.instances ?? []) as InventoryStock[]).filter(
      Boolean,
    );
  }

  get warehouses(): Warehouse[] {
    return ((this.warehouseQuery?.instances ?? []) as Warehouse[]).filter(
      Boolean,
    );
  }

  get carriers(): Carrier[] {
    return ((this.carrierQuery?.instances ?? []) as Carrier[]).filter(Boolean);
  }

  get returns(): ProductReturn[] {
    return ((this.returnQuery?.instances ?? []) as ProductReturn[]).filter(
      Boolean,
    );
  }

  get pickLists(): PickList[] {
    return ((this.pickQuery?.instances ?? []) as PickList[]).filter(Boolean);
  }

  // ── Board ────────────────────────────────────────────────────────────────

  get boardColumns() {
    return BOARD_COLUMNS;
  }

  get boardOrders() {
    let term = this.boardSearch.trim().toLowerCase();
    let inPipeline = this.orders.filter((o) =>
      BOARD_COLUMNS.some((c) => c.key === o.status),
    );
    if (!term) {
      return inPipeline;
    }
    return inPipeline.filter((o) => {
      let haystack = [
        o.orderNumber,
        o.customerName,
        ...(o.lineItems ?? []).map((l) => l?.sku),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  @action columnKeyFor(order: FulfilmentOrder) {
    return order.status ?? 'pending';
  }

  @action
  async moveOrder(order: FulfilmentOrder, columnKey: string) {
    let store = (this.args as any).context?.store;
    if (!store || !order.id) {
      throw new Error('No store available to record the move');
    }
    await store.patch(order.id, { attributes: { status: columnKey } });
  }

  @action openCard(card: CardDef) {
    (this.args as any).viewCard?.(card, 'isolated');
  }

  @action async createOrder() {
    let create = (this.args as any).createCard;
    let realm = this.realms?.[0];
    let ref = identifyCard(FulfilmentOrder);
    if (!create || !ref || !realm) {
      return;
    }
    await create(ref, undefined, {
      realmURL: realm,
      doc: {
        data: {
          attributes: {
            status: 'pending',
            priority: 'normal',
            source: 'manual',
            paymentStatus: 'pending',
            placedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  @action async createStockRow() {
    let create = (this.args as any).createCard;
    let realm = this.realms?.[0];
    let ref = identifyCard(InventoryStock);
    if (!create || !ref || !realm) {
      return;
    }
    await create(ref, undefined, { realmURL: realm });
  }

  @action async createReturn() {
    let create = (this.args as any).createCard;
    let realm = this.realms?.[0];
    let ref = identifyCard(ProductReturn);
    if (!create || !ref || !realm) {
      return;
    }
    await create(ref, undefined, {
      realmURL: realm,
      doc: {
        data: {
          attributes: {
            status: 'requested',
            requestedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  // ── Counters ─────────────────────────────────────────────────────────────

  get todayCount() {
    return this.orders.filter((o) =>
      ['pending', 'processing', 'picking', 'packing'].includes(o.status ?? ''),
    ).length;
  }

  get expressCount() {
    return this.orders.filter(
      (o) => o.isExpress && !['delivered', 'cancelled'].includes(o.status ?? ''),
    ).length;
  }

  get inTransit() {
    return this.shipments.filter(
      (s) => s.status && s.status !== 'delivered',
    );
  }

  get exceptions() {
    return this.shipments.filter((s) => isShipmentException(s.status));
  }

  get lateShipments() {
    return this.shipments.filter((s) => s.isLate && s.status !== 'delivered');
  }

  get lowStock() {
    return this.stock.filter((s) => s.isLowStock);
  }

  get outOfStock() {
    return this.stock.filter((s) => s.isOutOfStock);
  }

  // Reads the card's own `lifecycleState` rather than re-listing the closed
  // statuses here — the badge count and the two filtered views then cannot
  // disagree about what "open" means.
  get openReturns() {
    return this.returns.filter((r) => r.lifecycleState === 'open');
  }

  // ── Inventory ────────────────────────────────────────────────────────────

  // There is no client-side mirror of the collection queries any more, and that
  // is the point: all four views are handed the same Query object, so the row
  // set cannot differ between them. Client-side filtering is still the right
  // tool for the board and for the counters below — those compute over resolved
  // fields, which a query cannot do.

  get closedReturns() {
    return this.returns.length - this.openReturns.length;
  }

  get warehouseSummary() {
    return this.warehouses.map((w) => {
      let rows = this.stock.filter((s) => s.warehouseCode === w.code);
      let value = rows.reduce(
        (sum, r) => sum + (r.quantityOnHand ?? 0) * (r.product?.cost?.amount ?? 0),
        0,
      );
      return {
        warehouse: w,
        skuCount: rows.length,
        value,
        utilization: w.utilizationPercent,
        isVirtual: w.isVirtual,
      };
    });
  }

  @action setInventoryStatus(value: 'all' | 'low' | 'out') {
    this.inventoryStatus = value;
  }

  @action setReturnsStatus(value: 'all' | 'open' | 'closed') {
    this.returnsStatus = value;
  }

  // Every badge carries its count, derived from the same collection the view
  // renders. A zero-count badge still renders — a disappearing badge makes the
  // row jump as data changes.
  get inventoryBadges() {
    return [
      { id: 'all' as const, label: 'All', count: this.stock.length },
      { id: 'low' as const, label: 'Low', count: this.lowStock.length },
      { id: 'out' as const, label: 'Out', count: this.outOfStock.length },
    ];
  }

  get returnsBadges() {
    return [
      { id: 'all' as const, label: 'All', count: this.returns.length },
      { id: 'open' as const, label: 'Open', count: this.openReturns.length },
      { id: 'closed' as const, label: 'Closed', count: this.closedReturns },
    ];
  }

  // ── Ship desk ────────────────────────────────────────────────────────────

  // Packed orders with no shipment yet — the queue the ship desk works from.
  get readyToShip() {
    return this.shipments.filter((s) => s.status === 'label_created');
  }

  get shipDeskQueue() {
    let queue = this.shipments.filter(
      (s) => !s.shippedAt || s.status === 'label_created',
    );
    return queue.length ? queue : this.shipments.slice(0, 3);
  }

  get selectedShipment(): Shipment | undefined {
    let list = this.shipDeskQueue;
    if (!list.length) {
      return undefined;
    }
    return (
      list.find((s) => s.id === this.selectedShipmentId) ?? list[0]
    );
  }

  // Rate shopping over the rates configured on the Carrier cards. There is no
  // carrier API here and the app does not pretend otherwise — every number
  // below traces to a service on a card someone filled in.
  get rateOptions() {
    let shipment = this.selectedShipment;
    if (!shipment) {
      return [];
    }
    let parcel = shipment.parcel;
    let paid = shipment.customerPaid?.amount ?? 0;

    let options = this.carriers
      .filter((c) => c.isActive !== false)
      .flatMap((carrier) =>
        (carrier.services ?? [])
          .filter((s) => s?.baseRate?.amount != null)
          .map((service) => {
            let divisor = carrier.dimDivisor ?? 5000;
            let volume =
              parcel?.length && parcel?.width && parcel?.height
                ? parcel.length * parcel.width * parcel.height
                : 0;
            let volumetric = volume ? volume / divisor : 0;
            let billable =
              Math.round(Math.max(parcel?.weight ?? 0, volumetric) * 100) / 100;
            let cost = quoteService(service, billable) ?? 0;
            return {
              key: `${carrier.code}-${service.code}`,
              carrier,
              carrierName: carrier.carrierName ?? carrier.code ?? '',
              serviceName: service.serviceName ?? service.code ?? '',
              serviceCode: service.code ?? '',
              speed: service.speedLabel ?? '—',
              days: service.deliveryDaysMin ?? 99,
              billable,
              cost,
              margin: Math.round((paid - cost) * 100) / 100,
              currency: service.baseRate?.currency?.code ?? 'GBP',
            };
          }),
      );

    return options.sort((a, b) => a.cost - b.cost);
  }

  get cheapestOption() {
    return this.rateOptions[0];
  }

  get fastestOption() {
    return [...this.rateOptions].sort((a, b) => a.days - b.days)[0];
  }

  @action selectShipment(id: string | undefined) {
    this.selectedShipmentId = id;
  }

  // ── Rendering helpers ────────────────────────────────────────────────────

  // Switching tabs no longer wipes the search: each collection owns its own
  // search state, so returning to a tab finds it as you left it.
  @action setTab(key: string) {
    this.tab = key;
  }

  get tabs() {
    return TABS.map((t) => ({ ...t, active: t.key === this.tab }));
  }

  get statusLegend() {
    return ORDER_STATUSES.filter((s) =>
      BOARD_COLUMNS.some((c) => c.key === s.value),
    );
  }

  <template>
    <div class='app'>
      <header class='masthead'>
        <div class='brand'>
          <span class='brand-mark' aria-hidden='true'>
            <span></span><span></span><span></span><span></span><span></span>
          </span>
          <div>
            <h1 class='brand-name'>{{@model.operationName}}</h1>
            <p class='brand-sub'>Order fulfilment · {{@model.cardTitle}}</p>
          </div>
        </div>

        <dl class='counters'>
          <div>
            <dt>To fulfil</dt>
            <dd>{{this.todayCount}}</dd>
          </div>
          <div>
            <dt>Express</dt>
            <dd>{{this.expressCount}}</dd>
          </div>
          <div>
            <dt>In transit</dt>
            <dd>{{this.inTransit.length}}</dd>
          </div>
          <div class='{{if this.exceptions.length "alarm"}}'>
            <dt>Exceptions</dt>
            <dd>{{this.exceptions.length}}</dd>
          </div>
          <div class='{{if this.outOfStock.length "alarm"}}'>
            <dt>Out of stock</dt>
            <dd>{{this.outOfStock.length}}</dd>
          </div>
        </dl>
      </header>

      <nav class='tabs' aria-label='Fulfilment sections'>
        {{#each this.tabs as |t|}}
          <button
            type='button'
            class='tab {{if t.active "tab-active"}}'
            aria-current={{if t.active 'page'}}
            {{on 'click' (fn this.setTab t.key)}}
          >{{t.label}}</button>
        {{/each}}
      </nav>

      {{#if this.isInteractive}}
        <section class='panel'>
          {{#if (eq this.tab 'board')}}
            <div class='collection-toolbar'>
              <div class='toolbar-left'>
                <div class='search'>
                  <BoxelInput
                    @value={{this.boardSearch}}
                    @onInput={{this.setBoardSearch}}
                    @placeholder='Search order number, customer or SKU'
                  />
                </div>
              </div>
              <div class='toolbar-right'>
                <Button
                  @kind='primary'
                  @size='small'
                  class='add-btn'
                  {{on 'click' this.createOrder}}
                ><PlusIcon width='16' height='16' role='presentation' />
                  <span class='add-label'>Add Order</span></Button>
              </div>
            </div>

            <OrderFulfilmentBoard
              class='ofb-host'
              @cards={{this.boardOrders}}
              @columns={{this.boardColumns}}
              @columnKeyFor={{this.columnKeyFor}}
              @onMove={{this.moveOrder}}
              @onOpen={{this.openCard}}
              @cardSize='regular-tile'
              @boardLabel='Order fulfilment board'
              @emptyMessage='No orders in the pipeline. Everything raised so far
                is shipped, delivered or on hold.'
            >
              <:card as |order|>
                <div
                  class='board-card'
                  role='button'
                  tabindex='0'
                  {{on 'click' (fn this.openCard order)}}
                >
                  <div class='bc-top'>
                    <span class='bc-num'>{{order.orderNumber}}</span>
                    {{#if order.isExpress}}
                      <span class='bc-flash'>{{order.priority}}</span>
                    {{/if}}
                  </div>
                  <p class='bc-cust'>{{order.customerName}}</p>
                  <div class='bc-meta'>
                    <span>{{order.itemCount}} items</span>
                    <span class='bc-total'>{{money
                        order.total.amount
                        order.currencyCode
                      }}</span>
                  </div>
                  {{#if order.warehouseCode}}
                    <span class='bc-wh'>{{order.warehouseCode}}</span>
                  {{/if}}
                </div>
              </:card>
            </OrderFulfilmentBoard>

            {{#if this.pickLists.length}}
              <section class='sub'>
                <h2>Pick lists on the floor</h2>
                <ul class='rows'>
                  {{#each this.pickLists as |pl|}}
                    <li>
                      <button
                        type='button'
                        class='row-btn'
                        {{on 'click' (fn this.openCard pl)}}
                      >
                        <span class='mono strong'>{{pl.pickListNumber}}</span>
                        <span class='muted'>{{pl.assignedTo}}</span>
                        <span class='bar'><span
                            class='bar-fill'
                            style={{pct pl.progressPercent}}
                          ></span></span>
                        <span class='mono'>{{pl.doneCount}}/{{pl.route.length}}</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              </section>
            {{/if}}
          {{/if}}

          {{#if (eq this.tab 'inventory')}}
            <div class='collection-toolbar'>
              <div class='toolbar-left'>
                <div class='search'>
                  <BoxelInput
                    @value={{this.inventorySearch}}
                    @onInput={{this.setInventorySearch}}
                    @placeholder='Search SKU, product, bin or warehouse'
                  />
                </div>
                <div class='filters'>
                  {{#each this.inventoryBadges as |b|}}
                    <Pill
                      @kind='button'
                      @variant={{if
                        (eq this.inventoryStatus b.id)
                        'primary'
                        'muted'
                      }}
                      aria-pressed='{{eq this.inventoryStatus b.id}}'
                      {{on 'click' (fn this.setInventoryStatus b.id)}}
                    >{{b.label}}
                      <span class='badge-count'>{{b.count}}</span></Pill>
                  {{/each}}
                </div>
              </div>
              <div class='toolbar-right'>
                <ViewSelector
                  @items={{this.viewItems}}
                  @selectedId={{this.inventoryView}}
                  @onChange={{this.setInventoryView}}
                />
                <Button
                  @kind='primary'
                  @size='small'
                  class='add-btn'
                  {{on 'click' this.createStockRow}}
                ><PlusIcon width='16' height='16' role='presentation' />
                  <span class='add-label'>Add Stock Row</span></Button>
              </div>
            </div>

            <div class='wh-grid'>
              {{#each this.warehouseSummary as |w|}}
                <button
                  type='button'
                  class='wh-tile'
                  {{on 'click' (fn this.openCard w.warehouse)}}
                >
                  <span class='wh-code'>{{w.warehouse.code}}</span>
                  <span class='wh-name'>{{w.warehouse.warehouseName}}</span>
                  <span class='wh-stat'>{{w.skuCount}} SKUs ·
                    {{money w.value}}</span>
                  {{#if w.isVirtual}}
                    <span class='wh-virtual'>Virtual — supplier ships direct</span>
                  {{else if w.utilization}}
                    <span class='bar'><span
                        class='bar-fill'
                        style={{pct w.utilization}}
                      ></span></span>
                    <span class='wh-stat'>{{w.utilization}}% of bins filled</span>
                  {{/if}}
                </button>
              {{/each}}
            </div>

            <section class='sub'>
              <h2>Stock rows</h2>
              {{#if this.inventoryQuery}}
                {{#if (this.isCardListView this.inventoryView)}}
                  {{! card / list / grid are one renderer, three cell shapes }}
                  <CardList
                    @context={{@context}}
                    @query={{this.inventoryQuery}}
                    @realms={{this.realms}}
                    @format='fitted'
                    @isLive={{true}}
                    @viewOption={{this.viewOptionFor this.inventoryView}}
                  />
                {{else}}
                  <div class='table-scroll'>
                    <Table
                      @query={{this.inventoryQuery}}
                      @realm={{this.realm}}
                      @cardTypeRef={{this.inventoryTypeRef}}
                      @context={{@context}}
                      @showClean={{true}}
                      @showComputedFields={{false}}
                      @showPrimitivesOnly={{false}}
                    />
                  </div>
                {{/if}}
              {{else}}
                <p class='empty'>Loading stock…</p>
              {{/if}}
            </section>
          {{/if}}

          {{#if (eq this.tab 'ship')}}
            {{#if this.selectedShipment}}
              <div class='ship'>
                <div class='ship-parcel'>
                  <h2>Parcel</h2>
                  <p class='ship-num'>{{this.selectedShipment.shipmentNumber}}</p>
                  <p class='muted'>Order
                    {{this.selectedShipment.orderNumber}}
                    · from
                    {{this.selectedShipment.originCode}}</p>
                  <dl class='kv'>
                    <div>
                      <dt>Measured</dt>
                      <dd>{{this.selectedShipment.parcel.sizeLabel}}</dd>
                    </div>
                    <div>
                      <dt>Weight</dt>
                      <dd>{{this.selectedShipment.parcel.weight}} kg</dd>
                    </div>
                    <div>
                      <dt>Customer paid</dt>
                      <dd>{{money this.selectedShipment.customerPaid.amount}}</dd>
                    </div>
                  </dl>
                  {{#if this.shipDeskQueue.length}}
                    <h3 class='queue-h'>Queue</h3>
                    <ul class='queue'>
                      {{#each this.shipDeskQueue as |s|}}
                        <li>
                          <button
                            type='button'
                            class='queue-btn
                              {{if (eq s.id this.selectedShipment.id) "on"}}'
                            {{on 'click' (fn this.selectShipment s.id)}}
                          >{{s.shipmentNumber}}</button>
                        </li>
                      {{/each}}
                    </ul>
                  {{/if}}
                </div>

                <div class='ship-rates'>
                  <h2>Rate comparison</h2>
                  <p class='rates-note'>Priced from the services configured on
                    your carrier cards, against this parcel's billable weight.
                    No carrier API is called.</p>
                  <ul class='rate-list'>
                    {{#each this.rateOptions as |opt|}}
                      <li
                        class='rate {{if (eq opt.key this.cheapestOption.key) "best"}}'
                      >
                        <div class='rate-id'>
                          {{#if (eq opt.key this.cheapestOption.key)}}
                            <span class='tagline'>Cheapest</span>
                          {{else if (eq opt.key this.fastestOption.key)}}
                            <span class='tagline'>Fastest</span>
                          {{/if}}
                          <span class='rate-name'>{{opt.carrierName}}
                            {{opt.serviceName}}</span>
                          <span class='muted'>{{opt.speed}} ·
                            {{opt.billable}}
                            kg billable</span>
                        </div>
                        <div class='rate-nums'>
                          <span class='rate-cost'>{{money
                              opt.cost
                              opt.currency
                            }}</span>
                          <span
                            class='rate-margin {{if (lt opt.margin 0) "neg"}}'
                          >{{money opt.margin opt.currency}} margin</span>
                        </div>
                      </li>
                    {{else}}
                      <li class='empty'>No carrier has a priced service yet. Add
                        one on a Carrier card and it appears here.</li>
                    {{/each}}
                  </ul>
                  <Button
                    @kind='secondary'
                    {{on 'click' (fn this.openCard this.selectedShipment)}}
                  >Open shipment to dispatch</Button>
                </div>
              </div>
            {{else}}
              <p class='empty'>Nothing waiting at the ship desk. Packed orders
                appear here once a shipment exists for them.</p>
            {{/if}}
          {{/if}}

          {{#if (eq this.tab 'transit')}}
            {{#if this.exceptions.length}}
              <section class='alert-box'>
                <h2>Needs attention</h2>
                <ul class='rows'>
                  {{#each this.exceptions as |s|}}
                    <li>
                      <button
                        type='button'
                        class='row-btn'
                        {{on 'click' (fn this.openCard s)}}
                      >
                        <span class='mono strong'>{{s.shipmentNumber}}</span>
                        <span class='muted'>{{s.latestEvent.statusDescription}}</span>
                        <span class='muted'>{{s.latestEvent.location}}</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              </section>
            {{/if}}

            <ul class='transit'>
              {{#each this.inTransit as |s|}}
                <li class='transit-card'>
                  <button
                    type='button'
                    class='transit-head'
                    {{on 'click' (fn this.openCard s)}}
                  >
                    <span class='mono strong'>{{s.shipmentNumber}}</span>
                    <span class='muted'>{{s.carrierName}}
                      {{s.serviceLevel}}</span>
                    <StatusChip
                      @label={{s.statusStyle.label}}
                      @hue={{s.statusStyle.hue}}
                    />
                  </button>
                  <ShipmentTracker
                    @status={{s.status}}
                    @events={{s.trackingEvents}}
                    @deliveryWindow={{s.deliveryWindow}}
                    @compact={{true}}
                  />
                </li>
              {{else}}
                <li class='empty'>Nothing in transit.</li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if (eq this.tab 'returns')}}
            <div class='collection-toolbar'>
              <div class='toolbar-left'>
                <div class='search'>
                  <BoxelInput
                    @value={{this.returnsSearch}}
                    @onInput={{this.setReturnsSearch}}
                    @placeholder='Search RMA, customer, reason or order'
                  />
                </div>
                <div class='filters'>
                  {{#each this.returnsBadges as |b|}}
                    <Pill
                      @kind='button'
                      @variant={{if
                        (eq this.returnsStatus b.id)
                        'primary'
                        'muted'
                      }}
                      aria-pressed='{{eq this.returnsStatus b.id}}'
                      {{on 'click' (fn this.setReturnsStatus b.id)}}
                    >{{b.label}}
                      <span class='badge-count'>{{b.count}}</span></Pill>
                  {{/each}}
                </div>
              </div>
              <div class='toolbar-right'>
                <ViewSelector
                  @items={{this.viewItems}}
                  @selectedId={{this.returnsView}}
                  @onChange={{this.setReturnsView}}
                />
                <Button
                  @kind='primary'
                  @size='small'
                  class='add-btn'
                  {{on 'click' this.createReturn}}
                ><PlusIcon width='16' height='16' role='presentation' />
                  <span class='add-label'>Add Return</span></Button>
              </div>
            </div>

            {{#if this.returnsQuery}}
              {{#if (this.isCardListView this.returnsView)}}
                <CardList
                  @context={{@context}}
                  @query={{this.returnsQuery}}
                  @realms={{this.realms}}
                  @format='fitted'
                  @isLive={{true}}
                  @viewOption={{this.viewOptionFor this.returnsView}}
                />
              {{else}}
                <div class='table-scroll'>
                  <Table
                    @query={{this.returnsQuery}}
                    @realm={{this.realm}}
                    @cardTypeRef={{this.returnsTypeRef}}
                    @context={{@context}}
                    @showClean={{true}}
                    @showComputedFields={{false}}
                    @showPrimitivesOnly={{false}}
                  />
                </div>
              {{/if}}
            {{else}}
              <p class='empty'>Loading returns…</p>
            {{/if}}
          {{/if}}
        </section>
      {{else}}
        <section class='panel static'>
          <p class='shell-note'>
            Fulfilment board, inventory, ship desk, tracking and returns load
            when this app is opened in the workspace.
          </p>
          <ul class='legend'>
            {{#each this.statusLegend as |s|}}
              <li><StatusChip @label={{s.label}} @hue={{s.hue}} /></li>
            {{/each}}
          </ul>
        </section>
      {{/if}}
    </div>

    <style scoped>
      .app {
        /* Adapter block: the semantic set forwarded once into this app's
           vocabulary. Every value is a token or a mix of one. */
        --ful-bg: var(--background);
        --ful-fg: var(--foreground);
        --ful-card-bg: var(--card);
        --ful-card-fg: var(--card-foreground);
        --ful-muted-fg: var(--muted-foreground);
        --ful-border: var(--border);
        --ful-rule: color-mix(in oklch, var(--foreground) 12%, transparent);
        --ful-perf: color-mix(in oklch, var(--foreground) 22%, transparent);
        --ful-sunk: color-mix(in oklch, var(--foreground) 3%, transparent);

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: var(--ful-bg, var(--boxel-light));
        color: var(--ful-fg, var(--boxel-dark));
        font-family: var(--font-sans, inherit);
      }

      /* The masthead is the app's one hero moment: a barcode mark, a heavy
         name, and the five numbers that decide what you do next. */
      .masthead {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        align-items: flex-end;
        justify-content: space-between;
        padding: var(--boxel-sp-lg) var(--boxel-sp-lg) var(--boxel-sp);
        border-bottom: 2px solid var(--ful-perf);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        min-width: 0;
      }
      .brand-mark {
        display: flex;
        align-items: stretch;
        gap: 2px;
        height: 34px;
      }
      .brand-mark span {
        display: block;
        background: color-mix(in oklch, var(--foreground) 75%, transparent);
      }
      .brand-mark span:nth-child(odd) {
        width: 3px;
      }
      .brand-mark span:nth-child(even) {
        width: 5px;
        opacity: 0.5;
      }
      .brand-name {
        margin: 0;
        font-size: 1.6rem;
        line-height: 1.05;
        font-family: var(--font-heading, inherit);
      }
      .brand-sub {
        margin: 2px 0 0;
        font-size: 0.75rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .counters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
        margin: 0;
      }
      .counters div {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .counters dt {
        font-size: 0.62rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .counters dd {
        margin: 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 1.7rem;
        font-weight: 800;
        line-height: 1;
      }
      /* A count that needs someone to act reads differently in form, not just
         in number. */
      .counters .alarm dd {
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 58%,
          var(--foreground, var(--boxel-dark))
        );
      }

      .tabs {
        display: flex;
        gap: 2px;
        padding: 0 var(--boxel-sp-lg);
        border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
        overflow-x: auto;
      }
      .tab {
        appearance: none;
        border: 0;
        background: transparent;
        padding: 10px 14px;
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        white-space: nowrap;
        color: var(--ful-muted-fg, var(--boxel-500));
        border-bottom: 2px solid transparent;
        cursor: pointer;
      }
      .tab:hover {
        color: var(--ful-fg, var(--boxel-dark));
      }
      .tab:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .tab-active {
        color: var(--ful-fg, var(--boxel-dark));
        border-bottom-color: var(--ful-perf);
      }

      .panel {
        /* The panel is the query container for the layouts below: the ship
           desk splits in two when there is room for it, regardless of how wide
           the browser is, because this card can sit in a narrow stack. */
        container-type: inline-size;
        container-name: ful-panel;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      /* ONE row: search + badges pinned left, view selector + add pinned right. */
      .collection-toolbar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .toolbar-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex: 1 1 auto;
        /* load-bearing: without it a flex item refuses to shrink below its
           content width and the row breaks early for no visible reason */
        min-width: 0;
        /* nowrap until the container is genuinely narrow: flex decides line
           breaks from BASE sizes, so a wrappable group wraps instead of letting
           the search shrink — which would put the badges on line two while
           448px of search sat un-shrunk. Wrapping is enabled at the breakpoint
           below, after the search has had its chance to give up space. */
        flex-wrap: nowrap;
        justify-content: flex-start;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex: 0 0 auto;
        /* the ONLY auto margin in the toolbar — never on a badge, a badge
           wrapper, or the view selector individually */
        margin-left: auto;
      }
      /* DIVERGENCE from the skill's literal `flex: 1 1 12rem; max-width: 28rem`,
         with measured cause: with `flex-grow: 1` the search is ALLOCATED the
         whole line, then `max-width` clamps what it paints — and the layout
         still treats the allocated space as taken, so the badges are pushed to
         x=983 beside "View as" (nowrap) or wrapped to a second line (wrap).
         Basis-as-maximum with no grow gives the same visual size and lets the
         badges sit where they belong. It still shrinks, so reflow step 1 is
         unchanged. */
      .toolbar-left .search {
        flex: 0 1 28rem;
        min-width: 8rem;
      }
      /* The badges hug the search — the left group is flex-start, so with the
         search no longer over-claiming space they land immediately after it. */
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        flex: 0 1 auto;
        min-width: 0;
        /* never a scroller and never a clipped badge: a filter whose label is
           cut mid-word ("Out" → "Ou…") is one the user cannot read */
        overflow: visible;
      }
      /* :deep is required — these are Pill component roots, which a scoped
         stylesheet does not reach. Each badge holds its size; the ROW wraps. */
      .filters > :deep(*) {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .badge-count {
        margin-left: 5px;
        font-variant-numeric: tabular-nums;
        opacity: 0.75;
      }
      .add-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      /* The reflow order, one step at a time. No step introduces a scroller and
         no step clips a control:
           1. the search shrinks toward its min-width (flex does this itself)
           2. the view selector drops its label, keeping the icons
           3. the badges wrap onto a second line inside the left group
           4. the toolbar wraps between the two groups
           5. the add button goes icon-only — last, because the label is the point */
      /* step 2: the view selector drops its label, keeping the icons */
      @container ful-panel (width < 900px) {
        .toolbar-right :deep(.view-options-label) {
          display: none;
        }
      }
      /* step 3: only now may the badges wrap onto a second line */
      @container ful-panel (width < 820px) {
        .toolbar-left {
          flex-wrap: wrap;
        }
      }
      /* step 5: last resort — the label is the point of the button */
      @container ful-panel (width < 430px) {
        .add-label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }

      .table-scroll {
        overflow-x: auto;
      }

      .ofb-host {
        flex: 1;
        min-height: 420px;
      }
      .board-card {
        display: flex;
        flex-direction: column;
        gap: 3px;
        height: 100%;
        padding: 10px 11px;
        box-sizing: border-box;
        border: 1px solid var(--ful-border, var(--boxel-border-color));
        border-radius: 4px;
        background: var(--ful-card-bg, var(--boxel-light));
        color: var(--ful-card-fg, var(--boxel-dark));
        text-align: left;
        cursor: pointer;
      }
      .board-card:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
      }
      .bc-top {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        align-items: baseline;
      }
      .bc-num {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.82rem;
        font-weight: 800;
      }
      .bc-flash {
        font-size: 0.6rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 1px 5px;
        border-radius: 2px;
        border: 1px dashed var(--ful-perf);
      }
      .bc-cust {
        margin: 0;
        font-size: 0.78rem;
        color: var(--ful-muted-fg, var(--boxel-500));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bc-meta {
        margin-top: auto;
        display: flex;
        justify-content: space-between;
        gap: 6px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.72rem;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .bc-total {
        font-weight: 800;
        color: var(--ful-card-fg, var(--boxel-dark));
      }
      .bc-wh {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.62rem;
        letter-spacing: 0.1em;
        color: var(--ful-muted-fg, var(--boxel-500));
      }

      .sub {
        border-top: 1px solid var(--ful-border, var(--boxel-border-color));
        padding-top: var(--boxel-sp);
      }
      .sub h2,
      .alert-box h2,
      .ship h2 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: 0.7rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
      }

      .rows {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 1px;
      }
      .row-btn,
      .stock-row {
        width: 100%;
        display: grid;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: 7px 8px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        font: inherit;
        font-size: 0.85rem;
        text-align: left;
        color: inherit;
        cursor: pointer;
      }
      .row-btn {
        grid-template-columns: 9rem minmax(0, 1fr) minmax(0, 1fr) auto auto;
      }
      .row-btn:hover,
      .stock-row:hover,
      .wh-tile:hover {
        background: var(--ful-sunk);
      }
      .row-btn:focus-visible,
      .stock-row:focus-visible,
      .wh-tile:focus-visible,
      .queue-btn:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
      }

      .stock-head,
      .stock-row {
        grid-template-columns: 3px minmax(0, 1fr) 10rem 5rem 5rem 5rem;
      }
      .stock-head {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: 0 8px 4px;
        border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
        font-size: 0.6rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
        grid-template-columns: minmax(0, 1fr) 10rem 5rem 5rem 5rem;
      }
      .stock-head span:nth-child(n + 3) {
        text-align: right;
      }
      .sr-bar {
        align-self: stretch;
        border-radius: 2px;
        background: color-mix(
          in oklch,
          var(--row-hue, var(--muted-foreground, var(--boxel-400))) 70%,
          transparent
        );
      }
      .sr-id {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .num {
        text-align: right;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .num.strong {
        font-weight: 800;
        color: var(--ful-fg, var(--boxel-dark));
      }
      .mono {
        font-family: var(--font-mono, ui-monospace, monospace);
      }
      .strong {
        font-weight: 700;
      }
      .muted {
        color: var(--ful-muted-fg, var(--boxel-500));
        font-size: 0.8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bar {
        height: 4px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--foreground) 10%, transparent);
        overflow: hidden;
      }
      .bar-fill {
        display: block;
        height: 100%;
        background: color-mix(in oklch, var(--foreground) 50%, transparent);
      }

      .wh-grid {
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      }
      .wh-tile {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--ful-border, var(--boxel-border-color));
        border-radius: 4px;
        background: transparent;
        font: inherit;
        text-align: left;
        color: inherit;
        cursor: pointer;
      }
      .wh-code {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.65rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .wh-name {
        font-size: 1rem;
        font-weight: 700;
      }
      .wh-stat,
      .wh-virtual {
        font-size: 0.75rem;
        color: var(--ful-muted-fg, var(--boxel-500));
      }

      .ship {
        display: grid;
        gap: var(--boxel-sp-lg);
        grid-template-columns: minmax(0, 1fr);
      }
      @container ful-panel (width > 720px) {
        .ship {
          grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.4fr);
        }
      }
      .ship-num {
        margin: 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 1.4rem;
        font-weight: 800;
      }
      .kv {
        display: grid;
        gap: 5px;
        margin: var(--boxel-sp-sm) 0 0;
      }
      .kv div {
        display: grid;
        grid-template-columns: 8rem minmax(0, 1fr);
        gap: var(--boxel-sp-xs);
        font-size: 0.85rem;
      }
      .kv dt {
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .kv dd {
        margin: 0;
        font-family: var(--font-mono, ui-monospace, monospace);
      }
      .queue-h {
        margin: var(--boxel-sp) 0 var(--boxel-sp-xxs);
        font-size: 0.7rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .queue {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .queue-btn {
        border: 1px solid var(--ful-border, var(--boxel-border-color));
        border-radius: 3px;
        background: transparent;
        padding: 3px 8px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.72rem;
        color: inherit;
        cursor: pointer;
      }
      .queue-btn.on {
        background: color-mix(in oklch, var(--foreground) 10%, transparent);
        font-weight: 700;
      }

      .rates-note {
        margin: 0 0 var(--boxel-sp-sm);
        font-size: 0.78rem;
        color: var(--ful-muted-fg, var(--boxel-500));
        max-width: 52ch;
      }
      .rate-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }
      .rate {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        justify-content: space-between;
        align-items: center;
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--ful-border, var(--boxel-border-color));
        border-radius: 4px;
      }
      .rate.best {
        border-width: 2px;
        border-color: var(--ful-perf);
      }
      .rate-id {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .tagline {
        font-size: 0.6rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .rate-name {
        font-weight: 700;
      }
      .rate-nums {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
      }
      .rate-cost {
        font-size: 1.15rem;
        font-weight: 800;
      }
      .rate-margin {
        font-size: 0.72rem;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .rate-margin.neg {
        font-weight: 800;
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 58%,
          var(--foreground, var(--boxel-dark))
        );
      }

      .alert-box {
        padding: var(--boxel-sp-sm);
        border-left: 3px solid
          color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 55%,
            transparent
          );
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 7%,
          transparent
        );
      }
      .transit {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--boxel-sp);
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      .transit-card {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--ful-border, var(--boxel-border-color));
        border-radius: 4px;
      }
      .transit-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        border: 0;
        background: transparent;
        padding: 0;
        font: inherit;
        text-align: left;
        color: inherit;
        cursor: pointer;
      }

      .empty {
        padding: var(--boxel-sp);
        font-size: 0.85rem;
        color: var(--ful-muted-fg, var(--boxel-500));
      }
      .static {
        gap: var(--boxel-sp);
      }
      .shell-note {
        margin: 0;
        font-size: 0.9rem;
        color: var(--ful-muted-fg, var(--boxel-500));
        max-width: 60ch;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      @media (width <= 640px) {
        .masthead,
        .panel {
          padding: var(--boxel-sp);
        }
        .counters {
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

function byType(klass: typeof CardDef) {
  let ref = identifyCard(klass);
  return ref ? { filter: { type: ref } } : undefined;
}

function eq(a: unknown, b: unknown) {
  return a === b;
}

function lt(a: number | undefined, b: number) {
  return (a ?? 0) < b;
}

function hue(value: string | undefined) {
  return htmlSafe(`--row-hue: ${value ?? 'var(--muted-foreground)'}`);
}

// Order Fulfilment — the app. It composes the blocks and owns nothing that a
// block should own: no hand-rolled board, no second status vocabulary, no
// bespoke tracking timeline. What it does own is the canvas, the five sections,
// and the domain decisions the blocks deliberately refused to make.
export class OrderFulfilmentApp extends CardDef {
  static displayName = 'Order Fulfilment';
  static icon = PackageIcon;
  // Five columns of board, a stock table with six numeric columns, and a rate
  // comparison that splits in two — none of them survive a narrow stack. The
  // app asks for the full width rather than degrading into a single column.
  static prefersWideFormat = true;

  @field operationName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: OrderFulfilmentApp) {
      return this.operationName?.length
        ? this.operationName
        : 'Order Fulfilment';
    },
  });

  static isolated = Isolated;

  static embedded = class Embedded extends Component<
    typeof OrderFulfilmentApp
  > {
    <template>
      <div class='app-emb'>
        <span class='app-name'>{{@model.operationName}}</span>
        <span class='app-sub'>Order fulfilment workspace</span>
      </div>
      <style scoped>
        .app-emb {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .app-name {
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .app-sub {
          font-size: 0.78rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof OrderFulfilmentApp> {
    <template>
      <span class='app-atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .app-atom {
          font-weight: 600;
          font-size: 0.85em;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof OrderFulfilmentApp> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <span class='eyebrow'>Fulfilment</span>
          <h3 class='headline'>{{@model.operationName}}</h3>
        </div>
        <div class='r-body'>
          <div class='mark' aria-hidden='true'>
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class='r-meta'>
          <span>Board · Inventory · Ship · Transit · Returns</span>
        </div>
      </article>

      <style scoped>
        .fit {
          --type-ratio: 1.24;
          --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));
          /* The block-axis budget. `--type-base` is driven mostly by `cqi`, which
             is huge in a wide, short cell (a 691x105 strip gave 15px, and the
             25px number it produced needed a 30px line box in a row that only
             had 22px — a 12px shear straight through the digits). Capping the
             SCALE against `cqb` fixes every role at once, where capping each
             display role individually did not: in a tall cell the cqi term still
             governs, so tiles are unchanged. */
          --type-base: clamp(
            10px,
            min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar)), 10cqb),
            17px
          );
          --meta-size: max(8px, calc(var(--type-base) / var(--type-ratio)));
          --glyph-size: max(11px, min(3cqi, 14cqb));
          --headline-size: max(
            11px,
            min(calc(var(--type-base) * pow(var(--type-ratio), 2)), 26cqb)
          );
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .eyebrow {
          display: block;
          font-size: var(--meta-size);
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .headline {
          margin: 1px 0 0;
          font-size: var(--headline-size);
          font-weight: 800;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .mark {
          display: flex;
          align-items: stretch;
          gap: 2px;
          height: 22px;
          margin-top: 6px;
        }
        .mark span {
          display: block;
          background: color-mix(in oklch, var(--card-foreground) 70%, transparent);
        }
        .mark span:nth-child(odd) {
          width: 2px;
        }
        .mark span:nth-child(even) {
          width: 4px;
          opacity: 0.5;
        }
        .r-meta {
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .r-body,
          .r-meta {
            display: none;
          }
          .headline {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (50px < height <= 130px) {
          .r-body {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default OrderFulfilmentApp;
