import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import AddressField from '@cardstack/base/address';
import enumField from '@cardstack/base/enum';
import MultiImageSourceField from '@cardstack/catalog/fields/multi-image-source/multi-image-source';

import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { PropertyGallery } from './components/property-gallery';
import { formatMoney } from './money';
import { stateColor, type StateColor } from './utils/index';

export const PROPERTY_TYPES = [
  'house',
  'apartment',
  'condo',
  'townhouse',
  'land',
  'commercial',
];

export const PropertyTypeField = enumField(StringField, {
  options: PROPERTY_TYPES.map((value) => ({ value, label: value })),
  displayName: 'Property Type',
});

export const PROPERTY_LISTING_STATUSES = [
  'draft',
  'published',
  'under-offer',
  'sold',
  'withdrawn',
];

export const PROPERTY_LISTING_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  'under-offer': 'Under Offer',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
};

export const PROPERTY_LISTING_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  published: stateColor('green'),
  'under-offer': stateColor('amber'),
  sold: stateColor('blue'),
  withdrawn: stateColor('red'),
};

const STATUS_HUES: Record<string, 'slate' | 'green' | 'amber' | 'blue' | 'red'> =
  {
    draft: 'slate',
    published: 'green',
    'under-offer': 'amber',
    sold: 'blue',
    withdrawn: 'red',
  };

export const PropertyListingStatusField = enumField(StringField, {
  options: PROPERTY_LISTING_STATUSES.map((value) => ({
    value,
    label: PROPERTY_LISTING_STATUS_LABELS[value],
  })),
  displayName: 'Property Listing Status',
});

// A real-estate listing: the property's facts, its asking price, its photo
// gallery, and a publish lifecycle. Distinct from the marketplace `Listing`
// (sole-vault) on purpose — a property is located, measured in beds/baths/
// area, and sold once; a collectible is shipped and priced per unit.
// `publishedAt` is an event fact written once by PublishListingCommand;
// the isolated view IS the property page a buyer would read.
export class PropertyListing extends CardDef {
  static displayName = 'Property Listing';
  static headerColor = '#1f6f5c';
  static prefersWideFormat = true;

  @field headline = contains(StringField);
  @field address = contains(AddressField);
  @field propertyType = contains(PropertyTypeField);
  @field askingPrice = contains(AmountWithCurrency);
  @field bedrooms = contains(NumberField);
  @field bathrooms = contains(NumberField);
  @field areaSqft = contains(NumberField);
  @field yearBuilt = contains(NumberField);
  @field photos = contains(MultiImageSourceField);
  @field description = contains(MarkdownField);
  @field status = contains(PropertyListingStatusField);
  @field publishedAt = contains(DateTimeField);
  @field agent = linksTo(() => Employee);

