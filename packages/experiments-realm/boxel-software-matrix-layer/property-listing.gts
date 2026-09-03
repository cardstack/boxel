import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
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
import { on } from '@ember/modifier';
import { eq, or } from '@cardstack/boxel-ui/helpers';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { PropertyGallery } from './components/property-gallery';
import { PhotoOrganizer } from './components/photo-organizer';
import { PublishChecklist } from './components/publish-checklist';
import { ChannelSelector } from './components/channel-selector';
import { SchedulePicker } from './components/schedule-picker';
import { EditSectionNav } from './components/edit-section-nav';
import { formatMoney } from './money';
import { daysBetween, stateColor, type StateColor } from './utils/index';

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

// Additive ladder (existing values never renamed — instances are
// migrations): draft → prepared → published → under-offer → sold, with
// withdrawn/expired as exits. The marketplace spec's Active/Pending map to
// published/under-offer.
export const PROPERTY_LISTING_STATUSES = [
  'draft',
  'prepared',
  'published',
  'under-offer',
  'sold',
  'withdrawn',
  'expired',
];

export const PROPERTY_LISTING_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  published: 'Published',
  'under-offer': 'Under Offer',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

export const PROPERTY_LISTING_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  prepared: stateColor('teal'),
  published: stateColor('green'),
  'under-offer': stateColor('amber'),
  sold: stateColor('blue'),
  withdrawn: stateColor('red'),
  expired: stateColor('red'),
};

const STATUS_HUES: Record<
  string,
  'slate' | 'teal' | 'green' | 'amber' | 'blue' | 'red'
