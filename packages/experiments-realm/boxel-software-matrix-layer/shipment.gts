import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import DatetimeField from '@cardstack/base/datetime';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { htmlSafe } from '@ember/template';
import { money } from './fulfilment-format';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { Button, BoxelInput, BoxelSelect } from '@cardstack/boxel-ui/components';
import PackageIcon from '@cardstack/boxel-icons/package';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import MapPin from '@cardstack/boxel-icons/map-pin';
import Receipt from '@cardstack/boxel-icons/receipt';
import Route from '@cardstack/boxel-icons/route';
import Truck from '@cardstack/boxel-icons/truck';
import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';
import DispatchShipmentCommand from './dispatch-shipment-command';
import FulfilOrderCommand from './fulfil-order-command';
import TrackingNumberField from './tracking-number';
import ParcelDimensionsField from './parcel-dimensions';
import DeliveryWindowField from './delivery-window';
import { FulfilmentLineItemField } from './fulfilment-line-item';
import {
  ShipmentStatusField,
  shipmentStatusStyle,
  isShipmentException,
} from './shipment-status';
import { FulfilmentOrder } from './fulfilment-order';
import { Warehouse } from './warehouse';
import { Carrier } from './carrier';
import StatusChip from './fulfilment-status-chip';
import { ShipmentTracker } from './shipment-tracker';

// One scan on the package's journey. Carriers emit these; we store them
// verbatim rather than collapsing them into the status, because the sequence is
// what a customer service conversation is actually about.
export class TrackingEventField extends FieldDef {
  static displayName = 'Tracking Event';

