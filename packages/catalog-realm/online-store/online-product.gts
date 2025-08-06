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
        aspect-ratio: 2;
        border-radius: 1rem;
        overflow: hidden;
        background: #f9fafb;
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
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        overflow: hidden;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
        font-size: 0.8125rem;
      }

      .product-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
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

      if (!inStock || inventory === 0) return 'out';
      if (inventory <= 5) return 'low';
      return 'in';
    } catch (e) {
      return 'unknown';
    }
  }

  <template>
    <div class='fitted-container'>
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
                <rect x='3' y='3' width='18' height='18' rx='2' />
              </svg>
            </div>
          {{/if}}

          <div class='badge-info'>
            <div class='primary-text badge-title'>{{if
                @model.productName
                @model.productName
                'Product'
              }}</div>
            <div class='secondary-text badge-price'>{{formatCurrency
                this.currentPrice
                currency='USD'
                size='tiny'
              }}</div>
            {{#if (eq this.stockStatus 'out')}}
              <div class='tertiary-text badge-status out'>Out</div>
            {{else if @model.sku}}
              <div class='tertiary-text badge-sku'>{{@model.sku}}</div>
            {{/if}}
          </div>

          {{#if this.hasDiscount}}
            <div class='badge-discount'>{{this.discountPercentage}}%</div>
          {{/if}}
        </div>
      </div>

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
                <rect x='3' y='3' width='18' height='18' rx='2' />
              </svg>
            </div>
          {{/if}}

          <div class='strip-info'>
            <div class='strip-main'>
              <div class='primary-text strip-title'>{{if
                  @model.productName
                  @model.productName
                  'Unnamed Product'
                }}</div>
              <div class='secondary-text strip-category'>{{if
                  @model.category
                  @model.category
                  'General'
                }}</div>
            </div>

            <div class='strip-pricing'>
              <div class='primary-text strip-price'>{{formatCurrency
                  this.currentPrice
                  currency='USD'
                  size='short'
                }}</div>
              {{#if this.hasDiscount}}
                <div class='tertiary-text strip-original'>{{formatCurrency
                    @model.price
                    currency='USD'
                    size='tiny'
                  }}</div>
              {{/if}}
            </div>

            <div class='strip-meta'>
              {{#if @model.sku}}
                <span class='tertiary-text'>{{@model.sku}}</span>
              {{/if}}
              <span class='tertiary-text stock-{{this.stockStatus}}'>
                {{#if (eq this.stockStatus 'in')}}{{formatNumber
                    @model.inventory
                  }}
                  left
                {{else if (eq this.stockStatus 'low')}}Low stock
                {{else}}Out of stock{{/if}}
              </span>
            </div>
          </div>

          {{#if this.hasDiscount}}
            <div class='strip-badge'>SALE</div>
          {{/if}}
        </div>
      </div>

      <div class='tile-format'>
        <div class='tile-content'>
          <div class='tile-image-container'>
            {{#if @model.imageUrl}}
              <img
                src={{@model.imageUrl}}
                alt={{@model.productName}}
                class='tile-image'
              />
            {{else}}
              <div class='tile-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
            {{/if}}

            {{#if this.hasDiscount}}
              <div class='tile-discount-badge'>{{this.discountPercentage}}% OFF</div>
            {{/if}}

            {{#if @model.category}}
              <div class='tile-category-badge'>{{@model.category}}</div>
            {{/if}}
          </div>

          <div class='tile-info'>
            <div class='primary-text tile-title'>{{if
                @model.productName
                @model.productName
                'Unnamed Product'
              }}</div>

            <div class='tile-pricing'>
              <div class='primary-text tile-current-price'>{{formatCurrency
                  this.currentPrice
                  currency='USD'
                  size='medium'
                }}</div>
              {{#if this.hasDiscount}}
                <div class='secondary-text tile-original-price'>{{formatCurrency
                    @model.price
                    currency='USD'
                    size='short'
                  }}</div>
              {{/if}}
            </div>

            <div class='tile-footer'>
              {{#if @model.sku}}
                <div class='tertiary-text tile-sku'>{{@model.sku}}</div>
              {{/if}}
              <div class='secondary-text stock-{{this.stockStatus}}'>
                {{#if (eq this.stockStatus 'in')}}{{formatNumber
                    @model.inventory
                  }}
                  in stock
                {{else if (eq this.stockStatus 'low')}}Low stock
                {{else}}Out of stock{{/if}}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class='card-format'>
        <div class='card-content'>
          <div class='card-image-section'>
            {{#if @model.imageUrl}}
              <img
                src={{@model.imageUrl}}
                alt={{@model.productName}}
                class='card-image'
              />
            {{else}}
              <div class='card-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
            {{/if}}

            {{#if this.hasDiscount}}
              <div class='card-discount-badge'>{{this.discountPercentage}}% OFF</div>
            {{/if}}
          </div>

          <div class='card-info-section'>
            <div class='card-header'>
              <div class='primary-text card-title'>{{if
                  @model.productName
                  @model.productName
                  'Unnamed Product'
                }}</div>
              {{#if @model.category}}
                <div
                  class='secondary-text card-category'
                >{{@model.category}}</div>
              {{/if}}
            </div>

            <div class='card-pricing'>
              <div class='primary-text card-current-price'>{{formatCurrency
                  this.currentPrice
                  currency='USD'
                  size='medium'
                }}</div>
              {{#if this.hasDiscount}}
                <div class='secondary-text card-original-price'>{{formatCurrency
                    @model.price
                    currency='USD'
                    size='short'
                  }}</div>
              {{/if}}
            </div>

            <div class='card-footer'>
              <div class='card-meta'>
                {{#if @model.sku}}
                  <span class='tertiary-text'>SKU: {{@model.sku}}</span>
                {{/if}}
                <span class='secondary-text stock-{{this.stockStatus}}'>
                  {{#if (eq this.stockStatus 'in')}}{{formatNumber
                      @model.inventory
                    }}
                    available
                  {{else if (eq this.stockStatus 'low')}}Low inventory
                  {{else}}Out of stock{{/if}}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* Container query system */
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
      }

      /* Hide all subformats by default */
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

      /* Activation ranges - NO GAPS */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
        }
      }

      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
        }
      }

      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
        }
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: var(--text-primary, rgba(0, 0, 0, 0.95));
        line-height: 1.2;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: var(--text-secondary, rgba(0, 0, 0, 0.85));
        line-height: 1.3;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: var(--text-tertiary, rgba(0, 0, 0, 0.7));
        line-height: 1.4;
      }

      /* Badge format styles */
      .badge-content {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        width: 100%;
        height: 100%;
      }

      .badge-image,
      .badge-icon {
        width: clamp(16px, 25%, 34px);
        height: clamp(16px, 25%, 34px);
        flex-shrink: 0;
        border-radius: 0.25rem;
        object-fit: cover;
      }

      .badge-icon {
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .badge-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
      }

      .badge-title {
        font-size: 0.875rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .badge-price {
        font-size: 0.75rem;
        margin-top: 0.25rem;
      }

      .badge-status,
      .badge-sku {
        font-size: 0.6875rem;
        margin-top: auto;
      }

      .badge-discount {
        background: #dc2626;
        color: white;
        padding: 0.125rem 0.25rem;
        border-radius: 0.1875rem;
        font-size: 0.625rem;
        font-weight: 600;
        line-height: 1;
        flex-shrink: 0;
      }

      /* Strip format styles */
      .strip-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        height: 100%;
      }

      .strip-image,
      .strip-icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 0.25rem;
        object-fit: cover;
        align-self: center;
      }

      .strip-icon {
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .strip-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        gap: 0.25rem;
      }

      .strip-main {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .strip-title {
        font-size: 0.875rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .strip-category {
        font-size: 0.75rem;
        color: #6366f1;
        background: #ede9fe;
        padding: 0.125rem 0.25rem;
        border-radius: 0.1875rem;
        flex-shrink: 0;
      }

      .strip-pricing {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: 0.125rem;
      }

      .strip-price {
        font-size: 0.875rem;
        color: #059669;
      }

      .strip-original {
        text-decoration: line-through;
      }

      .strip-meta {
        display: flex;
        gap: 0.5rem;
        font-size: 0.6875rem;
        margin-top: 0.125rem;
      }

      .strip-badge {
        background: #dc2626;
        color: white;
        padding: 0.25rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
        align-self: center;
        flex-shrink: 0;
      }

      /* Tile format styles */
      .tile-content {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
      }

      .tile-image-container {
        position: relative;
        aspect-ratio: 2;
        flex-shrink: 0;
        border-radius: 0.375rem;
        overflow: hidden;
        background: #f9fafb;
      }

      .tile-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .tile-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        color: #9ca3af;
      }

      .tile-placeholder svg {
        width: 2rem;
        height: 2rem;
      }

      .tile-discount-badge {
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

      .tile-category-badge {
        position: absolute;
        bottom: 0.5rem;
        left: 0.5rem;
        background: #6366f1;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .tile-info {
        flex: 1;
        padding: 0.75rem 0 0 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .tile-title {
        font-size: 0.875rem;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .tile-pricing {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .tile-current-price {
        font-size: 1rem;
        color: #059669;
      }

      .tile-original-price {
        text-decoration: line-through;
      }

      .tile-footer {
        margin-top: auto;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .tile-sku {
        font-family: ui-monospace, 'SF Mono', monospace;
        background: #f3f4f6;
        padding: 0.125rem 0.25rem;
        border-radius: 0.1875rem;
        align-self: flex-start;
      }

      /* Card format styles */
      .card-content {
        display: flex;
        gap: 1rem;
        width: 100%;
        height: 100%;
      }

      @container (min-width: 400px) and (height: 170px) {
        .card-content {
          flex-direction: row;
        }
        .card-image-section {
          flex: 1.618;
          aspect-ratio: 5;
        }
        .card-info-section {
          flex: 1;
        }
        .card-title {
          font-size: 0.875rem;
        }
        .card-category {
          font-size: 0.75rem;
          padding: 0.125rem 0.375rem;
        }
        .card-current-price {
          font-size: 1rem;
        }
        .card-original-price {
          font-size: 0.875rem;
        }
        .card-meta {
          font-size: 0.75rem;
        }
        .card-discount-badge {
          font-size: 0.625rem;
          padding: 0.25rem 0.5rem;
          top: 0.5rem;
          right: 0.5rem;
        }
      }

      @container (min-width: 400px) and (min-height: 171px) {
        .card-content {
          flex-direction: column;
        }
        .card-image-section {
          aspect-ratio: 4;
          flex-shrink: 0;
        }
        .card-info-section {
          flex: 1;
        }
      }

      .card-image-section {
        position: relative;
        border-radius: 0.5rem;
        overflow: hidden;
        background: #f9fafb;
      }

      .card-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .card-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        color: #9ca3af;
      }

      .card-placeholder svg {
        width: 3rem;
        height: 3rem;
      }

      .card-discount-badge {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: #dc2626;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 600;
      }

      .card-info-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .card-header {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .card-title {
        font-size: 1.125rem;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .card-category {
        color: #6366f1;
        background: #ede9fe;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        align-self: flex-start;
        font-size: 0.875rem;
      }

      .card-pricing {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .card-current-price {
        font-size: 1.25rem;
        color: #059669;
      }

      .card-original-price {
        text-decoration: line-through;
      }

      .card-footer {
        margin-top: auto;
      }

      .card-meta {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      /* Stock status colors */
      .stock-in {
        color: #059669;
      }
      .stock-low {
        color: #d97706;
      }
      .stock-out {
        color: #dc2626;
      }

      .badge-status.out {
        color: #dc2626;
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
