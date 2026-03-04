import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import Home from '@cardstack/boxel-icons/home';
import { FieldContainer, Pill } from '@cardstack/boxel-ui/components';

// Sotheby's × Architectural Digest inspired listing - warm editorial luxury with serif typography
export class PropertyListing extends CardDef {
  static displayName = 'Property Listing';
  static icon = Home;

  @field address = contains(StringField);
  @field neighborhood = contains(StringField);
  @field price = contains(NumberField);
  @field beds = contains(NumberField);
  @field baths = contains(StringField);
  @field sqft = contains(NumberField);
  @field propertyType = contains(StringField);
  @field yearBuilt = contains(NumberField);
  @field daysOnMarket = contains(NumberField);
  @field pricePerSqft = contains(NumberField);
  @field status = contains(StringField);
  @field openHouse = contains(StringField);
  @field imageUrl = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    get formattedPrice() {
      const p = this.args.model.price || 0;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(p);
    }

    get formattedSqft() {
      const s = this.args.model.sqft || 0;
      return s.toLocaleString();
    }

    get isNew() {
      return (this.args.model.daysOnMarket || 0) <= 7;
    }

    <template>
      <article class='property-listing-isolated'>
        {{#if @model.imageUrl}}
          <div class='hero-image-container'>
            <img
              class='hero-image'
              src={{@model.imageUrl}}
              alt={{@model.address}}
            />
            <div class='hero-overlay'>
              {{#if this.isNew}}
                <Pill class='new-listing-pill'>Just Listed</Pill>
              {{/if}}
              {{#if @model.status}}
                <Pill>{{@model.status}}</Pill>
              {{/if}}
            </div>
          </div>
        {{/if}}

        <div class='content-wrapper'>
          <header class='listing-header'>
            <div class='price-section'>
              <h1 class='price'>{{this.formattedPrice}}</h1>
              {{#if @model.pricePerSqft}}
                <span
                  class='price-per-sqft'
                >${{@model.pricePerSqft}}/sqft</span>
              {{/if}}
            </div>

            <div class='address-section'>
              <h2 class='address'><@fields.address /></h2>
              {{#if @model.neighborhood}}
                <p class='neighborhood'><@fields.neighborhood /></p>
              {{/if}}
            </div>
          </header>

          <div class='specs-grid'>
            <FieldContainer @label='Bedrooms' @tag='div' @vertical={{true}}>
              <div class='spec-value'>{{@model.beds}}</div>
            </FieldContainer>

            <FieldContainer @label='Bathrooms' @tag='div' @vertical={{true}}>
              <div class='spec-value'><@fields.baths /></div>
            </FieldContainer>

            <FieldContainer @label='Square Feet' @tag='div' @vertical={{true}}>
              <div class='spec-value'>{{this.formattedSqft}}</div>
            </FieldContainer>

            {{#if @model.propertyType}}
              <FieldContainer
                @label='Property Type'
                @tag='div'
                @vertical={{true}}
              >
                <div class='spec-value'><@fields.propertyType /></div>
              </FieldContainer>
            {{/if}}
          </div>

          {{#if @model.yearBuilt}}
            <div class='details-section'>
              <FieldContainer @label='Year Built' @tag='div'>
                <@fields.yearBuilt />
              </FieldContainer>

              {{#if @model.daysOnMarket}}
                <FieldContainer @label='Days on Market' @tag='div'>
                  {{@model.daysOnMarket}}
                </FieldContainer>
              {{/if}}
            </div>
          {{/if}}

          {{#if @model.openHouse}}
            <div class='open-house-section'>
              <FieldContainer @label='Open House' @tag='div'>
                <div class='open-house-time'><@fields.openHouse /></div>
              </FieldContainer>
            </div>
          {{/if}}
        </div>
      </article>

      <style scoped>
        .property-listing-isolated {
          height: 100%;
          overflow-y: auto;
          background: var(--background);
          display: flex;
          flex-direction: column;
        }

        .hero-image-container {
          position: relative;
          width: 100%;
          height: 400px;
          background: var(--muted);
          overflow: hidden;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .hero-overlay {
          position: absolute;
          top: var(--boxel-sp);
          right: var(--boxel-sp);
          display: flex;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }

        .new-listing-pill {
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .content-wrapper {
          padding: var(--boxel-sp-xl);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }

        .listing-header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border);
        }

        .price-section {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-sm);
        }

        .price {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-2xl);
          font-weight: 400;
          color: var(--foreground);
          margin: 0;
          letter-spacing: -0.02em;
        }

        .price-per-sqft {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }

        .address-section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
        }

        .address {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-lg);
          font-weight: 400;
          color: var(--foreground);
          margin: 0;
          letter-spacing: 0.01em;
        }

        .neighborhood {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xl);
          margin: 0;
        }

        .specs-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--boxel-sp);
        }

        .spec-value {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-lg);
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .details-section {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--muted);
          border-radius: var(--radius);
        }

        .open-house-section {
          padding: var(--boxel-sp);
          background: var(--accent);
          border-radius: var(--radius);
        }

        .open-house-time {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-lg);
          font-weight: 600;
          color: var(--accent-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @container (max-width: 600px) {
          .hero-image-container {
            height: 300px;
          }

          .content-wrapper {
            padding: var(--boxel-sp);
          }

          .price {
            font-size: var(--boxel-font-size-xl);
          }

          .specs-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get formattedPrice() {
      const p = this.args.model.price || 0;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(p);
    }

    get formattedSqft() {
      const s = this.args.model.sqft || 0;
      return s.toLocaleString();
    }

    <template>
      <article class='property-listing-fitted'>
        <div class='fitted-image'>
          {{#if @model.imageUrl}}
            <img src={{@model.imageUrl}} alt={{@model.address}} />
          {{else}}
            <Home class='placeholder-icon' />
          {{/if}}
        </div>
        <div class='fitted-content'>
          {{#if @model.neighborhood}}
            <div class='fitted-neighborhood'><@fields.neighborhood /></div>
          {{/if}}
          <div class='fitted-price'>{{this.formattedPrice}}</div>
          {{#if @model.address}}
            <div class='fitted-address'><@fields.address /></div>
          {{/if}}
          <div class='fitted-specs'>
            {{#if @model.beds}}<span><@fields.beds /> bd</span>{{/if}}
            {{#if @model.baths}}<span><@fields.baths /> ba</span>{{/if}}
            {{#if @model.sqft}}<span>{{this.formattedSqft}} sf</span>{{/if}}
          </div>
          {{#if @model.status}}
            <Pill
              @size='extra-small'
              @variant='primary'
              class='fitted-status'
            ><@fields.status /></Pill>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .property-listing-fitted {
          position: relative;
          display: grid;
          grid-template-columns: max-content 1fr;
          height: 100%;
          overflow: hidden;
          background: var(--card);
          container-name: fitted-card;
          container-type: size;
        }

        .fitted-image {
          width: 40cqh;
          min-width: 60px;
          max-width: 200px;
          overflow: hidden;
          background: var(--muted);
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
          width: 32px;
          height: 32px;
          color: var(--muted-foreground);
        }

        .fitted-content {
          padding: var(--boxel-sp-2xs);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          justify-content: center;
          overflow: hidden;
        }

        .fitted-price {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-lg);
          font-weight: 400;
          color: var(--foreground);
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fitted-address {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fitted-neighborhood {
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fitted-specs {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          white-space: nowrap;
          overflow: hidden;
        }

        .fitted-specs span + span {
          padding-left: var(--boxel-sp-5xs);
          border-left: 1px solid var(--border);
        }

        .fitted-status {
          display: inline-block;
          width: fit-content;
          line-height: 1;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          position: absolute;
          top: var(--boxel-sp-xs);
          right: var(--boxel-sp-xs);
          z-index: 1;
        }

        /* Position status on left for compact views */
        @container fitted-card ((height <= 105px) and (width <= 150px)) {
          .fitted-content {
            padding: var(--boxel-sp-3xs);
          }
          .fitted-status {
            display: none;
          }
          .fitted-price {
            font-size: 12px;
          }
        }

        /* Strip: 250x65 */
        @container fitted-card (height < 65px) {
          .property-listing-fitted {
            grid-template-columns: 1fr;
          }
          .fitted-image {
            display: none;
          }
          .fitted-content {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-sm);
            padding: 0 var(--boxel-sp-sm);
          }
          .fitted-price {
            font-size: var(--boxel-font-size-sm);
          }
          .fitted-neighborhood {
            font-size: var(--boxel-font-size-xs);
            flex: 1;
          }
          .fitted-address,
          .fitted-specs,
          .fitted-status {
            display: none;
          }
        }

        /* Strip: 400x105 with specs */
        @container fitted-card (65px <= height < 115px) {
          .fitted-specs {
            flex: 1;
          }
          .fitted-address {
            display: none;
          }
        }

        /* Vertical: square or tall */
        @container fitted-card (aspect-ratio <= 1.0) {
          .property-listing-fitted {
            grid-template-columns: 1fr;
            position: relative;
          }
          .fitted-image {
            width: 100%;
            max-width: 100%;
            height: 55cqh;
            position: relative;
          }
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (height <= 170px)) {
          .fitted-content {
            padding: var(--boxel-sp-2xs);
            justify-content: flex-start;
          }
          .fitted-price {
            font-size: var(--boxel-font-size);
          }
          .fitted-address {
            font-size: var(--boxel-font-size-xs);
          }
          .fitted-specs {
            font-size: 10px;
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (height <= 65px)) {
          .fitted-price {
            font-size: var(--boxel-caption-font-size);
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (width >= 400px) and (height >= 65px)) {
          .fitted-image {
            width: 50cqw;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get formattedPrice() {
      const p = this.args.model.price || 0;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(p);
    }

    get formattedSqft() {
      const s = this.args.model.sqft || 0;
      return s.toLocaleString();
    }

    <template>
      <article class='property-listing-embedded'>
        <div class='embedded-image'>
          {{#if @model.imageUrl}}
            <img src={{@model.imageUrl}} alt={{@model.address}} />
          {{else}}
            <Home class='placeholder-icon' />
          {{/if}}
        </div>
        <div class='embedded-content'>
          {{#if @model.neighborhood}}
            <div class='embedded-neighborhood'><@fields.neighborhood /></div>
          {{/if}}
          <div class='embedded-price'>{{this.formattedPrice}}</div>
          {{#if @model.address}}
            <div class='embedded-address'><@fields.address /></div>
          {{/if}}
          <div class='embedded-specs'>
            {{#if @model.beds}}<span><@fields.beds /> bd</span>{{/if}}
            {{#if @model.baths}}<span><@fields.baths /> ba</span>{{/if}}
            {{#if @model.sqft}}<span>{{this.formattedSqft}} sf</span>{{/if}}
          </div>
          <div class='embedded-footer'>
            {{#if @model.status}}
              <span class='embedded-status'><@fields.status /></span>
            {{/if}}
            {{#if @model.openHouse}}
              <span class='embedded-open-house'>Open:
                <@fields.openHouse /></span>
            {{/if}}
          </div>
        </div>
      </article>
      <style scoped>
        .property-listing-embedded {
          display: grid;
          grid-template-columns: 180px 1fr;
          overflow: hidden;
          background: var(--card);
          border-radius: var(--radius);
        }

        .embedded-image {
          aspect-ratio: 2 / 3;
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
          width: 40px;
          height: 40px;
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

        .embedded-neighborhood {
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground);
        }

        .embedded-price {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-xl);
          font-weight: 400;
          color: var(--foreground);
          letter-spacing: -0.01em;
          margin-top: var(--boxel-sp-5xs);
        }

        .embedded-address {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .embedded-specs {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
          display: flex;
          gap: var(--boxel-sp-sm);
          margin-top: var(--boxel-sp-5xs);
        }

        .embedded-specs span + span {
          padding-left: var(--boxel-sp-5xs);
          border-left: 1px solid var(--border);
        }

        .embedded-footer {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          margin-top: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }

        .embedded-status {
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--accent-foreground);
          background: var(--accent);
          padding: 2px 8px;
          border-radius: var(--radius);
          white-space: nowrap;
        }

        .embedded-open-house {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
