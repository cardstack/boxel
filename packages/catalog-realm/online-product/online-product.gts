import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import UrlField from 'https://cardstack.com/base/url';
import TextAreaField from 'https://cardstack.com/base/text-area';

import { Button, Pill } from '@cardstack/boxel-ui/components';
import {
  formatCurrency,
  formatNumber,
  eq,
  gt,
} from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import BoxIcon from '@cardstack/boxel-icons/package';

class IsolatedTemplate extends Component<typeof OnlineProduct> {
  @tracked showFullDescription = false;

  get currentPrice() {
    try {
      return this.args?.model?.salePrice ?? this.args?.model?.price ?? 0;
    } catch (e) {
      console.error('OnlineProduct: Error computing current price', e);
      return 0;
    }
  }

  get truncatedDescription() {
    try {
      const description = this.args?.model?.shortDescription ?? '';
      return description.length > 150
        ? description.substring(0, 150) + '...'
        : description;
    } catch (e) {
      console.error('OnlineProduct: Error truncating description', e);
      return '';
    }
  }

  get hasDiscount() {
    try {
      const salePrice = this.args?.model?.salePrice;
      const regularPrice = this.args?.model?.price;
      return salePrice && regularPrice && salePrice < regularPrice;
    } catch (e) {
      return false;
    }
  }

  get discountPercentage() {
    try {
      if (!this.hasDiscount) return 0;
      const salePrice = this.args?.model?.salePrice ?? 0;
      const regularPrice = this.args?.model?.price ?? 0;
      return Math.round(((regularPrice - salePrice) / regularPrice) * 100);
    } catch (e) {
      return 0;
    }
  }

  get stockStatus() {
    try {
      const inventory = this.args?.model?.inventory ?? 0;
      const inStock = this.args?.model?.inStock !== false;

      if (!inStock || inventory === 0) return 'out-of-stock';
      if (inventory <= 5) return 'low-stock';
      return 'in-stock';
    } catch (e) {
      return 'unknown';
    }
  }

  @action
  toggleDescription() {
    this.showFullDescription = !this.showFullDescription;
  }

