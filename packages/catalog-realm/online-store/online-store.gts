import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import ColorField from 'https://cardstack.com/base/color';
import EmailField from 'https://cardstack.com/base/email';

import { Button, CardContainer } from '@cardstack/boxel-ui/components';
import { eq, gt, formatNumber } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { fn, concat } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import { htmlSafe } from '@ember/template';

import StoreIcon from '@cardstack/boxel-icons/store';

import type { Query } from '@cardstack/runtime-common';
import { realmURL } from '@cardstack/runtime-common';

const productSource = {
  module: new URL('./online-product', import.meta.url).href,
  name: 'OnlineProduct',
};

const orderSource = {
  module: new URL('./online-order', import.meta.url).href,
  name: 'OnlineOrder',
};

const customerSource = {
  module: new URL('./online-customer', import.meta.url).href,
  name: 'OnlineCustomer',
};

class IsolatedTemplate extends Component<typeof OnlineStore> {
  @tracked activeTab = 'products';
  @tracked showAddProduct = false;

  get productsQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./online-product', import.meta.url).href,
          name: 'OnlineProduct',
        },
      },
    };
  }

  get ordersQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./online-order', import.meta.url).href,
          name: 'OnlineOrder',
        },
      },
    };
  }

  get customersQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./online-customer', import.meta.url).href,
          name: 'OnlineCustomer',
        },
      },
    };
  }

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  // Live data queries for header overview
  productsData = this.args.context?.getCards(
    this,
    () => this.productsQuery,
    () => this.realms,
    { isLive: true },
  );

  ordersData = this.args.context?.getCards(
    this,
    () => this.ordersQuery,
    () => this.realms,
    { isLive: true },
  );

  customersData = this.args.context?.getCards(
    this,
    () => this.customersQuery,
    () => this.realms,
    { isLive: true },
  );

  get overviewMetrics() {
    const productsCount = this.productsData?.instances?.length ?? 0;
    const ordersCount = this.ordersData?.instances?.length ?? 0;
    const customersCount = this.customersData?.instances?.length ?? 0;

    return {
      products: productsCount,
      orders: ordersCount,
      customers: customersCount,
      isLoading:
        this.productsData?.isLoading ||
        this.ordersData?.isLoading ||
        this.customersData?.isLoading,
    };
  }

  @action
  switchTab(tab: string) {
    this.activeTab = tab;
  }

  @action
  toggleAddProduct() {
    this.showAddProduct = !this.showAddProduct;
  }

  private _createNewProduct = restartableTask(async () => {
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          productName: null,
          price: null,
          salePrice: null,
          sku: null,
          category: null,
          shortDescription: null,
          inventory: null,
          inStock: true,
          imageUrl: null,
        },
        relationships: {
          store: {
            links: {
              self: this.args.model.id ?? null,
            },
          },
        },
        meta: {
          adoptsFrom: productSource,
        },
      },
    };

    await this.args.context?.actions?.createCard?.(
      productSource,
      new URL('./online-store', import.meta.url),
      {
        realmURL: this.realmURL,
        doc,
      },
    );
  });

  private _createNewOrder = restartableTask(async () => {
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          orderNumber: null,
          customerEmail: null,
          orderStatus: 'pending',
          orderTotal: null,
          orderDate: null,
          shippingAddress: null,
          paymentMethod: null,
          trackingNumber: null,
        },
        relationships: {},
        meta: {
          adoptsFrom: orderSource,
        },
      },
    };

    await this.args.context?.actions?.createCard?.(
      orderSource,
      new URL('./online-store', import.meta.url),
      {
        realmURL: this.realmURL,
        doc,
      },
    );
  });

  private _createNewCustomer = restartableTask(async () => {
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          customerName: null,
          email: null,
          phone: null,
          totalOrders: 0,
          totalSpent: 0,
          customerSince: null,
          loyaltyTier: 'Bronze',
        },
        relationships: {},
        meta: {
          adoptsFrom: customerSource,
        },
      },
    };

    await this.args.context?.actions?.createCard?.(
      customerSource,
      new URL('./online-store', import.meta.url),
      {
        realmURL: this.realmURL,
        doc,
      },
    );
  });

  @action
  createNewProduct() {
    this._createNewProduct.perform();
  }

  @action
  createNewOrder() {
    this._createNewOrder.perform();
  }

  @action
  createNewCustomer() {
    this._createNewCustomer.perform();
  }

  <template>
    <div class='stage'>
      <div class='store-mat'>
        <header class='store-header'>
          <div class='store-branding'>
            {{#if @model.logoUrl}}
              <img
                src={{@model.logoUrl}}
                alt='{{@model.storeName}}'
                class='store-logo'
              />
            {{else}}
              <div
                class='store-logo-placeholder'
                style={{htmlSafe
                  (if
                    @model.brandColor
                    (concat 'background-color: ' @model.brandColor)
                    ''
                  )
                }}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M3 9h18l-1.5 9H4.5L3 9z' />
                  <path d='M9 9V7a3 3 0 0 1 6 0v2' />
                </svg>
              </div>
            {{/if}}

            <div class='store-info'>
              <h1 class='store-title'>{{if
                  @model.storeName
                  @model.storeName
                  'My Online Store'
                }}</h1>
              {{#if @model.websiteUrl}}
                <a
                  href={{@model.websiteUrl}}
                  target='_blank'
                  rel='noopener noreferrer'
                  class='store-url'
                >{{@model.websiteUrl}}</a>
              {{/if}}
            </div>
          </div>
        </header>

        <section class='store-overview'>
          {{#if this.overviewMetrics.isLoading}}
            <div class='overview-grid overview-loading'>
              <div class='overview-metric loading-metric'>
                <div class='metric-icon loading-icon'>
                  <div class='loading-spinner-small'></div>
                </div>
                <div class='metric-content'>
                  <div class='metric-value loading-text'>Loading</div>
                  <div class='metric-label'>Overview</div>
                </div>
              </div>
              <div class='overview-metric loading-metric'>
                <div class='metric-icon loading-icon'>
                  <div class='loading-spinner-small'></div>
                </div>
                <div class='metric-content'>
                  <div class='metric-value loading-text'>...</div>
                  <div class='metric-label'>Please wait</div>
                </div>
              </div>
            </div>
          {{else}}
            <div class='overview-grid'>
              <div class='overview-metric products'>
                <div class='metric-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='7' y='7' width='14' height='14' rx='2' ry='2' />
                    <path d='M3 12h4l2-2 2 2h10' />
                  </svg>
                </div>
                <div class='metric-content'>
                  <div class='metric-value'>{{formatNumber
                      this.overviewMetrics.products
                    }}</div>
                  <div class='metric-label'>Products</div>
                </div>
              </div>

              <div class='overview-metric orders'>
                <div class='metric-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='1' y='4' width='22' height='16' rx='2' ry='2' />
                    <line x1='1' y1='10' x2='23' y2='10' />
                  </svg>
                </div>
                <div class='metric-content'>
                  <div class='metric-value'>{{formatNumber
                      this.overviewMetrics.orders
                    }}</div>
                  <div class='metric-label'>Orders</div>
                </div>
              </div>

              <div class='overview-metric customers'>
                <div class='metric-icon'>
                  <svg
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
                </div>
                <div class='metric-content'>
                  <div class='metric-value'>{{formatNumber
                      this.overviewMetrics.customers
                    }}</div>
                  <div class='metric-label'>Customers</div>
                </div>
              </div>
            </div>
          {{/if}}
        </section>

        <nav class='tab-navigation'>
          <button
            class='tab-button {{if (eq this.activeTab "products") "active" ""}}'
            {{on 'click' (fn this.switchTab 'products')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='7' y='7' width='14' height='14' rx='2' ry='2' />
              <path d='M3 12h4l2-2 2 2h10' />
            </svg>
            Products
          </button>

          <button
            class='tab-button {{if (eq this.activeTab "orders") "active" ""}}'
            {{on 'click' (fn this.switchTab 'orders')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='1' y='4' width='22' height='16' rx='2' ry='2' />
              <line x1='1' y1='10' x2='23' y2='10' />
            </svg>
            Orders
          </button>

          <button
            class='tab-button
              {{if (eq this.activeTab "customers") "active" ""}}'
            {{on 'click' (fn this.switchTab 'customers')}}
          >
            <svg
              class='tab-icon'
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
            Customers
          </button>
        </nav>

        <main class='tab-content'>
          {{#if (eq this.activeTab 'products')}}
            <section class='products-content'>
              <div class='section-header'>
                <h2>Product Catalog</h2>
                <Button
                  class='primary-button'
                  {{on 'click' this.createNewProduct}}
                >
                  <svg
                    class='button-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='12' y1='5' x2='12' y2='19' />
                    <line x1='5' y1='12' x2='19' y2='12' />
                  </svg>
                  Add Product
                </Button>
              </div>

              {{#let
                (component @context.prerenderedCardSearchComponent)
                as |PrerenderedCardSearch|
              }}
                <PrerenderedCardSearch
                  @query={{this.productsQuery}}
                  @format='fitted'
                  @realms={{this.realms}}
                  @isLive={{true}}
                >
                  <:loading>
                    <div class='products-loading'>
                      <div class='loading-spinner'></div>
                      <p>Loading products...</p>
                    </div>
                  </:loading>

                  <:response as |cards|>
                    {{#if (gt cards.length 0)}}
                      <div class='dynamic-products-grid'>
                        {{#each cards key='url' as |card|}}
                          {{#if card.isError}}
                            <div class='card-error'>
                              <p>Failed to load: {{card.url}}</p>
                            </div>
                          {{else}}
                            <CardContainer
                              {{@context.cardComponentModifier
                                cardId=card.url
                                format='data'
                                fieldType=undefined
                                fieldName=undefined
                              }}
                              @displayBoundaries={{true}}
                              class='product-card-container'
                            >
                              <card.component />
                            </CardContainer>
                          {{/if}}
                        {{/each}}
                      </div>
                    {{else}}
                      <div class='empty-state'>
                        <div class='empty-icon'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <circle cx='9' cy='9' r='7' />
                            <path d='M21 21l-4.35-4.35' />
                          </svg>
                        </div>
                        <h3>No Products Found</h3>
                        <p>Start building your store by adding your first
                          product.</p>
                      </div>
                    {{/if}}
                  </:response>
                </PrerenderedCardSearch>
              {{/let}}
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'orders')}}
            <section class='orders-content'>
              <div class='section-header'>
                <h2>Order Management</h2>
                <Button
                  class='primary-button'
                  {{on 'click' this.createNewOrder}}
                >
                  <svg
                    class='button-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='12' y1='5' x2='12' y2='19' />
                    <line x1='5' y1='12' x2='19' y2='12' />
                  </svg>
                  Add Order
                </Button>
              </div>

              {{#let
                (component @context.prerenderedCardSearchComponent)
                as |PrerenderedCardSearch|
              }}
                <PrerenderedCardSearch
                  @query={{this.ordersQuery}}
                  @format='fitted'
                  @realms={{this.realms}}
                  @isLive={{true}}
                >
                  <:loading>
                    <div class='orders-loading'>
                      <div class='loading-spinner'></div>
                      <p>Loading orders...</p>
                    </div>
                  </:loading>

                  <:response as |cards|>
                    {{#if (gt cards.length 0)}}
                      <div class='dynamic-orders-grid'>
                        {{#each cards key='url' as |card|}}
                          {{#if card.isError}}
                            <div class='card-error'>
                              <p>Failed to load: {{card.url}}</p>
                            </div>
                          {{else}}
                            <CardContainer
                              {{@context.cardComponentModifier
                                cardId=card.url
                                format='data'
                                fieldType=undefined
                                fieldName=undefined
                              }}
                              @displayBoundaries={{true}}
                              class='order-card-container'
                            >
                              <card.component />
                            </CardContainer>
                          {{/if}}
                        {{/each}}
                      </div>
                    {{else}}
                      <div class='empty-state'>
                        <div class='empty-icon'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M9 11H5a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-4'
                            />
                            <path d='M12 1v10' />
                            <path d='M8 6l4-4 4 4' />
                          </svg>
                        </div>
                        <h3>No Orders Yet</h3>
                        <p>Start managing your store by adding your first order.</p>
                      </div>
                    {{/if}}
                  </:response>
                </PrerenderedCardSearch>
              {{/let}}
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'customers')}}
            <section class='customers-content'>
              <div class='section-header'>
                <h2>Customer Management</h2>
                <Button
                  class='primary-button'
                  {{on 'click' this.createNewCustomer}}
                >
                  <svg
                    class='button-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='12' y1='5' x2='12' y2='19' />
                    <line x1='5' y1='12' x2='19' y2='12' />
                  </svg>
                  Add Customer
                </Button>
              </div>

              {{#let
                (component @context.prerenderedCardSearchComponent)
                as |PrerenderedCardSearch|
              }}
                <PrerenderedCardSearch
                  @query={{this.customersQuery}}
                  @format='fitted'
                  @realms={{this.realms}}
                  @isLive={{true}}
                >
                  <:loading>
                    <div class='customers-loading'>
                      <div class='loading-spinner'></div>
                      <p>Loading customers...</p>
                    </div>
                  </:loading>

                  <:response as |cards|>
                    {{#if (gt cards.length 0)}}
                      <div class='dynamic-customers-grid'>
                        {{#each cards key='url' as |card|}}
                          {{#if card.isError}}
                            <div class='card-error'>
                              <p>Failed to load: {{card.url}}</p>
                            </div>
                          {{else}}
                            <CardContainer
                              {{@context.cardComponentModifier
                                cardId=card.url
                                format='data'
                                fieldType=undefined
                                fieldName=undefined
                              }}
                              @displayBoundaries={{true}}
                              class='customer-card-container'
                            >
                              <card.component />
                            </CardContainer>
                          {{/if}}
                        {{/each}}
                      </div>
                    {{else}}
                      <div class='empty-state'>
                        <div class='empty-icon'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'
                            />
                            <circle cx='9' cy='7' r='4' />
                            <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                            <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                          </svg>
                        </div>
                        <h3>No Customers Yet</h3>
                        <p>Start building your customer base by adding your
                          first customer.</p>
                      </div>
                    {{/if}}
                  </:response>
                </PrerenderedCardSearch>
              {{/let}}
            </section>
          {{/if}}

        </main>
      </div>
    </div>

    <style scoped>
      /* ³⁴ Complete store styling */
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

      .store-mat {
        width: 100%;
        padding: 1.5rem;
        overflow-y: auto;
        max-height: 100%;
        font-size: 0.875rem;
        line-height: 1.3;
        background: white;
        border-radius: 0.75rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      }

      @media (max-width: 800px) {
        .store-mat {
          height: 100%;
          padding: 1rem;
          border-radius: 0;
        }
      }

      /* Store header styling */
      .store-header {
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .store-branding {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .store-logo,
      .store-logo-placeholder {
        width: 4rem;
        height: 4rem;
        border-radius: 0.75rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .store-logo-placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .store-logo-placeholder svg {
        width: 2rem;
        height: 2rem;
      }

      .store-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0 0 0.25rem 0;
        color: #111827;
      }

      .store-url {
        color: #6366f1;
        text-decoration: none;
        font-size: 0.875rem;
      }

      .store-url:hover {
        text-decoration: underline;
      }

      /* Overview metrics styling */
      .store-overview {
        margin-bottom: 2rem;
        padding: 1rem;
        background: #fafbfc;
        border-radius: 0.75rem;
        border: 1px solid #e5e7eb;
      }

      .overview-loading {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #6b7280;
        font-size: 0.875rem;
      }

      .loading-spinner-small {
        width: 1rem;
        height: 1rem;
        border: 2px solid #e5e7eb;
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .overview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
      }

      @media (max-width: 768px) {
        .overview-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }
      }

      @media (max-width: 480px) {
        .overview-grid {
          grid-template-columns: 1fr;
        }
      }

      .overview-metric {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        padding: 0.5rem;
        transition: all 0.2s ease;
      }

      .overview-metric:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      @media (max-width: 768px) {
        .overview-metric {
          padding: 0.75rem;
        }
      }

      .metric-icon {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      @media (max-width: 768px) {
        .metric-icon {
          width: 2rem;
          height: 2rem;
        }
      }

      .metric-icon svg {
        width: 1.25rem;
        height: 1.25rem;
        color: white;
      }

      @media (max-width: 768px) {
        .metric-icon svg {
          width: 1rem;
          height: 1rem;
        }
      }

      .overview-metric.products .metric-icon {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
      }

      .overview-metric.orders .metric-icon {
        background: linear-gradient(135deg, #059669, #10b981);
      }

      .overview-metric.customers .metric-icon {
        background: linear-gradient(135deg, #dc2626, #f59e0b);
      }

      .overview-metric.catalog-value .metric-icon {
        background: linear-gradient(135deg, #7c3aed, #a855f7);
      }

      .metric-content {
        min-width: 0;
        flex: 1;
      }

      .metric-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: #111827;
        line-height: 1.1;
      }

      @media (max-width: 768px) {
        .metric-value {
          font-size: 1rem;
        }
      }

      .metric-label {
        font-size: 0.75rem;
        color: #6b7280;
        margin-top: 0.125rem;
        line-height: 1;
      }

      @media (max-width: 768px) {
        .metric-label {
          font-size: 0.6875rem;
        }
      }

      .products-header-actions {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .primary-button {
        background: #6366f1;
        color: white;
        border: none;
        padding: 0.625rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .primary-button:hover {
        background: #5855eb;
        transform: translateY(-1px);
      }

      .button-icon {
        width: 1rem;
        height: 1rem;
      }

      /* Tab navigation */
      .tab-navigation {
        display: flex;
        border-bottom: 1px solid #e5e7eb;
        margin-bottom: 1.5rem;
        gap: 0.25rem;
      }

      .tab-button {
        background: none;
        border: none;
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        border-radius: 0.5rem 0.5rem 0 0;
        transition: all 0.2s ease;
      }

      .tab-button:hover {
        color: #374151;
        background: #f9fafb;
      }

      .tab-button.active {
        color: #6366f1;
        background: white;
        border-bottom: 2px solid #6366f1;
      }

      .tab-icon {
        width: 1.125rem;
        height: 1.125rem;
      }

      /* Tab content */
      .tab-content {
        min-height: 30rem;
      }

      /* Tab-specific content */
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }

      .section-header h2 {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0;
        color: #111827;
      }

      .stat {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: #f3f4f6;
        border-radius: 0.375rem;
      }

      /* Dynamic grids */
      .dynamic-products-grid,
      .dynamic-orders-grid,
      .dynamic-customers-grid {
        display: grid;
        gap: 1rem;
        margin-top: 1rem;
      }

      .dynamic-products-grid {
        grid-auto-rows: minmax(300px, auto);
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      }

      .dynamic-customers-grid {
        grid-auto-rows: minmax(250px, auto);
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      }

      .product-card-container,
      .order-card-container,
      .customer-card-container {
        border-radius: 0.5rem;
        overflow: hidden;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
      }

      .product-card-container:hover,
      .order-card-container:hover,
      .customer-card-container:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
      }

      .products-loading,
      .orders-loading,
      .customers-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem;
        color: #6b7280;
      }

      .loading-spinner {
        width: 2rem;
        height: 2rem;
        border: 3px solid #e5e7eb;
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 1rem;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .card-error {
        padding: 1rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 0.5rem;
        color: #b91c1c;
        font-size: 0.875rem;
      }

      /* Empty states */
      .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        max-width: 28rem;
        margin: 0 auto;
      }

      .empty-icon {
        width: 4rem;
        height: 4rem;
        background: #f3f4f6;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1rem;
      }

      .empty-icon svg {
        width: 2rem;
        height: 2rem;
        color: #9ca3af;
      }

      .empty-state h3 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: #111827;
      }

      .empty-state p {
        color: #6b7280;
        margin: 0 0 1.5rem 0;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof OnlineStore> {
  <template>
    <div class='store-preview'>
      <div class='store-header-compact'>
        <div class='store-branding-compact'>
          {{#if @model.logoUrl}}
            <img
              src={{@model.logoUrl}}
              alt='{{@model.storeName}}'
              class='store-logo-small'
            />
          {{else}}
            <div
              class='store-logo-small placeholder'
              style={{htmlSafe
                (if
                  @model.brandColor (concat 'background: ' @model.brandColor) ''
                )
              }}
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M3 9h18l-1.5 9H4.5L3 9z' />
                <path d='M9 9V7a3 3 0 0 1 6 0v2' />
              </svg>
            </div>
          {{/if}}
          <div class='store-info-compact'>
            <h3>{{if @model.storeName @model.storeName 'Online Store'}}</h3>
            {{#if @model.websiteUrl}}
              <div class='store-url-compact'>{{@model.websiteUrl}}</div>
            {{/if}}
          </div>
        </div>

      </div>

      {{#if @model.storeDescription}}
        <div class='store-description-compact'>
          <@fields.storeDescription />
        </div>
      {{/if}}
    </div>

    <style scoped>
      /* ³⁶ Embedded styling */
      .store-preview {
        padding: 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        background: white;
        font-size: 0.8125rem;
      }

      .store-header-compact {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .store-branding-compact {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }

      .store-logo-small {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.5rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .store-logo-small.placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .store-logo-small.placeholder svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .store-info-compact h3 {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0 0 0.125rem 0;
        color: #111827;
      }

      .store-url-compact {
        font-size: 0.75rem;
        color: #6366f1;
      }

      .store-description-compact {
        font-size: 0.75rem;
        color: #4b5563;
        line-height: 1.4;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof OnlineStore> {
  <template>
    <div class='fitted-container'>
      <div class='badge-format'>
        <div class='badge-content'>
          {{#if @model.logoUrl}}
            <img
              src={{@model.logoUrl}}
              alt='{{@model.storeName}}'
              class='badge-logo'
            />
          {{else}}
            <div
              class='badge-logo placeholder'
              style={{htmlSafe
                (if
                  @model.brandColor (concat 'background: ' @model.brandColor) ''
                )
              }}
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M3 9h18l-1.5 9H4.5L3 9z' />
              </svg>
            </div>
          {{/if}}
          <div class='badge-info'>
            <div class='badge-name'>{{if
                @model.storeName
                @model.storeName
                'Store'
              }}</div>
          </div>
        </div>
      </div>

      <div class='strip-format'>
        <div class='strip-content'>
          <div class='strip-identity'>
            {{#if @model.logoUrl}}
              <img
                src={{@model.logoUrl}}
                alt='{{@model.storeName}}'
                class='strip-logo'
              />
            {{else}}
              <div
                class='strip-logo placeholder'
                style={{htmlSafe
                  (if
                    @model.brandColor
                    (concat 'background: ' @model.brandColor)
                    ''
                  )
                }}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M3 9h18l-1.5 9H4.5L3 9z' />
                </svg>
              </div>
            {{/if}}
            <div class='strip-info'>
              <div class='strip-name'>{{if
                  @model.storeName
                  @model.storeName
                  'Online Store'
                }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class='tile-format'>
        <div class='tile-content'>
          <div class='tile-header'>
            {{#if @model.logoUrl}}
              <img
                src={{@model.logoUrl}}
                alt='{{@model.storeName}}'
                class='tile-logo'
              />
            {{else}}
              <div
                class='tile-logo placeholder'
                style={{htmlSafe
                  (if
                    @model.brandColor
                    (concat 'background: ' @model.brandColor)
                    ''
                  )
                }}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M3 9h18l-1.5 9H4.5L3 9z' />
                </svg>
              </div>
            {{/if}}
            <h4 class='tile-name'>{{if
                @model.storeName
                @model.storeName
                'Online Store'
              }}</h4>
          </div>

          {{#if @model.websiteUrl}}
            <div class='tile-url'>{{@model.websiteUrl}}</div>
          {{/if}}
        </div>
      </div>

      <div class='card-format'>
        <div class='card-content'>
          <div class='card-header'>
            <div class='card-branding'>
              {{#if @model.logoUrl}}
                <img
                  src={{@model.logoUrl}}
                  alt='{{@model.storeName}}'
                  class='card-logo'
                />
              {{else}}
                <div
                  class='card-logo placeholder'
                  style={{htmlSafe
                    (if
                      @model.brandColor
                      (concat 'background: ' @model.brandColor)
                      ''
                    )
                  }}
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M3 9h18l-1.5 9H4.5L3 9z' />
                  </svg>
                </div>
              {{/if}}
              <div class='card-info'>
                <h3 class='card-name'>{{if
                    @model.storeName
                    @model.storeName
                    'Online Store'
                  }}</h3>
                {{#if @model.websiteUrl}}
                  <div class='card-url'>{{@model.websiteUrl}}</div>
                {{/if}}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* ³⁸ Fitted format responsive styling */
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
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

      /* Badge format: up to 150px width, up to 169px height */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
        }
      }

      /* Strip format: 151px+ width, up to 169px height */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      /* Tile format: up to 399px width, 170px+ height */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      /* Card format: 400px+ width, 170px+ height */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      /* Badge format styling */
      .badge-content {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
      }

      .badge-logo {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.25rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .badge-logo.placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .badge-logo.placeholder svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .badge-info {
        min-width: 0;
        flex: 1;
      }

      .badge-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Strip format styling */
      .strip-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        gap: 0.75rem;
      }

      .strip-identity {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        flex: 1;
      }

      .strip-logo {
        width: 2rem;
        height: 2rem;
        border-radius: 0.375rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .strip-logo.placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .strip-logo.placeholder svg {
        width: 1rem;
        height: 1rem;
      }

      .strip-info {
        min-width: 0;
        flex: 1;
      }

      .strip-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #111827;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .strip-meta {
        font-size: 0.6875rem;
        color: #6b7280;
        line-height: 1;
        margin-top: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Tile format styling */
      .tile-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.75rem;
      }

      .tile-header {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }

      .tile-logo {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.5rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .tile-logo.placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .tile-logo.placeholder svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .tile-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
        margin: 0;
        line-height: 1.2;
      }

      .tile-url {
        font-size: 0.6875rem;
        color: #6366f1;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: auto;
      }

      /* Card format styling */
      .card-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.75rem;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .card-branding {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .card-logo {
        width: 3rem;
        height: 3rem;
        border-radius: 0.5rem;
        object-fit: cover;
        flex-shrink: 0;
      }

      .card-logo.placeholder {
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .card-logo.placeholder svg {
        width: 1.5rem;
        height: 1.5rem;
      }

      .card-name {
        font-size: 1rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 0.25rem 0;
        line-height: 1.2;
      }

      .card-url {
        font-size: 0.75rem;
        color: #6366f1;
      }
    </style>
  </template>
}

export class OnlineStore extends CardDef {
  static displayName = 'Online Store';
  static icon = StoreIcon;
  static prefersWideFormat = true;

  @field storeName = contains(StringField);
  @field storeDescription = contains(MarkdownField);
  @field websiteUrl = contains(UrlField);
  @field brandColor = contains(ColorField);
  @field logoUrl = contains(UrlField);
  @field contactEmail = contains(EmailField);
  @field storePhysicalAddress = contains(TextAreaField);

  @field title = contains(StringField, {
    computeVia: function (this: OnlineStore) {
      try {
        const name = this.storeName ?? 'Online Store';
        return name.length > 50 ? name.substring(0, 47) + '...' : name;
      } catch (e) {
        console.error('OnlineStore: Error computing title', e);
        return 'Online Store';
      }
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
