import MarkdownField from 'https://cardstack.com/base/markdown';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import { Seller as SellerCard } from './seller';
import {
  CardDef,
  field,
  linksTo,
  contains,
  containsMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatUsd(val: number | undefined) {
  if (val === undefined) {
    return '';
  }
  return usdFormatter.format(val / 100);
}

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatNumber(val: number | undefined) {
  if (val === undefined) {
    return '';
  }
  return numberFormatter.format(val);
}

function expectedArrivalDescription(leadTimeDays, deliveryWindowDays) {
  let min = leadTimeDays;
  let max = leadTimeDays + deliveryWindowDays;
  // calculate a date range, relative to today
  let minDate = new Date();
  minDate.setDate(minDate.getDate() + min);
  let maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + max);
  let minMonth = minDate.toLocaleString('default', { month: 'short' });
  let maxMonth = maxDate.toLocaleString('default', { month: 'short' });
  let minDay = minDate.getDate();
  let maxDay = maxDate.getDate();
  if (minMonth === maxMonth) {
    return `${minMonth} ${minDay}–${maxDay}`;
  } else {
    return `${minMonth} ${minDay}–${maxMonth} ${maxDay}`;
  }
}
interface EmbeddedProductComponentSignature {
  Args: {
    model: Product;
  };
}