> = {
  draft: 'slate',
  prepared: 'teal',
  published: 'green',
  'under-offer': 'amber',
  sold: 'blue',
  withdrawn: 'red',
  expired: 'red',
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
  @field lotSizeSqft = contains(NumberField);
  @field neighborhood = contains(StringField);
  @field features = containsMany(StringField);
  @field mlsNumber = contains(StringField);
  @field hoaFee = contains(AmountWithCurrency);
  // Which photo fronts the property page and every card face. Ordered by
  // `photos.images`; captions ride in a parallel array kept in step by the
  // photo organizer, never edited on their own.
  @field heroIndex = contains(NumberField);
  @field photoCaptions = containsMany(StringField);

  @field isPublished = contains(BooleanField, {
    computeVia: function (this: PropertyListing) {
      return Boolean(this.publishedAt);
    },
  });

  // How long the listing has been live. Counted from `publishedAt` (the
  // event fact) only while the listing is on the market — a draft has no
  // clock and a sold listing's final DOM is a story for its audit trail.
  @field daysOnMarket = contains(NumberField, {
    computeVia: function (this: PropertyListing) {
      if (!this.publishedAt) {
        return null;
      }
      if (this.status !== 'published' && this.status !== 'under-offer') {
        return null;
      }
      return daysBetween(this.publishedAt, new Date());
    },
  });

  @field pricePerSqft = contains(NumberField, {
    computeVia: function (this: PropertyListing) {
      let amount = this.askingPrice?.amount;
      let area = this.areaSqft;
      if (amount == null || !area) {
        return null;
      }
      return Math.round(amount / area);
    },
  });

  // For the pre-publish checklist ("at least N photos").
  @field photoCount = contains(NumberField, {
    computeVia: function (this: PropertyListing) {
      return (this.photos?.resolvedUrls ?? []).filter(Boolean).length;
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
    @tracked publishing = false;
    @tracked publishProblem: string | undefined;
    @tracked publishPanelOpen = false;
    @tracked selectedChannels: string[] = ['mls', 'zillow', 'realtor', 'redfin'];
    @tracked scheduleIso: string | undefined;
    @tracked publishOutcome: string | undefined;

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
    get domLabel() {
      let d = this.args.model?.daysOnMarket;
      if (d == null) {
        return undefined;
      }
      return d === 1 ? '1 day on market' : `${d} days on market`;
    }
    get pricePerSqftLabel() {
      let p = this.args.model?.pricePerSqft;
      return p != null ? `$${p.toLocaleString('en-US')}/sqft` : undefined;
    }
    get hoaLabel() {
      let h = this.args.model?.hoaFee;
      return h?.amount != null
        ? `${formatMoney(h.amount, h.currency?.code)}/mo HOA`
        : undefined;
    }
    get publishedLabel() {
      let at = this.args.model?.publishedAt;
      if (!at) {
        return undefined;
      }
      return new Date(at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    /** The publish affordance shows only where the ladder allows it. */
    get canPublish(): boolean {
      let m = this.args.model;
      return Boolean(
        this.args.context?.commandContext &&
          m?.id &&
          (m.status === 'draft' || m.status === 'prepared' || !m.status),
      );
    }
    togglePanel = () => {
      this.publishPanelOpen = !this.publishPanelOpen;
      this.publishProblem = undefined;
      this.publishOutcome = undefined;
    };

    toggleChannel = (channel: string) => {
      if (channel === 'mls') {
        return;
      }
      this.selectedChannels = this.selectedChannels.includes(channel)
        ? this.selectedChannels.filter((c) => c !== channel)
        : [...this.selectedChannels, channel];
    };

    setSchedule = (iso: string | undefined) => {
      this.scheduleIso = iso;
    };

    publish = async () => {
      let context = this.args.context?.commandContext;
      if (!context || !this.args.model?.id) {
        return;
      }
      this.publishing = true;
      this.publishProblem = undefined;
      this.publishOutcome = undefined;
      try {
        // Literal lazy import: the command imports PropertyListing back, so
        // a static import here would be a module cycle (booking.gts
        // precedent).
        let { default: PublishListingCommand } = await import(
          './commands/publish-listing-command'
        );
        let result: any = await new PublishListingCommand(context).execute({
          listing: this.args.model,
          channels: this.selectedChannels,
          scheduledDate: this.scheduleIso
            ? new Date(this.scheduleIso)
            : undefined,
        } as any);
        this.publishOutcome = result?.message;
        if (!result?.scheduled) {
          this.publishPanelOpen = false;
        }
      } catch (e: any) {
        this.publishProblem = e?.message ?? 'Publish failed';
      } finally {
        this.publishing = false;
      }
    };
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
            {{#if this.domLabel}}
              <span class='dom'>{{this.domLabel}}</span>
            {{/if}}
          </div>
        </header>

        <PropertyGallery
          @urls={{@model.photos.resolvedUrls}}
          @alt={{@model.cardTitle}}
          @captions={{@model.photoCaptions}}
          @heroIndex={{@model.heroIndex}}
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
          {{#if @model.lotSizeSqft}}
            <div class='fact'>
              <span class='fact-value'>{{@model.lotSizeSqft}}</span>
              <span class='fact-label'>lot sqft</span>
            </div>
          {{/if}}
          {{#if this.pricePerSqftLabel}}
            <div class='fact'>
              <span class='fact-value'>{{this.pricePerSqftLabel}}</span>
              <span class='fact-label'>per sqft</span>
            </div>
          {{/if}}
          {{#if this.hoaLabel}}
            <div class='fact'>
              <span class='fact-value'>{{this.hoaLabel}}</span>
              <span class='fact-label'>hoa</span>
            </div>
          {{/if}}
        </div>

        {{#if @model.features.length}}
          <ul class='feature-pills'>
            {{#each @model.features as |feature|}}
              <li class='feature-pill'>{{feature}}</li>
            {{/each}}
          </ul>
        {{/if}}

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

        {{! the outcome banner outlives the panel — after a successful
            publish canPublish flips false and the panel unmounts, but the
            agent still needs to read what just happened }}
        {{#if this.publishOutcome}}
          <p class='publish-outcome'>✓ {{this.publishOutcome}}</p>
        {{/if}}

        {{#if this.canPublish}}
          <section class='publish-panel'>
            <div class='publish-row'>
              <button
                type='button'
                class='publish-btn {{if this.publishPanelOpen "quiet"}}'
                {{on 'click' this.togglePanel}}
              >
                {{if this.publishPanelOpen 'Close' 'Publish Listing'}}
              </button>
            </div>
            {{#if this.publishPanelOpen}}
              <div class='publish-body'>
                <div class='publish-col'>
                  <h2>Ready to publish to</h2>
                  <ChannelSelector
                    @selected={{this.selectedChannels}}
                    @onToggle={{this.toggleChannel}}
                  />
                  <SchedulePicker
                    @value={{this.scheduleIso}}
                    @onChange={{this.setSchedule}}
                  />
                </div>
                <div class='publish-col'>
                  <h2>Pre-publish checklist</h2>
                  <PublishChecklist @model={{@model}} />
                  <button
                    type='button'
                    class='publish-btn go'
                    disabled={{this.publishing}}
                    {{on 'click' this.publish}}
                  >
                    {{if this.publishing 'Publishing…' '🚀 Publish'}}
                  </button>
                  {{#if this.publishProblem}}
                    <span class='publish-problem'>{{this.publishProblem}}</span>
                  {{/if}}
                </div>
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{#if (or @model.mlsNumber this.publishedLabel)}}
          <footer class='foot'>
            {{#if @model.mlsNumber}}
              <span>MLS# {{@model.mlsNumber}}</span>
            {{/if}}
            {{#if this.publishedLabel}}
              <span>Listed: {{this.publishedLabel}}</span>
            {{/if}}
          </footer>
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
        .dom {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .feature-pills {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .feature-pill {
          font-size: 0.75rem;
          padding: 2px 10px;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 999px;
          background: color-mix(
            in oklch,
            var(--muted, var(--boxel-100)) 60%,
            transparent
          );
        }
        .publish-panel {
          display: grid;
          gap: var(--boxel-sp-sm);
        }
        .publish-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .publish-body {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--boxel-sp);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .publish-col {
          display: grid;
          gap: var(--boxel-sp-sm);
          align-content: start;
          min-width: 0;
        }
        .publish-btn.quiet {
          background: transparent;
          color: var(--foreground, var(--boxel-dark));
          border: 1px solid var(--border, var(--boxel-200));
        }
        .publish-btn.go {
          justify-self: start;
        }
        .publish-outcome {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container (max-width: 560px) {
          .publish-body {
            grid-template-columns: 1fr;
          }
        }
        .publish-btn {
          border: 0;
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          background: var(--primary, var(--boxel-dark));
          color: var(--primary-foreground, var(--boxel-light));
        }
        .publish-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .publish-problem {
          font-size: 0.8125rem;
          color: var(--destructive, var(--boxel-danger));
        }
        .foot {
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp);
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          border-top: 1px solid var(--border, var(--boxel-200));
          padding-top: var(--boxel-sp-xs);
          font-variant-numeric: tabular-nums;
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
              <div class='row'>
                <FieldContainer
                  @label='MLS number (assigned when published — edit only to correct)'
                  @vertical={{true}}
                >
                  <@fields.mlsNumber />
                </FieldContainer>
                <FieldContainer
                  @label='Published at (stamped by the Publish command — edit only to correct)'
                  @vertical={{true}}
                >
                  <@fields.publishedAt />
                </FieldContainer>
              </div>
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
              <div class='row'>
                <FieldContainer @label='Lot size (sqft)' @vertical={{true}}>
                  <@fields.lotSizeSqft />
                </FieldContainer>
                <FieldContainer
                  @label='HOA fee (monthly)'
                  @vertical={{true}}
                >
                  <@fields.hoaFee />
                </FieldContainer>
              </div>
              <FieldContainer
                @label='Features (one per line — shown as pills on the property page)'
                @vertical={{true}}
              >
                <@fields.features />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "location") "focused"}}'
              data-sect='location'
            >
              <h3>Location</h3>
              <FieldContainer @label='Address' @vertical={{true}}>
                <@fields.address />
              </FieldContainer>
              <FieldContainer @label='Neighborhood' @vertical={{true}}>
                <@fields.neighborhood />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "media") "focused"}}'
              data-sect='media'
            >
              <h3>Photos
                <span class='sect-hint'>order, hero and captions are managed
                  below</span></h3>
              <FieldContainer @label='Photo gallery' @vertical={{true}}>
                <@fields.photos />
              </FieldContainer>
              <FieldContainer
                @label='Arrange (drag to reorder · set the hero · captions show in the gallery)'
                @vertical={{true}}
              >
                <PhotoOrganizer @model={{@model}} />
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
