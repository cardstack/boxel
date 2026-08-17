import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import AddressField from '@cardstack/base/address';
import EmailField from '@cardstack/base/email';
import enumField from '@cardstack/base/enum';
import { ProgressBar } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import WarehouseIcon from '@cardstack/boxel-icons/building-warehouse';

// A warehouse is not always a building you own. A 3PL holds your stock and
// ships it for you; a dropship "location" holds nothing at all and exists so an
// order can be allocated somewhere. Treating all three as the same card is what
// lets allocation logic stay in one place.
export const WAREHOUSE_TYPES = [
  { value: 'owned', label: 'Owned' },
  { value: 'third_party', label: '3PL' },
  { value: 'dropship', label: 'Dropship (virtual)' },
];

export const WarehouseTypeField = enumField(StringField, {
  options: WAREHOUSE_TYPES,
  displayName: 'Warehouse Type',
});

export class Warehouse extends CardDef {
  static displayName = 'Warehouse';
  static icon = WarehouseIcon;

  @field code = contains(StringField);
  @field warehouseName = contains(StringField);
  @field warehouseType = contains(WarehouseTypeField);
  @field isActive = contains(BooleanField);
  @field address = contains(AddressField);

  // Plain coordinates rather than a geo field: the only thing this card needs
  // them for is plotting, and a bare pair keeps the card usable in realms that
  // do not have the catalog's geo blocks.
  @field latitude = contains(NumberField);
  @field longitude = contains(NumberField);

  @field contactPerson = contains(StringField);
  @field contactEmail = contains(EmailField);
  @field contactPhone = contains(StringField);
  @field operatingHours = contains(StringField);

  // Bin-level granularity is optional. A spare-room operation has no bins and
  // reports no utilisation rather than a fake 0%.
  @field totalBins = contains(NumberField);
  @field occupiedBins = contains(NumberField);
  @field zones = containsMany(StringField);

  @field utilizationPercent = contains(NumberField, {
    computeVia: function (this: Warehouse) {
      let total = this.totalBins ?? 0;
      if (total <= 0) {
        return undefined;
      }
      return Math.round(((this.occupiedBins ?? 0) / total) * 100);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Warehouse) {
      return this.warehouseName?.length
        ? this.warehouseName
        : 'Untitled Warehouse';
    },
  });

  get isVirtual() {
    return this.warehouseType === 'dropship';
  }

  get locationLabel() {
    let city = this.address?.city;
    let country = this.address?.country?.code ?? this.address?.country?.name;
    return [city, country].filter(Boolean).join(', ') || undefined;
  }

