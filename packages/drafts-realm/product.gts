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
  FieldsTypeFor,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
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

export function expectedArrivalDescription(
  leadTimeDays: number,
  deliveryWindowDays: number,
) {
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
  Element: HTMLDivElement;
  Args: {
    model: Partial<Product>;
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

export class ProductImages extends GlimmerComponent<ProductImagesSignature> {
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

interface ProductDetailSignature {
  Element: HTMLDivElement;
  Args: {
    model: Partial<Product>;
    fields: FieldsTypeFor<Product>;
  };
}

export class ProductDetail extends GlimmerComponent<ProductDetailSignature> {
  get leadTimeDays() {
    return this.args.model.leadTimeDays || 0;
  }

  get deliveryWindowDays() {
    return this.args.model.deliveryWindowDays || 0;
  }

  <template>
    <div ...attributes>
      <h2>Item Details</h2>
      <div class='details'>
        <@fields.details />
      </div>
      <h2>Shipping and return policies</h2>
      <div class='policies'>
        <div>
          🗓️ Order today, get by
          {{expectedArrivalDescription
            this.leadTimeDays
            this.deliveryWindowDays
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
          {{#if (eq @model.usShippingCostCents 0)}}
            🚚 Free shipping
          {{else}}
            🚚 Cost to ship:
            {{formatUsd @model.usShippingCostCents}}
          {{/if}}
        </div>
      </div>
    </div>
    <style>
      h2 {
        margin-top: 0;
        font-size: 1.1em;
      }
      .policies {
        line-height: 2;
      }
    </style>
  </template>
}

class Isolated extends Component<typeof Product> {
  @tracked activeImage = this.args.model.images?.[0];

  @action updateActiveImage(image: string) {
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
        <ProductDetail
          @model={{@model}}
          @fields={{@fields}}
          class='details-container'
        />
      </div>
      <div class='right-container'>
        <div class='seller-container'>
          <span class='seller'>
            {{@model.seller.title}}
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
      .seller {
        font-size: 1.1em;
        margin-right: var(--boxel-sp);
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
      div[data-test-compound-field-format='atom'] {
        display: inline-block;
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

  static isolated = Isolated;
}