  <template>
    <div class='stage'>
      <div class='product-mat'>
        <div class='product-header'>
          <div class='product-image-section'>
            {{#if @model.imageUrl}}
              <img
                src={{@model.imageUrl}}
                alt={{@model.productName}}
                class='product-image'
              />
            {{else}}
              <div class='product-image-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
            {{/if}}

            {{#if this.hasDiscount}}
              <div class='discount-badge'>
                {{this.discountPercentage}}% OFF
              </div>
            {{/if}}
          </div>

          <div class='product-info-section'>
            <div class='product-badges'>
              {{#if @model.category}}
                <Pill
                  @kind='secondary'
                  class='category-pill'
                >{{@model.category}}</Pill>
              {{/if}}

              <Pill
                @kind={{if
                  (eq this.stockStatus 'in-stock')
                  'success'
                  (if (eq this.stockStatus 'low-stock') 'warning' 'danger')
                }}
                class='stock-pill'
              >
                {{#if (eq this.stockStatus 'in-stock')}}
                  In Stock
                {{else if (eq this.stockStatus 'low-stock')}}
                  Low Stock ({{@model.inventory}}
                  left)
                {{else if (eq this.stockStatus 'out-of-stock')}}
                  Out of Stock
                {{else}}
                  Stock Unknown
                {{/if}}
              </Pill>
            </div>

            <h1 class='product-title'>{{if
                @model.productName
                @model.productName
                'Unnamed Product'
              }}</h1>

            {{#if @model.sku}}
              <div class='product-sku'>SKU: {{@model.sku}}</div>
            {{/if}}

            <div class='product-pricing'>
              <div class='current-price'>
                {{formatCurrency
                  this.currentPrice
                  currency='USD'
                  size='medium'
                }}
              </div>

              {{#if this.hasDiscount}}
                <div class='original-price'>
                  {{formatCurrency @model.price currency='USD' size='medium'}}
                </div>
              {{/if}}
            </div>

            {{#if @model.shortDescription}}
              <div class='product-description'>
                {{#if this.showFullDescription}}
                  <p>{{@model.shortDescription}}</p>
                {{else}}
                  <p class='description-preview'>
                    {{this.truncatedDescription}}
                  </p>
                {{/if}}

                {{#if (gt @model.shortDescription.length 150)}}
                  <Button
                    @variant='ghost'
                    class='description-toggle'
                    {{on 'click' this.toggleDescription}}
                  >
                    {{if this.showFullDescription 'Show Less' 'Show More'}}
                  </Button>
                {{/if}}
              </div>
            {{/if}}

            <div class='product-inventory'>
              {{#if @model.inventory}}
                <div class='inventory-count'>
                  <svg
                    class='inventory-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'
                    />
                    <polyline points='3.27,6.96 12,12.01 20.73,6.96' />
                    <line x1='12' y1='22.08' x2='12' y2='12' />
                  </svg>
                  {{formatNumber @model.inventory}}
                  units available
                </div>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='product-details'>
          <section class='details-section'>
            <h3>Product Details</h3>
            <div class='details-grid'>
              {{#if @model.category}}
                <div class='detail-item'>
                  <span class='detail-label'>Category:</span>
                  <span class='detail-value'>{{@model.category}}</span>
                </div>
              {{/if}}

              {{#if @model.sku}}
                <div class='detail-item'>
                  <span class='detail-label'>SKU:</span>
                  <span class='detail-value'>{{@model.sku}}</span>
                </div>
              {{/if}}

              <div class='detail-item'>
                <span class='detail-label'>Availability:</span>
                <span class='detail-value stock-status {{this.stockStatus}}'>
                  {{#if (eq this.stockStatus 'in-stock')}}
                    In Stock
                  {{else if (eq this.stockStatus 'low-stock')}}
                    Low Stock
                  {{else if (eq this.stockStatus 'out-of-stock')}}
                    Out of Stock
                  {{else}}
                    Unknown
                  {{/if}}
                </span>
              </div>

              {{#if @model.inventory}}
                <div class='detail-item'>
                  <span class='detail-label'>Quantity:</span>
                  <span class='detail-value'>{{formatNumber @model.inventory}}
                    units</span>
                </div>
              {{/if}}
            </div>
          </section>
        </div>
      </div>
    </div>

    <style scoped>
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 0.5rem;
        background: #f8fafc;
      }

      @media (max-width: 800px) {
        .stage {
          padding: 0;
        }
      }

      .product-mat {
        max-width: 64rem;
        width: 100%;
        padding: 2rem;
        overflow-y: auto;
        max-height: 100%;
        font-size: 0.875rem;
        line-height: 1.3;
        background: white;
        border-radius: 0.75rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      }

      @media (max-width: 800px) {
        .product-mat {
          height: 100%;
          padding: 1.5rem;
          border-radius: 0;
        }
      }

      .product-header {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3rem;
        margin-bottom: 3rem;
      }

      @media (max-width: 900px) {
        .product-header {
          grid-template-columns: 1fr;
          gap: 2rem;
        }
      }

      .product-image-section {
        position: relative;
        aspect-ratio: 1;
        border-radius: 1rem;
        overflow: hidden;
        background: #f9fafb;
        flex-shrink: 0;
      }

      .product-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .product-image-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #e5e7eb;
        color: #9ca3af;
      }

      .product-image-placeholder svg {
        width: 4rem;
        height: 4rem;
      }

      .discount-badge {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: #dc2626;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .product-info-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .product-badges {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .product-title {
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
        line-height: 1.2;
      }

      @media (max-width: 600px) {
        .product-title {
          font-size: 1.5rem;
        }
      }

      .product-sku {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        font-size: 0.875rem;
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        align-self: flex-start;
      }

      .product-pricing {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .current-price {
        font-size: 1.875rem;
        font-weight: 700;
        color: #059669;
      }

      .original-price {
        font-size: 1.25rem;
        color: #9ca3af;
        text-decoration: line-through;
      }

      .product-description {
        color: #374151;
        line-height: 1.6;
      }

      .description-preview {
        margin: 0;
      }

      .description-toggle {
        margin-top: 0.5rem;
        padding: 0.25rem 0;
        font-size: 0.875rem;
        color: #6366f1;
        background: none;
        border: none;
        cursor: pointer;
        text-decoration: underline;
      }

      .product-inventory {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #6b7280;
        font-size: 0.875rem;
      }

      .inventory-count {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }

      .inventory-icon {
        width: 1rem;
        height: 1rem;
      }

      .product-details {
        margin-top: 2rem;
      }

      .details-section h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 1.5rem 0;
        color: #111827;
      }

      .details-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
        gap: 1rem;
      }

      .detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem;
        background: #f9fafb;
        border-radius: 0.5rem;
      }

      .detail-label {
        font-weight: 500;
        color: #6b7280;
      }

      .detail-value {
        font-weight: 600;
        color: #111827;
      }

      .stock-status.in-stock {
        color: #059669;
      }

      .stock-status.low-stock {
        color: #d97706;
      }

      .stock-status.out-of-stock {
        color: #dc2626;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof OnlineProduct> {
  get currentPrice() {
    try {
      return this.args?.model?.salePrice ?? this.args?.model?.price ?? 0;
    } catch (e) {
      return 0;
    }
  }

  get hasDiscount() {
    try {
      const salePrice = this.args?.model?.salePrice;
      const regularPrice = this.args?.model?.price;
      return salePrice && regularPrice && salePrice < regularPrice;
    } catch (e) {
      return false;
    }
  }

  <template>
    <div class='product-card'>
      <div class='product-card-image'>
        {{#if @model.imageUrl}}
          <img src={{@model.imageUrl}} alt={{@model.productName}} />
        {{else}}
          <div class='product-image-placeholder'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
              <circle cx='9' cy='9' r='2' />
              <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
            </svg>
          </div>
        {{/if}}

        {{#if this.hasDiscount}}
          <div class='discount-badge'>SALE</div>
        {{/if}}

        {{#if @model.category}}
          <Pill
            @kind='secondary'
            class='category-badge'
          >{{@model.category}}</Pill>
        {{/if}}
      </div>

      <div class='product-card-content'>
        <h4 class='product-card-title'>{{if
            @model.productName
            @model.productName
            'Unnamed Product'
          }}</h4>

        {{#if @model.shortDescription}}
          <p class='product-card-description'>{{@model.shortDescription}}</p>
        {{/if}}

        <div class='product-card-footer'>
          <div class='product-card-pricing'>
            <div class='current-price'>{{formatCurrency
                this.currentPrice
                currency='USD'
                size='medium'
              }}</div>
            {{#if this.hasDiscount}}
              <div class='original-price'>{{formatCurrency
                  @model.price
                  currency='USD'
                  size='short'
                }}</div>
            {{/if}}
          </div>

          <div class='product-card-stock'>
            {{#if @model.inventory}}
              <span class='stock-count'>{{formatNumber @model.inventory}}
                in stock</span>
            {{else}}
              <span class='stock-out'>Out of stock</span>
            {{/if}}
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .product-card {
        background: white;
        overflow: hidden;
        font-size: 0.8125rem;
      }

      .product-card-image {
        position: relative;
        aspect-ratio: 2;
        overflow: hidden;
      }

      .product-card-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .product-image-placeholder {
        width: 100%;
        height: 100%;
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .product-image-placeholder svg {
        width: 2rem;
        height: 2rem;
      }

      .discount-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: #dc2626;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .category-badge {
        position: absolute;
        bottom: 0.5rem;
        left: 0.5rem;
        font-size: 0.75rem;
      }

      .product-card-content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .product-card-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
        margin: 0;
        line-height: 1.2;
      }

      .product-card-description {
        color: #6b7280;
        font-size: 0.75rem;
        line-height: 1.4;
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .product-card-footer {
        margin-top: auto;
      }

      .product-card-pricing {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }

      .current-price {
        font-size: 1rem;
        font-weight: 700;
        color: #059669;
      }

      .original-price {
        font-size: 0.875rem;
        color: #9ca3af;
        text-decoration: line-through;
      }

      .product-card-stock {
        font-size: 0.75rem;
      }

      .stock-count {
        color: #059669;
      }

      .stock-out {
        color: #dc2626;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof OnlineProduct> {
  get currentPrice() {
    try {
      return this.args?.model?.salePrice ?? this.args?.model?.price ?? 0;
    } catch (e) {
      return 0;
    }
  }

  get hasDiscount() {
    try {
      const salePrice = this.args?.model?.salePrice;
      const regularPrice = this.args?.model?.price;
      return salePrice && regularPrice && salePrice < regularPrice;
    } catch (e) {
      return false;
    }
  }

  get stockDisplay() {
    try {
      const inventory = this.args?.model?.inventory ?? 0;
      const inStock = this.args?.model?.inStock !== false;

      if (!inStock || inventory === 0) return 'Out of Stock';
      if (inventory <= 5) return `${inventory} left`;
      return 'In Stock';
    } catch (e) {
      return 'Unknown';
    }
  }

  <template>
    <div class='fitted-container'>
      {{! Badge Format: 150px width max, 40-105px height }}
      <div class='badge-format'>
        <div class='badge-content'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{@model.productName}}
              class='badge-image'
            />
          {{else}}
            <div class='badge-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='9' cy='9' r='2' />
                <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
              </svg>
            </div>
          {{/if}}
          <div class='badge-text'>
            <div class='badge-primary'>{{if
                @model.productName
                @model.productName
                'Product'
              }}</div>
            <div class='badge-secondary'>{{formatCurrency
                this.currentPrice
                currency='USD'
                size='tiny'
              }}</div>
          </div>
          {{#if this.hasDiscount}}
            <div class='badge-indicator'>SALE</div>
          {{/if}}
        </div>
      </div>

      {{! Strip Format: 151px+ width, max 169px height }}
      <div class='strip-format'>
        <div class='strip-content'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{@model.productName}}
              class='strip-image'
            />
          {{else}}
            <div class='strip-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='9' cy='9' r='2' />
                <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
              </svg>
            </div>
          {{/if}}
          <div class='strip-text'>
            <div class='strip-primary'>{{if
                @model.productName
                @model.productName
                'Unnamed Product'
              }}</div>
            <div class='strip-secondary'>{{formatCurrency
                this.currentPrice
                currency='USD'
                size='short'
              }}</div>
            <div class='strip-tertiary'>{{@model.category}}</div>
          </div>
          {{#if this.hasDiscount}}
            <div class='strip-indicator'>SALE</div>
          {{/if}}
        </div>
      </div>

      {{! Tile Format: max 399px width, 170px+ height }}
      <div class='tile-format'>
        <div class='tile-content'>
          {{#if @model.imageUrl}}
            <img
              src={{@model.imageUrl}}
              alt={{@model.productName}}
              class='tile-image'
            />
          {{else}}
            <div class='tile-image-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <circle cx='9' cy='9' r='2' />
                <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
              </svg>
            </div>
          {{/if}}

          <div class='tile-info'>
            <div class='tile-primary'>{{if
                @model.productName
                @model.productName
                'Unnamed Product'
              }}</div>
            <div class='tile-price'>{{formatCurrency
                this.currentPrice
                currency='USD'
                size='medium'
              }}</div>
          </div>

          {{#if this.hasDiscount}}
            <div class='tile-sale-badge'>SALE</div>
          {{/if}}
        </div>
      </div>

      {{! Card Format: 400px+ width, 170px+ height }}
      <div class='card-format'>
        <div class='card-content'>
          <div class='card-left'>
            {{#if @model.imageUrl}}
              <img
                src={{@model.imageUrl}}
                alt={{@model.productName}}
                class='card-image'
              />
            {{else}}
              <div class='card-image-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
            {{/if}}
            {{#if this.hasDiscount}}
              <div class='card-sale-badge'>SALE</div>
            {{/if}}
          </div>

          <div class='card-right'>
            <div class='card-info'>
              <div class='card-primary'>{{if
                  @model.productName
                  @model.productName
                  'Unnamed Product'
                }}</div>
              {{#if @model.sku}}
                <div class='card-sku'>SKU: {{@model.sku}}</div>
              {{/if}}
              <div class='card-pricing'>
                <div class='card-price'>{{formatCurrency
                    this.currentPrice
                    currency='USD'
                    size='medium'
                  }}</div>
                {{#if this.hasDiscount}}
                  <div class='card-original-price'>{{formatCurrency
                      @model.price
                      currency='USD'
                      size='short'
                    }}</div>
                {{/if}}
              </div>
            </div>

            <div class='card-bottom'>
              {{#if @model.category}}
                <div class='card-category'>{{@model.category}}</div>
              {{/if}}
              <div class='card-stock'>{{this.stockDisplay}}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      /* Container setup with size detection */
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
        background: white;
        border-radius: 0.375rem;
        overflow: hidden;
      }

      /* Hide all formats by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.1875rem, 2%, 0.625rem);
        box-sizing: border-box;
      }

      /* Badge Format Activation: ≤150px width, ≤169px height */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
        }
      }

      /* Strip Format Activation: 151px+ width, ≤169px height */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
        }
      }

      /* Tile Format Activation: ≤399px width, 170px+ height */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      /* Card Format Activation: 400px+ width, 170px+ height */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
        }
      }

      /* Card compact layout: horizontal split at golden ratio for 170px height */
      @container (min-width: 400px) and (height: 170px) {
        .card-content {
          flex-direction: row;
          gap: 1rem;
        }
        .card-left {
          flex: 1;
        }
        .card-right {
          flex: 1.618;
        }
      }

      /* =============  BADGE FORMAT ============= */
      .badge-content {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        width: 100%;
        height: 100%;
        position: relative;
      }

      .badge-image,
      .badge-icon {
        width: clamp(1rem, 25%, 2.125rem);
        height: clamp(1rem, 25%, 2.125rem);
        border-radius: 0.25rem;
        flex-shrink: 0;
        object-fit: cover;
      }

      .badge-icon {
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .badge-icon svg {
        width: 60%;
        height: 60%;
      }

      .badge-text {
        flex: 1;
        min-width: 0;
        text-align: left;
      }

      .badge-primary {
        font-size: clamp(0.625rem, 4cqw, 0.875rem);
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .badge-secondary {
        font-size: clamp(0.5rem, 3.5cqw, 0.75rem);
        font-weight: 500;
        color: #059669;
        line-height: 1.3;
        margin-top: 0.125rem;
      }

      .badge-indicator {
        position: absolute;
        top: -0.1875rem;
        right: -0.1875rem;
        background: #dc2626;
        color: white;
        padding: 0.125rem 0.25rem;
        border-radius: 0.1875rem;
        font-size: clamp(0.5rem, 2.5cqw, 0.625rem);
        font-weight: 600;
        line-height: 1;
      }

      /* =============  STRIP FORMAT ============= */
      .strip-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        height: 100%;
        position: relative;
      }

      /* Strip image sizing based on height */
      @container (max-height: 65px) {
        .strip-image,
        .strip-icon {
          width: clamp(1.25rem, 8cqw, 2.125rem);
          height: clamp(1.25rem, 8cqw, 2.125rem);
        }
      }

      @container (min-height: 66px) {
        .strip-image,
        .strip-icon {
          width: 2.5rem;
          height: 2.5rem;
        }
      }

      /* Wide strips: image can fill height with aspect ratio constraint */
      @container (min-width: 250px) and (min-height: 105px) {
        .strip-image {
          width: auto;
          height: 100%;
          max-width: 6rem;
          aspect-ratio: 1.4;
        }
      }

      .strip-image {
        border-radius: 0.25rem;
        flex-shrink: 0;
        object-fit: cover;
      }

      .strip-icon {
        background: #f3f4f6;
        border-radius: 0.25rem;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .strip-icon svg {
        width: 60%;
        height: 60%;
      }

      .strip-text {
        flex: 1;
        min-width: 0;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      /* Hide elements based on height */
      @container (max-height: 65px) {
        .strip-tertiary {
          display: none;
        }
      }

      @container (max-height: 40px) {
        .strip-secondary {
          display: none;
        }
        .strip-text {
          flex-direction: row;
          align-items: center;
          gap: 0.5rem;
        }
      }

      .strip-primary {
        font-size: clamp(0.75rem, 3.5cqw, 0.875rem);
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .strip-secondary {
        font-size: clamp(0.625rem, 3cqw, 0.75rem);
        font-weight: 500;
        color: #059669;
        line-height: 1.3;
      }

      .strip-tertiary {
        font-size: clamp(0.625rem, 2.5cqw, 0.6875rem);
        font-weight: 400;
        color: #6b7280;
        line-height: 1.4;
      }

      .strip-indicator {
        position: absolute;
        top: 0;
        right: 0;
        background: #dc2626;
        color: white;
        padding: 0.1875rem 0.375rem;
        border-radius: 0.25rem;
        font-size: clamp(0.5rem, 2.5cqw, 0.625rem);
        font-weight: 600;
      }

      /* =============  TILE FORMAT ============= */
      .tile-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.75rem;
      }

      .tile-image,
      .tile-image-placeholder {
        width: 100%;
        aspect-ratio: 1.6;
        border-radius: 0.375rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .tile-image-placeholder {
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .tile-image-placeholder svg {
        width: 2rem;
        height: 2rem;
      }

      .tile-info {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        text-align: center;
      }

      .tile-primary {
        font-size: clamp(0.875rem, 4cqw, 1rem);
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        text-overflow: ellipsis;
      }

      .tile-price {
        font-size: clamp(1rem, 4.5cqw, 1.125rem);
        font-weight: 700;
        color: #059669;
        line-height: 1.2;
      }

      .tile-original-price {
        font-size: clamp(0.75rem, 3.5cqw, 0.875rem);
        color: #9ca3af;
        text-decoration: line-through;
        line-height: 1.3;
      }

      .tile-category {
        font-size: clamp(0.6875rem, 3cqw, 0.75rem);
        color: #6366f1;
        background: #ede9fe;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        align-self: center;
      }

      .tile-stock {
        font-size: clamp(0.625rem, 3cqw, 0.6875rem);
        color: #6b7280;
        font-weight: 500;
      }

      .tile-sale-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: #dc2626;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        font-size: clamp(0.625rem, 3cqw, 0.75rem);
        font-weight: 600;
      }

      /* =============  CARD FORMAT ============= */
      .card-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 1rem;
      }

      .card-left {
        position: relative;
        flex: 1;
        max-height: 40%;
      }

      .card-image,
      .card-image-placeholder {
        width: 100%;
        height: 100%;
        border-radius: 0.5rem;
        object-fit: cover;
      }

      .card-image-placeholder {
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .card-image-placeholder svg {
        width: 3rem;
        height: 3rem;
      }

      .card-right {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        flex: 1.618;
      }

      .card-info {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        text-align: left;
      }

      .card-primary {
        font-size: clamp(1rem, 4cqw, 1.25rem);
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        text-overflow: ellipsis;
      }

      .card-sku {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        font-size: clamp(0.75rem, 3cqw, 0.8125rem);
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        align-self: flex-start;
      }

      .card-pricing {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        text-align: left;
      }

      .card-price {
        font-size: clamp(1.125rem, 5cqw, 1.5rem);
        font-weight: 700;
        color: #059669;
      }

      .card-original-price {
        font-size: clamp(0.875rem, 3.5cqw, 1rem);
        color: #9ca3af;
        text-decoration: line-through;
      }

      .card-bottom {
        margin-top: auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        text-align: left;
      }

      .card-category {
        font-size: clamp(0.75rem, 3cqw, 0.8125rem);
        color: #6366f1;
        background: #ede9fe;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
      }

      .card-stock {
        font-size: clamp(0.75rem, 3cqw, 0.8125rem);
        color: #6b7280;
        font-weight: 500;
      }

      .card-sale-badge {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: #dc2626;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        font-size: clamp(0.75rem, 3cqw, 0.8125rem);
        font-weight: 600;
      }

      /* Typography hierarchy enforcement */
      .badge-secondary,
      .strip-secondary,
      .strip-tertiary,
      .tile-original-price,
      .tile-category,
      .tile-stock,
      .card-sku,
      .card-original-price,
      .card-category,
      .card-stock {
        font-size: smaller;
      }

      /* Responsive font scaling for smaller containers */
      @container (max-width: 120px) {
        .badge-primary {
          font-size: 0.625rem;
        }
        .badge-secondary {
          font-size: 0.5rem;
        }
      }

      @container (max-width: 200px) {
        .strip-primary {
          font-size: 0.75rem;
        }
        .strip-secondary {
          font-size: 0.625rem;
        }
        .strip-tertiary {
          font-size: 0.5625rem;
        }
      }

      @container (max-width: 300px) {
        .tile-primary {
          font-size: 0.875rem;
        }
        .tile-price {
          font-size: 1rem;
        }
      }
    </style>
  </template>
}

export class OnlineProduct extends CardDef {
  static displayName = 'Product';
  static icon = BoxIcon;

  @field productName = contains(StringField);
  @field price = contains(NumberField);
  @field salePrice = contains(NumberField);
  @field sku = contains(StringField);
  @field category = contains(StringField);
  @field shortDescription = contains(TextAreaField);
  @field inventory = contains(NumberField);
  @field inStock = contains(BooleanField);
  @field imageUrl = contains(UrlField);

  @field title = contains(StringField, {
    computeVia: function (this: OnlineProduct) {
      try {
        const name = this.productName ?? 'Unnamed Product';
        return name.length > 50 ? name.substring(0, 47) + '...' : name;
      } catch (e) {
        console.error('OnlineProduct: Error computing title', e);
        return 'Unnamed Product';
      }
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