  static isolated = class Isolated extends Component<typeof Warehouse> {
    <template>
      <article class='wh'>
        <header class='hd'>
          <div>
            <span class='code'>{{@model.code}}</span>
            <h1 class='name'>{{@model.warehouseName}}</h1>
            {{#if @model.locationLabel}}
              <p class='loc'>{{@model.locationLabel}}</p>
            {{/if}}
          </div>
          <div class='hd-type'>
            <@fields.warehouseType @format='atom' />
            {{#unless @model.isActive}}
              <span class='inactive'>Inactive</span>
            {{/unless}}
          </div>
        </header>

        {{#if @model.isVirtual}}
          <p class='virtual-note'>
            This is a virtual location. Stock is never counted here — orders
            allocated to it are forwarded to the supplier, who ships direct.
          </p>
        {{else if @model.utilizationPercent}}
          <section class='sec'>
            <h2>Capacity</h2>
            <ProgressBar
              @value={{@model.utilizationPercent}}
              @max={{100}}
              @label='{{@model.occupiedBins}} of {{@model.totalBins}} bins filled'
            />
          </section>
        {{/if}}

        <div class='cols'>
          <section class='sec'>
            <h2>Address</h2>
            <@fields.address @format='embedded' />
          </section>

          <section class='sec'>
            <h2>Contact</h2>
            <dl class='kv'>
              <div>
                <dt>Person</dt>
                <dd>{{if @model.contactPerson @model.contactPerson '—'}}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd><@fields.contactEmail @format='atom' /></dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd class='mono'>{{if @model.contactPhone @model.contactPhone '—'}}</dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>{{if @model.operatingHours @model.operatingHours '—'}}</dd>
              </div>
            </dl>
          </section>
        </div>

        {{#if @model.zones.length}}
          <section class='sec'>
            <h2>Zones</h2>
            <ul class='zones'>
              {{#each @model.zones as |zone|}}
                <li class='zone'>{{zone}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
      </article>

      <style scoped>
        .wh {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
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
          justify-content: space-between;
          align-items: flex-start;
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
        }
        .loc {
          margin: 4px 0 0;
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .hd-type {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .inactive {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 3px;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 60%,
            var(--foreground, var(--boxel-dark))
          );
          background: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 12%,
            transparent
          );
        }
        .virtual-note {
          margin: var(--boxel-sp) 0 0;
          padding: var(--boxel-sp-sm);
          border-left: 3px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
          background: color-mix(in oklch, var(--foreground) 3%, transparent);
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
        .kv {
          display: grid;
          gap: 6px;
          margin: 0;
        }
        .kv div {
          display: grid;
          grid-template-columns: 5rem minmax(0, 1fr);
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
        .zones {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .zone {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 3px;
          border: 1px solid var(--ful-border, var(--boxel-border-color));
          color: var(--ful-muted-fg, var(--boxel-500));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Warehouse> {
    <template>
      <div class='wh-emb'>
        <span class='wh-code'>{{@model.code}}</span>
        <span class='wh-name'>{{@model.warehouseName}}</span>
        <span class='wh-slot'>{{if @model.locationLabel @model.locationLabel '—'}}</span>
        <span class='wh-slot'>{{#if
            @model.utilizationPercent
          }}{{@model.utilizationPercent}}% full{{else}}—{{/if}}</span>
      </div>

      <style scoped>
        .wh-emb {
          display: grid;
          grid-template-columns: 6rem minmax(0, 1fr) 9rem 5.5rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.9rem;
        }
        .wh-code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .wh-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wh-slot {
          text-align: right;
          font-size: 0.78rem;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
        @container (width < 380px) {
          .wh-emb {
            grid-template-columns: 5rem minmax(0, 1fr) 5rem;
          }
          .wh-slot:nth-of-type(1) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Warehouse> {
    <template>
      <span class='wh-atom'>{{if @model.code @model.code @model.warehouseName}}</span>
      <style scoped>
        .wh-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Warehouse> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <WarehouseIcon class='glyph' />
            <span class='code'>{{@model.code}}</span>
          </div>
          <h3 class='headline'>{{@model.warehouseName}}</h3>
        </div>
        <div class='r-body'>
          {{#if @model.locationLabel}}
            <p class='loc'>{{@model.locationLabel}}</p>
          {{/if}}
          {{#if @model.utilizationPercent}}
            <div class='gauge' aria-hidden='true'>
              <span
                class='gauge-fill'
                style={{fillWidth @model.utilizationPercent}}
              ></span>
            </div>
          {{/if}}
        </div>
        <div class='r-meta'>
          {{#if @model.utilizationPercent}}
            <span class='pct'>{{@model.utilizationPercent}}% full</span>
          {{else if @model.isVirtual}}
            <span class='pct'>Virtual</span>
          {{/if}}
          <span class='zn'>{{@model.zones.length}} zones</span>
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
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
        }
        .r-body {
          grid-area: body;
        }
        .r-meta {
          grid-area: meta;
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
        .loc {
          margin: 3px 0 0;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
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
        .pct {
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
        @container fitted-card (50px < height <= 105px) {
          .r-body {
            display: none;
          }
        }
        @container fitted-card (105px < height <= 130px) {
          .gauge {
            display: none;
          }
        }
        @container fitted-card (width <= 130px) {
          .zn {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function fillWidth(pct: number | undefined) {
  return htmlSafe(`width: ${Math.min(100, Math.max(0, pct ?? 0))}%`);
}

export default Warehouse;