export class EmbeddedProductComponent extends GlimmerComponent<EmbeddedProductComponentSignature> {
  <template>
    <div class='product' ...attributes>
      <img src={{@model.thumbnailURL}} alt={{@model.title}} />
      <div class='title'>
        {{@model.title}}
      </div>
      <div class='price'>
        {{formatUsd @model.unitPriceCents}}
      </div>
      <div class='seller'>
        {{@model.seller.title}}
      </div>
    </div>
    <style>
      .product {
        max-width: 300px;
      }
      img {
        border-radius: 10px;
        display: block;
        max-width: 100%;
        aspect-ratio: 1.6;
        object-fit: cover;
      }
      .title {
        margin-top: 6px;
        font-weight: 500;
        height: 36px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .price {
        color: green;
      }
      .title,
      .price {
        font-weight: 500;
        font-size: 14px;
        line-height: 18px;
      }
      .seller {
        margin-top: 6px;
        font-size: 12px;
      }
    </style>
  </template>
}

interface ProductImagesSignature {
  Element: HTMLDivElement;
  Args: {
    images: string[] | undefined;
    activeImage: string | undefined;
    onSelectImage: (arg0: string) => void;
  };
}

class ProductImages extends GlimmerComponent<ProductImagesSignature> {
  <template>
    <div ...attributes>
      <img class='main' src={{@activeImage}} />
      <div class='thumbnails'>
        {{#each @images as |image|}}
          <img
            src={{image}}
            class={{cn active=(eq image @activeImage)}}
            {{on 'click' (fn @onSelectImage image)}}
          />
        {{/each}}
      </div>
    </div>
    <style>
      .main {
        min-width: 0;
        max-width: 100%;
        display: block;
        border-radius: 10px;
      }
      .thumbnails {
        display: flex;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: visible;
        padding-top: var(--boxel-sp-xs);
      }
      .thumbnails img {
        width: 50px;
        height: 50px;
        object-fit: cover;
        border-radius: 10px;
        margin-right: var(--boxel-sp-xxs);
        margin-bottom: var(--boxel-sp-xxs);
        cursor: pointer;
        transition: transform 0.2s ease-in-out;
      }
      .thumbnails img:hover {
        transform: scale(1.1);
      }
      .thumbnails img.active {
        opacity: 0.5;
      }
      .thumbnails::-webkit-scrollbar-track {
        background: transparent;
      }
      .thumbnails::-webkit-scrollbar-thumb {
        border-radius: 5px;
        background: var(--boxel-purple-400);
      }
      .thumbnails::-webkit-scrollbar {
        height: 5px;
      }
    </style>
  </template>
}

interface StarRatingSignature {
  Element: HTMLDivElement;
  Args: {
    value: number | undefined;
  };
}

class StarRating extends GlimmerComponent<StarRatingSignature> {
  get rating() {
    return this.args.value || 0;
  }
  maxRating = 5;
  fullClassNames = 'star-full';
  emptyClassNames = 'star-empty';

  get stars() {
    let rating = Math.round(this.rating);
    let starsArray = [];
    for (let i = 1; i <= this.maxRating; i++) {
      starsArray.push({ rating: i, full: rating >= i });
    }
    return starsArray;
  }
  <template>
    <div class='StarRating' ...attributes>
      {{#each this.stars as |star|}}
        <button
          class={{cn
            'star'
            (if star.full this.fullClassNames this.emptyClassNames)
          }}
          type='button'
        >{{if star.full '★' '☆'}}</button>
      {{/each}}
    </div>
    <style>
      .star {
        color: inherit;
        border: 0;
        background: none;
        padding: 0;
      }
    </style>
  </template>
}

export class Product extends CardDef {
  static displayName = 'Product';

  // use title field for product title

  @field images = containsMany(StringField);
  @field seller = linksTo(SellerCard);
  @field unitPriceCents = contains(NumberField);
  @field usShippingCostCents = contains(NumberField);
  @field leadTimeDays = contains(NumberField);
  @field deliveryWindowDays = contains(NumberField);
  @field isReturnable = contains(BooleanField);
  @field details = contains(MarkdownField);
  @field reviewsCount = contains(NumberField);
  @field reviewsAverage = contains(NumberField);
  @field thumbnailURL = contains(StringField, {
    computeVia(this: Product) {
      return this.images?.[0];
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <EmbeddedProductComponent @model={{@model}} />
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    @tracked activeImage = this.args.model.images?.[0];
    @action updateActiveImage(image) {
      this.activeImage = image;
    }

    <template>
      <div class='product'>
        <div class='decorative-header'></div>
        <div class='left-container'>
          <ProductImages
            @images={{@model.images}}
            @activeImage={{this.activeImage}}
            @onSelectImage={{this.updateActiveImage}}
            class='images'
          />
          <div class='details-container'>
            <h2>Item Details</h2>
            <div class='details'>
              <@fields.details />
            </div>
            <h2>Shipping and return policies</h2>
            <div class='policies'>
              <div>
                🗓️ Order today, get by
                {{expectedArrivalDescription
                  @model.leadTimeDays
                  @model.deliveryWindowDays
                }}
              </div>
              {{#if @model.isReturnable}}
                <div>
                  ⮐ Free returns within 30 days
                </div>
              {{else}}
                <div>⮐ Returns &amp; exchanges not accepted</div>
              {{/if}}
              <div>
                ⛟ Cost to ship:
                {{formatUsd @model.usShippingCostCents}}</div>
            </div>
          </div>
        </div>
        <div class='right-container'>
          <div class='seller-container'>
            <span class='seller'>
              {{@model.seller.title}}
            </span>
            <StarRating @value={{@model.reviewsAverage}} class='rating' />
            <span class='reviews-count'>
              ({{formatNumber @model.reviewsCount}})
            </span>
          </div>
          <h1 class='title'>{{@model.title}}</h1>
          <div class='price'>{{formatUsd @model.unitPriceCents}}</div>
          <button>
            Add to cart
          </button>
        </div>
      </div>
      <style>
        .product {
          display: grid;
          grid-template-columns: 50% 50%;
          width: 100%;
        }
        .decorative-header {
          background-image: url(https://i.imgur.com/PQuDAEo.jpg);
          height: var(--boxel-sp-xxl);
          grid-column: 1 / span 2;
          margin-bottom: var(--boxel-sp);
        }
        .images {
          margin: 0 var(--boxel-sp);
        }
        .details-container {
          background: var(--boxel-200);
          border-radius: 16px;
          margin: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
        .details-container h2 {
          margin-top: 0;
          font-size: 1.1em;
        }
        .policies {
          line-height: 2;
        }
        .seller {
          font-size: 1.1em;
          margin-right: var(--boxel-sp);
        }
        .rating {
          display: inline-block;
        }
        .title,
        .price {
          font-size: 1.8em;
          font-weight: 600;
        }
        .price {
          color: green;
        }
        button {
          margin-top: 10px;
          border-radius: 20px;
          background: black;
          color: white;
          font-weight: 500;
          font-size: 14px;
          padding: 7px 24px;
          border: 0;
        }
      </style>
    </template>
  };

  /*
  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }




























































  */
}
