import { contains, containsMany, linksTo, field, Card, Component } from 'https://cardstack.com/base/card-api';
import IntegerCard from 'https://cardstack.com/base/integer';
import { Vendor } from './vendor';
import { Details } from './details';
import { LineItem } from './line-item';
import { PaymentMethod } from './payment-method';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';
import { balanceInCurrency, formatUSD } from './currency-format';

let invoiceStyles = initStyleSheet(`
  @font-face {
    font-family: "Open Sans";
    src: url("http://local-realm/fonts/OpenSans-Regular.ttf");
    font-weight: 400;
  }
  @font-face {
    font-family: "Open Sans";
    src: url("http://local-realm/fonts/OpenSans-Bold.ttf");
    font-weight: 700;
  }
  this {
    max-width: 50rem;
    background-color: #fff; 
    border: 1px solid gray; 
    border-radius: 10px; 
    font-family: "Open Sans", Helvetica, Arial, sans-serif;
    font-size: 0.8125rem;
    letter-spacing: 0.01em;
    line-height: 1.25;
    overflow: hidden;
  }
  .header {
    padding: 2rem;
    background-color: #F8F7FA;
  }
  .invoice {
    padding: 2rem;
    display: grid;
    gap: 3rem 0;
  }
  h1 {
    margin: 0;
    font-size: 1.275rem;
    letter-spacing: 0;
    line-height: 1.875;
  }
  h2 {
    margin-top: 0;
    font-size: 1rem;
    letter-spacing: 0.03em;
    line-height: 1.375;
  }
  .label {
    margin-bottom: 1rem;
    color: #A0A0A0;
    font-size: 0.6875rem;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.25;
  }

  .line-items__header {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr; 
  }
  .line-items__header > *:nth-child(2) {
    justify-self: center;
  }
  .line-items__header > *:last-child {
    justify-self: end;
  }
  .line-items__rows {
    padding: 2rem 0;
    border-top: 1px solid #E8E8E8;
    border-bottom: 1px solid #E8E8E8;
  }
  .line-items__rows > * + * {
    margin-top: 1.25rem;
  }

  .payment,
  .payment-methods {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .payment-method + .payment-method {
    margin-top: 1rem;
  }
  .payment-method__currency { 
    font-weight: bold; 
    font-size: 1rem; 
  } 
  .payment-method__amount { 
    color: #5A586A; 
  }

  .balance-due {
    text-align: right;
  }
  .balance-due__total {
    font-size: 1.625rem;
    font-weight: bold;
  }
`);

class InvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <div {{attachStyles invoiceStyles}}>
      <header class="header">
        <h1>Invoice</h1>
      </header>
      <section class="invoice">
        <section class="vendor">
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section class="details">
          <h2>Details</h2>
          <@fields.details />
        </section>
        <section class="line-items">
          <h2>Line Items</h2>
          <header class="line-items__header">
            <div class="label">Goods / services rendered</div>
            <div class="label line-items__qty">Qty</div>
            <div class="label line-items__amount">Amount</div>
          </header>
          <div class="line-items__rows">
            <@fields.lineItems />
          </div>
        </section>
        <div class="payment">
          <section>
            <h2>Payment Methods</h2>
            <div class="payment-methods">
              <div>
                <div class="label">Primary<br> Payment Method</div>
                {{#let @model.primaryPayment as |payment|}}
                  {{#if payment.currency}}
                    <div class="payment-method">
                      <div class="payment-method__currency">{{payment.logo}} {{payment.currency}}</div>
                      <div class="payment-method__amount">
                        {{balanceInCurrency @model.balanceDue payment.exchangeRate payment.currency}}
                      </div>
                    </div>
                  {{/if}}
                {{/let}}
              </div>
              <div>
                <div class="label">Alternate<br> Payment Methods</div>
                {{#each @model.alternatePayments as |payment|}}
                  {{#if payment.currency}}
                    <div class="payment-method">
                      <div class="payment-method__currency">{{payment.logo}} {{payment.currency}}</div>
                      <div class="payment-method__amount">
                        {{balanceInCurrency @model.balanceDue payment.exchangeRate payment.currency}}
                      </div>
                    </div>
                  {{/if}}
                {{/each}}
              </div>
            </div>
          </section>
          <section class="balance-due">
            <div class="label">Balance Due</div>
            <div class="balance-due__total">{{formatUSD @model.balanceDue}}</div>
          </section>
        </div>
      </section>
    </div>
  </template>
}

export class InvoicePacket extends Card {
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = contains(PaymentMethod);
  @field alternatePayments = containsMany(PaymentMethod);
  @field balanceDue = contains(IntegerCard, { computeVia: 
    function(this: InvoicePacket) { 
      return this.lineItems.length === 0 ? 0 : this.lineItems.map(i => i.amount * i.quantity).reduce((a, b) => (a + b)); 
    }
  });

  static embedded = InvoiceTemplate;
  static isolated = InvoiceTemplate;
}