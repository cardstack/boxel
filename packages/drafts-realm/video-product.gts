import { Product, ProductDetail, ProductImages } from './product';
import {
  Component,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { RatingsSummary as RatingsSummaryField } from './ratings-summary';
import { MonetaryAmountAtom } from './monetary-amount';

class Isolated extends Component<typeof VideoProduct> {
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
          <@fields.ratingsSummary @format='atom' />
        </div>
        <h1 class='title'>{{@model.title}}</h1>
        <div class='price'><MonetaryAmountAtom
            @model={{@model.unitPrice}}
          /></div>
        {{#if @model.videoUrl}}
          <div class='video-container'>
            <video controls aria-label='Product video' aria-hidden='false'>
              <source src={{@model.videoUrl}} type='video/mp4' />
            </video>
          </div>
        {{/if}}
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
      .title,
      .price {
        font-size: 1.8em;
        font-weight: 600;
      }
      .price {
        color: green;
      }
      .video-container {
        max-height: 600px;
        overflow: hidden;
        margin-top: var(--boxel-sp);
        padding-right: var(--boxel-sp);
      }
      video {
        max-width: 100%;
        max-height: 100%;
        min-width: 0;
        min-height: 0;
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
      div[data-test-compound-field-format='atom'],
      div[data-test-compound-field-format='embedded'] {
        display: inline-block;
      }
    </style>
  </template>
}

// @ts-ignore
export class VideoProduct extends Product {
  static displayName = 'Video Product';
  @field videoUrl = contains(StringField);
  @field ratingsSummary = contains(RatingsSummaryField, {
    computeVia(this: VideoProduct) {
      return new RatingsSummaryField({
        average: Math.floor(Math.random() * 6), // random number between 0 and 5 inclusive
        count: Math.floor(Math.random() * 29701) + 300, // random number between 300 and 30000
      });
    },
  });
  static isolated = Isolated;
}
