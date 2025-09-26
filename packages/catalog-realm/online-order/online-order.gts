import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import EmailField from 'https://cardstack.com/base/email';
import AddressField from 'https://cardstack.com/base/address';

import { Pill } from '@cardstack/boxel-ui/components';
import {
  eq,
  formatCurrency,
  formatDateTime,
} from '@cardstack/boxel-ui/helpers';

import OrderIcon from '@cardstack/boxel-icons/shopping-cart';

class IsolatedTemplate extends Component<typeof OnlineOrder> {
  get statusColor() {
    const status = this.args?.model?.orderStatus;
    switch (status) {
      case 'completed':
        return '#059669';
      case 'processing':
        return '#d97706';
      case 'shipped':
        return '#2563eb';
      case 'cancelled':
        return '#dc2626';
      default:
        return '#6b7280';
    }
  }

  <template>
    <div class='stage'>
      <div class='order-mat'>
        <div class='order-header'>
          <div class='order-title-section'>
            <div class='order-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='9' cy='21' r='1' />
                <circle cx='20' cy='21' r='1' />
                <path
                  d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'
                />
              </svg>
            </div>
            <div class='order-title-info'>
              <h1 class='order-title'>{{if
                  @model.orderNumber
                  @model.orderNumber
                  'Order'
                }}</h1>
              <div class='order-date'>{{if
                  @model.orderDate
                  (formatDateTime @model.orderDate size='medium')
                  'No date'
                }}</div>
            </div>
          </div>

          <div class='order-status-section'>
            <Pill
              @kind={{if
                (eq @model.orderStatus 'completed')
                'success'
                (if
                  (eq @model.orderStatus 'processing')
                  'warning'
                  (if (eq @model.orderStatus 'shipped') 'primary' 'secondary')
                )
              }}
              class='status-pill'
            >
              {{if @model.orderStatus @model.orderStatus 'Pending'}}
            </Pill>
            <div class='order-total-large'>{{formatCurrency
                @model.orderTotal
                currency='USD'
                size='medium'
                fallback='$0.00'
              }}</div>
          </div>
        </div>

        <div class='order-details-grid'>
          <div class='detail-section customer-section'>
            <h3>Customer Information</h3>
            <div class='customer-info'>
              <div class='customer-icon'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  <circle cx='12' cy='7' r='4' />
                </svg>
              </div>
              <div class='customer-details'>
                <div class='customer-email'>{{if
                    @model.customerEmail
                    @model.customerEmail
                    'No email provided'
                  }}</div>
                <div class='customer-label'>Customer</div>
              </div>
            </div>
          </div>

