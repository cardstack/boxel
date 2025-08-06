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

import { Pill } from '@cardstack/boxel-ui/components';
import {
  eq,
  formatCurrency,
  formatDateTime,
} from '@cardstack/boxel-ui/helpers';

import OrderIcon from '@cardstack/boxel-icons/shopping-cart';

class EmbeddedTemplate extends Component<typeof OnlineOrder> {
  <template>
    <div class='order-card'>
      <div class='order-header'>
        <div class='order-number'>
          <strong>{{if
              @model.orderNumber
              @model.orderNumber
              'No Order Number'
            }}</strong>
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
          >
            {{if @model.orderStatus @model.orderStatus 'Pending'}}
          </Pill>
        </div>
        <div class='order-total'>{{formatCurrency
            @model.orderTotal
            currency='USD'
            fallback='$0.00'
          }}</div>
      </div>

      <div class='order-details'>
        {{#if @model.customerEmail}}
          <div class='order-detail'>
            <span class='detail-label'>Customer:</span>
            <span>{{@model.customerEmail}}</span>
          </div>
        {{/if}}

        {{#if @model.orderDate}}
          <div class='order-detail'>
            <span class='detail-label'>Date:</span>
            <span>{{formatDateTime @model.orderDate size='medium'}}</span>
          </div>
        {{/if}}

        {{#if @model.trackingNumber}}
          <div class='order-detail'>
            <span class='detail-label'>Tracking:</span>
            <span class='tracking-number'>{{@model.trackingNumber}}</span>
          </div>
        {{/if}}

        {{#if @model.shippingAddress}}
          <div class='order-detail'>
            <span class='detail-label'>Shipping:</span>
            <span class='shipping-address'>{{@model.shippingAddress}}</span>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .order-card {
        padding: 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        background: white;
        font-size: 0.8125rem;
      }

      .order-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.75rem;
      }

      .order-number {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .order-total {
        font-size: 1rem;
        font-weight: 600;
        color: #059669;
      }

      .order-details {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .order-detail {
        display: flex;
        gap: 0.5rem;
      }

      .detail-label {
        font-weight: 500;
        color: #374151;
        min-width: 4rem;
      }

      .tracking-number {
        font-family: ui-monospace, 'SF Mono', Monaco, monospace;
        font-size: 0.75rem;
        background: #f3f4f6;
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
      }

      .shipping-address {
        color: #4b5563;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof OnlineOrder> {
  <template>
    <div class='order-fitted'>
      <div class='order-info'>
        <div class='order-id'>{{if
            @model.orderNumber
            @model.orderNumber
            'No Order Number'
          }}</div>
        <div class='order-status'>
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
          >
            {{if @model.orderStatus @model.orderStatus 'Pending'}}
          </Pill>
        </div>
      </div>
      <div class='order-amount'>{{formatCurrency
          @model.orderTotal
          currency='USD'
          fallback='$0.00'
        }}</div>
    </div>

    <style scoped>
      .order-fitted {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem;
        font-size: 0.75rem;
      }

      .order-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .order-id {
        font-weight: 600;
        color: #111827;
      }

      .order-status {
        display: flex;
        align-items: center;
      }

      .order-amount {
        font-weight: 600;
        color: #059669;
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
  @field shippingAddress = contains(StringField);
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

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