  @field isPublished = contains(BooleanField, {
    computeVia: function (this: PropertyListing) {
      return Boolean(this.publishedAt);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PropertyListing) {
      if (this.headline?.trim()) {
        return this.headline;
      }
      let addr = [this.address?.addressLine1, this.address?.city]
        .filter(Boolean)
        .join(', ');
      return addr || 'Untitled Property';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return (
        PROPERTY_LISTING_STATUS_LABELS[this.args.model?.status ?? ''] ??
        'Draft'
      );
    }
    get priceLabel() {
      let p = this.args.model?.askingPrice;
      return p?.amount != null
        ? formatMoney(p.amount, p.currency?.code)
        : 'Price on request';
    }
    get addressLabel() {
      return this.args.model?.address?.fullAddress ?? '';
    }
    get areaLabel() {
      let a = this.args.model?.areaSqft;
      return a != null ? `${a.toLocaleString('en-US')} sqft` : '—';
    }
    <template>
      <article class='listing'>
        <header class='head'>
          <div>
            <p class='kicker'>{{@model.propertyType}} ·
              {{this.addressLabel}}</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <div class='head-right'>
            <span class='price'>{{this.priceLabel}}</span>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
          </div>
        </header>

        <PropertyGallery
          @urls={{@model.photos.resolvedUrls}}
          @alt={{@model.cardTitle}}
        />

        <div class='facts'>
          <div class='fact'>
            <span class='fact-value'>{{@model.bedrooms}}</span>
            <span class='fact-label'>beds</span>
          </div>
          <div class='fact'>
            <span class='fact-value'>{{@model.bathrooms}}</span>
            <span class='fact-label'>baths</span>
          </div>
          <div class='fact'>
            <span class='fact-value'>{{this.areaLabel}}</span>
            <span class='fact-label'>area</span>
          </div>
          {{#if @model.yearBuilt}}
            <div class='fact'>
              <span class='fact-value'>{{@model.yearBuilt}}</span>
              <span class='fact-label'>built</span>
            </div>
          {{/if}}
        </div>

        {{#if @model.description}}
          <section class='panel'>
            <h2>About this property</h2>
            <@fields.description />
          </section>
        {{/if}}

        {{#if @model.agent}}
          <section class='panel'>
            <h2>Listing Agent</h2>
            <@fields.agent @format='atom' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .listing {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          display: grid;
          gap: var(--boxel-sp);
          max-width: 60rem;
          margin: 0 auto;
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.75rem;
          letter-spacing: 0.06em;
          text-transform: capitalize;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.75rem;
          line-height: 1.2;
        }
        .head-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-5xs);
        }
        .price {
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .facts {
          display: flex;
          gap: var(--boxel-sp);
          flex-wrap: wrap;
        }
        .fact {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          min-width: 5rem;
        }
        .fact-value {
          font-size: 1.125rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .fact-label {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container (max-width: 560px) {
          .head {
            flex-direction: column;
          }
          .head-right {
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return (
        PROPERTY_LISTING_STATUS_LABELS[this.args.model?.status ?? ''] ??
        'Draft'
      );
    }
    get priceLabel() {
      let p = this.args.model?.askingPrice;
      return p?.amount != null
        ? formatMoney(p.amount, p.currency?.code)
        : '—';
    }
    <template>
      <div class='row'>
        {{#if @model.photos.primaryUrl}}
          <img class='thumb' src={{@model.photos.primaryUrl}} alt='' />
        {{/if}}
        <div class='who'>
          <span class='name'>{{@model.cardTitle}}</span>
          <span class='meta'>{{@model.bedrooms}} bd ·
            {{@model.bathrooms}} ba · {{@model.address.city}}</span>
        </div>
        <span class='amount'>{{this.priceLabel}}</span>
        <StatePill @label={{this.statusLabel}} @hue={{this.statusHue}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: auto 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .thumb {
          width: 56px;
          height: 40px;
          object-fit: cover;
          border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        }
        .who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .amount {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get priceLabel() {
      let p = this.args.model?.askingPrice;
      return p?.amount != null
        ? formatMoney(p.amount, p.currency?.code)
        : '—';
    }
    <template>
      <div class='fit'>
        {{#if @model.photos.primaryUrl}}
          <img class='fit-img' src={{@model.photos.primaryUrl}} alt='' />
        {{/if}}
        <div class='fit-body'>
          <span class='fit-name'>{{@model.cardTitle}}</span>
          <span class='fit-sub'>{{@model.bedrooms}} bd ·
            {{@model.bathrooms}} ba</span>
          <span class='fit-price'>{{this.priceLabel}}</span>
        </div>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .fit-img {
          width: 100%;
          height: 55%;
          object-fit: cover;
          flex: 0 0 auto;
        }
        .fit-body {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          min-height: 0;
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-price {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        @container fitted-card (height <= 120px) {
          .fit-img {
            display: none;
          }
        }
        @container fitted-card (height <= 65px) {
          .fit-body {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-sub {
            display: none;
          }
          .fit-price {
            margin-left: auto;
          }
        }
      </style>
    </template>
  };
}
