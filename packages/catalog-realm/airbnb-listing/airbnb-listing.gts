// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from '../fields/number'; // ² Import catalog number field
import RatingField from '../fields/rating'; // ³ Import catalog rating field
import MultipleImageField from '../fields/multiple-image'; // ⁴ Import catalog multiple image field
import DateField from '../fields/date'; // ¹⁴ Import catalog date field
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { gt } from '@cardstack/boxel-ui/helpers';
import { Button, Pill } from '@cardstack/boxel-ui/components';
import HomeIcon from '@cardstack/boxel-icons/home';

class IsolatedTemplate extends Component<typeof AirbnbListing> {
  // ¹¹ Isolated format
  @tracked showAllAmenities = false;

  @action
  toggleAmenities() {
    this.showAllAmenities = !this.showAllAmenities;
  }

  get displayedAmenities() {
    const amenities = this.args.model?.amenities ?? [];
    return this.showAllAmenities ? amenities : amenities.slice(0, 6);
  }

  get hasMoreAmenities() {
    return (this.args.model?.amenities?.length ?? 0) > 6;
  }

  <template>
    <div class='airbnb-listing-isolated'>
      <div class='listing-content'>
        {{#if @model.photos}}
          <div class='photos-section'>
            <@fields.photos @format='embedded' />
          </div>
        {{/if}}

        <div class='listing-details'>
          <div class='listing-header'>
            <div class='title-section'>
              <h1 class='property-name'>{{if
                  @model.propertyName
                  @model.propertyName
                  'Untitled Property'
                }}</h1>
              <div class='location-row'>
                <svg
                  class='location-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' />
                  <circle cx='12' cy='10' r='3' />
                </svg>
                <span class='location'>{{if
                    @model.location
                    @model.location
                    'Location not specified'
                  }}</span>
              </div>
            </div>

            <div class='rating-price-row'>
              {{#if @model.rating}}
                <div class='rating-section'>
                  <@fields.rating @format='embedded' />
                  {{#if @model.reviewCount}}
                    <span class='review-count'>({{@model.reviewCount}}
                      reviews)</span>
                  {{/if}}
                </div>
              {{/if}}

              {{#if @model.superhost}}
                {{#if (gt @model.superhost.length 0)}}
                  <Pill class='superhost-badge'>★ Superhost</Pill>
                {{/if}}
              {{/if}}
            </div>
          </div>

          <div class='property-info'>
            <div class='info-grid'>
              {{#if @model.propertyType}}
                <div class='info-item'>
                  <svg
                    class='info-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />
                  </svg>
                  <span>{{@model.propertyType}}</span>
                </div>
              {{/if}}

              {{#if @model.guests}}
                <div class='info-item'>
                  <svg
                    class='info-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                    <circle cx='9' cy='7' r='4' />
                    <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                    <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                  </svg>
                  <span>{{@model.guests}} guests</span>
                </div>
              {{/if}}

              {{#if @model.bedrooms}}
                <div class='info-item'>
                  <svg
                    class='info-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M2 4v16h20V4H2zm2 2h16v4H4V6zm16 6v6H4v-6h16z' />
                  </svg>
                  <span>{{@model.bedrooms}} bedrooms</span>
                </div>
              {{/if}}

              {{#if @model.beds}}
                <div class='info-item'>
                  <svg
                    class='info-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M2 4v16h20V4H2zm2 2h16v4H4V6zm16 6v6H4v-6h16z' />
                  </svg>
                  <span>{{@model.beds}} beds</span>
                </div>
              {{/if}}

              {{#if @model.bathrooms}}
                <div class='info-item'>
                  <svg
                    class='info-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M9 6l0 0a5 5 0 0 1 5 5v3H4v-3a5 5 0 0 1 5-5zM4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'
                    />
                  </svg>
                  <span>{{@model.bathrooms}} bathrooms</span>
                </div>
              {{/if}}
            </div>
          </div>

          {{#if @model.host}}
            <div class='host-section'>
              <h3>Hosted by {{@model.host}}</h3>
              {{#if @model.listedDate}}
                <div class='listed-date'>Listed on
                  <@fields.listedDate @format='embedded' /></div>
              {{/if}}
            </div>
          {{/if}}

          {{#if @model.description}}
            <div class='description'>
              <h3>About this place</h3>
              <p>{{@model.description}}</p>
            </div>
          {{/if}}

          {{#if (gt @model.amenities.length 0)}}
            <div class='amenities-section'>
              <h3>What this place offers</h3>
              <div class='amenities-grid'>
                {{#each this.displayedAmenities as |amenity|}}
                  <div class='amenity-item'>
                    <svg
                      class='amenity-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polyline points='20 6 9 17 4 12' />
                    </svg>
                    <span>{{amenity}}</span>
                  </div>
                {{/each}}
              </div>
              {{#if this.hasMoreAmenities}}
                <Button
                  class='show-amenities-btn'
                  @kind='secondary'
                  {{on 'click' this.toggleAmenities}}
                >
                  {{#if this.showAllAmenities}}
                    Show less
                  {{else}}
                    Show all
                    {{@model.amenities.length}}
                    amenities
                  {{/if}}
                </Button>
              {{/if}}
            </div>
          {{/if}}

          <div class='booking-section'>
            <div class='price-container'>
              <div class='price-row'>
                <span class='price'><@fields.pricePerNight
                    @format='embedded'
                  /></span>
                <span class='per-night'>/ night</span>
              </div>
            </div>

            <Button class='reserve-btn' @kind='primary'>
              <svg
                class='calendar-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                <line x1='16' y1='2' x2='16' y2='6' />
                <line x1='8' y1='2' x2='8' y2='6' />
                <line x1='3' y1='10' x2='21' y2='10' />
              </svg>
              Check availability
            </Button>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* ¹⁶ Themed isolated styles */
      .airbnb-listing-isolated {
        font-family: var(
          --font-sans,
          'Inter',
          'Circular',
          -apple-system,
          system-ui,
          sans-serif
        );
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: var(--background, #ffffff);
        container-type: inline-size;
      }

      .listing-content {
        max-width: 1200px;
        margin: 0 auto;
        padding: calc(var(--spacing, 0.25rem) * 8);
      }

      .photos-section {
        margin-bottom: calc(var(--spacing, 0.25rem) * 8);
        border-radius: var(--radius, 12px);
        overflow: hidden;
      }

      .listing-details {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 8);
      }

      .listing-header {
        padding-bottom: calc(var(--spacing, 0.25rem) * 6);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .title-section {
        margin-bottom: calc(var(--spacing, 0.25rem) * 4);
      }

      .property-name {
        font-size: 2rem;
        font-weight: 600;
        color: var(--foreground, #222222);
        margin: 0 0 0.75rem 0;
        line-height: 1.2;
      }

      .location-row {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .location-icon {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, #717171);
      }

      .location {
        font-size: 0.9375rem;
        color: var(--foreground, #222222);
        font-weight: 500;
      }

      .rating-price-row {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 4);
        flex-wrap: wrap;
      }

      .rating-section {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .review-count {
        font-size: 0.875rem;
        color: var(--muted-foreground, #717171);
        font-weight: 500;
      }

      .superhost-badge {
        background: var(--muted, #f7f7f7);
        color: var(--foreground, #222222);
        padding: 0.375rem 0.75rem;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .property-info {
        padding: calc(var(--spacing, 0.25rem) * 6) 0;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: calc(var(--spacing, 0.25rem) * 4);
      }

      .info-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.9375rem;
        color: var(--foreground, #222222);
      }

      .info-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--muted-foreground, #717171);
      }

      .host-section {
        padding: calc(var(--spacing, 0.25rem) * 6) 0;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .host-section h3 {
        font-size: 1.375rem;
        font-weight: 600;
        color: var(--foreground, #222222);
        margin: 0 0 0.5rem 0;
      }

      .listed-date {
        font-size: 0.875rem;
        color: var(--muted-foreground, #717171);
      }

      .description {
        padding: calc(var(--spacing, 0.25rem) * 6) 0;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .description h3 {
        font-size: 1.375rem;
        font-weight: 600;
        color: var(--foreground, #222222);
        margin: 0 0 1rem 0;
      }

      .description p {
        font-size: 0.9375rem;
        color: var(--foreground, #222222);
        line-height: 1.6;
        margin: 0;
      }

      .amenities-section {
        padding: calc(var(--spacing, 0.25rem) * 6) 0;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .amenities-section h3 {
        font-size: 1.375rem;
        font-weight: 600;
        color: var(--foreground, #222222);
        margin: 0 0 1rem 0;
      }

      .amenities-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: calc(var(--spacing, 0.25rem) * 4);
        margin-bottom: calc(var(--spacing, 0.25rem) * 4);
      }

      .amenity-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.9375rem;
        color: var(--foreground, #222222);
      }

      .amenity-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--foreground, #222222);
      }

      .show-amenities-btn {
        padding: 0.75rem 1.5rem;
        font-size: 0.9375rem;
        font-weight: 600;
        border: 1px solid var(--foreground, #222222);
        background: var(--background, white);
        color: var(--foreground, #222222);
        border-radius: var(--radius, 8px);
        cursor: pointer;
        transition: all 0.2s;
      }

      .show-amenities-btn:hover {
        background: var(--muted, #f7f7f7);
      }

      .booking-section {
        position: sticky;
        bottom: 0;
        background: var(--card, white);
        padding: calc(var(--spacing, 0.25rem) * 6);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 12px);
        box-shadow: var(--shadow-lg, 0 6px 20px rgba(0, 0, 0, 0.2));
      }

      .price-container {
        margin-bottom: calc(var(--spacing, 0.25rem) * 4);
      }

      .price-row {
        display: flex;
        align-items: baseline;
        gap: 0.375rem;
      }

      .price {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--foreground, #222222);
      }

      .per-night {
        font-size: 0.9375rem;
        color: var(--muted-foreground, #717171);
      }

      .reserve-btn {
        width: 100%;
        padding: calc(var(--spacing, 0.25rem) * 4)
          calc(var(--spacing, 0.25rem) * 6);
        font-size: 1rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        background: var(
          --primary,
          linear-gradient(to right, #e61e4d 0%, #e31c5f 50%, #d70466 100%)
        );
        border: none;
        border-radius: var(--radius, 8px);
        color: var(--primary-foreground, white);
        cursor: pointer;
        transition: all 0.2s;
      }

      .reserve-btn:hover {
        background: var(
          --accent,
          linear-gradient(to right, #d90b63 0%, #d70466 100%)
        );
        transform: scale(1.02);
      }

      .calendar-icon {
        width: 1.125rem;
        height: 1.125rem;
      }

      @container (max-width: 767px) {
        .listing-content {
          padding: calc(var(--spacing, 0.25rem) * 4);
        }

        .property-name {
          font-size: 1.5rem;
        }

        .info-grid {
          grid-template-columns: 1fr;
        }

        .amenities-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class AirbnbListing extends CardDef {
  // ⁵ Airbnb listing card definition
  static displayName = 'Airbnb Listing';
  static prefersWideFormat = true;
  static icon = HomeIcon;

  @field propertyName = contains(StringField); // ⁶ Primary identifier
  @field location = contains(StringField);
  @field propertyType = contains(StringField); // e.g., "Entire home", "Private room"
  @field pricePerNight = contains(NumberField, {
    configuration: {
      options: {
        prefix: '$',
        decimals: 0,
      },
    },
  });
  @field rating = contains(RatingField, {
    // ⁷ 5-star rating
    configuration: {
      options: {
        maxStars: 5,
      },
    },
  });
  @field reviewCount = contains(NumberField);
  @field guests = contains(NumberField);
  @field bedrooms = contains(NumberField);
  @field beds = contains(NumberField);
  @field bathrooms = contains(NumberField);
  @field photos = contains(MultipleImageField, {
    // ⁸ Property photos with carousel
    configuration: {
      variant: 'gallery',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        allowReorder: true,
        maxFiles: 20,
      },
    },
  });
  @field amenities = containsMany(StringField); // ⁹ e.g., "WiFi", "Pool", "Kitchen"
  @field description = contains(StringField);
  @field host = contains(StringField);
  @field superhost = contains(StringField); // "Yes" or "No"
  @field listedDate = contains(DateField); // ¹⁵ Date when listing was uploaded

  @field title = contains(StringField, {
    // ¹⁰ Computed title
    computeVia: function (this: AirbnbListing) {
      try {
        const name = this.propertyName ?? 'Untitled Property';
        const location = this.location ? ` • ${this.location}` : '';
        return `${name}${location}`;
      } catch (e) {
        console.error('AirbnbListing: Error computing title', e);
        return 'Untitled Property';
      }
    },
  });

  static isolated = IsolatedTemplate;

  static embedded = class Embedded extends Component<typeof AirbnbListing> {
    // ¹² Embedded format
    get firstImage() {
      return this.args.model?.photos?.images?.[0]?.url;
    }

    <template>
      <div class='airbnb-listing-embedded'>
        {{#if this.firstImage}}
          <div class='embedded-photo'>
            <img src={{this.firstImage}} alt='Property' class='photo-img' />
          </div>
        {{/if}}

        <div class='embedded-content'>
          <div class='embedded-header'>
            <h3 class='embedded-title'>{{if
                @model.propertyName
                @model.propertyName
                'Untitled Property'
              }}</h3>
            <div class='embedded-location'>{{if
                @model.location
                @model.location
                'Location not specified'
              }}</div>
          </div>

          <div class='embedded-info'>
            {{#if @model.guests}}
              <span class='info-detail'>{{@model.guests}} guests</span>
            {{/if}}
            {{#if @model.bedrooms}}
              <span class='info-detail'>·</span>
              <span class='info-detail'>{{@model.bedrooms}} bedrooms</span>
            {{/if}}
            {{#if @model.beds}}
              <span class='info-detail'>·</span>
              <span class='info-detail'>{{@model.beds}} beds</span>
            {{/if}}
          </div>

          <div class='embedded-footer'>
            {{#if @model.rating}}
              <div class='embedded-rating'>
                <@fields.rating @format='atom' />
                {{#if @model.reviewCount}}
                  <span class='embedded-reviews'>({{@model.reviewCount}})</span>
                {{/if}}
              </div>
            {{/if}}

            <div class='embedded-price'>
              <span class='price-amount'><@fields.pricePerNight
                  @format='embedded'
                /></span>
              <span class='price-label'>/ night</span>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* ¹⁷ Themed embedded styles */
        .airbnb-listing-embedded {
          display: flex;
          gap: calc(var(--spacing, 0.25rem) * 4);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: var(--radius, 12px);
          background: var(--card, white);
          transition: all 0.2s;
          cursor: pointer;
        }

        .airbnb-listing-embedded:hover {
          box-shadow: var(--shadow-md, 0 6px 16px rgba(0, 0, 0, 0.12));
        }

        .embedded-photo {
          flex-shrink: 0;
          width: 120px;
          height: 120px;
          border-radius: var(--radius, 8px);
          overflow: hidden;
        }

        .photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .embedded-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-width: 0;
        }

        .embedded-header {
          margin-bottom: calc(var(--spacing, 0.25rem) * 2);
        }

        .embedded-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--foreground, #222222);
          margin: 0 0 0.25rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-location {
          font-size: 0.875rem;
          color: var(--muted-foreground, #717171);
        }

        .embedded-info {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.875rem;
          color: var(--muted-foreground, #717171);
          margin-bottom: calc(var(--spacing, 0.25rem) * 2);
        }

        .embedded-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .embedded-rating {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .embedded-reviews {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #717171);
        }

        .embedded-price {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
        }

        .price-amount {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--foreground, #222222);
        }

        .price-label {
          font-size: 0.875rem;
          color: var(--muted-foreground, #717171);
        }
      </style>
    </template>
  };
}
