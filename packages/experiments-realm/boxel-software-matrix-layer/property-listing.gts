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
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { PropertyGallery } from './components/property-gallery';
import { EditSectionNav } from './components/edit-section-nav';
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

  // The form for writing a listing, grouped the way an agent drafts one:
  // name it and price it → state the property's facts → where it is →
  // show it → sell it. `isPublished` and `cardTitle` are computed and never
  // appear here; `publishedAt` is command-written (PublishListingCommand)
  // and only exposed with a warning hint. Five sections → the
  // EditSectionNav rail (edit-card Rule 0b). This family asserts no brand
  // token in its other formats, so the accent stays the theme foreground.
  static edit = class Edit extends Component<typeof this> {
    // Left section nav: clicking anchors that section to the top of the
    // form's own scroller (the root, per edit-card Rule 1 — never a nested
    // scroller). Scoped through the event's own root so several open edit
    // panels never cross-scroll each other.
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Listing' },
      { id: 'facts', label: 'Property Facts' },
      { id: 'location', label: 'Location' },
      { id: 'media', label: 'Photos' },
      { id: 'about', label: 'Description & Agent' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.listing-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='listing-edit'>
        {{! the container element cannot be restyled by its own query
            (edit-card Rule 1 corollary) — the responsive grid lives on
            this inner wrapper instead }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
            <section
              class='sect {{if (eq this.activeSection "identity") "focused"}}'
              data-sect='identity'
            >
              <h3>Listing</h3>
              <FieldContainer @label='Headline' @vertical={{true}}>
                <@fields.headline />
              </FieldContainer>
              <div class='row'>
                <FieldContainer @label='Property type' @vertical={{true}}>
                  <@fields.propertyType />
                </FieldContainer>
                <FieldContainer @label='Asking price' @vertical={{true}}>
                  <@fields.askingPrice />
                </FieldContainer>
                <FieldContainer @label='Status' @vertical={{true}}>
                  <@fields.status />
                </FieldContainer>
              </div>
              <FieldContainer
                @label='Published at (stamped by the Publish command — edit only to correct)'
                @vertical={{true}}
              >
                <@fields.publishedAt />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "facts") "focused"}}'
              data-sect='facts'
            >
              <h3>Property Facts</h3>
              <div class='row four'>
                <FieldContainer @label='Bedrooms' @vertical={{true}}>
                  <@fields.bedrooms />
                </FieldContainer>
                <FieldContainer @label='Bathrooms' @vertical={{true}}>
                  <@fields.bathrooms />
                </FieldContainer>
                <FieldContainer @label='Area (sqft)' @vertical={{true}}>
                  <@fields.areaSqft />
                </FieldContainer>
                <FieldContainer @label='Year built' @vertical={{true}}>
                  <@fields.yearBuilt />
                </FieldContainer>
              </div>
            </section>

            <section
              class='sect {{if (eq this.activeSection "location") "focused"}}'
              data-sect='location'
            >
              <h3>Location</h3>
              <FieldContainer @label='Address' @vertical={{true}}>
                <@fields.address />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "media") "focused"}}'
              data-sect='media'
            >
              <h3>Photos
                <span class='sect-hint'>the first photo is the hero on the
                  property page and every card face</span></h3>
              <FieldContainer @label='Photo gallery' @vertical={{true}}>
                <@fields.photos />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "about") "focused"}}'
              data-sect='about'
            >
              <h3>Description &amp; Agent</h3>
              <FieldContainer @label='About this property' @vertical={{true}}>
                <@fields.description />
              </FieldContainer>
              <FieldContainer @label='Listing agent' @vertical={{true}}>
                <@fields.agent />
              </FieldContainer>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .listing-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          /* this family asserts no brand hue in its other formats — the
             accent is the theme's foreground (boxel-theming §4a: pin
             nothing) */
          --pl-ink: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top;
           no ink knobs handed over — the rail's default is already the
           inverted foreground/background pair */
        .sect-nav {
          position: sticky;
          top: 0;
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        /* the section the rail points at mirrors the rail's active state */
        .sect.focused {
          outline-color: var(--pl-ink);
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--pl-ink) 12%, transparent);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.four {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        @container edit (width < 640px) {
          .row,
          .row.four {
            grid-template-columns: 1fr;
          }
          /* narrow panel: nav becomes a horizontal chip row above the form */
          .edit-body {
            grid-template-columns: 1fr;
          }
          /* narrow: the rail flips horizontal (consumer's scope attribute
             rides ...attributes onto the component root, so these apply) */
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };
}