          <div class='detail-section payment-section'>
            <h3>Payment & Shipping</h3>
            <div class='payment-details'>
              {{#if @model.paymentMethod}}
                <div class='detail-row'>
                  <span class='detail-label'>Payment:</span>
                  <span class='detail-value'>{{@model.paymentMethod}}</span>
                </div>
              {{/if}}

              {{#if @model.shippingAddress}}
                <div class='detail-row'>
                  <span class='detail-label'>Shipping:</span>
                  <span
                    class='detail-value shipping-address'
                  >{{@model.shippingAddress.fullAddress}}</span>
                </div>
              {{/if}}

              {{#if @model.trackingNumber}}
                <div class='detail-row'>
                  <span class='detail-label'>Tracking:</span>
                  <span
                    class='detail-value tracking-number'
                  >{{@model.trackingNumber}}</span>
                </div>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='order-summary'>
          <div class='summary-card'>
            <h3>Order Summary</h3>
            <div class='summary-line total-line'>
              <span>Total Amount</span>
              <span class='total-amount'>{{formatCurrency
                  @model.orderTotal
                  currency='USD'
                  size='medium'
                  fallback='$0.00'
                }}</span>
            </div>
          </div>
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

      .order-mat {
        container-type: inline-size;
        max-width: 56rem;
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
        .order-mat {
          height: 100%;
          padding: 1.5rem;
          border-radius: 0;
        }
      }

      .order-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 2rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid #e5e7eb;
      }

      @media (max-width: 600px) {
        .order-header {
          flex-direction: column;
          gap: 1rem;
        }
      }

      .order-title-section {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .order-icon {
        width: 3rem;
        height: 3rem;
        background: #3b82f6;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .order-icon svg {
        width: 1.5rem;
        height: 1.5rem;
      }

      .order-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
        line-height: 1.2;
      }

      .order-date {
        color: #6b7280;
        font-size: 0.875rem;
        margin-top: 0.25rem;
      }

      .order-status-section {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.75rem;
      }

      @media (max-width: 600px) {
        .order-status-section {
          align-items: flex-start;
        }
      }

      .status-pill {
        font-size: 0.875rem;
        padding: 0.375rem 0.75rem;
      }

      .order-total-large {
        font-size: 1.75rem;
        font-weight: 700;
        color: #059669;
      }

      .order-details-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        margin-bottom: 2rem;
      }

      @container (max-width: 768px) {
        .order-details-grid {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
      }

      @container (max-width: 500px) {
        .order-mat {
          padding: 1rem;
          gap: 1rem;
        }

        .order-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
        }

        .order-status-section {
          align-items: flex-start;
          width: 100%;
        }

        .order-details-grid {
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .detail-section {
          padding: 1rem;
        }

        .order-title {
          font-size: 1.25rem;
        }

        .order-total-large {
          font-size: 1.5rem;
        }
      }

      @container (max-width: 350px) {
        .order-mat {
          padding: 0.75rem;
          font-size: 0.8125rem;
        }

        .customer-info {
          flex-direction: column;
          gap: 0.75rem;
          text-align: center;
        }

        .customer-icon {
          width: 2.5rem;
          height: 2.5rem;
        }

        .customer-icon svg {
          width: 1.25rem;
          height: 1.25rem;
        }

        .order-title {
          font-size: 1.125rem;
        }

        .order-total-large {
          font-size: 1.25rem;
        }

        .detail-section {
          padding: 0.75rem;
        }

        .detail-section h3 {
          font-size: 0.875rem;
        }
      }

      .detail-section {
        background: #f9fafb;
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .detail-section h3 {
        font-size: 1rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 1rem 0;
      }

      .customer-info {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .customer-icon {
        width: 3rem;
        height: 3rem;
        flex-shrink: 0;
        background: #f3f4f6;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
      }

      .customer-icon svg {
        width: 1.5rem;
        height: 1.5rem;
      }

      .customer-email {
        font-size: 0.875rem;
        font-weight: 500;
        color: #111827;
      }

      .customer-label {
        font-size: 0.75rem;
        color: #6b7280;
        margin-top: 0.25rem;
      }

      .payment-details {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
      }

      .detail-label {
        font-weight: 500;
        color: #6b7280;
        min-width: 5rem;
        flex-shrink: 0;
      }

      .detail-value {
        color: #111827;
        text-align: right;
        word-break: break-word;
      }

      .tracking-number {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        font-size: 0.75rem;
        background: #f3f4f6;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
      }

      .shipping-address {
        max-width: 12rem;
      }

      .order-summary {
        border-top: 1px solid #e5e7eb;
        padding-top: 1.5rem;
      }

      .summary-card {
        background: #f9fafb;
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .summary-card h3 {
        font-size: 1rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 1rem 0;
      }

      .summary-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .total-line {
        padding-top: 1rem;
        border-top: 1px solid #e5e7eb;
        font-weight: 600;
      }

      .total-amount {
        font-size: 1.25rem;
        color: #059669;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof OnlineOrder> {
  <template>
    <div class='order-card'>
      <div class='order-header'>
        <div class='order-left'>
          <div class='order-icon'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='9' cy='21' r='1' />
              <circle cx='20' cy='21' r='1' />
              <path
                d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'
              />
            </svg>
          </div>
          <div class='order-info'>
            <div class='order-number'>{{if
                @model.orderNumber
                @model.orderNumber
                'No Order Number'
              }}</div>
            <div class='order-date'>{{if
                @model.orderDate
                (formatDateTime @model.orderDate size='short')
                'No date'
              }}</div>
          </div>
        </div>

        <div class='order-right'>
          <div class='order-total'>{{formatCurrency
              @model.orderTotal
              currency='USD'
              size='medium'
              fallback='$0.00'
            }}</div>
          <Pill
            @kind={{if
              (eq @model.orderStatus 'completed')
              'success'
              (if
                (eq @model.orderStatus 'processing')
                'warning'
                (if (eq @model.orderStatus 'shipped') 'primary' 'secondary')
              )
            }}
            class='status-pill'
          >
            {{if @model.orderStatus @model.orderStatus 'Pending'}}
          </Pill>
        </div>
      </div>

      {{#if @model.customerEmail}}
        <div class='order-details'>
          <div class='detail-item'>
            <span class='detail-label'>Customer:</span>
            <span class='detail-value'>{{@model.customerEmail}}</span>
          </div>

          {{#if @model.trackingNumber}}
            <div class='detail-item'>
              <span class='detail-label'>Tracking:</span>
              <span
                class='detail-value tracking-number'
              >{{@model.trackingNumber}}</span>
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .order-card {
        container-type: inline-size;
        padding: 1rem;
        background: white;
        font-size: 0.8125rem;
        transition: all 0.2s ease;
      }

      .order-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .order-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .order-icon {
        width: 2.5rem;
        height: 2.5rem;
        flex-shrink: 0;
        background: #3b82f6;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .order-icon svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .order-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .order-number {
        font-weight: 600;
        color: #111827;
        font-size: 0.875rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 8rem;
      }

      .order-date {
        color: #6b7280;
        font-size: 0.75rem;
      }

      .order-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.5rem;
        text-align: right;
      }

      .order-total {
        font-size: 1rem;
        font-weight: 700;
        color: #059669;
      }

      .status-pill {
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
      }

      .order-details {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding-top: 0.75rem;
        border-top: 1px solid #f3f4f6;
      }

      .detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }

      .detail-label {
        font-weight: 500;
        color: #6b7280;
        font-size: 0.75rem;
        min-width: 4rem;
        flex-shrink: 0;
      }

      .detail-value {
        color: #374151;
        font-size: 0.75rem;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tracking-number {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        background: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.6875rem;
      }

      /* Container query responsive layouts */
      @container (max-width: 400px) {
        .order-card {
          padding: 0.75rem;
        }

        .order-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .order-left {
          width: 100%;
        }

        .order-right {
          align-items: flex-start;
          width: 100%;
        }

        .order-total {
          font-size: 1.25rem;
        }

        .order-details {
          gap: 0.25rem;
          padding-top: 0.5rem;
        }
      }

      @container (max-width: 280px) {
        .order-card {
          padding: 0.5rem;
          font-size: 0.75rem;
        }

        .order-icon {
          width: 2rem;
          height: 2rem;
        }

        .order-icon svg {
          width: 1rem;
          height: 1rem;
        }

        .order-number {
          font-size: 0.8125rem;
          max-width: 6rem;
        }

        .order-date {
          font-size: 0.6875rem;
        }

        .order-total {
          font-size: 1.125rem;
        }

        .status-pill {
          font-size: 0.6875rem;
          padding: 0.1875rem 0.375rem;
        }

        .detail-value {
          font-size: 0.6875rem;
        }

        .tracking-number {
          font-size: 0.625rem;
          padding: 0.0625rem 0.25rem;
        }
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof OnlineOrder> {
  get customerName() {
    try {
      const email = this.args?.model?.customerEmail ?? '';
      return (
        email
          .split('@')[0]
          .replace(/[._]/g, ' ')
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ') || 'Customer'
      );
    } catch (e) {
      return 'Customer';
    }
  }

  get shortAddress() {
    try {
      const address = this.args?.model?.shippingAddress;
      if (!address) return 'No address';

      // Use city and country for short address, or fall back to full address
      const city = address?.city;
      const country = address.country?.name;

      if (city && country) {
        return `${city}, ${country}`;
      } else if (city) {
        return city;
      } else if (country) {
        return country;
      } else {
        return address.fullAddress || 'No address';
      }
    } catch (e) {
      return 'No address';
    }
  }

  <template>
    <div class='fitted-container'>
      <div class='small-tile-format'>
        <div class='small-tile-content'>
          <div class='small-tile-header'>
            <div class='small-tile-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='9' cy='21' r='1' />
                <circle cx='20' cy='21' r='1' />
                <path
                  d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'
                />
              </svg>
            </div>
            <Pill
              @kind={{if
                (eq @model.orderStatus 'completed')
                'success'
                (if (eq @model.orderStatus 'processing') 'warning' 'secondary')
              }}
              class='small-tile-pill'
            >
              {{if @model.orderStatus @model.orderStatus 'P'}}
            </Pill>
          </div>
          <div class='small-tile-info'>
            <div class='small-tile-primary'>{{if
                @model.orderNumber
                @model.orderNumber
                'Order'
              }}</div>
            <div class='small-tile-price'>{{formatCurrency
                @model.orderTotal
                currency='USD'
                size='short'
                fallback='$0'
              }}</div>
            <div class='small-tile-customer'>{{this.customerName}}</div>
          </div>
        </div>
      </div>

      <div class='regular-tile-format'>
        <div class='regular-tile-content'>
          <div class='regular-tile-header'>
            <div class='regular-tile-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='9' cy='21' r='1' />
                <circle cx='20' cy='21' r='1' />
                <path
                  d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'
                />
              </svg>
            </div>
            <div class='regular-tile-info'>
              <div class='regular-tile-primary'>{{if
                  @model.orderNumber
                  @model.orderNumber
                  'Order'
                }}</div>
              <div class='regular-tile-date'>{{if
                  @model.orderDate
                  (formatDateTime @model.orderDate size='short')
                  'No date'
                }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class='tall-tile-format'>
        <div class='tall-tile-content'>
          <div class='tall-tile-header'>
            <div class='tall-tile-left'>
              <div class='tall-tile-icon'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='9' cy='21' r='1' />
                  <circle cx='20' cy='21' r='1' />
                  <path
                    d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'
                  />
                </svg>
              </div>
              <div class='tall-tile-info'>
                <div class='tall-tile-primary'>{{if
                    @model.orderNumber
                    @model.orderNumber
                    'Order'
                  }}</div>
                <div class='tall-tile-date'>{{if
                    @model.orderDate
                    (formatDateTime @model.orderDate size='medium')
                    'No date'
                  }}</div>
              </div>
            </div>
            <Pill
              @kind={{if
                (eq @model.orderStatus 'completed')
                'success'
                (if (eq @model.orderStatus 'processing') 'warning' 'secondary')
              }}
              class='tall-tile-pill'
            >
              {{if @model.orderStatus @model.orderStatus 'Pending'}}
            </Pill>
          </div>

          <div class='tall-tile-body'>
            <div class='tall-tile-price'>{{formatCurrency
                @model.orderTotal
                currency='USD'
                size='medium'
                fallback='$0.00'
              }}</div>
          </div>

          <div class='tall-tile-details'>
            <div class='tall-tile-detail-item'>
              <span class='tall-tile-detail-label'>Customer:</span>
              <span class='tall-tile-detail-value'>{{if
                  @model.customerEmail
                  @model.customerEmail
                  'No customer'
                }}</span>
            </div>

            {{#if @model.trackingNumber}}
              <div class='tall-tile-detail-item'>
                <span class='tall-tile-detail-label'>Tracking:</span>
                <span
                  class='tall-tile-detail-value tall-tile-tracking'
                >{{@model.trackingNumber}}</span>
              </div>
            {{/if}}

            {{#if @model.shippingAddress}}
              <div class='tall-tile-detail-item'>
                <span class='tall-tile-detail-label'>Shipping:</span>
                <span
                  class='tall-tile-detail-value'
                >{{this.shortAddress}}</span>
              </div>
            {{/if}}
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
      .small-tile-format,
      .regular-tile-format,
      .tall-tile-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.25rem, 2%, 0.75rem);
        box-sizing: border-box;
      }

      /* Format Activation Rules */
      @container (max-width: 200px) {
        .small-tile-format {
          display: flex;
        }
      }

      @container (min-width: 201px) and (max-width: 350px) {
        .regular-tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      @container (min-width: 351px) {
        .tall-tile-format {
          display: flex;
          flex-direction: column;
        }
      }

      /* ============= SMALL TILE FORMAT ============= */
      .small-tile-content {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 100%;
        height: 100%;
        padding: 0.5rem;
        font-size: 0.75rem;
      }

      .small-tile-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.5rem;
      }

      .small-tile-icon {
        width: 1.75rem;
        height: 1.75rem;
        flex-shrink: 0;
        background: #3b82f6;
        border-radius: 0.375rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .small-tile-icon svg {
        width: 1rem;
        height: 1rem;
      }

      .small-tile-pill {
        font-size: 0.625rem;
        padding: 0.125rem 0.25rem;
      }

      .small-tile-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        justify-content: space-between;
        margin-top: 0.25rem;
      }

      .small-tile-primary {
        font-weight: 600;
        color: #111827;
        font-size: 0.8125rem;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .small-tile-price {
        font-weight: 700;
        color: #059669;
        font-size: 0.875rem;
        margin-top: auto;
      }

      .small-tile-customer {
        font-size: 0.625rem;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 0.125rem;
      }

      /* =============  REGULAR TILE FORMAT ============= */
      .regular-tile-content {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 100%;
        height: 100%;
        padding: 0.25rem;
        font-size: 0.8125rem;
      }

      .regular-tile-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .regular-tile-icon {
        width: 2.25rem;
        height: 2.25rem;
        flex-shrink: 0;
        background: #3b82f6;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .regular-tile-icon svg {
        width: 1.125rem;
        height: 1.125rem;
      }

      .regular-tile-info {
        flex: 1;
        min-width: 0;
      }

      .regular-tile-primary {
        font-weight: 600;
        color: #111827;
        font-size: 0.875rem;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .regular-tile-date {
        color: #6b7280;
        font-size: 0.75rem;
        margin-top: 0.125rem;
      }

      .regular-tile-body {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .regular-tile-price {
        font-size: 1.125rem;
        font-weight: 700;
        color: #059669;
      }

      .regular-tile-pill {
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
      }

      .regular-tile-details {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        border-top: 1px solid #f3f4f6;
        padding-top: 0.75rem;
        margin-top: auto;
      }

      .regular-tile-customer {
        font-size: 0.75rem;
        color: #374151;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .regular-tile-tracking {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        font-size: 0.6875rem;
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* =============  TALL TILE FORMAT ============= */
      .tall-tile-content {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 100%;
        height: 100%;
        font-size: 0.8125rem;
      }

      .tall-tile-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
      }

      .tall-tile-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .tall-tile-icon {
        width: 2.5rem;
        height: 2.5rem;
        flex-shrink: 0;
        background: #3b82f6;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .tall-tile-icon svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .tall-tile-info {
        flex: 1;
        min-width: 0;
      }

      .tall-tile-primary {
        font-weight: 600;
        color: #111827;
        font-size: 0.875rem;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tall-tile-date {
        color: #6b7280;
        font-size: 0.75rem;
        margin-top: 0.125rem;
      }

      .tall-tile-pill {
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
      }

      .tall-tile-body {
        text-align: center;
        margin-bottom: 1rem;
      }

      .tall-tile-price {
        font-size: 1.5rem;
        font-weight: 700;
        color: #059669;
      }

      .tall-tile-details {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border-top: 1px solid #f3f4f6;
        padding-top: 1rem;
        margin-top: auto;
      }

      .tall-tile-detail-item {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
      }

      .tall-tile-detail-label {
        font-weight: 500;
        color: #6b7280;
        font-size: 0.75rem;
        min-width: 4rem;
        flex-shrink: 0;
      }

      .tall-tile-detail-value {
        color: #374151;
        font-size: 0.75rem;
        text-align: right;
        word-break: break-word;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .tall-tile-tracking {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        background: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.6875rem;
      }

      /* Responsive adjustments */
      @container (max-height: 200px) {
        .regular-tile-details,
        .tall-tile-details {
          display: none;
        }
      }

      @container (max-height: 150px) {
        .small-tile-customer {
          display: none;
        }
      }

      @container (max-width: 180px) {
        .small-tile-content {
          padding: 0.375rem;
        }
        .small-tile-icon {
          width: 1.5rem;
          height: 1.5rem;
        }
        .small-tile-icon svg {
          width: 0.875rem;
          height: 0.875rem;
        }
      }
    </style>
  </template>
}

export class OnlineOrder extends CardDef {
  static displayName = 'Order';
  static icon = OrderIcon;

  @field orderNumber = contains(StringField);
  @field customerEmail = contains(EmailField);
  @field orderStatus = contains(StringField);
  @field orderTotal = contains(NumberField);
  @field orderDate = contains(DatetimeField);
  @field shippingAddress = contains(AddressField);
  @field paymentMethod = contains(StringField);
  @field trackingNumber = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: OnlineOrder) {
      try {
        const number = this.orderNumber ?? 'Order';
        return number.length > 50 ? number.substring(0, 47) + '...' : number;
      } catch (e) {
        console.error('OnlineOrder: Error computing title', e);
        return 'Order';
      }
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
