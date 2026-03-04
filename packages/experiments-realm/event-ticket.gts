import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateTimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';
import Ticket from '@cardstack/boxel-icons/ticket';
import MapPin from '@cardstack/boxel-icons/map-pin';

import { Pill } from '@cardstack/boxel-ui/components';

class VenueField extends FieldDef {
  static displayName = 'Venue';
  @field name = contains(StringField);
  @field city = contains(StringField);
}

function formatPrice(
  price: number | null | undefined,
  currency: string | null | undefined,
  decimals = 2,
): string {
  return `${currency || '$'}${(price || 0).toFixed(decimals)}`;
}

// Eventbrite × vintage ticket stub — skeuomorphic with perforated edge, bold fun energy
export class EventTicket extends CardDef {
  static displayName = 'Event Ticket';
  static icon = Ticket;

  @field venue = contains(VenueField);
  @field date = contains(DateTimeField);
  @field ticketType = contains(StringField);
  @field section = contains(StringField);
  @field row = contains(StringField);
  @field seat = contains(StringField);
  @field price = contains(NumberField);
  @field currency = contains(StringField);
  @field ticketId = contains(StringField);
  @field imageUrl = contains(UrlField);
  @field eventDetails = contains(MarkdownField);

  static isolated = class Isolated extends Component<typeof this> {
    get formattedPrice() {
      return formatPrice(this.args.model.price, this.args.model.currency);
    }

    <template>
      <div class='ticket-isolated'>
        <div class='ticket-wrapper'>
          {{#if @model.imageUrl}}
            <div class='hero-image'>
              <img src={{@model.imageUrl}} alt={{@model.cardTitle}} />
            </div>
          {{/if}}

          <div class='ticket-header'>
            {{#if @model.ticketType}}
              <div class='ticket-type-badge'><@fields.ticketType /></div>
            {{/if}}
            <h1 class='event-title'><@fields.cardTitle /></h1>

            {{#if @model.venue.name}}
              <div class='venue-details'>
                <MapPin class='location-icon' />
                <div>
                  <div class='venue-name'><@fields.venue.name /></div>
                  {{#if @model.venue.city}}
                    <div class='city-name'><@fields.venue.city /></div>
                  {{/if}}
                </div>
              </div>
            {{/if}}
          </div>

          <div class='ticket-body'>
            <div class='info-grid'>
              <div class='info-card'>
                <div class='info-label'>Date</div>
                <div class='info-value'><@fields.date /></div>
              </div>

              {{#if @model.section}}
                <div class='info-card'>
                  <div class='info-label'>Section</div>
                  <div class='info-value'><@fields.section /></div>
                </div>
              {{/if}}

              {{#if @model.row}}
                <div class='info-card'>
                  <div class='info-label'>Row</div>
                  <div class='info-value'><@fields.row /></div>
                </div>
              {{/if}}

              {{#if @model.seat}}
                <div class='info-card'>
                  <div class='info-label'>Seat</div>
                  <div class='info-value'><@fields.seat /></div>
                </div>
              {{/if}}
            </div>

            <div class='pricing-section'>
              <div class='price-label'>Total Price</div>
              <div class='price-amount'>{{this.formattedPrice}}</div>
            </div>

            {{#if @model.eventDetails}}
              <div class='event-details-section'>
                <h2 class='section-title'>Event Details</h2>
                <div class='event-details-content'>
                  <@fields.eventDetails />
                </div>
              </div>
            {{/if}}

            {{#if @model.ticketId}}
              <div class='ticket-id-section'>
                <div class='ticket-id-label'>Ticket ID</div>
                <div class='ticket-id-value'><@fields.ticketId /></div>
                <div class='barcode'>
                  <Ticket class='barcode-icon' />
                </div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .ticket-isolated {
          height: 100%;
          overflow-y: auto;
          background: var(--background);
          padding: var(--boxel-sp-xl);
        }

        .ticket-wrapper {
          max-width: 37.5rem;
          margin: 0 auto;
          background: var(--card);
          border-radius: var(--boxel-border-radius-xl);
          overflow: hidden;
          box-shadow: var(--boxel-deep-box-shadow);
        }

        .hero-image {
          width: 100%;
          height: 15rem;
          overflow: hidden;
        }

        .hero-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .ticket-header {
          background: linear-gradient(
            135deg,
            var(--primary) 0%,
            var(--secondary) 100%
          );
          color: var(--primary-foreground);
          padding: var(--boxel-sp-xl);
        }

        .ticket-type-badge {
          display: inline-block;
          background: color-mix(
            in oklch,
            var(--primary-foreground) 25%,
            transparent
          );
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          border-radius: var(--boxel-border-radius-xxl);
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          margin-bottom: var(--boxel-sp);
        }

        .event-title {
          font-family: var(--boxel-heading-font-family);
          font-size: var(--boxel-heading-font-size);
          font-weight: var(--boxel-heading-font-weight);
          line-height: var(--boxel-heading-line-height);
          margin: 0 0 var(--boxel-sp-lg) 0;
          letter-spacing: var(--boxel-lsp-xs);
          text-transform: uppercase;
        }

        .venue-details {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
        }

        .location-icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          flex-shrink: 0;
          margin-top: var(--boxel-sp-6xs);
        }

        .venue-name {
          font-size: var(--boxel-font-size-lg);
          font-weight: 600;
          margin-bottom: var(--boxel-sp-5xs);
        }

        .city-name {
          font-size: var(--boxel-font-size-sm);
          opacity: 0.9;
        }

        .ticket-body {
          padding: var(--boxel-sp-xl);
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(9.375rem, 1fr));
          gap: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-xl);
        }

        .info-card {
          background: var(--muted);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-sm);
          border-left: 0.25rem solid var(--primary);
        }

        .info-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          margin-bottom: var(--boxel-sp-xs);
        }

        .info-value {
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          color: var(--foreground);
        }

        .pricing-section {
          background: linear-gradient(
            135deg,
            var(--primary) 0%,
            var(--secondary) 100%
          );
          padding: var(--boxel-sp-lg);
          border-radius: var(--boxel-border-radius-lg);
          text-align: center;
          color: var(--primary-foreground);
          margin-bottom: var(--boxel-sp-xl);
        }

        .event-details-section {
          margin-bottom: var(--boxel-sp-xl);
        }

        .section-title {
          font-family: var(--boxel-section-heading-font-family);
          font-size: var(--boxel-section-heading-font-size);
          font-weight: var(--boxel-section-heading-font-weight);
          line-height: var(--boxel-section-heading-line-height);
          color: var(--foreground);
          margin: 0 0 var(--boxel-sp) 0;
        }

        .event-details-content {
          background: var(--muted);
          padding: var(--boxel-sp-lg);
          border-radius: var(--boxel-border-radius-lg);
          color: var(--foreground);
          line-height: 1.6;
        }

        .price-label {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          margin-bottom: var(--boxel-sp-xs);
          opacity: 0.9;
        }

        .price-amount {
          font-family: var(--boxel-heading-font-family);
          font-size: var(--boxel-heading-font-size);
          font-weight: var(--boxel-heading-font-weight);
          letter-spacing: var(--boxel-lsp-xs);
        }

        .ticket-id-section {
          text-align: center;
          padding: var(--boxel-sp-lg);
          background: var(--muted);
          border-radius: var(--boxel-border-radius-lg);
        }

        .ticket-id-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          margin-bottom: var(--boxel-sp-xs);
        }

        .ticket-id-value {
          font-family: var(--boxel-monospace-font-family);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          color: var(--foreground);
          margin-bottom: var(--boxel-sp-lg);
        }

        .barcode {
          display: flex;
          justify-content: center;
        }

        .barcode-icon {
          width: 3rem;
          height: 3rem;
          color: var(--muted-foreground);
          opacity: 0.4;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get formattedPrice() {
      return formatPrice(this.args.model.price, this.args.model.currency, 0);
    }

    <template>
      <article class='event-ticket-fitted'>
        <div class='fitted-image'>
          {{#if @model.imageUrl}}
            <img src={{@model.imageUrl}} alt={{@model.cardTitle}} />
          {{else}}
            <Ticket class='placeholder-icon' />
          {{/if}}
        </div>
        <div class='fitted-content'>
          {{#if @model.ticketType}}
            <Pill
              @size='extra-small'
              @variant='muted'
              class='fitted-badge'
            ><@fields.ticketType /></Pill>
          {{/if}}
          <div class='fitted-name'><@fields.cardTitle /></div>
          <div class='fitted-meta'>
            <div class='fitted-meta-left'>
              {{#if @model.date}}
                <span class='fitted-date'><@fields.date /></span>
              {{/if}}
              {{#if @model.venue.name}}
                <span class='fitted-venue'>
                  <MapPin class='fitted-venue-icon' />
                  <span class='fitted-venue-text'>
                    <span class='fitted-venue-name'><@fields.venue.name
                      /></span>
                    {{#if @model.venue.city}}
                      <span class='fitted-venue-city'><@fields.venue.city
                        /></span>
                    {{/if}}
                  </span>
                </span>
              {{/if}}
            </div>
            {{#if @model.price}}
              <span class='fitted-price'>{{this.formattedPrice}}</span>
            {{/if}}
          </div>
        </div>
        <div class='fitted-barcode' aria-hidden='true'></div>
      </article>
      <style scoped>
        .event-ticket-fitted {
          /* Resolved variables — theme value with fallback */
          --_card: var(--card, oklch(1 0 0));
          --_foreground: var(--foreground, oklch(0.14 0 0));
          --_primary: var(--primary, oklch(0.55 0.22 264));
          --_primary-foreground: var(--primary-foreground, oklch(1 0 0));
          --_secondary: var(--secondary, oklch(0.5 0.22 300));
          --_muted-foreground: var(--muted-foreground, oklch(0.55 0.02 250));
          --_border: var(--border, oklch(0.92 0 0));

          display: grid;
          grid-template-columns: max-content 1fr;
          height: 100%;
          overflow: hidden;
          background: var(--_card);
          position: relative;
        }

        .fitted-image {
          width: 40cqh;
          min-width: 3.75rem;
          max-width: 11.25rem;
          overflow: hidden;
          background: linear-gradient(
            135deg,
            var(--_primary) 0%,
            var(--_secondary) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fitted-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .placeholder-icon {
          width: 2rem;
          height: 2rem;
          color: var(--_primary-foreground);
          opacity: 0.7;
        }

        .fitted-content {
          padding: var(--boxel-sp-xs);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          justify-content: center;
          overflow: hidden;
        }

        .fitted-barcode {
          display: none;
          position: absolute;
          bottom: var(--boxel-sp-sm);
          right: var(--boxel-sp-sm);
          width: 2.25rem;
          height: 1.75rem;
          background: repeating-linear-gradient(
            to right,
            var(--_muted-foreground) 0,
            var(--_muted-foreground) 1.5px,
            transparent 1.5px,
            transparent 3px,
            var(--_muted-foreground) 3px,
            var(--_muted-foreground) 4px,
            transparent 4px,
            transparent 5.5px,
            var(--_muted-foreground) 5.5px,
            var(--_muted-foreground) 8px,
            transparent 8px,
            transparent 9px,
            var(--_muted-foreground) 9px,
            var(--_muted-foreground) 10px,
            transparent 10px,
            transparent 11.5px
          );
          background-size: 11.5px 100%;
          opacity: 0.85;
          border-radius: 1px;
        }

        .event-ticket-fitted:has(.fitted-badge) .fitted-content {
          padding: var(--boxel-sp-5xs) var(--boxel-sp-2xs);
        }

        .event-ticket-fitted:has(.fitted-badge) .fitted-name {
          font-size: var(--boxel-font-size-sm);
        }

        .fitted-badge {
          position: absolute;
          top: var(--boxel-sp-xs);
          left: var(--boxel-sp-xs);
          z-index: 1;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          font-size: var(--boxel-caption-font-size);
        }

        .fitted-name {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size);
          font-weight: 900;
          color: var(--_foreground);
          text-transform: uppercase;
          letter-spacing: -0.01em;
          line-height: 1.1;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .fitted-meta {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-6xs);
          overflow: hidden;
          min-width: 0;
        }

        .fitted-meta-left {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-6xs);
          overflow: hidden;
          min-width: 0;
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-xs);
          color: var(--_muted-foreground);
        }

        .fitted-date {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fitted-venue {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-3xs);
          overflow: hidden;
        }

        .fitted-venue-text {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .fitted-venue-name,
        .fitted-venue-city {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fitted-venue-city {
          opacity: 0.75;
        }

        .fitted-venue-icon {
          width: 0.625rem;
          height: 0.625rem;
          flex-shrink: 0;
          color: var(--_primary);
          margin-top: 0.2em;
        }

        .fitted-price {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          color: var(--_primary);
          flex-shrink: 0;
        }

        /* Strip */
        @container fitted-card (height < 65px) {
          .event-ticket-fitted {
            grid-template-columns: 1fr;
          }
          .fitted-image {
            display: none;
          }
          .fitted-content {
            flex-direction: row;
            align-items: center;
            padding: var(--boxel-sp-xs);
          }
          .fitted-badge,
          .fitted-meta-left {
            display: none;
          }
          .fitted-name {
            font-size: var(--boxel-font-size-xs);
            flex: 1;
            -webkit-line-clamp: 1;
          }
          .fitted-meta {
            flex-shrink: 0;
            flex-direction: row;
            align-items: center;
          }
        }

        /* Compact */
        @container fitted-card (65px <= height < 115px) {
          .fitted-badge,
          .fitted-venue {
            display: none;
          }
          .fitted-meta {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }

        @container fitted-card ((65px <= height < 115px) and (width >= 150px)) {
          .fitted-venue {
            display: flex;
          }
          .fitted-venue-name {
            display: none;
          }
        }

        @container fitted-card ((65px <= height < 115px) and (width <= 260px)) {
          .fitted-name {
            font-size: var(--boxel-font-size-sm);
          }
        }

        /* Vertical: square or tall */
        @container fitted-card (aspect-ratio <= 1.0) {
          .event-ticket-fitted {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }
          .fitted-image {
            width: 100%;
            max-width: 100%;
            height: 50cqh;
          }
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (height < 150px)) {
          .fitted-image {
            display: none;
          }
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (height >= 150px)) {
          .fitted-content {
            justify-content: flex-start;
          }
        }

        /* Spacious vertical card */
        @container fitted-card ((aspect-ratio <= 1.0) and (width >= 350px) and (height >= 400px)) {
          .fitted-barcode {
            display: block;
          }
          .fitted-image {
            height: 55cqh;
            position: relative;
          }
          .fitted-image::after {
            content: '';
            position: absolute;
            inset: auto 0 0;
            height: 35%;
            background: linear-gradient(to bottom, transparent, var(--_card));
            pointer-events: none;
          }
          .fitted-content {
            padding: var(--boxel-sp);
          }
          .fitted-name {
            font-size: var(--boxel-font-size);
          }
          .fitted-meta-left {
            font-size: var(--boxel-font-size-sm);
            gap: var(--boxel-sp-xs);
          }
          .fitted-venue-icon {
            width: 0.75rem;
            height: 0.75rem;
          }
          .fitted-price {
            font-size: var(--boxel-font-size-sm);
            font-weight: 800;
            margin-top: var(--boxel-sp-sm);
            padding-top: var(--boxel-sp-sm);
            border-top: 1px solid var(--_border);
            width: 100%;
          }
        }

        @container fitted-card ((height >= 115px) and (width > 160px)) {
          .fitted-barcode {
            display: block;
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (width >= 400px) and (height >= 65px)) {
          .fitted-image {
            width: 40cqw;
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (width <= 150px) and (height <= 105px)) {
          .fitted-image {
            display: none;
          }
          .fitted-name {
            font-size: var(--boxel-caption-font-size);
          }
        }

        @container fitted-card ((width <= 160px) and (height <= 180px)) {
          .fitted-name {
            font-size: var(--boxel-font-size-sm);
          }
        }

        @container fitted-card (width < 250px) {
          .fitted-price {
            display: none;
          }
        }

        @container fitted-card (width < 240px) {
          .fitted-venue-name {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get formattedPrice() {
      return formatPrice(this.args.model.price, this.args.model.currency);
    }

    <template>
      <article class='event-ticket-embedded'>
        <div class='embedded-image'>
          {{#if @model.imageUrl}}
            <img src={{@model.imageUrl}} alt={{@model.cardTitle}} />
          {{else}}
            <Ticket class='placeholder-icon' />
          {{/if}}
        </div>
        <div class='embedded-content'>
          {{#if @model.ticketType}}
            <div class='embedded-badge'><@fields.ticketType /></div>
          {{/if}}
          <div class='embedded-name'><@fields.cardTitle /></div>
          {{#if @model.venue.name}}
            <div class='embedded-venue'>
              <MapPin class='venue-icon' />
              <span class='embedded-venue-text'>
                <span class='embedded-venue-name'><@fields.venue.name /></span>
                {{#if @model.venue.city}}
                  <span class='embedded-venue-city'><@fields.venue.city
                    /></span>
                {{/if}}
              </span>
            </div>
          {{/if}}
          <div class='embedded-when'>
            {{#if @model.date}}<span><@fields.date /></span>{{/if}}
          </div>
        </div>
        <div class='perf-divider' aria-hidden='true'></div>
        <div class='embedded-stub'>
          {{#if @model.section}}
            <div class='stub-seat-grid'>
              <div class='stub-field'>
                <div class='stub-label'>SEC</div>
                <div class='stub-value'><@fields.section /></div>
              </div>
              {{#if @model.row}}
                <div class='stub-field'>
                  <div class='stub-label'>ROW</div>
                  <div class='stub-value'><@fields.row /></div>
                </div>
              {{/if}}
              {{#if @model.seat}}
                <div class='stub-field'>
                  <div class='stub-label'>SEAT</div>
                  <div class='stub-value'><@fields.seat /></div>
                </div>
              {{/if}}
            </div>
          {{/if}}
          <div class='stub-price'>{{this.formattedPrice}}</div>
          {{#if @model.ticketId}}
            <div class='stub-id'><@fields.ticketId /></div>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .event-ticket-embedded {
          display: grid;
          grid-template-columns: minmax(6.25rem, 25cqh) 1fr 0.875rem minmax(
              6.875rem,
              9.375rem
            );
          overflow: hidden;
          background: var(--card);
          border-radius: var(--radius);
        }

        .embedded-image {
          overflow: hidden;
          background: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .embedded-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .placeholder-icon {
          width: 2.5rem;
          height: 2.5rem;
          color: var(--muted-foreground);
        }

        .embedded-content {
          padding: var(--boxel-sp) var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          justify-content: center;
          overflow: hidden;
        }

        .embedded-badge {
          display: inline-block;
          align-self: flex-start;
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          color: var(--primary-foreground);
          background: var(--primary);
          padding: var(--boxel-sp-6xs) var(--boxel-sp-5xs);
          border-radius: var(--radius);
          white-space: nowrap;
        }

        .embedded-name {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-lg);
          font-weight: 900;
          color: var(--foreground);
          text-transform: uppercase;
          letter-spacing: -0.01em;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: var(--boxel-sp-5xs);
        }

        .embedded-venue {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-5xs);
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
          overflow: hidden;
        }

        .embedded-venue-text {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .embedded-venue-name,
        .embedded-venue-city {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .embedded-venue-city {
          opacity: 0.75;
        }

        .venue-icon {
          width: 0.75rem;
          height: 0.75rem;
          flex-shrink: 0;
          color: var(--primary);
          margin-top: 0.15em;
        }

        .embedded-when {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          color: var(--foreground);
          margin-top: var(--boxel-sp-5xs);
        }

        .embedded-when span + span {
          padding-left: var(--boxel-sp-xs);
          border-left: 1px solid var(--border);
        }

        /* Perforated edge */
        .perf-divider {
          position: relative;
        }

        .perf-divider::before {
          content: '';
          position: absolute;
          left: 50%;
          top: 0;
          bottom: 0;
          width: 1px;
          transform: translateX(-50%);
          background: var(--border);
        }

        .perf-divider::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(
            circle at center,
            var(--background) 0.25rem,
            transparent 0.25rem
          );
          background-size: 0.875rem 0.75rem;
          background-repeat: repeat-y;
          background-position: center;
        }

        /* Ticket stub */
        .embedded-stub {
          background: var(--muted);
          padding: var(--boxel-sp) var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-xs);
          text-align: center;
          overflow: hidden;
        }

        .stub-seat-grid {
          display: flex;
          gap: var(--boxel-sp-xs);
          justify-content: center;
        }

        .stub-field {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-6xs);
        }

        .stub-label {
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          color: var(--muted-foreground);
        }

        .stub-value {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-lg);
          font-weight: 900;
          color: var(--foreground);
          line-height: 1;
        }

        .stub-price {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          color: var(--primary);
          letter-spacing: -0.02em;
        }

        .stub-id {
          font-family: var(--font-mono);
          font-size: var(--boxel-caption-font-size);
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
      </style>
    </template>
  };
}
