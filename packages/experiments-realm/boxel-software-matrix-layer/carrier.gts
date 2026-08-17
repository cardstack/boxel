import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import TruckIcon from '@cardstack/boxel-icons/truck';

// A carrier's service level: the promise, and what it costs.
//
// The rate is real data on the card, not a call to an API the platform does not
// have. Rate shopping in this app compares configured rates — which is honest,
// and is also how a small business actually works before it integrates.
export class CarrierServiceField extends FieldDef {
  static displayName = 'Carrier Service';

  @field code = contains(StringField);
  @field serviceName = contains(StringField);
  @field deliveryDaysMin = contains(NumberField);
  @field deliveryDaysMax = contains(NumberField);
  @field baseRate = contains(AmountWithCurrency);
  @field perKgRate = contains(NumberField);
  @field supportsTracking = contains(BooleanField);

  get speedLabel() {
    let min = this.deliveryDaysMin;
    let max = this.deliveryDaysMax ?? min;
    if (min == null) {
      return undefined;
    }
    if (min === max) {
      return min === 1 ? 'Next day' : `${min} days`;
    }
    return `${min}–${max} days`;
  }

  static embedded = class Embedded extends Component<
    typeof CarrierServiceField
  > {
    <template>
      <div class='svc'>
        <span class='svc-name'>{{if
            @model.serviceName
            @model.serviceName
            'Unnamed service'
          }}</span>
        <span class='svc-speed'>{{if @model.speedLabel @model.speedLabel '—'}}</span>
        <span class='svc-rate'>
          {{#if @model.baseRate.amount}}
            <@fields.baseRate @format='atom' />
          {{else}}
            —
          {{/if}}
        </span>
        <span class='svc-perkg'>
          {{#if @model.perKgRate}}
            +{{@model.perKgRate}}/kg
          {{else}}
            —
          {{/if}}
        </span>
      </div>

      <style scoped>
        .svc {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 6rem 5rem 5.5rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs) 0;
          font-size: 0.85rem;
        }
        .svc-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .svc-speed,
        .svc-perkg {
          color: var(--muted-foreground, var(--boxel-500));
          font-size: 0.78rem;
        }
        .svc-rate,
        .svc-perkg {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .svc-rate {
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof CarrierServiceField> {
    <template>
      <span class='svc-atom'>{{@model.serviceName}}</span>
      <style scoped>
        .svc-atom {
          font-size: 0.85em;
          font-weight: 600;
        }
      </style>
    </template>
  };
}

// What a service costs to send a given billable weight. Exported as a pure
// function so the ship desk, the shipment card and any future rules engine all
// price a parcel the same way.
export function quoteService(
  service: CarrierServiceField | undefined,
  billableWeightKg: number | undefined,
): number | undefined {
  if (!service) {
    return undefined;
  }
  let base = service.baseRate?.amount;
  if (base == null) {
    return undefined;
  }
  let perKg = service.perKgRate ?? 0;
  let weight = billableWeightKg ?? 0;
  return Math.round((base + perKg * weight) * 100) / 100;
}

export class Carrier extends CardDef {
  static displayName = 'Carrier';
  static icon = TruckIcon;

  @field code = contains(StringField);
  @field carrierName = contains(StringField);
  @field isActive = contains(BooleanField);
  @field accountNumber = contains(StringField);
  @field services = containsMany(CarrierServiceField);
  @field supportedCountries = containsMany(StringField);

  // `{number}` is substituted by TrackingNumberField. Storing the pattern here
  // is what lets a shipment link out to any carrier without this app knowing
  // any carrier's URL scheme.
  @field trackingUrlPattern = contains(StringField);

  // Volume-to-weight divisor. Carriers differ (5000 and 6000 are both common),
  // so the parcel field takes it as data rather than assuming one.
  @field dimDivisor = contains(NumberField);

  // The carrier's own colour, carried as data. It is never used as text —
  // only as a diluted fill and border — because a brand hue cannot be
  // contrast-checked against a theme in advance.
  @field brandHue = contains(StringField);

  @field onTimeDeliveries = contains(NumberField);
  @field totalDeliveries = contains(NumberField);

  @field onTimePercent = contains(NumberField, {
    computeVia: function (this: Carrier) {
      let total = this.totalDeliveries ?? 0;
      if (total <= 0) {
        return undefined;
      }
      return Math.round(((this.onTimeDeliveries ?? 0) / total) * 100);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Carrier) {
      return this.carrierName?.length ? this.carrierName : 'Untitled Carrier';
    },
  });

  get cheapestService() {
    let priced = (this.services ?? []).filter((s) => s?.baseRate?.amount != null);
    if (!priced.length) {
      return undefined;
    }
    return priced.reduce((a, b) =>
      (a.baseRate?.amount ?? 0) <= (b.baseRate?.amount ?? 0) ? a : b,
    );
  }

  get fastestService() {
    let timed = (this.services ?? []).filter(
      (s) => s?.deliveryDaysMin != null,
    );
    if (!timed.length) {
      return undefined;
    }
    return timed.reduce((a, b) =>
      (a.deliveryDaysMin ?? 99) <= (b.deliveryDaysMin ?? 99) ? a : b,
    );
  }

  static isolated = class Isolated extends Component<typeof Carrier> {
    <template>
      <article class='carrier'>
        <header class='hd'>
          <div class='hd-id'>
            <span class='code'>{{@model.code}}</span>
            <h1 class='name'>{{@model.carrierName}}</h1>
          </div>
          <dl class='hd-stats'>
            <div>
              <dt>On time</dt>
              <dd>{{#if @model.onTimePercent}}{{@model.onTimePercent}}%{{else}}—{{/if}}</dd>
            </div>
            <div>
              <dt>Deliveries</dt>
              <dd>{{if @model.totalDeliveries @model.totalDeliveries '—'}}</dd>
            </div>
            <div>
              <dt>Services</dt>
              <dd>{{@model.services.length}}</dd>
            </div>
          </dl>
        </header>

        <section class='sec'>
          <h2>Services and rates</h2>
          <div class='svc-head'>
            <span>Service</span>
            <span>Transit</span>
            <span>Base</span>
            <span>Per kg</span>
          </div>
          {{#if @model.services.length}}
            <@fields.services @format='embedded' />
          {{else}}
            <p class='empty'>No services configured. Rate shopping will skip this
              carrier until at least one service has a base rate.</p>
          {{/if}}
        </section>

        <section class='sec'>
          <h2>Account</h2>
          <dl class='kv'>
            <div>
              <dt>Account number</dt>
              <dd class='mono'>{{if @model.accountNumber @model.accountNumber '—'}}</dd>
            </div>
            <div>
              <dt>Tracking URL</dt>
              <dd class='mono wrap'>{{if
                  @model.trackingUrlPattern
                  @model.trackingUrlPattern
                  'Not configured — tracking numbers will not link out'
                }}</dd>
            </div>
            <div>
              <dt>Dimensional divisor</dt>
              <dd class='mono'>{{if @model.dimDivisor @model.dimDivisor '—'}}</dd>
            </div>
            <div>
              <dt>Countries</dt>
              <dd>{{if
                  @model.supportedCountries.length
                  (join @model.supportedCountries)
                  '—'
                }}</dd>
            </div>
          </dl>
        </section>
      </article>

      <style scoped>
        /* Adapter block: the semantic set forwarded once into this card's
           vocabulary. Nothing is invented here — every value is a token or a
           mix of one. */
        .carrier {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-card-bg: var(--card);
          --ful-card-fg: var(--card-foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-rule: color-mix(in oklch, var(--foreground) 12%, transparent);

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
          align-items: flex-end;
          justify-content: space-between;
          padding-bottom: var(--boxel-sp);
          border-bottom: 2px solid var(--ful-rule);
        }
        .code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .name {
          margin: 0.1rem 0 0;
          font-size: 1.9rem;
          line-height: 1.05;
          font-family: var(--font-heading, inherit);
          color: var(--ful-fg, var(--boxel-dark));
        }
        .hd-stats {
          display: flex;
          gap: var(--boxel-sp-lg);
          margin: 0;
        }
        .hd-stats div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .hd-stats dt {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .hd-stats dd {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 1.25rem;
          font-weight: 700;
        }
        .sec {
          margin-top: var(--boxel-sp-lg);
        }
        .sec h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.72rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .svc-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 6rem 5rem 5.5rem;
          gap: var(--boxel-sp-xs);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .svc-head span:nth-child(n + 3) {
          text-align: right;
        }
        .kv {
          display: grid;
          gap: var(--boxel-sp-xs);
          margin: 0;
        }
        .kv div {
          display: grid;
          grid-template-columns: 12rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
        }
        .kv dt {
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: 0.85rem;
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .wrap {
          overflow-wrap: anywhere;
        }
        .empty {
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
          margin: var(--boxel-sp-xs) 0 0;
        }
        @media (width <= 500px) {
          .kv div {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Carrier> {
    <template>
      <div class='c-emb'>
        <span class='c-code'>{{@model.code}}</span>
        <span class='c-name'>{{@model.carrierName}}</span>
        <span class='c-slot'>{{#if
            @model.onTimePercent
          }}{{@model.onTimePercent}}% on time{{else}}—{{/if}}</span>
      </div>

      <style scoped>
        .c-emb {
          display: grid;
          grid-template-columns: 5.5rem minmax(0, 1fr) 8rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.9rem;
        }
        .c-code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .c-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .c-slot {
          text-align: right;
          font-size: 0.78rem;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Carrier> {
    <template>
      <span class='c-atom'>{{if
          @model.carrierName
          @model.carrierName
          @model.code
        }}</span>
      <style scoped>
        .c-atom {
          font-weight: 600;
          font-size: 0.85em;
        }
      </style>
    </template>
  };

  // Fitted. Progressive: badge shows the carrier code only; strip adds the
  // name; tile adds the on-time figure; card adds the cheapest service.
  static fitted = class Fitted extends Component<typeof Carrier> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <TruckIcon class='glyph' />
            <span class='code'>{{@model.code}}</span>
          </div>
          <h3 class='headline'>{{@model.carrierName}}</h3>
        </div>
        <div class='r-body'>
          {{#if @model.cheapestService}}
            <p class='cheapest'>
              from
              <strong>{{@model.cheapestService.serviceName}}</strong>
              {{@model.cheapestService.speedLabel}}
            </p>
          {{/if}}
        </div>
        <div class='r-meta'>
          {{#if @model.onTimePercent}}
            <span class='ontime'>{{@model.onTimePercent}}% on time</span>
          {{/if}}
          <span class='count'>{{@model.services.length}} services</span>
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
          grid-template-areas: 'head' 'body' 'meta';
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
        .r-head {
          grid-area: head;
          overflow: hidden;
          min-height: 0;
        }
        .r-body {
          grid-area: body;
          overflow: hidden;
          min-height: 0;
        }
        .r-meta {
          grid-area: meta;
          overflow: hidden;
          min-height: 0;
          display: flex;
          gap: 8px;
          justify-content: space-between;
          align-items: baseline;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .code {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .headline {
          margin: 0;
          font-size: var(--headline-size);
          line-height: 1.2;
          font-weight: 700;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .cheapest {
          margin: 4px 0 0;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .cheapest strong {
          color: var(--card-foreground, var(--boxel-dark));
        }
        .ontime {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
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
          .headline {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (50px < height <= 130px) {
          .r-body {
            display: none;
          }
        }
        @container fitted-card (width <= 120px) {
          .count {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function join(list: string[] | undefined) {
  return (list ?? []).join(', ');
}

export default Carrier;