  @field occurredAt = contains(DatetimeField);
  @field statusCode = contains(StringField);
  @field statusDescription = contains(StringField);
  @field location = contains(StringField);
  @field isDelivered = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof TrackingEventField> {
    <template>
      <div class='ev'>
        <span class='ev-when'><@fields.occurredAt @format='atom' /></span>
        <span class='ev-desc'>{{@model.statusDescription}}</span>
        <span class='ev-where'>{{if @model.location @model.location '—'}}</span>
      </div>

      <style scoped>
        .ev {
          display: grid;
          grid-template-columns: 10rem minmax(0, 1fr) 9rem;
          gap: var(--boxel-sp-xs);
          font-size: 0.82rem;
          padding: 3px 0;
        }
        .ev-when {
          font-family: var(--font-mono, ui-monospace, monospace);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .ev-desc {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .ev-where {
          text-align: right;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof TrackingEventField> {
    <template>
      <span class='ev-atom'>{{@model.statusDescription}}</span>
      <style scoped>
        .ev-atom {
          font-size: 0.85em;
        }
      </style>
    </template>
  };
}

// Shipment (Sh) — a physical package.
//
// Kept separate from the order on purpose. One order becomes two shipments when
// stock sits in two warehouses; two orders become one when a customer buys
// twice in a morning. Neither is expressible if shipment is a set of fields on
// the order.
//
// The carrier's name, tracking URL pattern and dimensional divisor are
// SNAPSHOTTED onto the shipment when the label is created, not read through the
// link. A carrier renaming a service two years from now must not rewrite what
// happened on a package that already arrived.
export class Shipment extends CardDef {
  static displayName = 'Shipment';
  static icon = PackageIcon;

  @field shipmentNumber = contains(StringField);
  @field order = linksTo(() => FulfilmentOrder);
  @field originWarehouse = linksTo(() => Warehouse);
  @field carrier = linksTo(() => Carrier);

  @field lineItems = containsMany(FulfilmentLineItemField);
  @field parcel = contains(ParcelDimensionsField);
  @field trackingNumber = contains(TrackingNumberField);
  @field deliveryWindow = contains(DeliveryWindowField);
  @field trackingEvents = containsMany(TrackingEventField);

  @field serviceLevel = contains(StringField);
  @field carrierName = contains(StringField);
  @field shippingCost = contains(AmountWithCurrency);
  @field customerPaid = contains(AmountWithCurrency);
  @field labelUrl = contains(StringField);

  @field status = contains(ShipmentStatusField);
  @field shippedAt = contains(DatetimeField);
  @field deliveredAt = contains(DatetimeField);
  @field proofOfDelivery = contains(StringField);
  @field isDropship = contains(BooleanField);

  @field orderNumber = contains(StringField, {
    computeVia: function (this: Shipment) {
      return this.order?.orderNumber;
    },
  });

  @field originCode = contains(StringField, {
    computeVia: function (this: Shipment) {
      return this.originWarehouse?.code;
    },
  });

  @field itemCount = contains(NumberField, {
    computeVia: function (this: Shipment) {
      return (this.lineItems ?? []).reduce(
        (sum, l) => sum + (l?.quantity ?? 0),
        0,
      );
    },
  });

  // Margin on the shipping line: what the customer paid minus what the carrier
  // charged. Negative is the number worth seeing, which is why it is computed
  // rather than left for someone to work out per package.
  @field shippingMargin = contains(NumberField, {
    computeVia: function (this: Shipment) {
      let paid = this.customerPaid?.amount;
      let cost = this.shippingCost?.amount;
      if (paid == null || cost == null) {
        return undefined;
      }
      return Math.round((paid - cost) * 100) / 100;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Shipment) {
      return this.shipmentNumber?.length
        ? this.shipmentNumber
        : 'Untitled Shipment';
    },
  });

  get statusStyle() {
    return shipmentStatusStyle(this.status);
  }

  get isException() {
    return isShipmentException(this.status);
  }

  // Before dispatch there is no snapshot yet, so fall back to the linked
  // carrier's current name. After dispatch the snapshot wins — which is the
  // whole point of taking one.
  get carrierLabel() {
    return this.carrierName ?? this.carrier?.carrierName;
  }

  // Losing money on the shipping line is the number a small business wants
  // flagged, not buried in a column of similar-looking figures.
  get isMarginNegative() {
    return this.shippingMargin != null && this.shippingMargin < 0;
  }

  // Late is derived, not stored: the promise and the actual are both already
  // here, so a stored flag would only be a third thing to keep in step.
  get isLate() {
    let promised = this.deliveryWindow?.latest;
    if (!promised) {
      return false;
    }
    let actual = this.deliveredAt;
    if (actual) {
      return actual.getTime() > promised.getTime();
    }
    return this.status !== 'delivered' && Date.now() > promised.getTime();
  }

  get latestEvent() {
    let events = (this.trackingEvents ?? []).filter(Boolean);
    if (!events.length) {
      return undefined;
    }
    return [...events].sort(
      (a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0),
    )[events.length - 1];
  }

  static isolated = class Isolated extends Component<typeof Shipment> {
    @tracked trackingInput = '';
    @tracked podInput = '';
    @tracked selectedService: string | undefined = undefined;
    @tracked busy = false;
    @tracked feedback: string | undefined = undefined;
    @tracked failed = false;

    get model() {
      return this.args.model as Shipment;
    }

    // No tool context means no command runner — in prerender or a read-only
    // surface the card shows what happened rather than offering buttons that
    // would do nothing.
    get canRun() {
      return Boolean(this.args.context?.toolContext && this.model?.id);
    }

    get serviceOptions() {
      return (this.model.carrier?.services ?? [])
        .filter(Boolean)
        .map((s) => ({
          code: s.code ?? '',
          label: `${s.serviceName ?? s.code} — ${s.speedLabel ?? ''}`,
        }));
    }

    get selectedServiceOption() {
      return this.serviceOptions.find((o) => o.code === this.selectedService);
    }

    get isDispatchable() {
      let status = this.model.status;
      return !status || status === 'label_created';
    }

    get isDeliverable() {
      let status = this.model.status;
      return status === 'in_transit' || status === 'out_for_delivery';
    }

    // A package in exception has not finished its journey — it has stopped. It
    // used to fall through to the "nothing further to record" branch, which
    // told the operator there was nothing to do about the one shipment the app
    // paints red. The two real exits are: it moved again (re-dispatch with the
    // carrier's new tracking number), or it came back (returned to sender).
    get isStalled() {
      return this.model.status === 'exception';
    }

    get deliveredRecord() {
      let at = this.model.deliveredAt;
      if (!at) {
        return undefined;
      }
      let promised = this.model.deliveryWindow?.latest;
      return {
        at,
        wasLate: promised ? at.getTime() > promised.getTime() : undefined,
        promised,
      };
    }

    @action setTracking(value: string) {
      this.trackingInput = value;
    }

    @action setPod(value: string) {
      this.podInput = value;
    }

    @action chooseService(option: { code: string }) {
      this.selectedService = option?.code;
    }

    @action
    async dispatch() {
      let toolContext = this.args.context?.toolContext;
      if (!toolContext || this.busy) {
        return;
      }
      this.busy = true;
      this.failed = false;
      this.feedback = undefined;
      try {
        let result = await new DispatchShipmentCommand(toolContext).execute({
          shipmentId: this.model.id,
          serviceCode: this.selectedService,
          trackingNumber: this.trackingInput.trim(),
        });
        this.feedback = `Dispatched on ${result.serviceLevel} — quoted ${result.quotedCost} at ${result.billableWeight} kg billable, due ${result.estimatedDelivery}.`;
        this.trackingInput = '';
      } catch (e) {
        this.failed = true;
        this.feedback = e instanceof Error ? e.message : String(e);
      } finally {
        this.busy = false;
      }
    }

    // Off-path exit. It is a status write plus a scan, not a fulfilment: no
    // order is closed, because nothing arrived. Kept as a store patch rather
    // than a command because there is no second fact to derive from it.
    @action
    async markReturnedToSender() {
      let store = this.args.context?.store;
      if (!store || !this.model.id || this.busy) {
        return;
      }
      this.busy = true;
      this.failed = false;
      this.feedback = undefined;
      try {
        let now = new Date().toISOString();
        let events = (this.model.trackingEvents ?? [])
          .filter(Boolean)
          .map((e) => ({
            occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
            statusCode: e.statusCode ?? null,
            statusDescription: e.statusDescription ?? null,
            location: e.location ?? null,
            isDelivered: e.isDelivered ?? false,
          }));
        await store.patch(this.model.id, {
          attributes: {
            status: 'returned_to_sender',
            trackingEvents: [
              ...events,
              {
                occurredAt: now,
                statusCode: 'RTS',
                statusDescription: 'Returned to sender',
                location: null,
                isDelivered: false,
              },
            ],
          },
        });
        this.feedback =
          'Marked returned to sender. It has left the in-transit list; raise a return if the customer is owed a refund.';
        this.trackingInput = '';
      } catch (e) {
        this.failed = true;
        this.feedback = e instanceof Error ? e.message : String(e);
      } finally {
        this.busy = false;
      }
    }

    @action
    async markDelivered() {
      let toolContext = this.args.context?.toolContext;
      if (!toolContext || this.busy) {
        return;
      }
      this.busy = true;
      this.failed = false;
      this.feedback = undefined;
      try {
        let result = await new FulfilOrderCommand(toolContext).execute({
          shipmentId: this.model.id,
          // Empty stays empty: the command omits the attribute entirely rather
          // than writing null over a note already on the card.
          proofOfDelivery: this.podInput.trim(),
        });
        this.podInput = '';
        this.feedback = result.orderNumber
          ? result.wasAlreadyFulfilled
            ? `Delivered. ${result.orderNumber} was already fulfilled, so its fulfilment date stands.`
            : `Delivered. ${result.orderNumber} is now fulfilled.`
          : 'Delivered. This shipment has no order to close.';
      } catch (e) {
        this.failed = true;
        this.feedback = e instanceof Error ? e.message : String(e);
      } finally {
        this.busy = false;
      }
    }

    <template>
      <article class='shp'>
        <header class='label'>
          <div class='label-top'>
            <div>
              <span class='eyebrow'>Shipment</span>
              <h1 class='num'>{{@model.shipmentNumber}}</h1>
            </div>
            <div class='carrier-block'>
              <span class='carrier'>{{if
                  @model.carrierLabel
                  @model.carrierLabel
                  'No carrier'
                }}</span>
              {{#if @model.serviceLevel}}
                <span class='service'>{{@model.serviceLevel}}</span>
              {{/if}}
            </div>
          </div>

          <div class='label-mid'>
            <div class='tn-block'>
              <span class='cap'>Tracking</span>
              <@fields.trackingNumber @format='embedded' />
            </div>
            <div class='code' aria-hidden='true'>
              <span></span><span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
          </div>

          <div class='label-bot'>
            <div>
              <span class='cap'>Order</span>
              <span class='val mono'>{{if @model.orderNumber @model.orderNumber '—'}}</span>
            </div>
            <div>
              <span class='cap'>From</span>
              <span class='val mono'>{{if @model.originCode @model.originCode '—'}}</span>
            </div>
            <div>
              <span class='cap'>Parcel</span>
              <span class='val'><@fields.parcel @format='atom' /></span>
            </div>
            <div>
              <span class='cap'>Status</span>
              <span class='val'><StatusChip
                  @label={{@model.statusStyle.label}}
                  @hue={{@model.statusStyle.hue}}
                /></span>
            </div>
          </div>
        </header>

        {{#if this.canRun}}
          <section class='actions'>
            {{#if this.isDispatchable}}
              <h2><Truck class='sec-icon' role='presentation' />Dispatch</h2>
              <p class='act-note'>Choose the service you actually bought and
                enter the tracking number off the printed label. The rate is
                quoted from the carrier's own table and stamped onto this
                shipment.</p>
              <div class='act-row'>
                <BoxelSelect
                  @options={{this.serviceOptions}}
                  @selected={{this.selectedServiceOption}}
                  @onChange={{this.chooseService}}
                  @placeholder='Service'
                  @renderInPlace={{true}}
                  class='act-select'
                  as |opt|
                >{{opt.label}}</BoxelSelect>
                <BoxelInput
                  @value={{this.trackingInput}}
                  @onInput={{this.setTracking}}
                  @placeholder='Tracking number'
                  class='act-input'
                />
                <Button
                  @kind='primary'
                  @disabled={{this.busy}}
                  {{on 'click' this.dispatch}}
                >Dispatch</Button>
              </div>
            {{else if this.isDeliverable}}
              <h2><MapPin class='sec-icon' role='presentation' />Delivery</h2>
              <p class='act-note'>Records the delivery and closes the order,
                stamping its fulfilment date once. Where the parcel was left is
                the detail a disputed delivery turns on, so it is captured here
                rather than remembered.</p>
              <div class='act-row'>
                <BoxelInput
                  @value={{this.podInput}}
                  @onInput={{this.setPod}}
                  @placeholder='Proof of delivery — signed by, or where left (optional)'
                  class='act-input'
                />
                <Button
                  @kind='primary'
                  @disabled={{this.busy}}
                  {{on 'click' this.markDelivered}}
                >Mark delivered</Button>
              </div>
            {{else if this.isStalled}}
              <h2><TriangleAlert
                  class='sec-icon'
                  role='presentation'
                />Stalled</h2>
              <p class='act-note'>This package is not moving. If the carrier has
                issued a new tracking number, re-dispatch it below; if it is on
                its way back to you, send it to returned-to-sender so it leaves
                the in-transit list.</p>
              <div class='act-row'>
                <BoxelInput
                  @value={{this.trackingInput}}
                  @onInput={{this.setTracking}}
                  @placeholder='New tracking number'
                  class='act-input'
                />
                <Button
                  @kind='primary'
                  @disabled={{this.busy}}
                  {{on 'click' this.dispatch}}
                >Re-dispatch</Button>
                <Button
                  @disabled={{this.busy}}
                  {{on 'click' this.markReturnedToSender}}
                >Returned to sender</Button>
              </div>
            {{else}}
              <h2><CircleCheck class='sec-icon' role='presentation' />Closed</h2>
              {{#if this.deliveredRecord}}
                {{! The delivery was recorded and then withheld: deliveredAt and
                    proofOfDelivery were both written by the command and drawn
                    by nothing. This is the read side of Mark delivered. }}
                <dl class='kv delivered-kv'>
                  <div>
                    <dt>Delivered</dt>
                    <dd><@fields.deliveredAt @format='atom' /></dd>
                  </div>
                  {{#if this.deliveredRecord.promised}}
                    <div>
                      <dt>Against promise</dt>
                      <dd class={{if this.deliveredRecord.wasLate 'late-val'}}>
                        {{#if this.deliveredRecord.wasLate}}
                          Late — promised
                          <@fields.deliveryWindow @format='atom' />
                        {{else}}
                          On time
                        {{/if}}
                      </dd>
                    </div>
                  {{/if}}
                  <div>
                    <dt>Proof of delivery</dt>
                    <dd>{{#if @model.proofOfDelivery}}{{@model.proofOfDelivery}}
                      {{else}}<span class='muted'>Not recorded</span>{{/if}}</dd>
                  </div>
                </dl>
              {{else}}
                <p class='act-note'>This shipment has finished its journey.
                  Nothing further to record.</p>
              {{/if}}
            {{/if}}

            {{#if this.feedback}}
              <p class='act-feedback {{if this.failed "act-failed"}}'>{{this.feedback}}</p>
            {{/if}}
          </section>
        {{/if}}

        {{#if @model.isException}}
          <p class='alert'>
            This package is in exception. It will not move again until someone
            acts — check the latest scan below for what the carrier needs.
          </p>
        {{else if @model.isLate}}
          <p class='alert'>
            Past its promised delivery window. The customer has almost certainly
            noticed.
          </p>
        {{/if}}

        <section class='sec'>
          <h2><Route class='sec-icon' role='presentation' />Journey</h2>
          <ShipmentTracker
            @status={{@model.status}}
            @events={{@model.trackingEvents}}
            @deliveryWindow={{@model.deliveryWindow}}
            @trackingUrl={{@model.trackingNumber.trackingUrl}}
          />
        </section>

        <div class='cols'>
          <section class='sec'>
            <h2><PackageIcon class='sec-icon' role='presentation' />Contents</h2>
            {{#if @model.lineItems.length}}
              <@fields.lineItems @format='embedded' />
            {{else}}
              <p class='empty'>No contents recorded on this shipment.</p>
            {{/if}}
          </section>

          <section class='sec'>
            <h2><Receipt class='sec-icon' role='presentation' />Cost</h2>
            <dl class='kv'>
              <div>
                <dt>Carrier charged</dt>
                <dd>{{#if @model.shippingCost.amount}}{{money @model.shippingCost.amount @model.customerPaid.currency.code}}{{else}}—{{/if}}</dd>
              </div>
              <div>
                <dt>Customer paid</dt>
                <dd>{{#if @model.customerPaid.amount}}{{money @model.customerPaid.amount @model.customerPaid.currency.code}}{{else}}—{{/if}}</dd>
              </div>
              <div>
                <dt>Margin</dt>
                {{! `shippingMargin` is a NumberField, so it printed raw: "-1.88"
                    sat under "£6.87" and "£4.99" — three money values on one
                    card, one of them missing its symbol. Through `money` like
                    every other figure in this family. }}
                <dd class='{{if @model.isMarginNegative "neg"}}'>{{#if
                    @model.shippingMargin
                  }}{{money
                    @model.shippingMargin
                    @model.customerPaid.currency.code
                  }}{{else}}—{{/if}}</dd>
              </div>
            </dl>
          </section>
        </div>
      </article>

      <style scoped>
        .shp {
          /* Type scale, mapped to the house 1.333 modular scale rather than the
             28 hand-picked rem values these cards used to carry — 44 of which
             fell below 12px, under the smallest token the design system has. */
          --t-micro: var(--boxel-font-size-xs);
          --t-sm: var(--boxel-font-size-sm);
          --t-body: var(--boxel-font-size);
          --t-lg: var(--boxel-font-size-lg);
          --t-xl: var(--boxel-font-size-xl);
          /* Isolated gets NO container from the host — every ancestor up to the
             panel is `container-type: normal`, so an `@container` rule here is
             inert until this declares its own. `inline-size`, not `size`: the
             card scrolls, and `size` needs a definite block size. */
          container-type: inline-size;
          container-name: card-iso;
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-perf: color-mix(in oklch, var(--foreground) 22%, transparent);
          /* ONE panel primitive. Every full-width tinted block on this card —
             section, note, alert, callout — takes its ground, inset and radius
             from here, because a background makes spacing VISIBLE: while
             sections were separated by whitespace alone, a note padded
             `sp-sm` and a section padded `sp-lg` looked the same. Tint them
             both and their text edges no longer line up down the page, and
             every gap between them reads as a mis-registration rather than a
             rhythm. The inset is the thing that must agree; the tint only
             exposed it. */
          --panel-bg: color-mix(in oklch, var(--foreground) 3%, transparent);
          --panel-pad: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          --panel-radius: var(--radius, 8px);
          /* The ONE vertical rhythm. It used to be `margin-top` on `.sec` plus a
             `.cols .sec { margin-top: 0 }` override for the side-by-side case —
             two mechanisms for one relationship, and `.cols` itself had neither,
             so the measured gap above a two-column group was 0px while the gap
             above a stacked section was 28.4px. A tinted panel colliding with
             the text above it is what that 0 looks like. */
          --panel-gap: var(--boxel-sp-xl);

          display: flex;
          flex-direction: column;
          gap: var(--panel-gap);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          background: var(--ful-bg, var(--boxel-light));
          color: var(--ful-fg, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        /* The hero is the label itself: heavy border, perforated divisions,
           monospace throughout — the physical object this card stands for. */
        .label {
          border: 2px solid var(--ful-perf);
          border-radius: 3px;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
        }
        .label-top {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          justify-content: space-between;
          align-items: flex-start;
          padding: var(--boxel-sp);
          border-bottom: 2px dashed var(--ful-perf);
        }
        .eyebrow {
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .num {
          margin: 2px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--t-xl);
          line-height: 1;
        }
        .carrier-block {
          text-align: right;
        }
        .carrier {
          display: block;
          font-size: var(--t-body);
          font-weight: 800;
          letter-spacing: 0.02em;
        }
        .service {
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .label-mid {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          align-items: center;
          justify-content: space-between;
          padding: var(--boxel-sp);
          border-bottom: 2px dashed var(--ful-perf);
        }
        .code {
          display: flex;
          align-items: stretch;
          gap: 2px;
          height: 42px;
          flex: 1 1 160px;
          max-width: 320px;
          justify-content: flex-end;
        }
        .code span {
          display: block;
          background: color-mix(in oklch, var(--card-foreground) 78%, transparent);
        }
        .code span:nth-child(3n) {
          width: 5px;
          opacity: 0.5;
        }
        .code span:nth-child(3n + 1) {
          width: 2px;
        }
        .code span:nth-child(3n + 2) {
          width: 3px;
          opacity: 0.75;
        }
        .label-bot {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
        .label-bot > div {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cap {
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .val {
          font-size: var(--t-sm);
          font-weight: 600;
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        /* A different TINT (it is a warning, not a section) but the same inset
           and corner — the ground says what kind of block it is, the geometry
           keeps it registered with everything above and below it. */
        .alert {
          margin: var(--boxel-sp) 0 0;
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          border-left: 3px solid
            color-mix(
              in oklch,
              var(--destructive, var(--boxel-danger)) 55%,
              transparent
            );
          background: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 8%,
            transparent
          );
          font-size: var(--t-sm);
          color: var(--ful-fg, var(--boxel-dark));
        }
        .actions {
          margin-top: var(--boxel-sp-lg);
          padding: var(--panel-pad);
          border: 1px solid var(--ful-border, var(--boxel-border-color));
          border-radius: 4px;
        }
        .actions h2 {
          margin: 0 0 var(--boxel-sp-xxs);
          font-size: var(--t-micro);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .act-note {
          margin: 0 0 var(--boxel-sp-sm);
          font-size: var(--t-micro);
          max-width: 60ch;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .act-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }
        .act-select {
          flex: 1 1 220px;
          max-width: 320px;
        }
        .act-input {
          flex: 1 1 200px;
          max-width: 280px;
        }
        .act-feedback {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: var(--t-sm);
          font-weight: 600;
          color: var(--ful-fg, var(--boxel-dark));
        }
        .act-failed {
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 58%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .sec {
          /* A surface, not just a gap. Sections were told apart only by spacing,
             and their headings were 12px uppercase muted — pixel-identical to
             every table column label on the card, so "where does a section
             start" had no answer. The ground is mixed toward --foreground so it
             follows the theme in both modes rather than being a grey. */
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          background: var(--panel-bg);
        }
        .sec h2 {
          /* The section heading is now the loudest uppercase thing on the card:
             --foreground against the column labels' --muted-foreground. Weight
             alone (500 vs 400) was not a readable difference. */
          display: flex;
          align-items: center;
          gap: 7px;
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ful-fg, var(--foreground, var(--boxel-dark)));
        }
        .kv {
          display: grid;
          gap: 6px;
          margin: 0;
        }
        .kv div {
          display: grid;
          grid-template-columns: 9rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
        }
        .kv dt {
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: var(--t-sm);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .neg {
          font-weight: 800;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 60%,
            var(--foreground, var(--boxel-dark))
          );
        }
        /* The delivered record sits inside the actions section, which has no
           surface of its own, so it needs its own top margin. Prose, not
           figures: the POD line is a sentence, so it drops the mono. */
        .delivered-kv {
          margin-top: var(--boxel-sp-xs);
        }
        .delivered-kv dd {
          font-family: inherit;
        }
        .late-val {
          font-weight: 700;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 58%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .muted {
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .empty {
          font-size: var(--t-sm);
          color: var(--ful-muted-fg, var(--boxel-500));
        }

        /* Section icons: one size, one muted colour, everywhere. They make the
           card scannable by shape; they must never compete with the heading. */
        h2 .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: 0 0 auto;
          color: var(--ful-muted-fg, var(--boxel-500));
        }

        /* One collapse stop. The card is rendered in a resizable stack panel, so
           this fires when a second card opens beside it — not only on a phone. */
        @container card-iso (width < 720px) {
          .cols,
          .grid,
          .two {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Shipment> {
    <template>
      <div class='s-emb'>
        <span class='s-num'>{{@model.shipmentNumber}}</span>
        <span class='s-carrier'>{{if @model.carrierName @model.carrierName '—'}}</span>
        <span class='s-status'><StatusChip
            @label={{@model.statusStyle.label}}
            @hue={{@model.statusStyle.hue}}
          /></span>
        <span class='s-slot'><@fields.deliveryWindow @format='atom' /></span>
      </div>

      <style scoped>
        .s-emb {
          display: grid;
          grid-template-columns: 8.5rem minmax(0, 1fr) auto 6rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: 0.88rem;
        }
        .s-num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .s-carrier {
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .s-slot {
          text-align: right;
          font-size: 0.78rem;
        }
        @container (width < 400px) {
          .s-emb {
            grid-template-columns: 8rem minmax(0, 1fr) auto;
          }
          .s-slot {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Shipment> {
    <template>
      <span class='s-atom'>{{@model.shipmentNumber}}</span>
      <style scoped>
        .s-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Shipment> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='hd-row'>
            <span class='dot' style={{dotStyle @model.statusStyle.hue}}></span>
            <span class='num'>{{@model.shipmentNumber}}</span>
          </div>
          <span class='carrier'>{{@model.carrierName}}</span>
        </div>

        <div class='r-body'>
          <div class='code' aria-hidden='true'>
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span>
          </div>
          <p class='tn'>{{@model.trackingNumber.number}}</p>
          <p class='status'>{{@model.statusStyle.label}}</p>
        </div>

        <div class='r-meta'>
          <span class='ord'>{{if @model.orderNumber @model.orderNumber ''}}</span>
          <span class='eta'><@fields.deliveryWindow @format='atom' /></span>
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
          --meta-size: max(11px, calc(var(--type-base) / var(--type-ratio)));
          --glyph-size: max(11px, min(3cqi, 14cqb));
          /* The identifier is a VALUE, so it must render in full. It is capped
             against the inline axis as well as the block axis so a real order /
             RMA / SKU always fits its box — the ellipsis below is a safety net
             for a pathological identifier, not a truncation strategy. */
          --num-size: max(
            11px,
            min(
              calc(var(--type-base) * pow(var(--type-ratio), 2)),
              26cqb,
              7.5cqi
            )
          );
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);
          --perf: color-mix(in oklch, var(--card-foreground) 20%, transparent);

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 3px;
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
        .r-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
        }
        .r-meta {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
          padding-top: 3px;
          border-top: 1px dashed var(--perf);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .hd-row {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .dot {
          flex: none;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: color-mix(
            in oklch,
            var(--st-hue, var(--muted-foreground, var(--boxel-400))) 72%,
            transparent
          );
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--num-size);
          font-weight: 800;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .carrier {
          font-size: var(--meta-size);
          font-weight: 700;
          white-space: nowrap;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .code {
          display: flex;
          align-items: stretch;
          gap: 2px;
          height: 16px;
          margin-top: 4px;
        }
        .code span {
          display: block;
          background: color-mix(in oklch, var(--card-foreground) 72%, transparent);
        }
        .code span:nth-child(3n) {
          width: 4px;
          opacity: 0.5;
        }
        .code span:nth-child(3n + 1) {
          width: 2px;
        }
        .code span:nth-child(3n + 2) {
          width: 3px;
          opacity: 0.75;
        }
        .tn {
          margin: 3px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          letter-spacing: 0.12em;
          color: var(--muted-foreground, var(--boxel-500));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status {
          margin: 3px 0 0;
          font-size: var(--type-base);
          font-weight: 700;
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
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
          .code,
          .tn {
            display: none;
          }
        }
        @container fitted-card (width <= 150px) {
          .carrier {
            display: none;
          }
        }
        @container fitted-card (width <= 110px) {
          .ord {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function dotStyle(hue: string | undefined) {
  return htmlSafe(`--st-hue: ${hue ?? 'var(--muted-foreground)'}`);
}

export default Shipment;
