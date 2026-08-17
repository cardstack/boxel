import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import DatetimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { Button, BoxelInput } from '@cardstack/boxel-ui/components';
import RouteIcon from '@cardstack/boxel-icons/route';
import { Warehouse } from './warehouse';
import { FulfilmentOrder } from './fulfilment-order';

export const PICK_LIST_STATUSES = [
  { value: 'pending', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
];

export const PickListStatusField = enumField(StringField, {
  options: PICK_LIST_STATUSES,
  displayName: 'Pick List Status',
});

// One stop on the walk. `orderNumbers` is plural because batching is the whole
// point of a pick list: the same SKU picked once can serve three orders, and
// the picker needs to know how many to grab in total.
export class PickItemField extends FieldDef {
  static displayName = 'Pick Item';

  @field sku = contains(StringField);
  @field productName = contains(StringField);
  @field barcode = contains(StringField);
  @field binLocation = contains(StringField);
  @field quantity = contains(NumberField);
  @field pickedQuantity = contains(NumberField);
  @field isShort = contains(BooleanField);
  @field orderNumbers = containsMany(StringField);

  get isDone() {
    return (
      this.isShort === true || (this.pickedQuantity ?? 0) >= (this.quantity ?? 0)
    );
  }

  static embedded = class Embedded extends Component<typeof PickItemField> {
    <template>
      <div class='pi {{if @model.isDone "done"}}'>
        <span class='pi-bin'>{{if @model.binLocation @model.binLocation '—'}}</span>
        <div class='pi-id'>
          <span class='pi-sku'>{{@model.sku}}</span>
          <span class='pi-name'>{{@model.productName}}</span>
        </div>
        <span class='pi-qty'>{{if @model.pickedQuantity @model.pickedQuantity 0}}
          /
          {{if @model.quantity @model.quantity 0}}</span>
        <span class='pi-flag'>{{if @model.isShort 'short' ''}}</span>
      </div>

      <style scoped>
        .pi {
          display: grid;
          grid-template-columns: 6.5rem minmax(0, 1fr) 4rem 3.5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs) 0;
          font-size: 0.85rem;
        }
        .done {
          opacity: 0.55;
        }
        .pi-bin {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--foreground, var(--boxel-dark));
        }
        .pi-id {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .pi-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .pi-name {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pi-qty {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .pi-flag {
          text-align: right;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 60%,
            var(--foreground, var(--boxel-dark))
          );
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof PickItemField> {
    <template>
      <span class='pi-atom'>{{@model.binLocation}} · {{@model.sku}}</span>
      <style scoped>
        .pi-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
        }
      </style>
    </template>
  };
}

// Bins are named so that sorting them lexically walks the aisles in order —
// "A3-B-14" before "A3-C-02" before "B1-A-01". That is a property of how bins
// are labelled, not an optimisation this card invents, so the route is a plain
// sort rather than a solver pretending to be one.
export function routeOrder(items: PickItemField[] | undefined) {
  return [...(items ?? [])]
    .filter(Boolean)
    .sort((a, b) =>
      (a.binLocation ?? '~').localeCompare(b.binLocation ?? '~', undefined, {
        numeric: true,
      }),
    );
}

export class PickList extends CardDef {
  static displayName = 'Pick List';
  static icon = RouteIcon;

  @field pickListNumber = contains(StringField);
  @field warehouse = linksTo(() => Warehouse);
  @field orders = linksToMany(() => FulfilmentOrder);
  @field items = containsMany(PickItemField);
  @field assignedTo = contains(StringField);
  @field status = contains(PickListStatusField);
  @field createdAt = contains(DatetimeField);
  @field completedAt = contains(DatetimeField);

  @field totalUnits = contains(NumberField, {
    computeVia: function (this: PickList) {
      return (this.items ?? []).reduce((s, i) => s + (i?.quantity ?? 0), 0);
    },
  });

  @field pickedUnits = contains(NumberField, {
    computeVia: function (this: PickList) {
      return (this.items ?? []).reduce(
        (s, i) => s + (i?.pickedQuantity ?? 0),
        0,
      );
    },
  });

  @field warehouseCode = contains(StringField, {
    computeVia: function (this: PickList) {
      return this.warehouse?.code;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PickList) {
      return this.pickListNumber?.length
        ? this.pickListNumber
        : 'Untitled Pick List';
    },
  });

  get route() {
    return routeOrder(this.items);
  }

  get remaining() {
    return this.route.filter((i) => !i.isDone);
  }

  get nextItem() {
    return this.remaining[0];
  }

  get doneCount() {
    return this.route.length - this.remaining.length;
  }

  get progressPercent() {
    let total = this.route.length;
    if (!total) {
      return 0;
    }
    return Math.round((this.doneCount / total) * 100);
  }

  // The mobile pick walk. One item at a time, because a picker holding a phone
  // in one hand and a box in the other cannot parse a table.
  static isolated = class Isolated extends Component<typeof PickList> {
    @tracked scanValue = '';
    @tracked scanFeedback: string | undefined = undefined;
    @tracked busy = false;

    get model() {
      return this.args.model as PickList;
    }

    get canAct() {
      // No store means no persistence — in prerender or a read-only surface the
      // walk renders as a plan rather than offering buttons that would silently
      // do nothing.
      return Boolean((this.args as any).context?.store && this.model?.id);
    }

    // Writes the whole item array back. `store.patch` replaces arrays wholesale,
    // so the current values have to be re-serialized, not just the changed one.
    private async writeItems(mutate: (item: any, index: number) => any) {
      let store = (this.args as any).context?.store;
      let id = this.model?.id;
      if (!store || !id || this.busy) {
        return;
      }
      this.busy = true;
      try {
        let serialized = (this.model.items ?? []).map((item, index) => {
          let next = mutate(item, index);
          return {
            sku: next.sku ?? null,
            productName: next.productName ?? null,
            barcode: next.barcode ?? null,
            binLocation: next.binLocation ?? null,
            quantity: next.quantity ?? null,
            pickedQuantity: next.pickedQuantity ?? null,
            isShort: next.isShort ?? null,
            orderNumbers: next.orderNumbers ?? [],
          };
        });
        let allDone = serialized.every(
          (i) => i.isShort || (i.pickedQuantity ?? 0) >= (i.quantity ?? 0),
        );
        await store.patch(id, {
          attributes: {
            items: serialized,
            status: allDone ? 'complete' : 'in_progress',
            ...(allDone ? { completedAt: new Date().toISOString() } : {}),
          },
        });
      } finally {
        this.busy = false;
      }
    }

    private matches(item: any, value: string) {
      let v = value.trim().toLowerCase();
      if (!v) {
        return false;
      }
      return (
        (item.barcode ?? '').toLowerCase() === v ||
        (item.sku ?? '').toLowerCase() === v
      );
    }

    @action
    async pickCurrent() {
      let current = this.model.nextItem;
      if (!current) {
        return;
      }
      await this.writeItems((item) =>
        item === current
          ? {
              sku: item.sku,
              productName: item.productName,
              barcode: item.barcode,
              binLocation: item.binLocation,
              quantity: item.quantity,
              pickedQuantity: item.quantity,
              isShort: false,
              orderNumbers: item.orderNumbers,
            }
          : item,
      );
      this.scanFeedback = undefined;
    }

    @action
    async markShort() {
      let current = this.model.nextItem;
      if (!current) {
        return;
      }
      await this.writeItems((item) =>
        item === current
          ? {
              sku: item.sku,
              productName: item.productName,
              barcode: item.barcode,
              binLocation: item.binLocation,
              quantity: item.quantity,
              pickedQuantity: item.pickedQuantity ?? 0,
              isShort: true,
              orderNumbers: item.orderNumbers,
            }
          : item,
      );
      this.scanFeedback = 'Marked short — the order will need a partial ship.';
    }

    @action
    setScan(value: string) {
      this.scanValue = value;
    }

    // A USB barcode scanner is a keyboard that types fast and presses Enter.
    // Handling Enter on a plain text input therefore supports real hardware
    // without any device integration at all.
    @action
    async handleScanKey(event: KeyboardEvent) {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      let current = this.model.nextItem;
      if (!current) {
        return;
      }
      if (this.matches(current, this.scanValue)) {
        this.scanValue = '';
        await this.pickCurrent();
      } else {
        this.scanFeedback = `That is not ${current.sku}. Check the bin before picking.`;
        this.scanValue = '';
      }
    }

    <template>
      <article class='pl'>
        <header class='hd'>
          <div>
            <span class='eyebrow'>Pick list</span>
            <h1 class='num'>{{@model.pickListNumber}}</h1>
            <p class='sub'>
              {{if @model.warehouseCode @model.warehouseCode 'No warehouse'}}
              {{#if @model.assignedTo}}· {{@model.assignedTo}}{{/if}}
            </p>
          </div>
          <div class='count'>
            <span class='count-num'>{{@model.doneCount}}</span>
            <span class='count-of'>of {{@model.route.length}}</span>
          </div>
        </header>

        <div class='track' aria-hidden='true'>
          <span class='track-fill' style={{barWidth @model.progressPercent}}></span>
        </div>

        {{#if @model.nextItem}}
          <section class='next'>
            <span class='cap'>Next item</span>
            <p class='bin'>{{@model.nextItem.binLocation}}</p>
            <h2 class='item-name'>{{@model.nextItem.productName}}</h2>
            <p class='item-sku'>{{@model.nextItem.sku}}</p>
            <p class='take'>Take
              <strong>{{@model.nextItem.quantity}}</strong></p>
            {{#if @model.nextItem.orderNumbers.length}}
              <p class='for'>For
                {{#each @model.nextItem.orderNumbers as |o|}}<span
                    class='ord'
                  >{{o}}</span>{{/each}}</p>
            {{/if}}

            {{#if this.canAct}}
              <div class='scan'>
                <BoxelInput
                  @value={{this.scanValue}}
                  @onInput={{this.setScan}}
                  @placeholder='Scan barcode or type SKU'
                  {{on 'keydown' this.handleScanKey}}
                />
              </div>
              {{#if this.scanFeedback}}
                <p class='feedback'>{{this.scanFeedback}}</p>
              {{/if}}
              <div class='acts'>
                <Button
                  @kind='primary'
                  @disabled={{this.busy}}
                  {{on 'click' this.pickCurrent}}
                >Picked {{@model.nextItem.quantity}}</Button>
                <Button
                  @kind='secondary'
                  @disabled={{this.busy}}
                  {{on 'click' this.markShort}}
                >Item missing</Button>
              </div>
            {{else}}
              <p class='readonly'>Open this pick list in the app to scan and
                record picks.</p>
            {{/if}}
          </section>
        {{else}}
          <section class='next done'>
            <p class='done-msg'>Every line on this list is accounted for. Take the
              tote to the packing station.</p>
          </section>
        {{/if}}

        <section class='sec'>
          <h2 class='sec-h'>Route</h2>
          <div class='pi-head'>
            <span>Bin</span><span>Item</span><span>Picked</span><span></span>
          </div>
          {{#each @model.route as |item|}}
            <div class='route-row {{if item.isDone "row-done"}}'>
              <span class='r-bin'>{{if item.binLocation item.binLocation '—'}}</span>
              <div class='r-id'>
                <span class='r-sku'>{{item.sku}}</span>
                <span class='r-name'>{{item.productName}}</span>
              </div>
              <span class='r-qty'>{{if item.pickedQuantity item.pickedQuantity 0}}
                /
                {{if item.quantity item.quantity 0}}</span>
              <span class='r-flag'>{{if item.isShort 'short' ''}}</span>
            </div>
          {{/each}}
        </section>
      </article>

      <style scoped>
        .pl {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-perf: color-mix(in oklch, var(--foreground) 22%, transparent);

          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          background: var(--ful-bg, var(--boxel-light));
          color: var(--ful-fg, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .hd {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          justify-content: space-between;
          align-items: flex-start;
        }
        .eyebrow {
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .num {
          margin: 2px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 1.8rem;
          line-height: 1;
        }
        .sub {
          margin: 6px 0 0;
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .count {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .count-num {
          font-size: 2.4rem;
          font-weight: 800;
          line-height: 1;
        }
        .count-of {
          font-size: 0.9rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .track {
          height: 4px;
          margin-top: var(--boxel-sp);
          border-radius: 999px;
          background: color-mix(in oklch, var(--foreground) 10%, transparent);
          overflow: hidden;
        }
        .track-fill {
          display: block;
          height: 100%;
          background: color-mix(in oklch, var(--foreground) 55%, transparent);
        }
        /* The next-item card is deliberately oversized: it is read at arm's
           length, in a warehouse aisle, by someone who is not looking for it. */
        .next {
          margin-top: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          border: 2px solid var(--ful-perf);
          border-radius: 4px;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
        }
        .cap {
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .bin {
          margin: 6px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: clamp(2rem, 7vw, 3.2rem);
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0.02em;
        }
        .item-name {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 1.3rem;
          line-height: 1.15;
        }
        .item-sku {
          margin: 2px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.9rem;
          letter-spacing: 0.08em;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .take {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 1.1rem;
        }
        .take strong {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 1.6rem;
        }
        .for {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .ord {
          font-family: var(--font-mono, ui-monospace, monospace);
          margin-left: 6px;
        }
        .scan {
          margin-top: var(--boxel-sp);
        }
        .feedback {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: 0.82rem;
          font-weight: 600;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 58%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .acts {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp);
        }
        .readonly {
          margin: var(--boxel-sp) 0 0;
          font-size: 0.82rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .done-msg {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 600;
        }
        .sec {
          margin-top: var(--boxel-sp-lg);
        }
        .sec-h {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.72rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .pi-head,
        .route-row {
          display: grid;
          grid-template-columns: 6.5rem minmax(0, 1fr) 4rem 3.5rem;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }
        .pi-head {
          padding-bottom: 4px;
          border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .pi-head span:nth-child(n + 3) {
          text-align: right;
        }
        .route-row {
          padding: 5px 0;
          border-bottom: 1px solid
            color-mix(in oklch, var(--foreground) 6%, transparent);
          font-size: 0.85rem;
        }
        .row-done {
          opacity: 0.5;
        }
        .r-bin,
        .r-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
        }
        .r-bin {
          font-size: 0.8rem;
        }
        .r-id {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .r-sku {
          font-size: 0.75rem;
        }
        .r-name {
          font-size: 0.75rem;
          color: var(--ful-muted-fg, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .r-qty {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .r-flag {
          text-align: right;
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 60%,
            var(--foreground, var(--boxel-dark))
          );
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PickList> {
    <template>
      <div class='p-emb'>
        <span class='p-num'>{{@model.pickListNumber}}</span>
        <span class='p-wh'>{{if @model.warehouseCode @model.warehouseCode '—'}}</span>
        <span class='p-slot'>{{@model.doneCount}}/{{@model.route.length}} lines</span>
        <span class='p-slot'>{{@model.totalUnits}} units</span>
      </div>

      <style scoped>
        .p-emb {
          display: grid;
          grid-template-columns: 8rem minmax(0, 1fr) 7rem 6rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.88rem;
        }
        .p-num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .p-wh {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.78rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .p-slot {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 0.78rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof PickList> {
    <template>
      <span class='p-atom'>{{@model.pickListNumber}}</span>
      <style scoped>
        .p-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof PickList> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <RouteIcon class='glyph' />
            <span class='wh'>{{if @model.warehouseCode @model.warehouseCode ''}}</span>
          </div>
          <h3 class='headline'>{{@model.pickListNumber}}</h3>
        </div>
        <div class='r-body'>
          <div class='big'>
            <span class='done'>{{@model.doneCount}}</span>
            <span class='of'>of {{@model.route.length}} lines</span>
          </div>
          <div class='gauge' aria-hidden='true'>
            <span
              class='gauge-fill'
              style={{barWidth @model.progressPercent}}
            ></span>
          </div>
        </div>
        <div class='r-meta'>
          <span class='units'>{{@model.totalUnits}} units</span>
          <span class='who'>{{if @model.assignedTo @model.assignedTo ''}}</span>
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
          /* The identifier is a VALUE, so it must render in full. It is capped
             against the inline axis as well as the block axis so a real order /
             RMA / SKU always fits its box — the ellipsis below is a safety net
             for a pathological identifier, not a truncation strategy. */
          --headline-size: max(
            11px,
            min(
              calc(var(--type-base) * pow(var(--type-ratio), 2)),
              26cqb,
              7.5cqi
            )
          );
          --big-size: max(
            14px,
            min(calc(var(--type-base) * pow(var(--type-ratio), 2.4)), 34cqb)
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
        /* The card's own icon, the same one its isolated view uses — the
           fitted's visual anchor. It sits on the quiet eyebrow row so it can
           never compete with the headline, and it is the first thing dropped
           at the badge quantum. */
        .eyebrow {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .glyph {
          flex: none;
          width: var(--glyph-size);
          height: var(--glyph-size);
          color: var(--muted-foreground, var(--boxel-400));
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-meta {
          display: flex;
          gap: 8px;
          justify-content: space-between;
          align-items: baseline;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .wh {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .headline {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--headline-size);
          font-weight: 800;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .big {
          display: flex;
          align-items: baseline;
          gap: 5px;
          margin-top: 2px;
        }
        .done {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: var(--big-size);
          font-weight: 800;
          line-height: 1.2;
        }
        .of {
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .gauge {
          margin-top: 6px;
          height: 4px;
          border-radius: 999px;
          background: color-mix(in oklch, var(--card-foreground) 12%, transparent);
          overflow: hidden;
        }
        .gauge-fill {
          display: block;
          height: 100%;
          background: color-mix(in oklch, var(--card-foreground) 55%, transparent);
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .eyebrow,
          .r-body,
          .r-meta {
            display: none;
          }
        }
        @container fitted-card (50px < height <= 80px) {
          .r-body {
            display: none;
          }
        }
        @container fitted-card (80px < height <= 130px) {
          .gauge {
            display: none;
          }
        }
        @container fitted-card (width <= 140px) {
          .who {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function barWidth(pct: number | undefined) {
  return htmlSafe(`width: ${Math.min(100, Math.max(0, pct ?? 0))}%`);
}

export default PickList;
